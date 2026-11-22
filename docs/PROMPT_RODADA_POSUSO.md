# Rodada curta pós-uso — correções reativas (aprovada pelo auditor em 21/11/2026)

Escopo FECHADO, baseado apenas em defeitos concretos documentados em `docs/RELATORIO_TESTES_REAIS.md`.
NÃO é nova auditoria geral. Não reabrir as 6 rodadas anteriores.
HEAD de referência: ff222b8 (PR #1 aberto, sem merge, sem force push).

## 1. Reescrever o README como produto oficial

O README atual ainda orienta o professor a executar `Corrigir.cmd`, fala em Node/Chromium portáteis, distribuição de 858 MB e fluxo de terminal. Tudo isso está obsoleto.

O README deve apresentar **Tauri + WebView2 como versão oficial**, com instruções claras para um professor leigo:
- Onde baixar: GitHub → Actions → execução mais recente bem-sucedida da branch `feat/tauri-webview2-real-flow-fluent` → artefato `corretor-cna-nsis` (link para a página de execuções do workflow).
- Como instalar o `.exe` do zip.
- Como abrir pelo Menu Iniciar.
- Como fazer login manual no portal CNA na mesma janela.
- Como transferir lotes para a IA (copiar/colar manual, sem envio automático).
- O que acontece com os dados ao fechar (perfil temporário removido, nada retido).
- Ferramentas de desenvolvimento (CLI, scripts) devem ser identificadas como tal, não como caminho de instalação.
- Sugerir futuramente uma GitHub Release para distribuição estável (apenas menção, sem implementar).

## 2. Remover `distribuicao/` integralmente

A pasta contém somente `Corrigir.cmd`, `preflight.js`, `README.md` — distribuição antiga enganosa. Remover do repositório (`git rm`). Manter scripts CLI úteis ao desenvolvimento, mas rotulados como tal.

## 3. Painel: diagnóstico acionável + saúde inicial

Arquivos: `lib/panel.js`, `ui/painel.js`, `ui/painel.html` (e testes em `tests/panel.test.js` / novos testes).

- Se um lote não existir, a mensagem deve orientar o professor a **encerrar a execução e iniciar uma nova correção**, sem jargão técnico tipo "Arquivo original do lote não encontrado".
- Na abertura do painel, `/api/state` deve verificar também a existência/consistência dos arquivos esperados da coleta. Se faltarem, o estado deve sinalizar inconsistência e a interface **não pode mostrar botões habilitados como se estivesse tudo normal**.
- Exibir instrução compreensível quando houver inconsistência.
- Não redesenhar o painel. Adicionar testes de regressão para os dois casos (lote ausente; estado inconsistente na inicialização).

## 4. Relatório e privacidade

- Atualizar `docs/RELATORIO_TESTES_REAIS.md` com: 10 testes reais (estatísticas agregadas), limitações (mesmas 9 atividades, sem variedade, sem validação de retorno de IA), correções posteriores (2be5261, ff222b8) e esta rodada curta.
- **Não incluir respostas, nomes,refs individuais de alunos nem dados identificáveis** no relatório versionado (remover inclusive o exemplo `S32846` citado hoje). Manter apenas contagens, marcadores de integridade e desfechos.
- A pasta `C:\Users\luiza\Desktop\CNA teste` contém 10 lotes com dados reais; **não excluí-la você** — quem orquestra vai apagar depois de preservar o relatório sanitizado.

## 5. Proibido / não fazer

- Não implementar sessão persistente, não alterar autenticação, arquitetura Tauri, UI geral, parser, rubrica, executor nem política de finalização.
- Não abrir nova auditoria geral. Não clicar em Finalizar em atividade real. Não usar novos dados de alunos em testes automatizados.
- Não fazer merge, não force push. Commits pequenos e separados. NÃO fazer push — quem orquestra fará push, CI e a validação física final.

## 6. Testes e entrega

- `npm test` (baseline 304 testes) não pode regredir; `cargo fmt --check`, `cargo check`, `cargo test` após `scripts\poc-package-resources.ps1`.
- Deixar working tree limpa.
- Resposta final: SHA final, commits, arquivos modificados/removidos, resultados de testes, como ficou o README, provas dos testes do painel e pendências para a validação física final.
