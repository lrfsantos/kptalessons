# POC Tauri 2 + WebView2 — Relatório Final

**Branch:** `poc/tauri-webview2-single-window` · **Base:** `master` @ `3f2145b`
**Data:** 20/11/2026 · Dados 100% sintéticos; nenhuma atividade real foi aberta, corrigida ou finalizada.

## Resultado

**A arquitetura funcionou.** O Playwright controlou, via CDP, o **mesmo WebView2 visível na janela Tauri**: abriu o portal CNA (`app.cna.com.br/login`) dentro da janela do aplicativo, voltou à interface local e concluiu o fluxo do painel com o parser real. Uma única janela, nenhum Chromium portátil, nenhum navegador externo, nenhuma janela de terminal.

## O que foi implementado

| Componente | Local |
|---|---|
| Shell Tauri 2 (janela única 1100×760, allowlist de navegação, CDP dinâmico, perfil WebView2 temporário, sidecar invisível) | `src-tauri/` |
| Sidecar Node (servidor local loopback, `connectOverCDP`, painel real via `lib/panel.js`, evidências JSONL+PNG) | `src-node/sidecar.js` |
| Fixture sintética (10 atividades, ref/nonce fictícios) | `src-node/fixture.js` |
| Telas Início/Progresso/Conclusão (Material Design 3, sem CDN) | `poc-ui/` |
| Suíte de testes da POC | `tests/poc/` |
| Empacotamento de recursos + ícone | `scripts/poc-*.js|.ps1` |
| Job CI Windows | `.github/workflows/tests.yml` (`tauri-poc`) |
| Documentação técnica | `docs/POC_TAURI_WEBVIEW2.md` |

## Evidências

- **Versões:** Tauri 2.12.7 · Rust 1.100.0 · Node 24.19.0 (empacotado) · playwright-core do `package-lock.json`
- **E2E real** (`%TEMP%\cna-poc-evidencias-1795211035801\evidencias.jsonl`):
  - `pagina-inicial` → `http://127.0.0.1:1430/` "Corretor CNA" (a página da janela Tauri)
  - `portal-aberto-mesma-janela` → `https://app.cna.com.br/login` "Login | CNA", campo de senha presente, **sem login**
  - retorno inválido (nonce errado) → **HTTP 422**, mensagem humana exibida
  - retorno válido → **HTTP 200**: `accepted: [{num:1, activities:10}]`, `done: true`, tela "Demonstração concluída — 1 lote aceito, 0 rejeitados"
  - `verificacao-estrutural` → 1 página no contexto; processos: `msedgewebview2` (runtime interno), **0** chrome/chromium/msedge
- **CI:** run #19 — todos os jobs `success` (matriz Node 22/24 em Ubuntu/Windows + `tauri-poc`), em `6986f48`
- **Testes locais:** `tests/poc/` — 5 pass, 1 skip (teste CDP requer app rodando); parser real valida/rejeita os 4 cenários de fixture
- Screenshots (02-portal, 04-painel, 05-inválido, 06-válido, 07-conclusão) na pasta de evidências, sem dados pessoais

## Comparação da distribuição

| Métrica | Versão atual | Tauri POC |
|---|---:|---:|
| Instalador/arquivo distribuído | pasta portátil (zip) | **25,93 MB** (NSIS `.exe`) |
| Tamanho total instalado | **858,3 MB** | **~136 MB** (app 8,5 + recursos 102,0 + poc-ui 0,01) |
| Runtime de navegador empacotado | 742,7 MB (Chromium Playwright) | **0** (WebView2 Evergreen do Windows, via `downloadBootstrapper`) |
| Node.js empacotado | 101,2 MB | 88,5 MB (sidecar) |
| playwright-core | incluído em node_modules (13,3 MB) | 13,3 MB |
| Memória aproximada em repouso | NÃO VALIDADO | NÃO VALIDADO |
| Janelas visíveis ao professor | 2+ (terminal + aba do navegador) | **1** (a janela do app) |
| Executáveis na distribuição | 11 | 2 (app + node.exe) |

**Redução: ~85% no tamanho instalado (858 → ~136 MB), 100% do Chromium eliminado.**

## Limitações

- **Memória em repouso e tempo de inicialização a frio em máquina limpa: NÃO VALIDADO** (medições exigem execução prolongada e máquina sem cache).
- Teste de escala do Windows (100/125/150%) e resoluções pequenas: NÃO VALIDADO (manual).
- O instalador não foi executado numa máquina limpa sem WebView2 (bootstrapper não testado de ponta a ponta).
- Endpoint CDP escuta em `127.0.0.1` com porta aleatória, mas **porta aleatória não é autenticação** — outros processos locais poderiam conectá-la. Risco documentado; para migração real, considerar token no endpoint.
- Não há atualização automática (fora do escopo da POC).

## Recomendação

**Avançar para a migração real.** Os critérios de arquitetura, segurança e experiência passaram; as proteções existentes (parser, nonce, refs, mascaramento) foram reutilizadas sem enfraquecimento. Próximas etapas para migrar: portar `scraper.js`/`executor.js`/`login.js` para o sidecar, integrar o fluxo de coleta real, decidir política do perfil WebView2 (temporário por execução vs. persistente para manter login), e testes em máquina do professor-alvo.

**Não usar a POC em produção docente: só dados fictícios foram validados.**
