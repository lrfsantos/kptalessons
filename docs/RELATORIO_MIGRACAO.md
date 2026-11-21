# Relatório final — Migração Tauri + WebView2 (janela única)

**Data:** 2026-11-21 · **Branch:** `feat/tauri-webview2-real-flow-fluent`
**Base:** POC `poc/tauri-webview2-single-window` (a partir de `master` = `3f2145b`)
**Commits na branch:** 24 · **Arquivos:** 47 alterados (+8.087/−439)
**PR:** https://github.com/lrfsantos/kptalessons/pull/1 (aberto, sem merge)

---

## 1. Objetivo

Transformar a POC Tauri + WebView2 em aplicativo de produção: uma única janela
visível, sem terminal, sem navegador externo, com o fluxo REAL do Corretor CNA
(login manual → coleta → painel → retorno da IA → aplicação com finalização
automática) e interface Fluent/Windows 11 — sem abrir mão do fluxo CLI antigo
(`npm run corrigir`), preservado em paralelo até validação completa.

## 2. O que foi entregue (por fase)

| Fase | Entrega | Commit(s) |
|------|---------|-----------|
| 6 — Calibração de notas | `lib/notas.js` (75/50 centralizados), `hasPortuguese` contextual, rubricas ponderadas em `instrucoes_correcao.md`, testes | `1412836` |
| 1 — Refatoração de módulos | `performLogin` / `collectActivities` / `applyAcceptedCorrections` com página injetada + wrappers CLI | `d40d21e` |
| 2/5 — Hardening Rust + logs | Instância única, perfil criptográfico, CDP dinâmico, allowlist, handshake, shutdown gracioso, CSP | `82b5525` |
| 1b — Orquestrador real | `src-node/orquestrador.js`: fluxo completo na mesma janela/aba | `f5ad28f` |
| 3/4 — Fluent UI | `poc-ui/fluent.css` (tokens, claro/escuro), painel e telas redesenhados | `2e6ec31` |
| 7 — CI e testes | NSIS obrigatório, fmt/check/test, artefato, testes Rust de allowlist | `4040c4f`, `c9d4e11` |
| — | Fix descoberta CDP (subpasta EBWebView, validado no WebView2 real) | `a61fab8` |
| 8 — Docs | `docs/TAURI_ARQUITETURA.md`, AUDITORIA, README | `ee40576` |
| — | Pin de toolchain para `cargo fmt` determinístico | `4d6e653` |

## 3. Arquitetura final

Resumo em `docs/TAURI_ARQUITETURA.md` (diagrama, protocolo, riscos). Em uma
frase: **janela Tauri única → WebView2 visível → orquestrador Node invisível
controla a MESMA aba via CDP loopback (porta dinâmica descoberta por
`DevToolsActivePort`) → reutiliza as funções reais de login/coleta/painel/
aplicação do fluxo CLI.**

## 4. Invariantes do produto — cumpridos

- Login manual a cada execução; nenhuma credencial passa pelo app (só no portal).
- Sessão apenas no perfil temporário por execução, removido ao fechar.
- Finalizar faz parte do fluxo, mas apenas com confirmação positiva do portal
  (`appliedRefs`); revisões nunca são tocadas.
- Sem API/backend/telemetria; IA é a que o professor escolher (copiar/colar).
- Nenhum teste automatizado de login real ou Finalizar em atividades reais
  (fixtures/mocks apenas).

## 5. Segurança e privacidade

- Allowlist de navegação: origem Tauri + `127.0.0.1` só nas portas anunciadas
  nesta execução + `https://app.cna.com.br` (443). Sem curingas. 3 testes Rust.
- CSP restritiva (antes `null`): scripts/estilos só locais, sem inline.
- stdout do Node nunca é espelhado na UI; apenas eventos estruturados sem
  dados pessoais. Evidências ficam em `%TEMP%` (contagens e estágios).
- CDP: loopback + porta dinâmica + efêmero; **sem autenticação** — risco
  residual de processo local malicioso documentado como limitação explícita
  (`docs/TAURI_ARQUITETURA.md`, seção "Segurança do CDP").

