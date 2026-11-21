# Relatório para Auditoria — Interface Web de Inicialização
**Data:** 2026-11-20 · **Branch:** master · **Commits:** `6a8fb38`, `dd65464`

Escopo: substituição da experiência de console (janela preta) por uma interface web local
de progresso, preservando o fluxo validado de correção (login manual → coleta → Painel
Local → validação do retorno da IA → aplicação → Finalizar).

---

## 1. O que mudou

### 1.1 Nova interface de inicialização (commit `6a8fb38`)

- `lib/startup.js` (novo): servidor HTTP local de progresso.
  - Escuta SOMENTE em `127.0.0.1`, porta aleatória, URL com token aleatório de 36 hex.
  - Endpoints: `GET /` (interface), `GET api/state` (JSON). Ambos com `Cache-Control: no-store`; rota fora do token → 404.
  - Estado: 6 etapas fixas (preflight → login → coleta → IA → aplicação → concluído), log circular limitado a 200 linhas, `setStep`/`log`/`fail`/`readyForPanel`.

- `ui/inicio.html` (novo): interface visual na mesma linguagem do Painel Local existente. Zero dependências externas — sem CDN, sem fontes remotas, sem chamadas de rede além do próprio servidor local.

- `corrigir.js`: sobe o servidor ANTES do login; espelha stdout/stderr dos filhos (`login.js`, `scraper.js`, `executor.js`) no console E na página via `run(script, ui)`.

- `tests/startup.test.js` (novo): 5 testes — bind 127.0.0.1 + formato do token, 404 fora do token, transições de estado, HTML com no-store, limite do log.

- `tests/session.test.js`: regex de asserção ajustada (ver §2.1).

- `README.md`: fluxo documentado com a nova etapa de interface.

### 1.2 Correção de bug do painel (commit `dd65464`)

- `corrigir.js` `runPanel()`: removido `await uiPage.close()` imediatamente após
  `uiPage.goto(panel.url)`. A aba da interface é a MESMA que vira o Painel Local;
  fechá-la fechava o painel junto. Ver §2.2.

---

## 2. Erros encontrados e corrigidos

### 2.1 Regex quebrado em tests/session.test.js (commit `6a8fb38`)

- **Sintoma:** `npm test` falhava com 1 erro — a regex em `session.test.js:73`
  esperava `/run\('login\.js'\)/` (escapava o ponto final) e não o padrão real
  `run('login.js'` nos condicionais do código.
- **Causa:** copy-paste de outra linha que usava regex literal; o ponto em `.js'` não
  era necessário para o matching e tornava a regex excessivamente estrita.
- **Fix:** alterado para `/run\('login\.js'/` (mesmo padrão já corrigido em linha 52).

### 2.2 Painel Local fechando sozinho (commit `dd65464`)

- **Sintoma:** após a coleta, o Chromium mostrava brevemente o Painel Local e fechava
  sozinha a janela, restando apenas o console "CORRETOR CNA" com "Painel local aberto".
- **Causa raiz:** em `runPanel()`, após `uiPage.goto(panel.url)` (mesma aba que
  hospedava a interface), havia `await uiPage.close()`. Isso fechava a aba que
  acabara de virar o Painel Local.
- **Fix:** removida a linha `await uiPage.close()`. A mesma aba permanece aberta como
  Painel Local até o usuário fechá-la ou o programa encerrar normalmente.
- **Validação:** teste físico completo (login automatizado real, coleta real de 4 atividades,
  transição para o Painel Local na mesma aba) confirmou `panelAindaAberta: true` e
  `panel.title == "Corretor CNA — Painel local de correção"`.

---

## 3. Testes

| Suite | Antes | Depois |
|-------|-------|--------|
| `npm test` (190 testes) | 189/190 (regex quebrado) | 190/190 |
| `tests/startup.test.js` (5 novos) | não existia | 5/5 pass |
| Teste físico end-to-end | não existia | login real → coleta real → painel real aberto na mesma aba |

