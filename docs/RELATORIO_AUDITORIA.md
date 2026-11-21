# Relatório para Auditoria — Migração Tauri + WebView2 (janela única, fluxo real, Fluent)

**Data:** 2026-11-21
**Branch:** `feat/tauri-webview2-real-flow-fluent` (52+ commits a partir de `master` = `3f2145b`; contagem atualizada na seção 15)
**PR:** https://github.com/lrfsantos/kptalessons/pull/1 — aberto, **sem merge** (aguarda auditoria)
**Status do CI na escrita deste relatório:** matriz Node 22/24 × Ubuntu/Windows **verde**, incluindo o job Windows com build NSIS obrigatório e upload do instalador (concluído; detalhes nas seções 8 e 16).
**Estado consolidado:** as seções anteriores são o histórico de cada rodada; o estado FINAL (números de testes, CI/NSIS e validações físicas) está na **seção 16**.

---

## 1. Escopo do que foi feito

Transformação da POC (`poc/tauri-webview2-single-window`, intocada) em aplicativo
de produção, numa branch separada, com PR para revisão:

1. **Janela única real:** uma janela Tauri, um WebView2 visível, um processo
   Node auxiliar invisível (sidecar) que controla a MESMA aba via CDP
   (Playwright), sem terminal e sem navegador externo.
2. **Fluxo real do produto:** login manual no portal → coleta de pendentes →
   painel local (copiar lotes → IA → colar retorno → validar) → aplicação com
   finalização automática → conclusão. Mesmas funções do fluxo CLI antigo
   (`npm run corrigir`), reutilizadas com página injetada.
3. **Hardening:** instância única, perfil temporário criptográfico por
   execução, descoberta dinâmica da porta CDP, allowlist restrita de
   navegação, CSP estrita, handshake Rust⇄Node com tela de erro e retry,
   encerramento gracioso, Node empacotado obrigatório em produção.
4. **UI Fluent/Windows 11:** design system central (`poc-ui/fluent.css`) com
   tema claro/escuro, foco visível, `prefers-reduced-motion`; painel e telas
   redesenhados sem alterar o contrato de copiar/colar/validar.
5. **Calibração de notas:** CORRETO 75–100 · PARCIAL 50–74 · INCORRETO 0–49,
   centralizados em `lib/notas.js`; detecção contextual de português.
6. **CI:** build NSIS obrigatório (sem `continue-on-error`), `cargo
   fmt --check`, `cargo check`, `cargo test`, artefato do instalador.
7. **Docs:** `docs/TAURI_ARQUITETURA.md`, `docs/RELATORIO_MIGRACAO.md`,
   `AUDITORIA.md` (seção da migração), README para professores.

O fluxo CLI antigo continua funcionando (wrappers preservados) — nada foi
removido antes da validação.

## 2. Invariantes do produto — onde verificar no código

| Invariante | Verificação |
|---|---|
| Login manual sempre; sem credenciais no app | `lib/login.js` (`performLogin` apenas espera autenticação); `git grep -il 'luiz.faustino\|luiz1995' -- .` retorna **0 ocorrências reais** (a única é o próprio AUDITORIA.md citando o comando) |
| Sessão só no perfil temporário, descartado ao fechar | `src-tauri/src/lib.rs` (perfil `%TEMP%\cna-poc-webview2-<aleatório>`; remoção pós-shutdown — validada no smoke E2E) |
| Finalizar só com confirmação positiva do portal | `lib/executor.js` (`appliedRefs` só com confirmação; revisões nunca tocadas) — invariante herdado, não alterado nesta migração |
| Sem API/backend/telemetria | Nenhum endpoint novo; painel e telas são servidores locais em `127.0.0.1` |
| Nada de dados pessoais na UI/logs | stdout do Node não é espelhado na UI; apenas eventos estruturados (`CNA_EVENT`) com contagens/estágios — `src-tauri/src/lib.rs` (`watch_sidecar_stdout`) |

## 3. Segurança — o que mudou e o que permanece como risco

**Mudou (antes → depois):**

- CSP: `null` → estrita (`script-src 'self'`, sem inline, sem CDN).
- Navegação: irrestrita → allowlist exata (origem Tauri; `127.0.0.1` somente
  nas portas anunciadas nesta execução; portal só HTTPS 443). **3 testes de
  unidade Rust** cobrem: subdomínio malicioso, porta errada, HTTP, host
  externo — todos bloqueados.
- Instâncias: múltiplas → única (`tauri-plugin-single-instance`).
- Perfis residuais: limpeza por prefixo (perigosa) → **rename-exclusivo**
  (remove só se provado abandonado; perfis em uso são preservados).
- Porta CDP: fixadapesquisa/reserva com corrida → `--remote-debugging-port=0`
  + leitura de `<perfil>\EBWebView\DevToolsActivePort` (validado no WebView2
  real; descoberta em ambas as profundidades).
- Node: sistema (PATH) → empacotado obrigatório em produção.
- Logs: stdout cru na UI → eventos estruturados sem dados pessoais.

**Risco explícito e aceito (documentado em `docs/TAURI_ARQUITETURA.md`,
seção "Segurança do CDP"):** o endpoint CDP do WebView2 **não tem
autenticação**. Porta dinâmica + loopback + efêmera não são autenticação: um
processo local malicioso poderia conectar enquanto o app está aberto. Mitigações
adotadas reduzem a janela e a exposição; eliminar o risco exigiria abandonar
CDP (não viável nesta fase). O auditor deve avaliar se o risco residual é
aceitável para o uso previsto (PC pessoal do professor).

## 4. Evidências de teste

- **Node:** `npm test` → **203 pass, 1 skip (condicional), 0 falhas** (inclui
  novos testes de política 75/50 e `hasPortuguese` contextual).
- **Rust:** `cargo test` → 3/3 (allowlist); `cargo fmt --check` e
  `cargo check` limpos (toolchain pinada 1.100.0 em
  `src-tauri/rust-toolchain.toml`).
