# Rodada 4 — Encerramento definitivo e recuperação de falhas
# CORRETOR CNA — prompt do auditor (ChatGPT) extraído em 21/11/2026
# Repo: https://github.com/lrfsantos/kptalessons | Branch: feat/tauri-webview2-real-flow-fluent
# HEAD de referência: 97a54cab95a603b7dbb21cbfa07e4898d596061f | PR #1 aberto, NÃO mesclar.

OBJETIVO

Corrigir os problemas remanescentes encontrados na auditoria independente da rodada 3.
Esta rodada NÃO é uma reescrita da arquitetura.
Não alterar o fluxo funcional de correção, a rubrica, a semântica da finalização automática, o painel ou o contrato de copiar/colar/validar. Não fazer redesign.

## 1. Encerramento: timeout global obrigatório

Arquivo: src-node/ciclovida.js.
A implementação atual só cria o timeout depois da primeira chamada de drenar(). Isso deixa os recursos registrados inicialmente capazes de bloquear o encerramento indefinidamente. Corrigir.

Requisitos:
- Um único deadline para toda a operação de encerramento.
- Nenhuma rotina de recurso pode bloquear indefinidamente a limpeza.
- Recursos iniciais e tardios devem respeitar o mesmo deadline.
- A exportação de resultados deve ser aguardada com await.
- A remoção de RUN_DIR deve ocorrer depois da exportação ou do prazo controlado.
- O encerramento deve continuar mesmo se uma rotina falhar.
- Todas as chamadas simultâneas devem receber a mesma Promise.
- Nenhum recurso registrado pode ficar abandonado.
- Resolver também a corrida de aoEncerrar() durante a última drenagem: depois que o gerenciador começar a encerrar, recursos tardios devem ser encaminhados para encerramento imediato ou para uma fila ainda aberta e controlada. Não depender de Promise.resolve() ou de um único tick para garantir que não existem registros tardios.

Criar testes para: recurso inicial que nunca resolve; recurso inicial que termina antes do prazo; recurso registrado durante outra rotina; recurso registrado no limite do encerramento; exportação assíncrona; falha de exportação; múltiplas chamadas simultâneas; limpeza do diretório mesmo depois de falhas; garantia de que o processo não fica preso.
Não enfraquecer os testes existentes.

## 2. Queda do sidecar em qualquer tela

Arquivos principais: src-tauri/src/lib.rs, poc-ui/app.js, src-node/orquestrador.js.
O estado FALHA_SIDECAR é emitido corretamente pelo Rust, mas o listener de poc-ui/app.js existe somente na tela inicial. O aplicativo também navega para o portal, painel e conclusão.

Garantir que a queda do sidecar seja apresentada independentemente da página atualmente aberta.
A camada nativa deve controlar o estado de saúde do sidecar.

Quando houver queda inesperada:
- Interromper o fluxo atual.
- Não permitir que a interface pareça funcional.
- Não permitir finalização de atividades depois da perda de comunicação.
- Apresentar uma tela ou aviso de erro global.
- Oferecer recuperação segura.
- Impedir reinicialização duplicada; não criar um segundo sidecar antes de encerrar o anterior.
- Não resolver isso simplesmente duplicando listeners em todas as páginas; preferir uma solução centralizada na camada Tauri.

Criar testes que simulem a queda: na tela inicial; durante o portal; durante a coleta; durante o painel; durante a aplicação; durante a conclusão.
Os testes devem usar mocks e fixtures. Não acessar o portal real.

## 3. Segurança da aplicação após queda

Garantir que nenhuma operação de aplicação possa continuar se o sidecar perder sua conexão ou entrar em estado de falha.
Preservar a regra: appliedRefs só é atualizado depois de confirmação positiva do portal.
Não alterar a lógica de finalização automática. Não clicar em Finalizar no portal real durante testes.

## 4. Privacidade dos eventos

Arquivo: src-node/eventos.js.
Reduzir a dependência de mensagens arbitrárias de exceções. Preferir códigos de erro fechados e mensagens definidas pela interface. Eventos não devem transportar nomes, respostas, referências ou texto bruto do portal. Manter o esquema fechado.
Adicionar testes para mensagens que contenham nomes fictícios, e-mails, tokens, URLs e respostas.

## 5. Higiene da suíte

Arquivo: tests/higiene-temp.test.js.
Manter o TEMP isolado. Melhorar a forma de identificar testes que criam diretórios temporários, evitando que novos testes sejam adicionados sem cobertura de limpeza.
Não fazer limpeza genérica na máquina do usuário. Não remover pastas que não pertençam comprovadamente à suíte.

## 6. Testes de integração

Criar uma camada de testes integrada para: encerramento; queda do sidecar; navegação; erros do painel; exportação; limpeza.
Não basta testar cada função isoladamente. Simular o fluxo de ponta a ponta com fixtures e mocks.

É proibido: usar conta real; usar dados reais de alunos; abrir atividades reais para teste; clicar em Finalizar no portal; alterar atividades reais.

## 7. CI e documentação

Manter o workflow atual: Node 22/24; Windows/Linux; npm test; npm audit --audit-level=high; cargo fmt --check; cargo check; cargo test; NSIS obrigatório; upload obrigatório.
Atualizar docs/RELATORIO_AUDITORIA.md. Corrigir números antigos de commits e testes. Distinguir claramente: teste unitário; teste integrado; teste CI; teste físico. Não declarar validado o que não foi executado.

## 8. Git e entrega

Confirmar HEAD remoto antes de trabalhar. Permanecer na branch atual (feat/tauri-webview2-real-flow-fluent). Não alterar master. Não alterar a POC original. Não fazer force push. Não fazer merge. Criar commits pequenos e separados. Atualizar o PR #1.

## 9. Relatório final

Informar: HEAD final; commits; arquivos modificados; resultados dos testes Node; resultados Rust; resultado CI; prova do timeout global; prova de encerramento assíncrono; prova de tratamento da queda do sidecar em todas as telas; prova de que nenhuma aplicação continua após falha; prova de privacidade; build NSIS e tamanho; pendências de validação física.

Não fazer merge. Não finalizar atividades reais. Não alterar a lógica de correção.
