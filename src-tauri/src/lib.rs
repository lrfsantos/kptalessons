use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_single_instance::init as single_instance_init;

/// Estado do processo auxiliar Node (sidecar) e do perfil temporário.
struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    profile_dir: PathBuf,
    /// Portas locais (servidor de telas + painel) anunciadas pelo sidecar.
    local_ports: Arc<Mutex<HashSet<u16>>>,
}

// ----------------------------------------------------------------
// Perfil temporário: identificador criptográfico + marcador de posse
// ----------------------------------------------------------------

/// 16 bytes de fonte criptográfica (OS), em hex. Nada de timestamp+PID.
fn random_hex() -> String {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).expect("fonte criptográfica indisponível");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn profile_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cna-poc-webview2-{}", random_hex()));
    fs::create_dir_all(&dir).expect("não foi possível criar o perfil temporário do WebView2");
    // Marcador de posse: PID e identidade da execução (diagnóstico; o lock
    // efetivo é o diretório aberto pelo WebView2 — ver cleanup_stale_profiles).
    let owner = format!(
        "{{\"pid\":{},\"id\":\"{}\",\"iniciadoEm\":\"{}\"}}",
        std::process::id(),
        random_hex(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let _ = fs::write(dir.join("owner.json"), owner);
    dir
}

/// Remove perfis residuais de execuções abruptas anteriores.
///
/// Nunca remove por prefixo: só remove o diretório que o S.O. deixa ser
/// renomeado — prova de que nenhum WebView2 o mantém aberto. Perfis de
/// execuções vivas falham no rename (arquivos em uso) e são preservados.
/// O próprio perfil desta execução é ignorado.
fn cleanup_stale_profiles(own: &Path) {
    let prefix = "cna-poc-webview2-";
    let entries = match fs::read_dir(std::env::temp_dir()) {
        Ok(d) => d,
        Err(_) => return, // falha de leitura: não limpar nada
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if !name.starts_with(prefix) || !path.is_dir() || path == own {
            continue;
        }
        let claimed = std::env::temp_dir().join(format!("{name}.removendo-{}", random_hex()));
        if fs::rename(&path, &claimed).is_ok() {
            let _ = fs::remove_dir_all(&claimed);
        }
        // rename falhou => em uso por execução ativa: preservar.
    }
}

// ----------------------------------------------------------------
// Descoberta da porta CDP (5.2)
// ----------------------------------------------------------------

/// Aguarda o arquivo DevToolsActivePort dentro do perfil do WebView2
/// (mecanismo oficial: `--remote-debugging-port=0` faz o próprio
/// WebView2 escolher uma porta livre e registrá-la ali). Primeira linha
/// do arquivo é a porta; segunda, o caminho do endpoint do browser.
fn wait_cdp_port(profile: &Path, timeout: Duration) -> Result<u16, String> {
    let file = profile.join("DevToolsActivePort");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(content) = fs::read_to_string(&file) {
            if let Some(first) = content.lines().next() {
                if let Ok(port) = first.trim().parse::<u16>() {
                    if port != 0 {
                        return Ok(port);
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "DevToolsActivePort não apareceu em {} dentro de {}s",
        file.display(),
        timeout.as_secs()
    ))
}

// ----------------------------------------------------------------
// Allowlist de navegação (5.4)
// ----------------------------------------------------------------

/// Origens permitidas na única janela: a origem Tauri da aplicação,
/// os servidores locais DESTA execução (portas anunciadas pelo sidecar,
/// via HTTP apenas no loopback) e o portal CNA apenas por HTTPS (443).
/// Sem curingas: nada de *.cna.com.br, nem HTTP para o portal.
fn allowed_url(url: &Url, local_ports: &Arc<Mutex<HashSet<u16>>>) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    // Origem exata da aplicação (tauri://localhost e espelho Windows).
    if scheme == "tauri" || (scheme == "http" && host == "tauri.localhost") {
        return true;
    }
    // Servidores locais da execução: somente 127.0.0.1 em porta conhecida.
    if scheme == "http" && host == "127.0.0.1" {
        if let Some(port) = url.port() {
            if let Ok(set) = local_ports.lock() {
                if set.contains(&port) {
                    return true;
                }
            }
        }
        return false;
    }
    // Portal CNA: HTTPS na porta padrão apenas.
    if scheme == "https" && host == "app.cna.com.br" && url.port().is_none() {
        return true;
    }
    false
}

// ----------------------------------------------------------------
// Sidecar: spawn, handshake e encerramento (5.5/5.6/5.7)
// ----------------------------------------------------------------

/// Em produção exige o node.exe EMPACOTADO; em desenvolvimento aceita o
/// caminho explícito via CNA_POC_NODE. Nunca recorre ao node do PATH.
fn node_executable(base: &Path) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Ok(p) = std::env::var("CNA_POC_NODE") {
            return Ok(PathBuf::from(p));
        }
    }
    let bundled = base.join("node.exe");
    if bundled.exists() {
        return Ok(bundled);
    }
    if cfg!(debug_assertions) {
        Err("node.exe não encontrado (defina CNA_POC_NODE em desenvolvimento)".into())
    } else {
        Err("node.exe empacotado ausente em resources/ — instalação incompleta".into())
    }
}