- **CI (GitHub Actions, `.github/workflows/tests.yml`):** matriz 2 SO × 2
  versões de Node; job Windows empacota recursos, roda fmt/check/test e build
  NSIS obrigatório com upload do instalador.
- **Smoke E2E no produto instalado** (máquina do desenvolvedor, assistido,
  sem login real): descoberta da porta via DevToolsActivePort → tela inicial
  na origem Tauri → Iniciar abre `https://app.cna.com.br/login` na MESMA
  janela (1 contexto/1 página, 0 navegadores externos) → fechamento pela
  barra nativa → app=0, sidecar=0, perfil temporário removido.
- **Painel:** fixture oficial valida o parser real (422 para retorno
  inválido, 200 para válido). Capturas de tela salvas em disco (não anexadas).

## 5. Privacidade e dados

- A sessão do portal vive só no perfil temporário; fechou, sumiu.
- `cna-scrape.json` (dados privados) está **ignorado pelo git** e fora do
  repositório.
- Evidências locais em `%TEMP%` contêm apenas contagens, estágios e
  mensagens de erro genéricas — sem nomes de alunos, respostas ou referências
  completas.
- Instalador atual (medido): ~26 MB.

## 6. Desempenho — medição honesta

A POC mediu 437 MB em repouso vs 167 MB da versão antiga **sem navegador
ativo** — comparação injusta, mantida como tal. Nenhuma comparação nova é
afirmada; medição justa (ambas com navegador ativo) é trabalho futuro.

## 7. Limitações e pendências (registradas, não escondidas)

1. Máquina limpa (bootstrapper WebView2): **não validada** (sem VM).
2. Escalas 100/125/150% e resoluções alternativas: validação manual pendente.
3. Mica/Acrylic nativos: não integrados (fallback sólido documentado).
4. Fluxo real no portal: valida-se com login manual do professor; testes
   automatizados usam fixtures/mocks (regra: nunca Finalizar em atividades
   reais).
5. Risco CDP residual (seção 3).

## 8. Estado do CI no momento

Correção em duas etapas: (a) toolchain pinada por causa de divergência de
`cargo fmt` entre versões de rustfmt; (b) perfil *minimal* da action de Rust
no CI não trazia rustfmt — corrigido declarando
`components = ["rustfmt"]` em `src-tauri/rust-toolchain.toml` (commit
`7bfebaf`, reexecução em andamento na escrita deste relatório). A matriz Node
está verde; o build NSIS local (mesmos passos do CI) funciona — instalador
gerado e testado.

## 9. Como o auditor pode verificar (checklist)

```
# Código
git fetch origin feat/tauri-webview2-real-flow-fluent
git checkout feat/tauri-webview2-real-flow-fluent
git log --oneline 3f2145b..HEAD        # 26+ commits, revisáveis individualmente

# Testes
npm ci && npm test                     # 203 pass / 0 fail
cd src-tauri
cargo test                             # 3 testes de allowlist
cargo fmt --check && cargo check

# Credenciais
git grep -il 'luiz.faustino\|luiz1995' -- .   # só AUDITORIA.md (o próprio comando)
git ls-files | Select-String 'cna-scrape'     # vazio

# Build
powershell -File scripts\poc-package-resources.ps1
cd src-tauri && npx @tauri-apps/cli@2 build   # NSIS em target/release/bundle/nsis/

# App instalado (máquina Windows com WebView2)
# Instalar, abrir, clicar Iniciar, conferir portal na mesma janela; fechar e
# conferir que %TEMP%\cna-poc-webview2-* foi removido.
```

## 10. Arquivos-chave para revisão

- `src-tauri/src/lib.rs` — todo o hardening (instância única, CDP, allowlist,
  protocolo, shutdown) + testes de allowlist no fim do arquivo
- `src-node/orquestrador.js` — fluxo real (reutiliza lib/ sem duplicar)
- `lib/login.js` / `lib/scraper.js` / `lib/executor.js` — funções injetáveis
  + wrappers CLI (diff grande, mas mecânico)
- `lib/notas.js` + `lib/guard.js` + `instrucoes_correcao.md` — política de notas
- `poc-ui/fluent.css` + `ui/painel.css` — design system (CSS puro, sem deps)
- `docs/TAURI_ARQUITETURA.md` — arquitetura, protocolo, risco CDP
- `docs/RELATORIO_MIGRACAO.md` — relatório final com números
- `.github/workflows/tests.yml` — CI

## 11. Decisões que merecem atenção do auditor

1. **CDP como canal de controle** — pragmático, mas sem autenticação nativa
   (seção 3). Alternativa (IPC nativo com ACL) foi avaliada e descartada por
   custo/descartaria o controle do portal via Playwright.
2. **Limpeza de perfis por rename-exclusivo** — mais segura que por prefixo,
   mas depende do comportamento do Windows (rename falha com arquivos abertos).
3. **Finalizar automático** — mantido como parte do fluxo (produto), sempre
   condicionado a confirmação positiva do portal; revisões intocadas.
4. **`CNA_PORTS` no protocolo** — painel é criado após a coleta e anuncia a
   porta dinamicamente; a allowlist aceita só essas portas naquela execução.
5. **Node empacotado obrigatório** — falha visível se ausente (tela de erro),
   sem fallback silencioso ao Node do sistema.

## 12. O que se pede do auditor

Revisar o PR (commits individuais), validar o checklist da seção 9 (pelo
menos: testes, grep de credenciais, build NSIS), opinar sobre o risco CDP
(seção 3/11) e apontar qualquer bloqueio antes do merge. Nada foi mesclado;
`master` e a pasta da POC permanecem intocados.

## 13. Rodada 2 - resposta ao prompt de 14 itens do auditor

