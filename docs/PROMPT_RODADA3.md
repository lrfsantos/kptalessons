# Rodada 3 — Confiabilidade, encerramento, privacidade e testes
# CORRETOR CNA — prompt do auditor (Claude) extraído do ChatGPT em 21/11/2026
# Repo: https://github.com/lrfsantos/kptalessons | Branch: feat/tauri-webview2-real-flow-fluent
# HEAD de referência: 2356862286aa1df836d846601d16de204077c197 | PR #1 aberto, NÃO mesclar.

OBJETIVO

Corrigir os problemas encontrados na auditoria independente da rodada 2.
Esta rodada é exclusivamente de confiabilidade, privacidade e cobertura de testes.

- Não faça redesign.
- Não altere o fluxo funcional de correção.
- Não altere a política de notas, exceto para adicionar os testes de detecção contextual solicitados.
- Não altere a semântica da finalização automática.
- Não remova proteções existentes.

## 1. Ciclo de vida do Node

Arquivo: src-node/ciclovida.js. Corrija criarGerenciador().

Requisitos:
- Armazenar uma única Promise de encerramento.
- encerrar() deve retornar essa Promise.
- Chamadas simultâneas devem aguardar a mesma operação.
- A limpeza deve ser executada uma única vez.
- Recursos registrados depois do início do encerramento não podem ficar abandonados.
- Implementar ordem explícita de encerramento: encerrar o painel antes de desconectar Playwright/CDP; aguardar servidores e operações em andamento; exportar apenas o que precisa sobreviver; remover os dados sensíveis temporários; sair somente depois de concluída a limpeza ou atingido um timeout controlado.
- Não use process.exit() antes de concluir as operações.
- Adicione testes com recursos assíncronos demorados, falhas simuladas e múltiplas chamadas simultâneas.

## 2. Fechamento HTTP

Corrija fecharServidor(). A implementação atual chama closeAllConnections() antes de server.close(), o que pode interromper requisições ativas.

A nova implementação deve: impedir novas conexões; aguardar requisições em andamento; respeitar um timeout; encerrar conexões remanescentes somente como fallback.

Adicione um teste que mantenha uma requisição aberta enquanto o servidor está sendo encerrado. O teste deve provar que a operação termina normalmente antes do fechamento.

## 3. Monitoramento do sidecar

Arquivo: src-tauri/src/lib.rs. Corrija a detecção de falha após o handshake.
Atualmente, watch_sidecar_stdout() só emite falha se o processo morrer antes de CNA_SIDECAR_READY.

Implemente monitoramento contínuo da vida do processo:
- Detectar saída inesperada após o handshake.
- Informar a interface por evento estruturado.
- Não deixar a interface aparentemente funcional sem comunicação.
- Impedir reinicialização duplicada: antes de iniciar outro sidecar, verificar e encerrar corretamente qualquer processo anterior.
- Drenar stderr continuamente; não encaminhar mensagens técnicas para a interface; não deixar o processo bloqueado por pipes cheios.
- Testar falha antes e depois do handshake.

## 4. Allowlist de navegação

Arquivo: src-tauri/src/lib.rs. A função allowed_url() precisa validar a origem Tauri exata.

Corrigir: tauri:// sem host específico; http://tauri.localhost sem restrição de porta; portas e caminhos dos servidores locais.

A navegação deve aceitar apenas: origem Tauri exata; origem e caminhos autorizados do servidor de telas; origem e caminhos/token autorizados do painel desta execução; https://app.cna.com.br na porta HTTPS padrão. Não permitir HTTP para o portal. Não usar curingas.

Adicionar testes para: host Tauri incorreto; porta Tauri inesperada; host local incorreto; porta local não anunciada; caminho local não autorizado; token de painel incorreto; domínio CNA malicioso; HTTP para o portal; domínio externo.

## 5. Higiene dos testes temporários

Auditar todos os testes que criam arquivos ou diretários em %TEMP%/os.tmpdir(). Corrigir, no mínimo: tests/ciclovida.test.js, tests/csp.test.js, tests/poc/painel-fixture.test.js, quaisquer outros testes que deixem resíduos.

