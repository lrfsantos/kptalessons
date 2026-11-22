// Estado de inicialização + modo interativo (scripts externos: CSP estrito).
//
// Exibição de falhas (FALHA_INICIALIZACAO / FALHA_SIDECAR) é CENTRALIZADA na
// camada Tauri: o Rust injeta o overlay global (poc-ui/falha-global.js) em
// QUALQUER página atual via webview.eval — rodada 4, item 2. Nenhum listener
// por página.

// Modo interativo: você inicia; o portal abre NESTA janela para verificação.
document.getElementById('iniciar').addEventListener('click', function () {
  this.disabled = true;
  this.textContent = 'Abrindo o portal…';
  window.location.href = 'https://app.cna.com.br/login';
});
