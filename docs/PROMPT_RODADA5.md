# Rodada 5 — Correção final dos bloqueadores de segurança
# CORRETOR CNA — instruções do auditor (ChatGPT) extraídas em 21/11/2026
# Repo: https://github.com/lrfsantos/kptalessons | Branch: feat/tauri-webview2-real-flow-fluent
# HEAD de referência: 42a14567cd4f72217ae7aa6ae9e3efd4c2cdd688 | PR #1 aberto, NÃO mesclar.

Rodada CURTA e fechada. Não transformar em nova sequência de refatorações.
Não alterar o fluxo funcional de correção, a rubrica, a semântica da finalização automática, o painel ou o contrato de copiar/colar/validar. Não fazer redesign.

## 1. P0 — Bloqueio global completo da página sob o overlay

Arquivo: poc-ui/falha-global.js.
O overlay atual bloqueia cliques, mas NÃO bloqueia: teclas Enter/Espaço em elementos já focados, atalhos de teclado da página, eventos submit de formulários, outras interações sem clique convencional.

Cenário de risco: professor com o botão de finalização focado; sidecar cai; overlay aparece; professor aperta Enter — o evento passa por baixo do overlay.

Correção necessária:
- Bloquear eventos de teclado relevantes.
- Bloquear submissões de formulários.
- Impedir interação com os elementos subjacentes, preferencialmente com `inert` ou mecanismo equivalente.
- Garantir que os controles de recuperação do próprio overlay continuem funcionando.
- Restaurar a interação somente depois de recuperação comprovadamente bem-sucedida.
- Os testes devem verificar COMPORTAMENTO (evento de teclado no elemento focado sob o overlay não dispara a ação; submit não chega ao handler), não apenas a presença do overlay no DOM.

## 2. P0 — Cancelamento explícito do executor após perda de conexão

Arquivos: src-node/saude.js, src-node/orquestrador.js, executor.js (applyAcceptedCorrections).
Hoje: saude.js escuta `disconnected` → FLUXO_ERRO → encerrar(1); orquestrador verifica browser.isConnected() ANTES de iniciar a aplicação — mas não DURANTE. O loop do executor captura exceções e continua as demais atividades; a perda de conexão faz Playwright falhar, mas não cancela formalmente o fluxo.

Correção necessária:
- Implementar sinal de cancelamento (AbortController/AbortSignal) compartilhado entre o monitor de saúde e o executor.
- O executor verifica o estado de cancelamento: antes de iniciar cada atividade; antes de navegar para uma atividade; antes de preencher classificação e feedback; imediatamente antes de solicitar a finalização; antes de continuar para a próxima atividade.
- Ao detectar perda de conexão: interromper o loop; não iniciar novas operações; não continuar com as restantes; não registrar sucesso artificial; preservar appliedRefs exclusivamente para finalizações confirmadas.
- Não muda a regra de negócio: atividades PRONTAS continuam sendo finalizadas automaticamente quando o fluxo está saudável. É proteção contra falhas.

## 3. P1 — Rust: diferenciar EOF intencional de queda inesperada

Arquivo: src-tauri/src/lib.rs (watch_sidecar_stdout).
Hoje, EOF de stdout sempre gera falha global — mas EOF pode ser: processo morto inesperadamente OU encerramento normal/reinicialização solicitada (o shutdown enviado pelo Rust; e o encerramento do processo anterior em reiniciar_sidecar() pode disparar falso overlay).

Correção necessária:
- Estado explícito de encerramento intencional.
- Distinguir: sidecar encerrado normalmente; encerrado por solicitação de reinicialização; morto inesperadamente; falha de inicialização.
- Somente as duas últimas geram o overlay de falha.
- A distinção deve funcionar também quando o processo anterior é encerrado por timeout e recebe kill.

## 4. P1 — ciclovida.js: limpar o timer do prazo e fechar formalmente a fila tardia

Arquivo: src-node/ciclovida.js. NÃO voltar ao unref().
- Guardar o identificador do timer do prazo global e executar clearTimeout() quando o encerramento terminar antes do prazo.
- Definir transição explícita de estados da fila tardia: encerramento iniciado → fila aberta → fila fechada → prazo esgotado. aoEncerrar() após a fila fechada precisa de política definida (registro tardio pós-janela: documentar/tratar explicitamente, não deixar no array sem destino).
- Testes para registros posteriores ao fechamento da janela (comportamento definido e coberto).

## 5. P1 — Testes de integração para os três problemas principais

- Overlay bloqueando de verdade (teclado focado por baixo, submit, clique).
- Cancelamento do executor no meio do loop (perda de conexão simulada → nenhuma finalização nova; appliedRefs intocado sem confirmação).
- Falso overlay não dispara em encerramento/reinicialização intencional (nível Rust ou contrato testado).

## 6. Regras de segurança e entrega (inalteradas)

- Proibido: conta real, dados reais de alunos, abrir atividades reais, clicar em Finalizar no portal, alterar atividades reais. Só fixtures/mocks.
- appliedRefs só com confirmação positiva do portal.
- Confirmar HEAD remoto antes de trabalhar; permanecer na branch feat/tauri-webview2-real-flow-fluent; não alterar master nem a POC original; sem force push; sem merge; commits pequenos e separados; atualizar o PR #1.
- Atualizar docs/RELATORIO_AUDITORIA.md (seção 16) com: HEAD final, commits, arquivos, resultados Node/Rust/CI, provas dos 3 pontos principais, pendências de validação física (queda real do sidecar, instalação NSIS real, fluxo completo no portal — autorizado, sem atividades reais para finalização).
- npm test atual (~283 testes) não pode regredir; cargo fmt --check / cargo check / cargo test dentro de src-tauri\ SEMPRE após scripts\poc-package-resources.ps1.
- NÃO fazer push no final — quem orquestra fará push e acompanhará o CI.
