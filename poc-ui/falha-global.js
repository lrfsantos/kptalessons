// Overlay GLOBAL de queda do sidecar (rodada 4, item 2) — fonte ÚNICA.
// Injetado pela camada Tauri (webview.eval) em QUALQUER página atual
// (início, portal, painel, conclusão): não depende de listeners por página.
// O placeholder __CNA_MENSAGEM__ é substituído pelo Rust por uma string
// JSON (sempre válida em JS) antes da injeção.
// Recuperação segura: reiniciar_sidecar encerra o sidecar anterior ANTES de
// criar outro (parar_sidecar no Rust) — sem segundo sidecar duplicado.
(function () {
  'use strict';
  if (document.getElementById('cna-falha-global')) return; // idempotente
  var mensagem = __CNA_MENSAGEM__;
  var overlay = document.createElement('div');
  overlay.id = 'cna-falha-global';
  overlay.setAttribute('role', 'alert');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(20,20,20,.6);display:flex;align-items:center;justify-content:center;font:14px/1.5 system-ui,Segoe UI,sans-serif';
  var cartao = document.createElement('div');
  cartao.setAttribute('role', 'dialog');
  cartao.setAttribute('aria-label', 'Falha do serviço interno');
  cartao.style.cssText = 'max-width:480px;margin:16px;padding:24px;background:#fdfdfd;color:#191919;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.35)';
  var titulo = document.createElement('strong');
  titulo.textContent = 'Serviço interno interrompido.';
  var texto = document.createElement('p');
  texto.textContent = mensagem || 'O aplicativo perdeu a comunicação com o serviço interno.';
  var dica = document.createElement('p');
  dica.textContent = 'O fluxo foi interrompido por segurança: nenhuma atividade será alterada. Use a recuperação abaixo ou feche e reabra o aplicativo.';
  cartao.appendChild(titulo);
  cartao.appendChild(texto);
  cartao.appendChild(dica);

  function bloquear(e) {
    if (overlay.contains(e.target)) return; // botões do próprio overlay funcionam
    e.preventDefault();
    e.stopPropagation();
  }
  document.addEventListener('click', bloquear, true); // página por baixo não responde

  function fecharOverlay() {
    document.removeEventListener('click', bloquear, true);
    overlay.remove();
  }
  var acao = document.createElement('button');
  acao.type = 'button';
  acao.style.cssText = 'margin-top:12px;padding:8px 16px;cursor:pointer';
  acao.textContent = 'Tentar reiniciar o serviço';
  acao.addEventListener('click', function (e) {
    e.stopPropagation();
    var invocar = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (!invocar) {
      // Origem remota (portal) sem IPC: recuperação segura = reiniciar o app.
      acao.textContent = 'Feche e reabra o aplicativo para reiniciar.';
      return;
    }
    acao.disabled = true;
    invocar('reiniciar_sidecar').then(fecharOverlay).catch(function () {
      acao.disabled = false;
      acao.textContent = 'Não foi possível reiniciar. Feche e reabra o aplicativo.';
    });
  });
  cartao.appendChild(acao);
  overlay.appendChild(cartao);
  (document.body || document.documentElement).appendChild(overlay);
})();
