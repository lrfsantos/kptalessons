// Estado de inicialização + modo interativo (scripts externos: CSP estrito).
function mostrarErro(mensagem) {
  const cartao = document.querySelector('.cartao');
  if (!cartao || document.getElementById('erro-inicializacao')) return;
  const div = document.createElement('div');
  div.id = 'erro-inicializacao';
  div.className = 'aviso atencao';
  div.setAttribute('role', 'alert');
  div.innerHTML = '<strong>Falha na inicialização.</strong> ';
  if (arguments.length > 1 && arguments[1] === 'FALHA_SIDECAR') {
    div.innerHTML = '<strong>Serviço interno interrompido.</strong> ';
  }
  div.appendChild(document.createTextNode(mensagem || 'Tente novamente.'));
  const btn = document.createElement('button');
  btn.className = 'botao primario margem-topo';
  btn.type = 'button';
  btn.textContent = 'Tentar novamente';
  btn.addEventListener('click', function () {
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('reiniciar_sidecar').then(function () {
        div.remove();
      }).catch(function () { location.reload(); });
    } else {
      location.reload();
    }
  });
  div.appendChild(btn);
  cartao.appendChild(div);
}

if (window.__TAURI__ && window.__TAURI__.event) {
  window.__TAURI__.event.listen('app-estado', function (e) {
    var payload = e.payload || [];
    if (payload[0] === 'FALHA_INICIALIZACAO' || payload[0] === 'FALHA_SIDECAR') {
      var msg = '';
      try { msg = JSON.parse(payload[1]).mensagem; } catch (err) { /* usa padrão */ }
      mostrarErro(msg, payload[0]);
    }
  });
}

// Modo interativo: você inicia; o portal abre NESTA janela para verificação.
document.getElementById('iniciar').addEventListener('click', function () {
  this.disabled = true;
  this.textContent = 'Abrindo o portal…';
  window.location.href = 'https://app.cna.com.br/login';
});