fn spawn_sidecar(base: &Path, cdp_port: u16) -> Result<(Child, std::process::ChildStdin), String> {
    let script = base.join("src-node").join("orquestrador.js");
    if !script.exists() {
        return Err(format!("sidecar.js não encontrado em {}", script.display()));
    }
    let node = node_executable(base)?;
    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg(cdp_port.to_string())
        .current_dir(base)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())  // protocolo estruturado; nada espelhado na UI
        .stderr(Stdio::piped()); // diagnóstico; vai para o log local, não para a UI
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("falha ao iniciar o node empacotado: {e}"))?;
    let stdin = child.stdin.take().expect("stdin pipado");
    Ok((child, stdin))
}

/// Lê o stdout do sidecar: linhas `CNA_*` são o protocolo de handshake/
/// eventos; demais linhas (log técnico) NÃO vão para a interface.
/// EOF no stdout (processo morreu antes do handshake) => FALHA na UI.
fn watch_sidecar_stdout(app: tauri::AppHandle, child: &mut Child, ports: Arc<Mutex<HashSet<u16>>>) {
    let Some(stdout) = child.stdout.take() else { return };
    std::thread::spawn(move || {
        let mut pronto = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(rest) = line.strip_prefix("CNA_SIDECAR_READY ") {
                pronto = true;
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                    let mut set = ports.lock().unwrap();
                    if let Some(p) = v["demoPort"].as_u64() { set.insert(p as u16); }
                    if let Some(p) = v["panelPort"].as_u64() { set.insert(p as u16); }
                    let _ = app.emit("app-estado", ("SIDECAR_PRONTO", rest));
                }
            } else if line.starts_with("CNA_CDP_CONECTADO") {
                let _ = app.emit("app-estado", ("WEBVIEW2_CONECTADO", "{}"));
            } else if let Some(rest) = line.strip_prefix("CNA_PORTS ") {
                // Portas anunciadas depois do handshake (painel criado após a coleta).
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                    let mut set = ports.lock().unwrap();
                    if let Some(arr) = v["ports"].as_array() {
                        for p in arr { if let Some(p) = p.as_u64() { set.insert(p as u16); } }
                    }
                }
            } else if let Some(rest) = line.strip_prefix("CNA_EVENT ") {
                // Evento estruturado do fluxo (sem dados pessoais).
                let _ = app.emit("sidecar-evento", rest);
            }
            // Outras linhas: log técnico do node — não encaminhadas à UI (privacidade).
        }
        if !pronto {
            let msg = serde_json::json!({
                "mensagem": "O aplicativo não conseguiu iniciar o serviço interno. Feche e tente novamente; se persistir, reinstale."
            }).to_string();
            let _ = app.emit("app-estado", ("FALHA_INICIALIZACAO", msg));
        }
    });
}

fn emit_estado(app: &tauri::AppHandle, estado: &str, detalhe: &str) {
    let _ = app.emit("app-estado", (estado, detalhe));
}