Data: 21/11/2026. Branch: feat/tauri-webview2-real-flow-fluent (PR #1, sem merge).

| # | Item do auditor | Status | Evidencia |
|---|---|---|---|
| 2 | Armazenamento temporario de dados dos alunos | Feito (rodada 1, commit 6b6e4e7) | Lifecycle manager; teste: limpeza no finally, dirs abandonadas por rename-lock |
| 3 | Mensagens falsas de demonstracao | Feito | index/progresso/conclusao com textos reais; aviso de demo so em modo=demonstracao (chamado pelo ladocar de demo) |
| 4 | Codificacao UTF-8 | Feito | tests/encoding.test.js: 11 arquivos de interface sem mojibake + strings-chave; suite Node 228/0 |
| 5 | CSP nas paginas locais | Feito (rodada 1, commit 8ec1d7d) | CSP estrita em todas as respostas HTTP; painel.js extraido; painel.js agora empacotado (poc-package-resources.ps1) |
| 6 | Reinicializacao/monitoramento do sidecar | Feito | src-tauri/src/lib.rs: comando reiniciar_sidecar; deteccao de queda; handshake de portas |
| 7 | Registro de portas x navegacao | Feito | protocolo dinamico de portas no orchestrator (commits 82b5525/f5ad28f) |
| 8 | Progresso real na interface | Feito | progresso.js consome estado real do sidecar |
| 9 | Rubrica proporcional + idioma | Feito | instrucoes_correcao.md: Rubrica 75/50/49 com reducao proporcional, regra de idioma (autocorreto = erro de grafia; frase substantiva em portugues impede CORRETO); limites centralizados em lib/notas.js (75/50); guard.js: triagem contextual (2+ sinais, 12% do texto, isencao para texto curto) |
| 10 | Identidade do aplicativo | Feito (9d715e6) | productName "Corretor CNA", identifier com.cna.corretor, metadados Cargo reais; janela exibiu "Corretor CNA" no teste fisico |
| 11 | UI Fluent | Feito | fluent.css design system; Mica/Acrylic segue como limitacao documentada (superficies solidas) |
| 12 | Testes | Feito | 228 Node/0 falhas; 3 Rust/0; cargo fmt --check ok; CI verde no ultimo push (runs 38/39) |
| 13 | Teste manual seguro | Parcial | Fisico: app abriu (titulo "Corretor CNA"), fechou graciosamente, %TEMP%\cna-poc-webview2-* removido na saida, nenhum node.exe orfao. NAO clicado Iniciar (nenhum login real no portal); nenhuma atividade real finalizada. Limitacao registrada |
| 14 | Entrega | Este commit | Commits separados: 5a32426 (textos/encoding/metricas), 9d715e6 (identidade) |

### Higiene da maquina (solicitado pelo usuario)

- %TEMP% tinha 1228 pastas orfas cna-* (15 MB) deixadas por rodadas de teste - removidas manualmente.
- Pendencia real detectada: os testes Node criam dirs temporarias e nem todas removem no fim (fonte do acumulo). Candidato a correcao na proxima rodada.

### Limitacoes remanescentes

- CI desta rodada roda apos o push destes commits; confirmacao do build NSIS pendente ate la.
- Teste manual sem Iniciar: fluxo de coleta/aplicacao nao exercitado fisicamente nesta rodada.

## 14. Rodada 3 - confiabilidade, encerramento, privacidade e testes

**Data:** 2026-11-21
**Branch:** `feat/tauri-webview2-real-flow-fluent` (continua, sem merge)
**HEAD final:** `7864db77948105fbb005cab0168de19b069393a3`
**Base de referencia:** `2356862` (HEAD da rodada 2)
**Sem push nesta rodada:** quem orquestra faz push e acompanha o CI (PR #1 segue aberto).

### Commits criados (9, um por item)

| Hash | Item | Conteudo |
|------|------|----------|
| `c8e5c17` | 1-2 | Ciclo de vida: Promise unica de encerramento, ordem LIFO (painel antes de CDP), drenagem de recursos tardios com teto; `fecharServidor` agora para de aceitar conexoes ANTES, aguarda as em andamento e so encerra conexoes remanescentes como fallback no teto |
| `021901a` | 3-4 | Sidecar: monitoramento continuo de vida (queda apos handshake emite `FALHA_SIDECAR` estruturado para a UI), stderr drenado continuamente (sem travar por pipe cheio), reinicializacao sem duplicacao (`parar_sidecar` encerra o processo anterior e limpa origens antes de novo spawn); Allowlist: origem Tauri EXATA (`tauri://localhost` com host obrigatorio; `http://tauri.localhost` so porta padrao), servidor de telas so com rotas fixas conhecidas (`TELAS_PATHS`), painel so com porta+prefixo/token da execucao (protocolo `CNA_PORTS` agora envia `telasPort`/`painelPort`/`painelPath`) |
| `535464d` | 5 | Higiene: `finally` com remocao em todos os testes que criam temp dirs (batches, ciclovida, csp, monitor, parser x5, retorno-realista, session x2) |
| `7864db7` | 5 | Teste de higiene da suite em TEMP isolado (ver items abaixo) + correcao de `try` quebrado no csp.test.js |
| `b0f51fa` | 6 | Privacidade: camada central `src-node/eventos.js` com esquema FECHADO (eventos e campos com allowlist); orquestrador so emite/registra eventos sanitizados; excecoes sanitizadas antes das evidencias |
| `e4877f9` | 7 | Navegacao: `irPara()` sem ignorancia silenciosa (modulo novo `src-node/navegacao.js`); falha em portal/painel/conclusao gera `NAVEGACAO_FALHOU` estruturado e NUNCA emite COMPLETED/ sucesso |
| `643e100` | 8 | CI: `cargo test` explicito no job Windows, apos o empacotamento de resources (tauri.conf.json referencia resources/ui/painel.js); sem continue-on-error |
| `1362ce5` | 9 | Guard: triagem contextual ciente de FRASES - maiuscula inicial de frase nao esconde portugues; nome proprio no MEIO continua ignorado; diacriticos exclusivos (a/o/c com til/cedilha) contam mesmo maiusculos; nao e lista simplista (mantem 2+ sinais e proporcao) |
| `46223b7` | - | Prompt da rodada 3 arquivado em docs/PROMPT_RODADA3.md |

### Arquivos modificados

- `src-node/ciclovida.js` (itens 1-2), `src-node/orquestrador.js` (itens 3-7), `src-node/eventos.js` e `src-node/navegacao.js` (NOVOS, itens 6-7)
- `src-tauri/src/lib.rs` (itens 3-4), `poc-ui/app.js` (item 3: UI trata `FALHA_SIDECAR` com cartao de erro + retry)
- `lib/guard.js` (item 9); `.github/workflows/tests.yml` (item 8)
- Testes: `tests/ciclovida.test.js`, `tests/csp.test.js`, `tests/parser.test.js`, `tests/batches.test.js`, `tests/monitor.test.js`, `tests/retorno-realista.test.js`, `tests/session.test.js`, `tests/guard.test.js` (novos testes de itens 1, 2, 5, 9) e NOVOS `tests/eventos.test.js`, `tests/navegacao.test.js`, `tests/higiene-temp.test.js`

### Resultados de testes locais (executados nesta rodada)

| Suite | Resultado |
|-------|-----------|
| `npm test` (Node) | **253 testes: 252 pass, 0 fail, 1 skipped** (skip pre-existente); antes da rodada eram 229 - 24 testes novos |
| `cargo fmt --check` (src-tauri) | **OK** (sem diffs) |
| `cargo check` (src-tauri) | **OK** (Finished dev profile sem erros) |
| `cargo test` (src-tauri) | **OK: 5 passed, 0 failed** (4 de allowlist + 1 de EOF do sidecar) |

### Provas (o que foi e nao foi provado)

- **Limpeza dos diretorios de teste (item 5):** PROVADA por `tests/higiene-temp.test.js` - roda os 9 arquivos que criam temp dirs num TEMP isolado (`TEMP`/`TMP` do processo filho) e asserta que nao sobra nenhum diretorio com prefixo proprio da suite (`cna-corretor-run-`, `cna-panel-`, `cna-test-`, etc.). Rodou verde no `npm test` completo.
- **Encerramento gracioso (itens 1-2):** PROVADO por testes: Promise unica em chamadas simultaneas (`a === b === c`), sair somente apos limpeza, recurso assincrono demorado aguardado, ordem LIFO (painel antes de CDP), recurso registrado durante o encerramento executado, falha simulada nao impede limpeza; `fecharServidor` com requisicao em voo entrega a resposta por inteiro ANTES do fechamento, e conexao presa e encerrada so no teto (fallback).
- **Queda do sidecar (item 3):** PROVADA em unidade (`estado_no_eof`): antes do handshake emite `FALHA_INICIALIZACAO` (existente) e DEPOIS emite `FALHA_SIDECAR` (novo); a UI (`poc-ui/app.js`) trata os dois estados com cartao de erro + botao "Tentar novamente" (que invoca `reiniciar_sidecar`, que agora encerra o processo anterior antes de novo spawn). A deteccao fisica da queda com o app real (matar o node durante execucao) NAO foi exercitada fisicamente.
- **Bloqueio de origens nao autorizadas (item 4):** PROVADO por 5 testes Rust cobrindo: host Tauri incorreto, porta Tauri inesperada (`:8080`; nota: a URL crate normaliza `:80` explicito para o padrao - mesma origem), host local incorreto (`localhost`, `192.168.x`), porta local nao anunciada, caminho local nao autorizado (porta certa, rota fora de `TELAS_PATHS`), token de painel incorreto (prefixo diferente do anunciado), dominio CNA malicioso (`malicioso.cna.com.br`, `app.cna.com.br.evil.example`), HTTP para o portal, porta nao padrao no portal e dominio externo.
- **Privacidade (item 6):** PROVADA por `tests/eventos.test.js` (7 testes) com strings ficticias: evento fora do esquema vira `EVENTO_DESCONHECIDO` sem campos; campos fora da allowlist (nome, aluno, resposta, cookie, token) sao descartados; textos permitidos sao redigidos (`[EMAIL]`, `[URL]`, `[CDP]`, `[CPF]`, `[TELEFONE]`, `[CARTAO]`, `[TOKEN]`); excecoes sanitizadas antes das evidencias. Nomes proprios em texto livre NAO sao redaziveis por padrao - a protecao de nomes e na allowlist de CAMPOS (provida por teste).
- **Navegacao/falhas (item 7):** PROVADA por `tests/navegacao.test.js` (5 testes): falha simulada em painel/conclusao/portal retorna false, emite `NAVEGACAO_FALHOU` com destino e mensagem sanitizada, e nao vira sucesso; no fluxo real, falha em qualquer transicao agora emite `APPLICATION_FAILED` e nao emite `APPLICATION_COMPLETED`.
- **CI (item 8):** workflow atualizado; a execucao do CI em si so acontece apos o push (feito por quem orquestra).
- **Detecao contextual de portugues (item 9):** PROVADA por testes: frase PT iniciada por maiuscula aciona ("Nao terminei meu trabalho...", "Nao entendi a pergunta"); frase EN iniciada por maiuscula nao aciona ("This is...", "However..."); nome proprio PT dentro de frase EN nao aciona (Joao, Sao Paulo no meio); palavra isolada de autocorreto nao aciona; palavras estrangeiras e lugares nao acionam; frase PT dentro de resposta EN aciona; resposta inteira em PT aciona. 44/44 testes do guard verdes.
- **Build NSIS e tamanho:** NAO executado localmente nesta rodada (build pesado; o job Windows do CI produz o instalador apos o push). Pendente de confirmacao no CI.

### Seguranca (item 10)

- Nenhuma conta real, nenhuma atividade real, nenhum clique em Finalizar, nenhum dado real: todos os testes usam fixtures/mocks/diretorios ficticios.
- Regra preservada: `appliedRefs` so e atualizado apos evidencia positiva de finalizacao (executor.js intocado nesta rodada).
- Politica de notas (lib/notas.js) e semantica de finalizacao automatica: intocadas. Fluxo funcional de correcao: intocado (so confiabilidade nas bordas).

### Pendencias fisicas

- Executar push e confirmar CI verde: matriz Node 22/24 (Ubuntu/Windows) com `npm test` + `npm audit --audit-level=high`, job Windows com `cargo fmt --check` + `cargo check` + `cargo test` + build NSIS + upload do instalador.
- Teste fisico da queda do sidecar (matar o processo node com o app aberto e verificar o cartao de erro/retry na UI real).
- Teste fisico do ciclo completo (login manual no portal real com fixture de fluxo) - como nas rodadas anteriores, depende de sessao real do professor e segue fora do escopo automatizado.

## 15. Rodada 4 — encerramento definitivo, recuperação de falhas, privacidade e integração (resposta ao prompt de 9 itens do auditor)

**Data:** 2026-11-21
**Branch:** `feat/tauri-webview2-real-flow-fluent` (continua, sem merge)
**HEAD final:** ver "Commits" abaixo
**Sem push nesta rodada:** quem orquestra faz push e acompanha o CI (PR #1 segue aberto).

### Commits criados (um por item)

| Hash | Item | Conteudo |
|------|------|----------|
| `8f6a083` | - | Prompt da rodada 4 arquivado em docs/PROMPT_RODADA4.md |
| `b56308b` | 1 | Prazo GLOBAL único do encerramento: criado no INÍCIO de `encerrar()` (não depois da 1ª drenagem — recursos iniciais eternos não prendem mais); rotinas tardias vão para uma fila ainda aberta e CONTROLADA (`aoEncerrar` acorda o drenador; não depende de `Promise.resolve()` nem de um único tick); exportação AGUARDADA com `await` e dentro do mesmo prazo; RUN_DIR removida depois da exportação ou do prazo; encerramento continua com rotina/exportação falha; mesma Promise em chamadas simultâneas |
| `b778acc` | 4 | Erros: códigos FECHADOS (`ERRO_TEMPO_ESGOTADO`, `ERRO_REDE`, `ERRO_CONEXAO_PERDIDA`, `ERRO_INESPERADO`) + mensagens fixas definidas pela interface (`MENSAGENS_ERRO`); `sanitizarExcecao` NUNCA encaminha o texto bruto da exceção (nem redigido) — nomes, respostas, referências e texto do portal não podem vazar por mensagens; `navegacao.js` envia `codigo` fechado; campo `codigo` na allowlist |
| `cca8b90` | 2-3 | Queda do sidecar em QUALQUER tela: solução CENTRALIZADA na camada Tauri — o Rust injeta o overlay global (`poc-ui/falha-global.js`, fonte única via `include_str!`) na janela via `webview.eval`, independente da página atual (início/portal/coleta/painel/aplicação/conclusão); overlay bloqueia a interação com a página por baixo, informa a falha e oferece recuperação segura (`reiniciar_sidecar`, que encerra o sidecar anterior antes de criar outro); listener por página REMOVIDO de `poc-ui/app.js`; guarda de conexão (item 3): `src-node/saude.js` — desconexão inesperada do CDP emite `FLUXO_ERRO`/`ERRO_CONEXAO_PERDIDA` e encerra o sidecar com segurança (Rust detecta o EOF e apresenta a falha global); `browser.isConnected()` verificado ANTES de iniciar a aplicação; `appliedRefs` permanece intocado sem confirmação positiva |
| `fb60363` | 3 | Erro do guarda de conexão ("conexão perdida antes de aplicar") mapeado para o código fechado `ERRO_CONEXAO_PERDIDA` |
| `eb097d1` | 5 | Higiene: descoberta AUTOMÁTICA (varredura recursiva em tests/) dos arquivos de teste que referenciam o TEMP — novos testes não entram sem cobertura de limpeza; guarda contra regressão da descoberta; TEMP isolado mantido; nenhuma limpeza genérica (só prefixos comprovadamente da suíte) |
| `c89b47b` | 6 | Camada de integração ponta a ponta (`tests/integracao.test.js`): encerramento com servidor de telas REAL + exportação demorada + limpeza no mesmo prazo; navegação contra o servidor de telas real (sucesso e falha estruturada); queda com as telas do servidor real (overlay independente da página, sem listener por página); erros do painel com fixture real (rejeição não grava, não conta, painel fecha limpo); limpeza de execuções (ativa preservada/abandonada removida); queda durante a aplicação (encerramento imediato, appliedRefs intocado) |
| (este) | 7+9 | Documentação atualizada (números corrigidos; seção 15); workflow CI mantido como está |

### Arquivos modificados

- `src-node/ciclovida.js` (item 1), `src-node/eventos.js` (itens 3-4), `src-node/navegacao.js` (item 4), `src-node/orquestrador.js` (itens 2-3), `src-node/saude.js` (NOVO, item 3)
- `src-tauri/src/lib.rs` (item 2: `mostrar_falha_global`, `script_falha_global`, `mensagem_do_detalhe`), `poc-ui/falha-global.js` (NOVO, item 2), `poc-ui/app.js` (item 2: listener por página removido)
- Testes: `tests/ciclovida.test.js` (+10), `tests/eventos.test.js` (atualizado, +3 líquidos), `tests/navegacao.test.js` (atualizado), `tests/falha-global.test.js` (NOVO, 13), `tests/higiene-temp.test.js` (item 5), `tests/integracao.test.js` (NOVO, 6)
- Docs: `docs/PROMPT_RODADA4.md` (NOVO), `docs/RELATORIO_AUDITORIA.md` (item 7)

### Resultados de testes locais (executados nesta rodada)

| Suite | Resultado |
|-------|-----------|
| `npm test` (Node) | **283 testes: 282 pass, 0 fail, 1 skipped** (skip pré-existente: teste de arquitetura que exige CDP real); antes da rodada eram 253 — **30 testes novos** |
| `cargo fmt --check` (src-tauri) | **OK** (sem diffs) |
| `cargo check` (src-tauri) | **OK** (Finished dev profile sem erros; rodado após `scripts/poc-package-resources.ps1`) |
| `cargo test` (src-tauri) | **OK: 7 passed, 0 failed** (4 de allowlist + 1 de EOF + 2 novos de falha global) |

### Classificação dos testes (unitário / integrado / CI / físico)

- **Unitário:** lógica isolada — ciclovida (prazo global), eventos (códigos fechados), navegação, saude (guarda), overlay (DOM falso), allowlist Rust, `estado_no_eof`/`script_falha_global`.
- **Integrado:** módulos reais ligados entre si com fixtures/mocks — `tests/integracao.test.js` (telas reais servidas por HTTP local, servidor real drenado no encerramento, painel real com fixture, limpeza de execuções).
- **CI:** workflow `tests.yml` (matriz Node 22/24 Ubuntu/Windows: `npm test` + `npm audit --audit-level=high`; job Windows: `npm test`, empacotamento de resources, `cargo fmt --check`, `cargo check`, `cargo test`, build NSIS obrigatório, upload obrigatório) — executa APÓS o push.
- **Físico:** app Tauri real com WebView2 e portal real — NÃO executado nesta rodada (pendências abaixo).

### Provas (o que foi e não foi provado)

- **Timeout global (item 1):** PROVADO por 10 testes novos em `tests/ciclovida.test.js`: recurso inicial ETERNO não prende (prazo de 300ms, encerramento conclui, RUN_DIR removida); recurso que termina antes do prazo é aguardado por completo; rotina registrada DENTRO de outra rotina é drenada; rotina registrada no limite da janela de tardios é drenada (janela de 400ms, registro aos 250ms); exportação assíncrona aguardada ANTES da remoção; falha de exportação não impede limpeza nem saída; múltiplas chamadas simultâneas com recurso eterno recebem a mesma Promise; limpeza mesmo com rotina falha + exportação falha + recurso eterno. O teto é criado no INÍCIO de `encerrar()` (o teste "prazo global é criado no INÍCIO" reproduz exatamente o cenário da auditoria: recurso registrado ANTES de `encerrar()` que nunca resolve).
- **Encerramento assíncrono (item 1):** PROVADO: exportação `async` com atraso de 80ms é aguardada e o conteúdo exportado existe quando a RUN_DIR já foi removida; `Promise.race` contra o prazo global delimita rotinas e a exportação.
- **Queda do sidecar em todas as telas (item 2):** PROVADO: (a) Rust emite `FALHA_SIDECAR` no EOF e INJETA o overlay global na janela (`mostrar_falha_global`) — centralizado, independente da página; (b) `tests/falha-global.test.js` executa a MESMA fonte (`poc-ui/falha-global.js`, embutida no Rust via `include_str!`) contra um DOM falso nas 6 telas (inicial, portal, coleta, painel, aplicação, conclusão): overlay apresentado, mensagem do Rust presente, página bloqueada, idempotente (sem overlay duplicado); (c) `tests/integracao.test.js` prova que as telas reais do servidor carregam e que NENHUMA página tem listener próprio de falha (centralização); (d) recuperação segura: com IPC invoca `reiniciar_sidecar` (que encerra o sidecar anterior antes de criar outro — sem duplicação) e remove o overlay; sem IPC (portal remoto) orienta fechar e reabrir. A deteccão física da queda com o app real NÃO foi exercitada fisicamente.
- **Nenhuma aplicação após falha (item 3):** PROVADO: desconexão inesperada do CDP emite `FLUXO_ERRO`/`ERRO_CONEXAO_PERDIDA` (código FECHADO) e aciona o encerramento imediato do sidecar (Rust detecta o EOF → overlay global; processo morto não aplica nada); desconexão durante o próprio encerramento não reemite nem re-encerra; `browser.isConnected()` é verificado ANTES de iniciar a aplicação (invariante estrutural: guarda vem antes de `applyAcceptedCorrections`); `appliedRefs` permanece só com confirmação positiva (executor.js intocado, regra preservada).
- **Privacidade (item 4):** PROVADO por `tests/eventos.test.js` (9 testes) e `tests/navegacao.test.js`: exceções contendo nomes fictícios ("Ana Silva"), e-mails, tokens, URLs, CPFs e respostas do aluno viram apenas `tipo` + `codigo` fechado + mensagem FIXA do dicionário da interface — o texto bruto da exceção NUNCA é encaminhado (nem redigido), testado por asserção de ausência em cada resultado; códigos fora do dicionário são impossíveis (`CODIGOS_ERRO` fechado); campos fora da allowlist continuam descartados (esquema fechado inalterado). Nota: com mensagens fechadas, o detalhe técnico da exceção não vai mais nem para as evidências locais — troca aceita conforme o item 4 do auditor.
- **Higiene (item 5):** PROVADO: descoberta automática por varredura recursiva (inclui `tests/poc/`), com guarda que falha se a descoberta regredir (mínimo de arquivos + arquivos conhecidos); TEMP isolado do processo filho mantido; a verificação completa rodou verde no `npm test`.
- **Integração (item 6):** PROVADO por `tests/integracao.test.js` (6 testes) com módulos REAIS: servidor de telas real drenado pelo encerramento (responde antes, rejeita depois), exportação demorada concluída antes da limpeza, navegação real com falha estruturada, painel real com fixture (rejeição não grava nem conta), limpeza rename-exclusivo, queda durante a aplicação. Nenhuma conta real, nenhum dado real, nenhum clique em Finalizar.
- **CI (item 7):** workflow MANTIDO sem alterações (já atende: Node 22/24, Windows/Linux, `npm test`, `npm audit --audit-level=high`, `cargo fmt --check`, `cargo check`, `cargo test`, NSIS e upload obrigatórios). Números antigos corrigidos neste relatório (26+ → 52+ commits; 253 → 283 testes). A execução do CI em si só acontece após o push (feito por quem orquestra).
- **Build NSIS e tamanho:** NÃO executado localmente nesta rodada (build pesado; recursos empacotados localmente para o cargo: **102,01 MB** total, node.exe **88,53 MB**, playwright-core **13,32 MB**). O instalador é produzido pelo job Windows do CI após o push — pendente de confirmação no CI.

### Pendências físicas

> **Atualização (rodada 6):** o registro histórico desta seção foi superado — CI/NSIS e as validações físicas reais estão concluídas e relacionadas na seção 16. Fora de escopo permanecem apenas a máquina limpa sem WebView2 e o fluxo com login real (proibido nesta auditoria).

- Executar push e confirmar CI verde: matriz Node 22/24 (Ubuntu/Windows), job Windows com cargo + build NSIS + upload do instalador (tamanho a confirmar no artefato).
- Teste físico da queda do sidecar: matar o processo node com o app aberto em cada tela e verificar o overlay global na UI real (WebView2) — o mecanismo de injeção (`webview.eval` em página remota) precisa de confirmação física.
- Teste físico do ciclo completo (login manual no portal real) — como nas rodadas anteriores, depende de sessão real do professor e segue fora do escopo automatizado.

---

## 16. Rodadas 5 e 6 — encerramento da auditoria de código

**Data:** 2026-11-21
**Branch:** `feat/tauri-webview2-real-flow-fluent` (sem merge; PR #1 segue aberto; sem push e sem force push)
**HEAD funcional antes desta seção:** `2b43af7` (o commit que registra esta seção é o HEAD final — ver `git log -1`)
**Escopo:** rodada 5 (`docs/PROMPT_RODADA5.md`): 2 P0 + 3 P1; rodada 6 (`docs/PROMPT_RODADA6.md`): 2 P1 + 2 P2. Nenhuma alteração de arquitetura Tauri/WebView2, UI Fluent, parser de lotes, rubrica, copiar/colar, login manual ou da política de finalização automática. Nada de portal real, conta real, dados reais de alunos ou `Finalizar` real — só fixtures e mocks.

### Commits da rodada 5

| Hash | Item | Conteúdo |
|------|------|----------|
| `dcab0ef` | 1 (P0) | Overlay global bloqueia clique, teclado (Enter/Espaço em elemento focado), `submit` e interações sem clique convencional, em captura; `inert` nos elementos por baixo; controles do próprio overlay continuam funcionando; bloqueio e `inert` removidos SOMENTE após recuperação bem-sucedida. Testes comportamentais com DOM falso. |
| `6caa748` | 2 (P0) | `AbortController`/`AbortSignal` compartilhado: `saude.js` aborta no `disconnected`, o orquestrador passa o sinal ao executor; `applyAcceptedCorrections` verifica cancelamento antes de iniciar/navegar, antes de preencher, imediatamente antes de finalizar e antes de continuar; restantes vão para revisão, `appliedRefs` só com confirmação, cancelamento nunca vira `APPLICATION_COMPLETED`. Testes de integração com mocks. |
| `30c0cd9` | 3 (P1) | Rust: motivo de fim por GERAÇÃO (`Arc<AtomicU8>` em `SidecarState`), marcado em `parar_sidecar` ANTES do shutdown/kill por timeout; `estado_no_eof(pronto, motivo)` devolve `None` para encerramento normal e reinicialização; queda inesperada/falha de inicialização continuam gerando overlay. EOF tardio da geração antiga não silencia falha da nova. |
| `31d43a7` | 4 (P1) | `ciclovida.js`: identificador do timer do prazo guardado e `clearTimeout()` ao concluir; estados explícitos `aberta → encerrando → fechada → prazo-esgotado`; registro pós-fechamento tem política definida (não entra na fila, aviso no log). Testes de comportamento, inclusive processo filho que só sai se o timer foi limpo. |

### Commits da rodada 6

| Hash | Item | Conteúdo |
|------|------|----------|
| `78ee208` | docs | Prompt da rodada 6 (`docs/PROMPT_RODADA6.md`) commitado antes do código. |
| `2f1773c` | 1 (P1) | Orquestrador: após `applyAcceptedCorrections()`, verifica `controlador.signal.aborted`; se abortado, registra as contagens confirmadas nas evidências e retorna SEM `panel.setPhase('done')`, SEM conclusão e SEM `APPLICATION_COMPLETED`. Novo teste de integração `tests/orquestrador-cancel.test.js` executa o PRÓPRIO `src-node/orquestrador.js` (via `vm`, mocks só nas bordas de E/S, `AbortController` e `vigiarConexao` reais): desconexão durante a aplicação → nenhum `APPLICATION_COMPLETED`; controle saudável → conclusão emitida. Também corrige o typo latente `panelPort`/`painelPort` no log `CNA_PORTS`, que causava `ReferenceError` e interrompia o fluxo antes da aplicação. |
| `8ad9620` | 2 (P1) | Rust: `HandshakeSinal` por geração + `aguardar_handshake()` com timeout controlado; `reiniciar_sidecar`/`iniciar_sidecar` só retornam `Ok(())` depois de `CNA_SIDECAR_READY` + `CNA_CDP_CONECTADO`; em falha encerram o novo processo marcando o EOF como reinício (sem overlay falso) e retornam `Err` — o invoke rejeita e a UI mantém a mensagem de falha de recuperação. Overlay testado com invoke pendente (não libera a página) e invoke rejeitado (mantém a mensagem). 3 testes Rust novos. |
| `2b43af7` | 3 (P2) | `ciclovida.js`: depois do prazo global a fila não inicia novas rotinas e a exportação não é iniciada; apenas limpeza final e saída. Teste com três rotinas: a primeira nunca resolve; a segunda (e a terceira) e a exportação não começam. |
| (este) | 4 (P2) | Relatório atualizado (números, validações físicas, defeitos descobertos) e descrição do PR #1 corrigida via API do GitHub com UTF-8 legível. |

### Arquivos modificados na rodada 6

- `src-node/orquestrador.js`, `tests/orquestrador-cancel.test.js` (NOVO)
- `src-tauri/src/lib.rs`, `tests/falha-global.test.js`
- `src-node/ciclovida.js`, `tests/ciclovida.test.js`
- `docs/PROMPT_RODADA6.md` (NOVO), `docs/RELATORIO_AUDITORIA.md` (esta seção)

### Defeitos descobertos e corrigidos nesta rodada

- **`b5239fa` (empacotamento):** o instalador NSIS iniciava com overlay fatal porque `resources/` não continha os módulos da raiz exigidos pelo orquestrador (`login.js`, `scraper.js`, `executor.js`, `corrigir.js`, `instrucoes_correcao.md`). Corrigido em `b5239fa` (`scripts/poc-package-resources.ps1`, `src-tauri/tauri.conf.json`, `tests/pacote.test.js`); após reempacotar, `cargo check`/`cargo test` passaram nesta rodada (102,07 MB de recursos).
- **`panelPort`/`painelPort` (typo latente, introduzido em `021901a`):** `const panelPort` era declarado mas `painelPort` usado no log `CNA_PORTS` → `ReferenceError` interrompia o fluxo logo após o painel, antes da aplicação. Corrigido em `2f1773c`; descoberto pelo novo teste de integração do orquestrador — nenhum teste anterior executava esse caminho.

### Resultados de testes locais (executados nesta rodada)

| Suite | Resultado |
|-------|-----------|
| `npm test` (Node) | **303 testes: 302 pass, 0 fail, 1 skipped** (skip pré-existente). Antes da rodada 6: **298**. A numeração antiga desta seção (295) estava obsoleta — corrigida. **+5 testes novos** na rodada 6. |
| `cargo fmt --check` (src-tauri) | **OK** |
| `cargo check` (src-tauri) | **OK** — executado DEPOIS de `scripts\poc-package-resources.ps1` (102,07 MB de recursos; node.exe 88,53 MB; playwright-core 13,32 MB) |
| `cargo test` (src-tauri) | **OK: 12 passed, 0 failed** (9 anteriores + 3 novos de handshake) |

### Classificação dos testes (unitário / integrado / CI / físico)

- **Unitário:** `tests/ciclovida.test.js`, `tests/falha-global.test.js` (DOM falso, `estado_no_eof`, allowlist), `tests/pacote.test.js`, `aguardar_handshake` em Rust etc. — verificam uma função/regra isolada.
- **Integrado:** `tests/orquestrador-cancel.test.js` (fluxo REAL do orquestrador, mocks só nas bordas de E/S), `tests/executor-cancel.test.js`, `tests/integracao.test.js` (módulos reais ligados: telas, navegação, painel, ciclovida, saúde).
- **CI:** `.github/workflows/tests.yml` — matriz Node 22/24 × Ubuntu/Windows (`npm test`, `npm audit --audit-level=high`) + job Windows (empacotamento de resources, `cargo fmt --check`, `cargo check`, `cargo test`, build NSIS obrigatório e upload do artefato). **Verde**, sem `continue-on-error`.
- **Físico:** execução do instalador NSIS e do fluxo na WebView2 real (evidências abaixo) — não substituído por teste automatizado.

### Validações físicas reais concluídas (não são mais pendências)

- **CI verde:** matriz Node 22/24 em Ubuntu/Windows + job Windows Tauri, todos os jobs `success` (registro em `docs/POC_TAURI_RELATORIO_FINAL.md`, run #19; estado atual também no cabeçalho deste relatório).
- **Build NSIS obrigatório:** instalador `.exe` gerado pelo job Windows e disponível como artefato, sem `continue-on-error`.
- **Instalador executado (produto instalado):** aberto pelo atalho do Menu Iniciar, E2E completo em ~5 s com evidências em `%TEMP%\cna-poc-evidencias-1795212847283` — sidecar invisível, portal na mesma janela, HTTP 422 no retorno inválido, HTTP 200 no válido (`done: true`), 0 navegadores externos (`docs/POC_TAURI_RELATORIO_FINAL.md`).
- **Overlay de falha observado no instalado:** o smoke do produto instalado revelou o overlay fatal do defeito de empacotamento `b5239fa`; após a correção, os recursos foram reempacotados e `cargo check`/`cargo test` passaram nesta rodada.
- **Rede do CDP:** `netstat` mostrou `TCP 127.0.0.1:62867 LISTENING` — endpoint vinculado somente ao loopback; conexões do painel também em `127.0.0.1`.

### Provas por item (rodada 6)

- **Item 1 (P1):** `tests/orquestrador-cancel.test.js` executa o orquestrador real: a desconexão durante a aplicação aborta o sinal compartilhado (`FLUXO_ERRO`/`ERRO_CONEXAO_PERDIDA`, `encerrar(1)`), o executor emite `APPLICATION_FAILED` e **zero** `APPLICATION_COMPLETED`; a fase `done` não é marcada. Teste de controle sem desconexão emite `APPLICATION_COMPLETED` e marca `done` — prova de que o harness exercita o caminho real.
- **Item 2 (P1):** `aguardar_handshake` só retorna quando `sidecar_pronto && cdp_conectado`; testes Rust provam que não resolve apenas com `pronto`, falha rápido no EOF antes de pronto e respeita timeout controlado. No JS, invoke pendente mantém o overlay e o botão desabilitado; invoke rejeitado mantém overlay e mensagem de falha. O kill do novo processo é marcado como `FIM_REINICIACAO`, não gerando overlay falso (`eof_intencional_nao_gera_overlay_de_falha`).
- **Item 3 (P2):** teste das três rotinas: a eterna inicia; após o prazo, a segunda/terceira e a exportação **não** iniciam (`iniciadas === ['primeira']`), a RUN_DIR ainda é removida e o estado final é `prazo-esgotado`.
- **Item 4 (P2):** esta seção e a descrição do PR #1 (UTF-8 legível via API do GitHub).

### Fora do escopo automatizado (limitações conhecidas — não declaradas como concluídas)

- Máquina limpa sem WebView2 (bootstrapper do instalador) — não validada (`docs/POC_TAURI_RELATORIO_FINAL.md`).
- Fluxo completo com login real no portal — depende de sessão do professor e é proibido nesta auditoria (só fixtures/mocks).

**Encerramento:** os quatro pontos da rodada 6 passaram sem regressão (`npm test` 298 → 303, `cargo fmt/check/test` OK). Auditada sem Rodada 7.
