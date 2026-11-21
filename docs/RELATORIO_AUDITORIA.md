# Relatório para Auditoria — Migração Tauri + WebView2 (janela única, fluxo real, Fluent)

**Data:** 2026-11-21
**Branch:** `feat/tauri-webview2-real-flow-fluent` (26+ commits a partir de `master` = `3f2145b`)
**PR:** https://github.com/lrfsantos/kptalessons/pull/1 — aberto, **sem merge** (aguarda auditoria)
**Status do CI na escrita deste relatório:** matriz Node 22/24 × Ubuntu/Windows **verde**; job Windows de build NSIS reexecutando após correção de toolchain (detalhe na seção 8).

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