/// Encerramento gracioso: stdin "shutdown" -> espera com timeout -> kill.
/// Depois remove o perfil temporário (melhor esforço, com tentativas).
fn shutdown_sidecar(state: &State<'_, SidecarState>) {
    if let Some(mut stdin) = state.stdin.lock().ok().and_then(|mut g| g.take()) {
        let _ = stdin.write_all(b"shutdown\n");
        let _ = stdin.flush();
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let mut guard = state.child.lock().unwrap();
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => { guard.take(); break; }
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    guard.take();
                    break;
                }
                Ok(None) => drop(guard),
                Err(_) => { guard.take(); break; }
            },
            None => break,
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // Os processos internos do WebView2 desligam de forma assíncrona; a pasta
    // pode permanecer travada por alguns instantes. Tenta algumas vezes antes
    // de desistir (a inicialização seguinte também remove residuos).
    for _ in 0..6 {
        if fs::remove_dir_all(&state.profile_dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

// ----------------------------------------------------------------
// Comando: reiniciar o sidecar após falha de inicialização (5.5)
// ----------------------------------------------------------------

#[tauri::command]
fn reiniciar_sidecar(app: tauri::AppHandle, state: State<'_, SidecarState>, base_dir: State<'_, BaseDir>) -> Result<(), String> {
    let base = base_dir.0.clone();
    emit_estado(&app, "INICIANDO", "{}");
    iniciar_sidecar(app, &state, &base)
}

struct BaseDir(PathBuf);

fn iniciar_sidecar(app: tauri::AppHandle, state: &State<'_, SidecarState>, base: &Path) -> Result<(), String> {
    let cdp_port = wait_cdp_port(&state.profile_dir, Duration::from_secs(30))?;
    let (mut child, stdin) = spawn_sidecar(base, cdp_port)?;
    watch_sidecar_stdout(app.clone(), &mut child, state.local_ports.clone());
    if let Ok(mut g) = state.child.lock() { *g = Some(child); }
    if let Ok(mut g) = state.stdin.lock() { *g = Some(stdin); }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let profile = profile_dir();
    cleanup_stale_profiles(&profile);

    let local_ports: Arc<Mutex<HashSet<u16>>> = Arc::new(Mutex::new(HashSet::new()));

    // O loader do WebView2 lê estas variáveis ANTES da criação do primeiro
    // ambiente do navegador (aqui, antes de `.run()`).
    // Em Rust 2024, set_var é unsafe; o processo é single-threaded até aqui.
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            // Porta 0: o próprio WebView2 escolhe uma porta livre e registra
            // o endpoint em <perfil>/DevToolsActivePort (mecanismo oficial).
            "--remote-debugging-port=0",
        );
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profile);
    }

    tauri::Builder::default()
        .plugin(single_instance_init(|app, _args, _cwd| {
            // Segunda instância: foca a janela existente e encerra.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .manage(SidecarState {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            profile_dir: profile.clone(),
            local_ports: local_ports.clone(),
        })
        .setup(move |app| {
            let base = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().expect("src-tauri sem pai").to_path_buf()
            } else {
                // Produção: recursos em <exe>\resources (layout padrão do Tauri).
                std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("resources"))).unwrap_or_else(|| PathBuf::from("."))
            };
            app.manage(BaseDir(base.clone()));

            let ports_for_nav = local_ports.clone();
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Corretor CNA")
                .inner_size(1100.0, 760.0)
                .min_inner_size(820.0, 620.0)
                .resizable(true)
                .center()
                .on_navigation(move |url| allowed_url(url, &ports_for_nav))
                .build();
            let win = match win {
                Ok(w) => w,
                Err(e) => {
                    emit_estado(app.handle(), "FALHA_INICIALIZACAO", &format!("{{\"mensagem\":\"Falha ao criar a janela: {e}\"}}"));
                    return Ok(());
                }
            };

            // Estado inicial da UI; sidecar inicia depois que o WebView2
            // registrar a porta CDP (DevToolsActivePort).
            let _ = win.emit("app-estado", ("INICIANDO", "{}"));
            let state = app.state::<SidecarState>();
            if let Err(e) = iniciar_sidecar(app.handle().clone(), &state, &base) {
                let msg = serde_json::json!({ "mensagem": e }).to_string();
                emit_estado(app.handle(), "FALHA_INICIALIZACAO", &msg);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![reiniciar_sidecar])
        .build(tauri::generate_context!())
        .expect("erro ao construir o aplicativo Tauri")
        .run(|app_handle, event| match event {
            RunEvent::Exit | RunEvent::ExitRequested { .. } => {
                shutdown_sidecar(&app_handle.state::<SidecarState>());
            }
            _ => {}
        });
}