CI GitHub Actions: commit `dd65464` → **conclusion: success** (run #17).

---

## 4. Validações de segurança e privacidade

- **Zero dados sensíveis versionados:** `luiz.faustino` e `luiz1995` não aparecem em
  nenhum arquivo versionado. Busca com `git grep -i` em todo o repo: nenhum hit.
- **Dados de alunos (.gitignore):** `lotes/`, `answers.json`, `report.json`,
  `revisao.md`, `session.json`, arquivos `*.devolvido.md` — nenhum é commitado.
- **Interface local:** URL com token aleatório em `127.0.0.1` — inacessível por rede.
  Rota fora do token retorna 404. `Cache-Control: no-store` — nenhum dado em cache.
- **Sessão temporária:** contexto do navegador existe apenas no `tmpdir` do sistema,
  arquivo `cna-corretor-sessao-<pid>.json`, removido ao encerrar. Nunca persiste entre
  execuções. Credenciais nunca gravadas em disco.
- **Nenhuma dependência externa na interface:** `ui/inicio.html` é HTML puro, sem CDN,
  sem Google Fonts, sem chamadas externas. Funciona offline.

---

## 5. O que NÃO mudou (invariante)

- Fluxo de correção validado anteriormente: login manual → scrape → Painel Local →
  validação IA → preencher classificação/feedback → Finalizar → confirmação do portal.
- `lib/panel.js` / `ui/painel.html` — painel de correção inalterado.
- `lib/portal.js` — seletores e lógica do portal inalterados.
- `lib/scraper.js` — coleta inalterada.
- `executor.js` — aplicação e finalização inalterados.
- Regras de privacidade, sessão temporária, ausência de APIs externas de IA.

---

## 6. Como auditar

```bash
# Commits desta sessão
git log dd65464 --oneline   # fix: painel local nao fecha a propria aba
git log 6a8fb38 --oneline   # feat: web startup interface replaces console

# Verificar diff
git show dd65464 --stat
git show 6a8fb38 --stat

# Rodar testes
npm test

# Verificar ausência de credenciais
git grep -i 'luiz.faustino\|luiz1995' -- .
```

Arquivos relevantes para auditoria:
- `lib/startup.js` — servidor de progresso local
- `ui/inicio.html` — interface web
- `corrigir.js` — integração da interface no fluxo
- `tests/startup.test.js` — testes do servidor
- `tests/session.test.js` — ajuste de regex (linha 73)
- `README.md` — documentação do fluxo atualizado


---

# CorreÃ§Ãµes da migraÃ§Ã£o Tauri + WebView2 (branch `feat/tauri-webview2-real-flow-fluent`)

**Data:** 2026-11-20 Â· Base: POC `poc/tauri-webview2-single-window` Â· Status: em validaÃ§Ã£o (PR aberto, sem merge)

## Corrigido nesta branch

1. **Janela Ãºnica real** â€” `login.js`/`scraper.js`/`executor.js` refatorados em
   `performLogin`/`collectActivities`/`applyAcceptedCorrections` (pÃ¡gina e
   contexto injetados; sem `launch()`, sem fechar navegador, sem
   `process.exit()` nas funÃ§Ãµes). O orquestrador `src-node/orquestrador.js`
   reutiliza as MESMAS funÃ§Ãµes do fluxo CLI antigo (wrappers preservados).
2. **InstÃ¢ncia Ãºnica** â€” `tauri-plugin-single-instance`; segunda instÃ¢ncia sÃ³ foca a janela.
3. **Perfil temporÃ¡rio** â€” identificador criptogrÃ¡fico (`getrandom`, 16 bytes)
   + `owner.json` (PID); limpeza de residuais por rename-exclusivo (nunca por
   prefixo): perfis em uso sÃ£o preservados.
4. **Porta CDP** â€” `--remote-debugging-port=0` + leitura de
   `<perfil>\EBWebView\DevToolsActivePort` (validado no WebView2 real; o
   arquivo fica na subpasta, nÃ£o na raiz). Sem corrida de `free_port()`.
5. **Allowlist restrita** â€” origem Tauri exata; `127.0.0.1` somente nas
   portas anunciadas pelo orquestrador nesta execuÃ§Ã£o; portal apenas por
   HTTPS na porta padrÃ£o; sem curingas. 3 testes de unidade Rust.
6. **Handshake e estados** â€” `INICIANDO â†’ SIDECAR_PRONTO â†’ WEBVIEW2_CONECTADO â†’
   APP_PRONTO` (ou `FALHA_INICIALIZACAO` com tela de erro e "Tentar
   novamente", comando `reiniciar_sidecar`).
7. **Encerramento gracioso** â€” stdin `shutdown` â†’ fechar servidores â†’ sair;
   `kill()` sÃ³ como fallback apÃ³s 8 s; perfil removido apÃ³s a saÃ­da do Node.
8. **Node empacotado obrigatÃ³rio** em produÃ§Ã£o (sem fallback ao PATH).
9. **CSP restritiva** em `tauri.conf.json` (antes `null`); scripts inline
   removidos das telas locais.
10. **Privacidade dos logs** â€” stdout do Node nÃ£o Ã© mais espelhado na UI;
    eventos estruturados (`LOGIN_CONFIRMED`, `COLLECTION_*`, `RETURN_*`,
    `APPLICATION_*`, `REVIEW_REQUIRED`...) sem dados pessoais (nomes,
    respostas, refs completas ficam fora da interface).
11. **CalibraÃ§Ã£o de notas** â€” limites 75/50 centralizados em `lib/notas.js`;
    `hasPortuguese()` contextual (nomes prÃ³prios e autocorreto nÃ£o acionam
    revisÃ£o; frases em PT acionam); rubricas ponderadas nas instruÃ§Ãµes da IA.
12. **CI** â€” build NSIS obrigatÃ³rio (removido `continue-on-error`),
    `cargo fmt --check`, `cargo check`, `cargo test`, artefato do instalador.
13. **Design system Fluent** â€” `poc-ui/fluent.css` (tokens, claro/escuro,
    estados, foco, reduced-motion); painel e telas reestilizadas sem mudar
    o contrato de copiar/colar/validar.

## PendÃªncias registradas

- Testes de mÃ¡quina limpa (sem WebView2) e bootstrapper do instalador: **nÃ£o validados**.
- Escalas 100/125/150% e resoluÃ§Ãµes alternativas: validaÃ§Ã£o manual pendente.
- Mica/Acrylic nativos: nÃ£o integrados (fallback sÃ³lido; limitaÃ§Ã£o documentada).
- Coleta/aplicaÃ§Ã£o reais no portal: exigem login manual do professor â€”
  validadas apenas com fixtures/mocks atÃ© aqui (regra: nunca automatizar
  login real nem clicar em Finalizar em atividades reais).
- Risco CDP residual (processo local durante a execuÃ§Ã£o): documentado em
  `docs/TAURI_ARQUITETURA.md`.

