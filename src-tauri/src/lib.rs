use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_single_instance::init as single_instance_init;

/// Origens locais autorizadas DESTA execução: portas do servidor de telas
/// (caminhos fixos conhecidos) e porta+prefixo/token do painel.
#[derive(Default)]
struct OrigensLocais {
    telas_ports: Mutex<HashSet<u16>>,
    /// (porta do painel, prefixo de caminho "/<token>/") anunciados no handshake.
    painel: Mutex<Option<(u16, String)>>,
}

/// Estado do processo auxiliar Node (sidecar) e do perfil temporário.
struct SidecarState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    profile_dir: PathBuf,
    /// Origens locais (servidor de telas + painel) anunciadas pelo sidecar.
    origens: Arc<OrigensLocais>,
}

/// Caminhos autorizados do servidor de telas (rotas fixas de src-node/telas.js).
const TELAS_PATHS: [&str; 8] = [
    "/",
    "/progresso",
    "/conclusao",
    "/styles.css",
    "/fluent.css",
    "/app.js",
    "/progresso.js",
    "/conclusao.js",
];

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
    // O WebView2 cria uma subpasta EBWebView dentro da pasta de dados;
    // o arquivo pode ficar em <perfil>/DevToolsActivePort ou <perfil>/EBWebView/DevToolsActivePort.
    let candidates = [
        profile.join("DevToolsActivePort"),
        profile.join("EBWebView").join("DevToolsActivePort"),
    ];
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        for file in candidates.iter() {
            if let Ok(content) = fs::read_to_string(file) {
                if let Some(first) = content.lines().next() {
                    if let Ok(port) = first.trim().parse::<u16>() {
                        if port != 0 {
                            return Ok(port);
                        }
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "DevToolsActivePort não apareceu em {} dentro de {}s",
        candidates[0].display(),
        timeout.as_secs()
    ))
}

// ----------------------------------------------------------------
// Allowlist de navegação (5.4)
// ----------------------------------------------------------------

/// Origens permitidas na única janela: a origem Tauri EXATA da aplicação,
/// os servidores locais DESTA execução (somente 127.0.0.1 em porta anunciada,
/// com caminho/token autorizado, via HTTP apenas no loopback) e o portal CNA
/// apenas por HTTPS (443). Sem curingas: nada de *.cna.com.br, nem HTTP para
/// o portal, nem porta fora do padrão.
fn allowed_url(url: &Url, origens: &OrigensLocais) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    // Origem exata da aplicação: tauri://localhost (host obrigatório) e o
    // espelho Windows http://tauri.localhost na porta padrão apenas.
    if (scheme == "tauri" && host == "localhost")
        || (scheme == "http" && host == "tauri.localhost" && url.port().is_none())
    {
        return true;
    }
    // Servidores locais da execução: somente 127.0.0.1 em porta conhecida E
    // caminho autorizado (telas: rotas fixas; painel: prefixo com o token
    // desta execução). Nada de porta não anunciada ou caminho livre.
    if scheme == "http" && host == "127.0.0.1" {
        if let Some(port) = url.port() {
            let caminho = url.path();
            if let Ok(set) = origens.telas_ports.lock() {
                if set.contains(&port) && TELAS_PATHS.contains(&caminho) {
                    return true;
                }
            }
            if let Ok(guard) = origens.painel.lock() {
                if let Some((porta_painel, prefixo)) = guard.as_ref() {
                    if *porta_painel == port && caminho.starts_with(prefixo.as_str()) {
                        return true;
                    }
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
        .stdout(Stdio::piped()) // protocolo estruturado; nada espelhado na UI
        .stderr(Stdio::piped()); // diagnóstico; vai para o log local, não para a UI
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("falha ao iniciar o node empacotado: {e}"))?;
    let stdin = child.stdin.take().expect("stdin pipado");
    Ok((child, stdin))
}

/// Estado emitido à UI quando o stdout do sidecar chega ao fim (EOF = processo
/// morreu). Antes do handshake: falha de inicialização; depois: queda inesperada
/// — a interface NUNCA fica aparentemente funcional sem comunicação.
fn estado_no_eof(pronto: bool) -> &'static str {
    if pronto {
        "FALHA_SIDECAR"
    } else {
        "FALHA_INICIALIZACAO"
    }
}

/// Extrai a mensagem humana do detalhe JSON emitido com o estado.
fn mensagem_do_detalhe(detalhe: &str) -> String {
    serde_json::from_str::<serde_json::Value>(detalhe)
        .ok()
        .and_then(|v| v.get("mensagem").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default()
}

/// Script do overlay global de falha. Fonte ÚNICA em poc-ui/falha-global.js
/// (também testada em Node); o placeholder é substituído por uma string JSON
/// (sempre válida em JS, já com aspas e escapes corretos).
fn script_falha_global(mensagem: &str) -> String {
    let json = serde_json::to_string(mensagem).unwrap_or_else(|_| "\"\"".into());
    include_str!("../../poc-ui/falha-global.js").replace("__CNA_MENSAGEM__", &json)
}

/// Falha global (queda do sidecar / falha de inicialização): emite o estado
/// E injeta o overlay em QUALQUER página atualmente aberta — solução
/// centralizada na camada Tauri (rodada 4, item 2), sem listeners por página.
/// O overlay bloqueia a interação com a página por baixo (nada parece
/// funcional) e oferece recuperação segura (reiniciar_sidecar, que encerra o
/// sidecar anterior antes de criar outro — sem reinicialização duplicada).
fn mostrar_falha_global(app: &tauri::AppHandle, estado: &str, detalhe: &str) {
    let _ = app.emit("app-estado", (estado, detalhe));
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(&script_falha_global(&mensagem_do_detalhe(detalhe)));
    }
}

/// Drena o stderr do sidecar continuamente: sem isso, pipes cheios travam o
/// processo. Conteúdo técnico é descartado (nunca encaminhado à UI/privacidade).
fn drenar_stderr(child: &mut Child) {
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                if line.is_err() {
                    break;
                }
                // Diagnóstico técnico do node: consumido e descartado.
            }
        });
    }
}