- Todo diretório criado por teste precisa ser removido em finally.
- Quando o teste precisar verificar a preservação de um diretório, a remoção deve ocorrer somente depois da asserção.
- Adicionar um teste de higiene da suíte: registrar os diretórios temporários relevantes antes dos testes; executar a suíte; confirmar que os testes não deixaram novos diretórios próprios para trás.
- Não remover pastas reais do usuário. Não fazer limpeza genérica por prefixo sem comprovação de propriedade.

## 6. Sanitização de eventos e logs

Auditar todos os eventos emitidos por: login.js, scraper.js, executor.js, src-node/orquestrador.js.

Criar uma camada central com esquema fechado de eventos. Somente campos explicitamente permitidos podem chegar ao Rust e à interface. Não permitir encaminhamento indiscriminado de objetos recebidos de callbacks.

Não registrar: nomes; respostas; e-mails; telefones; CPFs; referências completas; cookies; tokens; senhas; URLs com parâmetros de autenticação; endpoints CDP.

Sanitizar exceções antes de gravar evidências.

Adicionar testes com strings fictícias contendo dados sensíveis para provar que não aparecem nos eventos ou logs.

## 7. Navegação e falhas

Arquivo: src-node/orquestrador.js. Remover o comportamento de ignorar silenciosamente erros em irPara().

Falhas ao navegar para o portal, painel ou conclusão devem gerar estados estruturados e mensagens adequadas. Não permitir que a aplicação continue esperando indefinidamente por uma página que não foi carregada. Não converter uma falha de navegação em sucesso.

Testar falhas simuladas em cada transição.

## 8. CI

Arquivo: .github/workflows/tests.yml. Adicionar explicitamente cargo test ao job Windows.

Manter: Node 22 e 24; Windows e Linux; npm test; npm audit --audit-level=high; cargo fmt --check; cargo check; cargo test; build NSIS obrigatório; upload obrigatório do instalador. Não introduzir continue-on-error.

Atualizar o relatório para distinguir testes locais, CI e validações físicas.

## 9. Detecção contextual de português

Arquivo: lib/guard.js. Não reescrever a política de notas.

Adicionar testes para verificar o tratamento de: frase portuguesa iniciada por letra maiúscula; frase inglesa iniciada por letra maiúscula; nome próprio em português dentro de frase inglesa; frase portuguesa dentro de resposta inglesa; resposta inteiramente em português; palavra isolada substituída por autocorreção; palavras estrangeiras e nomes de lugares.

Corrigir apenas o necessário para evitar que a regra de ignorar palavras maiúsculas esconda frases portuguesas. Não substituir a função por uma lista simplista de palavras.

## 10. Regras de segurança dos testes

É proibido: entrar em conta real de professor; abrir atividades reais para testes; clicar em Finalizar no portal real; alterar atividades reais; usar respostas ou dados reais de alunos; criar screenshots com dados reais. Usar exclusivamente fixtures e mocks.

Preservar a regra de que appliedRefs só é atualizado depois de evidência positiva de finalização.

## 11. Git e entrega

- Consultar o HEAD remoto antes de alterar arquivos.
- Continuar na branch existente (feat/tauri-webview2-real-flow-fluent).
- Não alterar master. Não alterar a branch original da POC. Não fazer force push. Não fazer merge.
- Fazer commits pequenos e objetivos. Atualizar o PR #1.
- Atualizar docs/RELATORIO_AUDITORIA.md com os resultados reais.

## 12. Relatório final

Apresentar: HEAD final; commits criados; arquivos modificados; testes novos e antigos; resultados de Node, Rust e CI; prova de limpeza dos diretórios de teste; prova de encerramento gracioso; prova de detecção de queda do sidecar; prova de bloqueio de origens não autorizadas; resultado dos testes de privacidade; build NSIS e tamanho; pendências que ainda dependem de teste físico.

Não declarar validado o que não foi executado. Não fazer merge. Não finalizar atividades reais. Não alterar o comportamento funcional do corretor.
