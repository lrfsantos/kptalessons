# Corretor CNA — Arquitetura Tauri + WebView2 (janela única)

Documento técnico do aplicativo Windows de janela única (branch
`feat/tauri-webview2-real-flow-fluent`). Substitui a arquitetura de
processos separados com Chromium portátil, mantendo o fluxo antigo
(`npm run corrigir`) funcionando em paralelo até a validação completa.

## Visão geral

- **Um executável Tauri**, **uma janela nativa Windows**, **um WebView2 visível**.
- **Um processo Node auxiliar (sidecar) invisível** (`src-node/orquestrador.js`),
  iniciado com `CREATE_NO_WINDOW`, sem console.
- **Uma única conexão Playwright/CDP** com o WebView2, por `127.0.0.1` (loopback).
- Nenhum Chromium portátil, nenhum navegador externo, nenhum terminal visível.

```
┌─────────────────────────── Janela única (Tauri) ───────────────────────────┐
│  WebView2 visível: início → portal CNA (login manual) → coleta            │
│  (barra de progresso) → painel local → aplicação → conclusão              │
└───────────────▲──────────────────────────────────────────▲────────────────┘
                │ CDP (loopback, porta dinâmica)           │ HTTP local
┌───────────────┴──────────────────────────────────────────┴───────────────┐
│ Orquestrador Node (sidecar invisível)                                     │
│  performLogin() · collectActivities() · createPanel() ·                   │
│  applyAcceptedCorrections()  ← mesmas funções do fluxo CLI antigo         │
└──────────────────────────────────────────────────────────────────────────┘
```

## Descoberta da porta CDP

O Rust define `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0`.
O próprio WebView2 escolhe uma porta livre e grava o endpoint em
`<perfil>\EBWebView\DevToolsActivePort` (subpasta criada pelo runtime —
validado na prática; também há fallback para o nível raiz do perfil).
O Rust faz polling do arquivo (timeout de 30 s) e só então inicia o
orquestrador com a porta real. Sem adivinhação de porta, sem corrida de
reserva de socket.

## Protocolo Rust ⇄ Node

O stdout do orquestrador é lido pelo Rust (nunca espelhado na interface):

| Linha                       | Significado                                    |
|-----------------------------|------------------------------------------------|
| `CNA_SIDECAR_READY {...}`   | Servidor local pronto; portas vão à allowlist  |
| `CNA_CDP_CONECTADO`         | Playwright conectado ao WebView2               |
| `CNA_PORTS {...}`           | Portas locais adicionais (painel)              |
| `CNA_EVENT {...}`           | Evento estruturado do fluxo (sem dados pessoais) |

Demais linhas (log técnico do Node) não vão para a UI — privacidade (ver
`docs/POC_TAURI_WEBVIEW2.md` e o modelo de privacidade no README).

O Rust emite à janela os estados de inicialização: `INICIANDO`,
`SIDECAR_PRONTO`, `WEBVIEW2_CONECTADO`, `APP_PRONTO`, `FALHA_INICIALIZACAO`
(a UI mostra tela de erro com "Tentar novamente", via comando
`reiniciar_sidecar`).

## Encerramento gracioso

Ao fechar a janela: Rust escreve `shutdown\n` no stdin do Node → o
orquestrador fecha o servidor HTTP local → sai com código 0. O Rust aguarda
até 8 s; em caso de falha, usa `kill()`. Depois remove o perfil temporário
com tentativas (6×400 ms) — o desligamento assíncrono do WebView2 pode
manter a pasta travada por instantes.

## Perfil temporário e instância única

- Perfil por execução: `%TEMP%\cna-poc-webview2-<16 bytes aleatórios
  criptográficos>\` com `owner.json` (PID + identidade).
- Instância única via plugin `tauri-plugin-single-instance` (segunda
  instância apenas foca a janela existente).
- Limpeza de residuais **nunca é por prefixo**: um perfil só é removido se o
  S.O. permitir renomeá-lo — prova de que nenhum WebView2 o mantém aberto.
  Perfis de execuções vivas falham no rename e são preservados.

## Allowlist de navegação

Somente: origem Tauri da aplicação; `http://127.0.0.1` nas portas exatas
anunciadas pelo orquestrador nesta execução; `https://app.cna.com.br`
(porta 443 padrão). Sem curingas (`*.cna.com.br` proibido), sem HTTP para o
portal. Testes de unidade em `src-tauri/src/lib.rs` cobrem os casos.

## Segurança do CDP — risco explícito

O endpoint CDP do WebView2 **não tem mecanismo de autenticação**. A porta
aleatória em `127.0.0.1` não é autenticação: qualquer processo local
poderia, em princípio, conectá-se enquanto o aplicativo está aberto.
Mitigações efetivas adotadas (e limites):

- Restrito ao loopback (verificado por netstat);
- Porta dinâmica (`=0`), nunca exibida na interface nem em logs;
- Existe somente enquanto o aplicativo está aberto;
- Encerrado junto com o aplicativo;
- O WebView2 não oferece ACL/token por conexão no CDP — **o risco residual
  (processo local malicioso durante a execução) está documentado e aceito
  nesta fase**. Um canal IPC com ACL nativo exigiria abandono do CDP +
  reimplementação do controle do portal (não é viável na migração atual).

## CSP

`tauri.conf.json` define CSP restritiva: `default-src 'self'`,
scripts/estilos apenas locais (`script-src 'self'` — as páginas não têm
scripts inline), sem CDN/fontes externas, `connect-src 'self'`. O painel
local (servido pelo Node em loopback) envia seus próprios cabeçalhos
(`X-Content-Type-Options`, `Cache-Control: no-store`, `Referrer-Policy`).

## Node empacotado

Em produção o orquestrador só inicia com o `node.exe` empacotado em
`resources/`. Ausência = tela de erro clara. Nunca se usa o Node do
sistema. Em desenvolvimento, usa-se `CNA_POC_NODE` (documentado no
relatório da POC).

## Interface (Fluent / Windows 11)

Design system único em `poc-ui/fluent.css`: tokens centralizados (cores,
tipografia Segoe UI Variable, raios, sombras, alturas de controle), tema
claro/escuro por `prefers-color-scheme`, estados completos de botão, foco
visível, `prefers-reduced-motion`. Barra de título nativa do Windows
(sem imitação). Mica/Acrylic nativos não são usados nesta fase — fallback
sólido coerente (documentado como limitação).

## Testes

- Suíte Node completa: `npm test` (parser, guard, painel, coleta simulada,
  sessão, UI, viewport, POC).
- Rust: `cargo test` (allowlist), `cargo fmt --check`, `cargo check`.
- CI (`tests.yml`): matriz Node 22/24 em Windows+Linux; job Windows com
  build NSIS **obrigatório** (sem `continue-on-error`) e artefato do
  instalador.
- Smoke E2E do produto instalado (manual assistido): descoberta da porta,
  janela única, portal na mesma janela, shutdown gracioso, perfil removido.
  Login real nunca é automatizado (regra do produto).
