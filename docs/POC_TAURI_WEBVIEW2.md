# Prova de Conceito — Tauri 2 + WebView2 em janela única

**Data:** 2026-11-20 · **Branch:** `poc/tauri-webview2-single-window` · **Base:** `master` (`3f2145b`)

Esta é uma prova de conceito isolada. Ela **não** altera a distribuição atual nem o
comportamento de `npm run corrigir`.

---

## 1. Objetivo

Substituir a distribuição atual (Node portátil + Chromium portátil + janelas separadas)
por um aplicativo desktop Windows de **janela única**:

- Janela nativa Tauri renderizando interface + portal CNA em **WebView2**;
- Processo auxiliar Node **invisível** que controla **esse mesmo WebView2** via Playwright/CDP;
- Nenhum Chromium portátil, nenhum PowerShell/CMD visível, nenhum navegador externo.

## 2. Arquitetura implementada

```text
Corretor CNA.exe (Tauri 2)
├── WebviewWindow "main" (1100×760, mín 820×620)
│   └── WebView2 (runtime Evergreen do Windows)
│       ├── poc-ui/index.html        (Tela A — Início)
│       ├── https://app.cna.com.br/login  (Tela B — login, sem credenciais)
│       ├── demo /progresso          (Tela C — progresso)
│       ├── Painel Local real        (lib/panel.js, fixture sintética)
│       └── demo /conclusao          (Tela E — conclusão da demonstração)
└── node.exe (sidecar, CREATE_NO_WINDOW)
    ├── playwright-core -> chromium.connectOverCDP(http://127.0.0.1:<porta>)
    ├── servidor HTTP local 127.0.0.1 (painel + telas da demo)
    └── evidências: %TEMP%\cna-poc-evidencias-<ts>\ (JSONL + PNG)
```

O lado Rust (`src-tauri/src/lib.rs`) é responsável por:

1. Reservar porta livre (`127.0.0.1:0`) para o CDP.
2. Criar perfil temporário `%TEMP%\cna-poc-webview2-*` e remover resíduos de execuções anteriores.
3. Definir **antes da criação do WebView2**:
   - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<porta>`
   - `WEBVIEW2_USER_DATA_FOLDER=<perfil temporário>`
4. Criar a única janela com `WebviewWindowBuilder` + `on_navigation` (allowlist).
5. Iniciar o sidecar Node com `CREATE_NO_WINDOW`, passando a porta CDP.
6. No encerramento: matar o sidecar, aguardar e remover o perfil temporário.

## 3. Versões

| Componente | Versão |
|---|---|
| Tauri | 2.12.7 |
| tauri-build | 2.7.6 |
| Rust | 1.100.0 (x86_64-pc-windows-msvc) |
| MSVC | BuildTools 2022 14.44.35207 |
| Node | 24.19.0 x64 (portátil reaproveitado) |
| playwright-core | 1.65.1 (mesma do `package-lock.json`) |
| WebView2 | Evergreen (runtime do Windows) |

## 4. Como o CDP foi ativado

- Porta **dinâmica** (nunca fixa, nunca 9222 na distribuição).
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` definido no processo antes da criação do WebView2.
- `WEBVIEW2_USER_DATA_FOLDER` aponta para perfil temporário exclusivo por execução.
- **Não** usamos `WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER`.
- Conexão sempre em `http://127.0.0.1:<porta>`.

## 5. Como o Playwright se conecta

`src-node/sidecar.js`:

```js
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];          // a página da janela visível
await page.goto('https://app.cna.com.br/login');  // mesma janela
```

O `connectOverCDP` **não abre janela nenhuma**: ele assume o navegador que já existe.
Verificado em `tests/poc/arquitetura.test.js`: uma única página/contexto, navegação
externa sem criar nova janela.

## 6. Perfil temporário

- Criado por execução em `%TEMP%\cna-poc-webview2-<pid>-<rand>`.
- Nunca reutiliza cookies entre execuções (contexto novo por execução).
- Removido no fechamento; resíduos antigos são removidos no início (best effort, só no
  padrão de nome próprio — nunca pastas de terceiros).

## 7. Sidecar: início e fim