## 6. Evidências de teste

- **Node:** 203 testes passando, 1 skip (condicional), 0 falhas — inclui os
  novos testes de política de notas (75/50) e hasPortuguese contextual.
- **Rust:** 3 testes de allowlist (`cargo test`), `cargo fmt --check` e
  `cargo check` limpos (toolchain pinada 1.100.0).
- **CI GitHub Actions:** matriz Node 22/24 × Ubuntu/Windows verde; job Windows
  com empacotamento de recursos, `cargo fmt --check`, build NSIS obrigatório
  e artefato do instalador.
- **Smoke E2E no produto instalado** (máquina do desenvolvedor, assistido):
  descoberta da porta via `DevToolsActivePort` → tela inicial na origem Tauri →
  clique em Iniciar abre o portal CNA na MESMA janela (1 contexto/1 página,
  0 navegadores externos) → fechamento pela barra nativa → app=0, sidecar=0,
  perfil temporário removido.
- **Painel validado** com fixture oficial (422 para retorno inválido, 200 para
  válido); capturas de tela salvas em disco (início + painel).

## 7. Desempenho — medição honesta

POC mediu **437 MB** em repouso vs **167 MB** da versão antiga pré-navegador.
Essa comparação NÃO é justa: a versão antiga medida não tinha Chromium ativo.
Nenhum número novo é afirmado neste relatório; medição comparativa correta
(ambas com navegador ativo) fica como trabalho futuro.

## 8. Limitações e pendências (registradas, não escondidas)

1. **Máquina limpa (sem WebView2):** bootstrapper do instalador não validado
   (sem VM disponível).
2. **Escalas 100/125/150% e resoluções alternativas:** validação manual
   pendente.
3. **Mica/Acrylic nativos:** não integrados; fallback sólido coerente.
4. **Risco CDP residual:** processo local durante a execução (documentado).
5. **Fluxo real no portal:** valida-se com login manual do professor; os
   testes automatizados usam fixtures/mocks por regra do produto.
6. **Memória:** comparação justa pendente (item 7).

## 9. Como construir

```
# Pré-requisitos: Node 24, Rust 1.100 (pinado em src-tauri/rust-toolchain.toml)
npm ci
powershell -File scripts\poc-package-resources.ps1   # empacota node/src/lib/ui/poc-ui/playwright-core
cd src-tauri
npx @tauri-apps/cli@2 build                          # gera NSIS em target/release/bundle/nsis/
```

Dev (sem empacotar): `$env:CNA_POC_NODE` aponta para um `node.exe`; `npm run
tauri dev`. O instalador gerado instala em `%LOCALAPPDATA%\Corretor CNA POC`.

## 10. Como testar (resumo)

`npm test` (Node) · `cargo test`/`cargo fmt --check`/`cargo check` em
`src-tauri` · smoke manual do instalador (descrito na seção 6).

## 11. Arquivos-chave

- `src-tauri/src/lib.rs` — app endurecido (instância única, CDP, allowlist, protocolo)
- `src-node/orquestrador.js` — orquestrador do fluxo real
- `src-node/sidecar.js` — orquestrador de demonstração (preservado para POC)
- `poc-ui/fluent.css` — design system; `ui/painel.css` — painel
- `lib/login.js` / `lib/scraper.js` / `lib/executor.js` — funções injetáveis
- `lib/notas.js` — política de notas; `lib/guard.js` — guarda de correção
- `docs/TAURI_ARQUITETURA.md` — arquitetura e riscos

## 12. Próximos passos sugeridos

1. Validação em máquina limpa (bootstrapper WebView2).
2. Verificação manual de escalas/resoluções.
3. Comparação justa de memória (ambas as versões com navegador ativo).
4. Validação do fluxo real pelo professor (login manual, atividades de teste).
5. Pós-validação: remover o fluxo CLI antigo e o Chromium portátil da
   distribuição.