/// Lê o stdout do sidecar: linhas `CNA_*` são o protocolo de handshake/
/// eventos; demais linhas (log técnico) NÃO vão para a interface.
/// EOF no stdout (processo morreu) => FALHA estruturada na UI, ANTES ou
/// DEPOIS do handshake.
fn watch_sidecar_stdout(app: tauri::AppHandle, child: &mut Child, origens: Arc<OrigensLocais>) {
    drenar_stderr(child);
    let Some(stdout) = child.stdout.take() else {
        return;
    };
    std::thread::spawn(move || {
        let mut pronto = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Some(rest) = line.strip_prefix("CNA_SIDECAR_READY ") {
                pronto = true;
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                    if let Some(p) = v["demoPort"].as_u64() {
                        origens.telas_ports.lock().unwrap().insert(p as u16);
                    }
                    let _ = app.emit("app-estado", ("SIDECAR_PRONTO", rest));
                }
            } else if line.starts_with("CNA_CDP_CONECTADO") {
                let _ = app.emit("app-estado", ("WEBVIEW2_CONECTADO", "{}"));
            } else if let Some(rest) = line.strip_prefix("CNA_PORTS ") {
                // Origens anunciadas depois do handshake: telas + painel (porta e token).
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(rest) {
                    if let Some(p) = v["telasPort"].as_u64() {
                        origens.telas_ports.lock().unwrap().insert(p as u16);
                    }
                    if let (Some(porta), Some(caminho)) =
                        (v["painelPort"].as_u64(), v["painelPath"].as_str())
                    {
                        if caminho.starts_with('/') && caminho.len() >= 2 {
                            *origens.painel.lock().unwrap() =
                                Some((porta as u16, caminho.to_string()));
                        }
                    }
                }
            } else if let Some(rest) = line.strip_prefix("CNA_EVENT ") {
                // Evento estruturado do fluxo (sem dados pessoais).
                let _ = app.emit("sidecar-evento", rest);
            }
            // Outras linhas: log técnico do node — não encaminhadas à UI (privacidade).
        }
        let msg = if pronto {
            serde_json::json!({
                "mensagem": "O serviço interno foi encerrado inesperadamente. Tente reiniciar; se persistir, feche e abra o aplicativo novamente."
            }).to_string()
        } else {
            serde_json::json!({
                "mensagem": "O aplicativo não conseguiu iniciar o serviço interno. Feche e tente novamente; se persistir, reinstale."
            }).to_string()
        };
        mostrar_falha_global(&app, estado_no_eof(pronto), &msg);
    });
}

fn emit_estado(app: &tauri::AppHandle, estado: &str, detalhe: &str) {
    let _ = app.emit("app-estado", (estado, detalhe));
}