- Início: `Command::new(node).args(["sidecar.js", porta])` com `CREATE_NO_WINDOW`
  (sem console). Sem plugin Shell, sem `cmd.exe`/PowerShell.
- Fim: evento de exit do Tauri mata o child (`kill` + `wait`) e remove o perfil.
- Nenhum caminho absoluto de desenvolvimento: em dev usa `CARGO_MANIFEST_DIR`;
  em produção usa o diretório de recursos ao lado do executável.

## 8. Como executar localmente

```powershell
# 1) empacotar recursos (node.exe + scripts + playwright-core)
.\scripts\poc-package-resources.ps1

# 2) rodar a prova de conceito
cd src-tauri
$env:CNA_POC_NODE = "C:\Users\luiza\Desktop\corretor cna\runtime\node\node.exe"
npx @tauri-apps/cli@2 dev
```

Evidências (JSONL + PNG) em `%TEMP%\cna-poc-evidencias-<timestamp>\`.

## 9. Gerar o instalador

```powershell
cd src-tauri
npx @tauri-apps/cli@2 build
```

- NSIS `.exe`, `webviewInstallMode: downloadBootstrapper` (bootstrapper do WebView2 Evergreen).
- Recursos embutidos: `node.exe`, `src-node/`, `lib/`, `ui/painel.html`,
  `node_modules/playwright-core/` (nenhum navegador).

## 10. Segurança do CDP

- Porta aleatória; bind apenas em loopback (o CDP do Chromium escuta em `127.0.0.1`).
- Endpoint nunca exposto na interface nem em logs (o sidecar registra só `endpointLoopback: true`).
- Nenhuma regra de firewall criada.
- **Limitação assumida:** uma porta aleatória **não é autenticação**. Outros processos
  locais podem tentar se conectar à porta CDP enquanto o app roda. Para distribuição
  real, considerar ligação aNamedPipe ou outra restrição adicional. Este risco está
  documentado aqui e não é ocultado.
- Allowlist de navegação: aplicação local (`tauri:`/`tauri.localhost`), loopback e
  **somente** `https://app.cna.com.br`. Demais origens são bloqueadas.

## 11. Medições

### Distribuição atual (medição 2026-11-20)

| Item | Tamanho |
|---|---:|
| Instalação portátil total | 0,84 GB |
| Chromium portátil (`runtime/ms-playwright`) | 742,7 MB |
| Node portátil (`runtime/node`) | 101,2 MB |
| `node_modules` | 13,3 MB |
| Executáveis `.exe` na instalação | 11 |

### POC Tauri (recursos medidos)

| Item | Tamanho |
|---|---:|
| `node.exe` empacotado | 88,5 MB |
| `playwright-core` | 13,3 MB |
| Total de recursos do sidecar | 101,96 MB |
| Chromium portátil | **0 MB (ausente)** |
| Instalador `.exe` | _a preencher após build_ |
| Instalado em disco | _a preencher após build_ |

## 12. Testes

- `npm test` (suite existente + `tests/poc/*`): deve permanecer verde.
- `tests/poc/painel-fixture.test.js`: fixture sintética + parser real (nonce errado,
  ref duplicada, classificação inválida rejeitados; válido aceito).
- `tests/poc/arquitetura.test.js`: validação estrutural quando o app está aberto
  (`CNA_POC_CDP_PORT`); pula automaticamente caso contrário.
- CI: job `tauri-poc` (Windows) com `cargo check` + testes + build best-effort.

## 13. Limitações técnicas

- A demonstração usa **dados fictícios**; nenhum portal real é alterado.
- O executor **não** é invocado; nada é finalizado.
- Interface é uma primeira versão orientada a Material Design 3; polimento visual é
  trabalho futuro.
- Empacotamento de recursos depende de `scripts/poc-package-resources.ps1` antes do build.
- Windows-only nesta fase.

## 14. Próximas etapas para uma migração real

1. Portar o fluxo completo (login/coleta) para o sidecar, mantendo o WebView2 como
   único navegador visível.
2. Fortalecer o CDP (pipe/named pipe, handshake de token) para distribuição.
3. Migrar `ui/inicio.html`, `ui/painel.html` para o design system M3.
4. Medir memória em repouso e tempo até o painel; comparar com a distribuição atual.
5. Instalador de produção + assinatura/AV testing.
