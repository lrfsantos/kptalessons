// ============================================================
// Saúde da conexão (rodada 4, item 3): se a comunicação com o
// WebView2/portal se perde, o sidecar NÃO continua operando.
// Nenhuma aplicação (preenchimento/finalização) pode continuar
// sem conexão: o encerramento seguro é acionado imediatamente —
// o Rust detecta o EOF e apresenta a falha global na UI.
// ============================================================
'use strict';

/**
 * Vigia a conexão: desconexão inesperada emite evento estruturado
 * (código FECHADO) e aciona o encerramento idempotente do sidecar.
 * @param {object} opts
 * @param {object} opts.browser      Instância Playwright (EventEmitter).
 * @param {object} opts.gerenciador  Gerenciador de ciclo de vida.
 * @param {function} opts.evento     Emissor de eventos estruturados.
 * @param {AbortController} [opts.controlador] Sinal compartilhado com o executor.
 */
function vigiarConexao({ browser, gerenciador, evento, controlador = null }) {
  browser.on('disconnected', () => {
    if (gerenciador.encerrado) return; // desconexão do próprio encerramento
    evento('FLUXO_ERRO', { codigo: 'ERRO_CONEXAO_PERDIDA' });
    // Rodada 5, item 2: cancela formalmente o loop de aplicação — sem
    // operação nova numa conexão já perdida (o encerramento é assíncrono).
    if (controlador && !controlador.signal.aborted)
      controlador.abort(new Error('conexão perdida'));
    gerenciador.encerrar(1);
  });
}

module.exports = { vigiarConexao };
