# Rodada 6 (última) — Encerramento da auditoria de código
# Auditor (ChatGPT): "auditoria quase encerrada"; sem Rodada 7 se estes pontos passarem.
# Repo: https://github.com/lrfsantos/kptalessons | Branch: feat/tauri-webview2-real-flow-fluent
# HEAD de referência: b5239fadf8ba7613cace4422d286adabc15668b7 | PR #1 aberto, NÃO mesclar.
# Contexto do auditor esgotou; a conversa continua em novo chat com resumo automático.

## 1. P1 — Orquestrador não pode anunciar sucesso depois do cancelamento

Arquivo: src-node/orquestrador.js.
O executor já recebe o AbortSignal e emite APPLICATION_FAILED quando abortado, mas o orquestrador não verifica `controlador.signal.aborted` depois de `applyAcceptedCorrections()` e prossegue para a tela de conclusão, emitindo APPLICATION_COMPLETED — dois eventos contraditórios.

Correção:
- Depois de applyAcceptedCorrections(), verificar o sinal abortado.
- Se abortado: NÃO chamar panel.setPhase('done'); NÃO emitir APPLICATION_COMPLETED; NÃO apresentar conclusão bem-sucedida; manter resultado interrompido/falha; preservar estatísticas das atividades com confirmação positiva.
- Adicionar teste de integração que execute o caminho do orquestrador, provoque desconexão durante a aplicação e confirme que nenhum APPLICATION_COMPLETED é emitido depois. (tests/executor-cancel.test.js testa só o executor isolado — não basta.)

## 2. P1 — Recuperação: só remover overlay após saúde real confirmada

Arquivos: poc-ui/falha-global.js, src-tauri/src/lib.rs.
`reiniciar_sidecar()` -> `iniciar_sidecar()` encerra o anterior, espera a porta CDP, cria o novo Node, registra o monitor de stdout e retorna Ok(()) — antes do handshake/CDP pronto. A Promise do invoke resolve e o overlay é removido nessa janela transitória.

Correção:
- O comando Rust de reinício deve aguardar o novo sidecar completar o handshake pronto (CNA_SIDECAR_READY + conexão CDP, com timeout controlado) antes de resolver Ok(()).
- Se falhar: não remover overlay; manter mensagem de falha de recuperação.
- Não duplicar sidecar; conservar a lógica de geração do EOF intencional.
- Teste: recuperação não libera a página até o handshake real; furnace de novo processo não gera overlay falso.

## 3. P2 — Prazo global: não iniciar rotinas/exportação depois de esgotado

Arquivo: src-node/ciclovida.js.
Quando o teto resolve, a rotina atual deixa de ser aguardada, mas o `while` continua percorrendo a fila e a exportação ainda é invocada (Promise.race resolve rápido, mas a função chega a iniciar).

Correção:
- Depois do prazo: não iniciar novas rotinas de encerramento; não iniciar exportação; apenas limpeza final possível + saída.
- Teste com três rotinas: primeira nunca resolve; segunda registra se executou; exportação registra se iniciou. Após o prazo, segunda e exportação não devem começar.

## 4. P2 — Documentação e PR

- Atualizar docs/RELATORIO_AUDITORIA.md: seção 16 ainda descreve push/CI e validações físicas como pendentes (não são mais); números antigos (295 → 298 testes); registrar o defeito de empacotamento descoberto (b5239fa) e as validações físicas reais concluídas.
- Corrigir a descrição do PR #1: caracteres corrompidos em português (MigraÃ§Ã£o etc.) → UTF-8 legível, via API do GitHub (token em git credential fill) ou PATCH REST. Não alterar o código por causa disso.
- Distinguir claramente: teste unitário, integrado, CI, físico.

## 5. Limites e regras (inalterados)

Não acrescentar funcionalidades. Não mexer em: arquitetura Tauri/WebView2, UI Fluent, parser de lotes, rubrica, copiar/colar, login manual, política de finalização automática, estrutura do CLI.
Proibido: conta real, dados reais de alunos, abrir atividades reais, clicar em Finalizar no portal. Só fixtures/mocks.
PR #1 aberto, sem merge; branch atual; sem force push; commits pequenos; atualizar PR e relatório; npm test (298 testes) não pode regredir; cargo fmt/check/test após scripts\poc-package-resources.ps1; CI verde + NSIS obrigatórios.
Se estes pontos passarem sem regressão, o auditor considera encerrada a auditoria de código — NÃO propor Rodada 7.
