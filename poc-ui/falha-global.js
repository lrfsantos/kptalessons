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

  // Rodada 5, item 1: bloqueio COMPLETO em captura — clique, teclado (Enter/
  // Espaço em elemento já focado), submit e interações sem clique convencional.
  var BLOQUEADOS = ['click', 'auxclick', 'contextmenu', 'dblclick', 'mousedown', 'mouseup',
    'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'submit'];

  function bloquear(e) {
    if (overlay.contains(e.target)) return; // controles do próprio overlay funcionam
    e.preventDefault();
    e.stopPropagation();
  }

  var restaurar = []; // elementos tornados inert (interação só volta na recuperação)

  function fecharOverlay() {
    BLOQUEADOS.forEach(function (ev) { document.removeEventListener(ev, bloquear, true); });
    restaurar.forEach(function (el) { try { el.inert = false; } catch (_) {} });
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
  var raiz = document.body || document.documentElement;
  raiz.appendChild(overlay);

  // inert por baixo: sem foco nem ativação por teclado/leitor de tela, além
  // do bloqueio em captura (defesa em profundidade).
  var filhos = raiz.children || [];
  for (var i = 0; i < filhos.length; i++) {
    var el = filhos[i];
    if (el === overlay || overlay.contains(el)) continue;
    try { el.inert = true; restaurar.push(el); } catch (_) {}
  }
  BLOQUEADOS.forEach(function (ev) { document.addEventListener(ev, bloquear, true); });
})();