/// Encerra o sidecar anterior (gracioso via stdin "shutdown" -> espera com
/// timeout -> kill). Usado no fim do app E antes de reinicializar, impedindo
/// reinicialização duplicada com processos órfãos.
fn parar_sidecar(state: &State<'_, SidecarState>) {
    if let Some(mut stdin) = state.stdin.lock().ok().and_then(|mut g| g.take()) {
        let _ = stdin.write_all(b"shutdown\n");
        let _ = stdin.flush();
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let mut guard = state.child.lock().unwrap();
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    guard.take();
                    break;
                }
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    guard.take();
                    break;
                }
                Ok(None) => drop(guard),
                Err(_) => {
                    guard.take();
                    break;
                }
            },
            None => break,
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // As portas/origens pertencem ao processo anterior: limpa antes de outro spawn.
    if let Ok(mut set) = state.origens.telas_ports.lock() {
        set.clear();
    }
    *state.origens.painel.lock().unwrap() = None;
}

/// Encerramento do aplicativo: para o sidecar e remove o perfil temporário
/// (melhor esforço, com tentativas — o WebView2 pode demorar a soltar a pasta).
fn shutdown_sidecar(state: &State<'_, SidecarState>) {
    parar_sidecar(state);
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
fn reiniciar_sidecar(
    app: tauri::AppHandle,
    state: State<'_, SidecarState>,
    base_dir: State<'_, BaseDir>,
) -> Result<(), String> {
    let base = base_dir.0.clone();
    emit_estado(&app, "INICIANDO", "{}");
    iniciar_sidecar(app, &state, &base)
}

struct BaseDir(PathBuf);

fn iniciar_sidecar(
    app: tauri::AppHandle,
    state: &State<'_, SidecarState>,
    base: &Path,
) -> Result<(), String> {
    // Impede reinicialização duplicada: encerra corretamente qualquer
    // processo anterior antes de iniciar outro sidecar.
    parar_sidecar(state);
    let cdp_port = wait_cdp_port(&state.profile_dir, Duration::from_secs(30))?;
    let (mut child, stdin) = spawn_sidecar(base, cdp_port)?;
    watch_sidecar_stdout(app.clone(), &mut child, state.origens.clone());
    if let Ok(mut g) = state.child.lock() {
        *g = Some(child);
    }
    if let Ok(mut g) = state.stdin.lock() {
        *g = Some(stdin);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origens(telas: &[u16], painel: Option<(u16, &str)>) -> Arc<OrigensLocais> {
        let o = Arc::new(OrigensLocais::default());
        for p in telas {
            o.telas_ports.lock().unwrap().insert(*p);
        }
        if let Some((porta, prefixo)) = painel {
            *o.painel.lock().unwrap() = Some((porta, prefixo.to_string()));
        }
        o
    }

    // ---- Item 4: allowlist de navegação --------------------------------

    #[test]
    fn origem_tauri_permitida() {
        let o = origens(&[], None);
        assert!(allowed_url(
            &Url::parse("tauri://localhost/index.html").unwrap(),
            &o
        ));
        assert!(allowed_url(
            &Url::parse("http://tauri.localhost/index.html").unwrap(),
            &o
        ));
    }

    #[test]
    fn origem_tauri_incorreta_é_bloqueada() {
        let o = origens(&[], None);
        // Host Tauri incorreto (origem de outro app/falso positivo de esquema).
        assert!(!allowed_url(
            &Url::parse("tauri://evil/index.html").unwrap(),
            &o
        ));
        assert!(!allowed_url(
            &Url::parse("tauri://outro.localhost/").unwrap(),
            &o
        ));
        // Porta Tauri inesperada no espelho Windows (a URL crate normaliza
        // :80 explícito para o padrão — mesma origem, permitido).
        assert!(!allowed_url(
            &Url::parse("http://tauri.localhost:8080/index.html").unwrap(),
            &o
        ));
    }

    #[test]
    fn servidor_local_somente_porta_e_caminho_anunciados() {
        let o = origens(&[51234], Some((55555, "/abcdef123/")));
        // Servidor de telas: porta anunciada + rota fixa.
        assert!(allowed_url(
            &Url::parse("http://127.0.0.1:51234/conclusao?erro=x").unwrap(),
            &o
        ));
        // Painel: porta + token desta execução.
        assert!(allowed_url(
            &Url::parse("http://127.0.0.1:55555/abcdef123/").unwrap(),
            &o
        ));
        // Host local incorreto (não 127.0.0.1).
        assert!(!allowed_url(
            &Url::parse("http://localhost:51234/").unwrap(),
            &o
        ));
        assert!(!allowed_url(
            &Url::parse("http://192.168.0.10:51234/").unwrap(),
            &o
        ));
        // Porta local não anunciada.
        assert!(!allowed_url(
            &Url::parse("http://127.0.0.1:9999/").unwrap(),
            &o
        ));
        // Caminho local não autorizado (porta certa, caminho fora da lista).
        assert!(!allowed_url(
            &Url::parse("http://127.0.0.1:51234/qualquer-coisa").unwrap(),
            &o
        ));
        // Token de painel incorreto (prefixo diferente do anunciado).
        assert!(!allowed_url(
            &Url::parse("http://127.0.0.1:55555/token-falso/").unwrap(),
            &o
        ));
    }

    #[test]
    fn portal_cna_somente_https_porta_padrao() {
        let o = origens(&[], None);
        assert!(allowed_url(
            &Url::parse("https://app.cna.com.br/login").unwrap(),
            &o
        ));
        // HTTP para o portal: proibido.
        assert!(!allowed_url(
            &Url::parse("http://app.cna.com.br/login").unwrap(),
            &o
        ));
        // Porta não padrão: proibida.
        assert!(!allowed_url(
            &Url::parse("https://app.cna.com.br:8443/login").unwrap(),
            &o
        ));
        // Domínio CNA malicioso (sem curingas).
        assert!(!allowed_url(
            &Url::parse("https://malicioso.cna.com.br/login").unwrap(),
            &o
        ));
        assert!(!allowed_url(
            &Url::parse("https://app.cna.com.br.evil.example/login").unwrap(),
            &o
        ));
        // Domínio externo.
        assert!(!allowed_url(
            &Url::parse("https://evil.example/").unwrap(),
            &o
        ));
    }

    // ---- Item 3: monitoramento do sidecar ------------------------------

    #[test]
    fn eof_do_stdout_informa_falha_antes_e_depois_do_handshake() {
        // Antes do handshake: falha de inicialização (comportamento existente).
        assert_eq!(estado_no_eof(false), "FALHA_INICIALIZACAO");
        // Depois do handshake: queda inesperada estruturada (novo).
        assert_eq!(estado_no_eof(true), "FALHA_SIDECAR");
    }

    // ---- Item 2 (rodada 4): falha global centralizada em qualquer tela ---

    #[test]
    fn mensagem_do_detalhe_extrai_mensagem_do_json() {
        assert_eq!(
            mensagem_do_detalhe(r#"{"mensagem":"serviço caiu"}"#),
            "serviço caiu"
        );
        // Detalhe sem mensagem (ou inválido): string vazia, nunca panic.
        assert_eq!(mensagem_do_detalhe("{}"), "");
        assert_eq!(mensagem_do_detalhe("não é json"), "");
    }

    #[test]
    fn script_falha_global_tem_mensagem_escapada_e_sem_placeholder() {
        // Mensagem com aspas/acentos: precisa sair como string JSON válida.
        let s = script_falha_global("Serviço \"interrompido\" — reinicie.");
        assert!(!s.contains("__CNA_MENSAGEM__"), "placeholder substituído");
        assert!(s.contains(r#""Serviço \"interrompido\" — reinicie.""#));
        assert!(s.contains("cna-falha-global"), "overlay global com id fixo");
        assert!(
            s.contains("reiniciar_sidecar"),
            "recuperação segura via comando"
        );
        // Idempotência embutida: segundo overlay não duplica.
        assert!(s.contains("getElementById('cna-falha-global')"));
    }
}

pub fn run() {
    let profile = profile_dir();
    cleanup_stale_profiles(&profile);

    let local_ports: Arc<OrigensLocais> = Arc::new(OrigensLocais::default());

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
            origens: local_ports.clone(),
        })
        .setup(move |app| {
            let base = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .expect("src-tauri sem pai")
                    .to_path_buf()
            } else {
                // Produção: recursos em <exe>\resources (layout padrão do Tauri).
                std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.join("resources")))
                    .unwrap_or_else(|| PathBuf::from("."))
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
                    mostrar_falha_global(
                        app.handle(),
                        "FALHA_INICIALIZACAO",
                        &format!("{{\"mensagem\":\"Falha ao criar a janela: {e}\"}}"),
                    );
                    return Ok(());
                }
            };

            // Estado inicial da UI; sidecar inicia depois que o WebView2
            // registrar a porta CDP (DevToolsActivePort).
            let _ = win.emit("app-estado", ("INICIANDO", "{}"));
            let state = app.state::<SidecarState>();
            if let Err(e) = iniciar_sidecar(app.handle().clone(), &state, &base) {
                let msg = serde_json::json!({ "mensagem": e }).to_string();
                mostrar_falha_global(app.handle(), "FALHA_INICIALIZACAO", &msg);
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
