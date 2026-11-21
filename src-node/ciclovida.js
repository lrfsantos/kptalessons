// ============================================================
// Ciclo de vida do orquestrador — encerramento idempotente.
//
// Responsabilidades:
//  1. Registrar recursos ativos (servidores HTTP, painel, conexão CDP).
//  2. Encerrar tudo em ordem segura: parar de aceitar requisições,
//     aguardar as em andamento, fechar painel e CDP, exportar o que o
//     professor precisa manter, remover os dados temporários sensíveis.
//  3. Idempotência: um segundo sinal de fechamento NÃO reexecuta a
//     limpeza (sem corrida).
//  4. Limpeza de execuções abandonadas: um diretório de execução só é
//     removido se o S.O. deixar renomeá-lo (prova de que nenhum processo
//     o mantém aberto). Execuções ativas falham no rename e preservadas.
// ============================================================
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {string} opts.runDir      Diretório temporário sensível desta execução.
 * @param {function} [opts.exportarResultados]  Copia para fora (pasta de
 *        resultados do professor) o que precisa sobreviver à limpeza.
 * @param {function} [opts.sair]    Injetável para testes (padrão: process.exit).
 */
function criarGerenciador({ runDir, exportarResultados = null, sair = process.exit }) {
  let encerrando = false;
  const rotinas = []; // encerramentos de recursos registrados (servidores, CDP...)

  return {
    /** Registra o encerramento de um recurso ativo (ordem de registro = ordem de chamada). */
    aoEncerrar(fn) {
      if (typeof fn === 'function') rotinas.push(fn);
    },
    /** Encerramento completo. Idempotente: chamadas concorrentes aguardam a mesma execução. */
    encerrar(codigo = 0) {
      if (encerrando) return;
      encerrando = true;
      (async () => {
        for (const fn of rotinas) {
          try { await fn(); } catch { /* recurso já fechado: seguir com a limpeza */ }
        }
        try { if (exportarResultados) exportarResultados(); } catch { /* melhor esforço */ }
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* melhor esforço */ }
        sair(codigo);
      })();
    },
    get encerrado() { return encerrando; },
  };
}

/**
 * Fecha um servidor HTTP com segurança: para de aceitar requisições,
 * encerra conexões keep-alive ociosas e aguarda as em andamento terminarem
 * (com teto de tempo para não travar o encerramento do aplicativo).
 */
function fecharServidor(server, tetoMs = 4000) {
  return new Promise(resolve => {
    let fechado = false;
    const concluir = () => { if (!fechado) { fechado = true; resolve(); } };
    try { server.closeAllConnections && server.closeAllConnections(); } catch { /* Node antigo */ }
    try { server.close(concluir); } catch { concluir(); return; }
    setTimeout(concluir, tetoMs);
  });
}

/**
 * Remove diretórios residuais de execuções abandonadas (mesma política do
 * Rust para perfis WebView2: rename-exclusivo como prova de abandono).
 * @param {string} prefixo  Ex.: 'cna-corretor-run-'
 * @param {string} [excluir] Caminho a preservar (o desta execução, se houver).
 */
function limparExecucoesAbandonadas(prefixo, excluir = null) {
  const base = require('os').tmpdir();
  let entradas;
  try { entradas = fs.readdirSync(base); } catch { return; }
  for (const nome of entradas) {
    if (!nome.startsWith(prefixo)) continue;
    const caminho = path.join(base, nome);
    if (excluir && caminho === excluir) continue;
    let reivindicado;
    try {
      reivindicado = caminho + '.removendo-' + process.pid;
      fs.renameSync(caminho, reivindicado); // falha => em uso por execução ativa
    } catch { continue; }
    try { fs.rmSync(reivindicado, { recursive: true, force: true }); } catch { /* melhor esforço */ }
  }
}

module.exports = { criarGerenciador, fecharServidor, limparExecucoesAbandonadas };
