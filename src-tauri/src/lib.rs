use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder};

/// Estado do processo auxiliar Node (sidecar) e do perfil temporário.
struct SidecarState {
    child: Mutex<Option<Child>>,
    profile_dir: PathBuf,
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .expect("nÃ£o foi possÃ­vel reservar uma porta local livre")
}

fn profile_dir() -> PathBuf {
    let base = std::env::temp_dir();
    let unique = std::process::id().to_string() + "-" + &rand_suffix();
    let dir = base.join(format!("cna-poc-webview2-{unique}"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn rand_suffix() -> String {
    // 16 hex derivados do tempo + pid (sem dependÃªncia extra).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x = nanos as u64 ^ ((std::process::id() as u64) << 32);
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::new();
    for _ in 0..16 {
        s.push(HEX[(x & 0xF) as usize] as char);
        x = x.rotate_left(4).wrapping_add(0x9E3779B97F4A7C15);
    }
    s
}

/// Remove perfis residuais de execuÃ§Ãµes abruptas anteriores (best effort).
/// Nunca remove nada fora do padrÃ£o prÃ³prio deste aplicativo.
fn cleanup_stale_profiles() {
    let prefix = "cna-poc-webview2-";
    let dir = match fs::read_dir(std::env::temp_dir()) {
        Ok(d) => d,
        Err(_) => return,
    };
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(prefix) || !entry.path().is_dir() {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path()); // em uso -> falha silenciosamente
    }
}

fn repo_base() -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri sem pai")
            .to_path_buf()
    } else {
        // Producao: recursos ficam em <exe>\resources (layout padrao do Tauri).
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("resources")))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn node_executable(base: &Path) -> PathBuf {
    if let Ok(p) = std::env::var("CNA_POC_NODE") {
        return PathBuf::from(p);
    }
    let bundled = base.join("node.exe");
    if bundled.exists() {
        return bundled;
    }
    PathBuf::from("node")
}

/// Origens permitidas na Ãºnica janela: aplicaÃ§Ã£o local, servidores locais
/// (painel/demonstraÃ§Ã£o) e SOMENTE o domÃ­nio do portal CNA.
fn allowed_url(url: &Url) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    if scheme == "tauri" || (scheme == "http" && host == "tauri.localhost") {
        return true;
    }
    if scheme == "http" || scheme == "https" {
        if host == "localhost" || host == "127.0.0.1" {
            return true;
        }
        // Dominio real do fluxo de login (documentado no cÃ³digo de produÃ§Ã£o).
        if host == "app.cna.com.br" {
            return true;
        }
    }
    false
}

fn spawn_sidecar(base: &Path, port: u16) -> std::io::Result<Child> {
    let script = base.join("src-node").join("sidecar.js");
    let node = node_executable(base);
    let args = [
        script.to_string_lossy().into_owned(),
        port.to_string(),
    ];
    let mut cmd = Command::new(&node);
    cmd.args(&args)
        .current_dir(base)
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    // Janela de console invisÃ­vel no Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

fn shutdown_sidecar(state: &State<'_, SidecarState>) {
    if let Some(mut child) = state.child.lock().ok().and_then(|mut g| g.take()) {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = fs::remove_dir_all(&state.profile_dir);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cleanup_stale_profiles();

    let port = free_port();
    let profile = profile_dir();

    // O loader do WebView2 lÃª estas variÃ¡veis ANTES da criaÃ§Ã£o do primeiro
    // ambiente do navegador (aqui, antes de `.run()`).
    // Em Rust 2024, set_var e unsafe; o processo e single-threaded ate aqui.
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            format!("--remote-debugging-port={port}"),
        );
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profile);
    }

    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            profile_dir: profile.clone(),
        })
        .setup(move |app| {
            let base = repo_base();
            match spawn_sidecar(&base, port) {
                Ok(child) => {
                    if let Ok(mut g) = app.state::<SidecarState>().child.lock() {
                        *g = Some(child);
                    }
                }
                Err(e) => {
                    eprintln!("Falha ao iniciar o auxiliar Node: {e}");
                }
            }

            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Corretor CNA")
                .inner_size(1100.0, 760.0)
                .min_inner_size(820.0, 620.0)
                .resizable(true)
                .center()
                .on_navigation(|url| allowed_url(url))
                .build();
            if let Err(e) = win {
                eprintln!("Falha ao criar a janela principal: {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao construir o aplicativo Tauri")
        .run(|app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                shutdown_sidecar(&app_handle.state::<SidecarState>());
            }
            _ => {}
        });
}
