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
 * @param {number} [opts.tetoMs]    Teto para recursos registrados durante a limpeza.
 */
function criarGerenciador({ runDir, exportarResultados = null, sair = process.exit, tetoMs = 15000 }) {
  let execucao = null; // ÚNICA Promise do encerramento (chamadas concorrentes aguardam a mesma operação)
  const rotinas = []; // encerramentos de recursos registrados (servidores, painel, CDP...)

  // Drena a fila em ordem LIFO: o painel (registrado depois) fecha antes de
  // Playwright/CDP, aguardando servidores e operações em andamento.
  const drenar = async () => {
    while (rotinas.length) {
      const fn = rotinas.pop();
      try { await fn(); } catch { /* recurso já fechado: seguir com a limpeza */ }
    }
  };

  return {
    /** Registra o encerramento de um recurso ativo. Seguro durante a limpeza:
     *  será drenado pela própria operação em andamento (nunca abandonado). */
    aoEncerrar(fn) {
      if (typeof fn === 'function') rotinas.push(fn);
    },
    /** Encerramento completo. Idempotente; retorna a mesma Promise a cada chamada. */
    encerrar(codigo = 0) {
      if (execucao) return execucao;
      execucao = (async () => {
        // 1. Encerra recursos registrados.
        await drenar();
        // 2. Recursos registrados DEPOIS do início do encerramento: cede um
        //    tick para os registros e drena de novo, com teto de tempo para a
        //    saída nunca ficar presa.
        await Promise.resolve();
        const teto = new Promise(resolve => {
          const t = setTimeout(resolve, tetoMs);
          if (t.unref) t.unref();
        });
        await Promise.race([drenar(), teto]);
        // 3. Exporta apenas o que precisa sobreviver; 4. remove dados sensíveis.
        try { if (exportarResultados) exportarResultados(); } catch { /* melhor esforço */ }
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* melhor esforço */ }
        // 5. Sai somente depois da limpeza concluída (ou teto); sem exit antecipado.
        sair(codigo);
      })();
      return execucao;
    },
    get encerrado() { return execucao !== null; },
  };
}

/**
 * Fecha um servidor HTTP com segurança, nesta ordem:
 *  1. Impede novas conexões (server.close) e AGUARDA as requisições em
 *     andamento terminarem;
 *  2. Respeita um teto de tempo (não travar o encerramento do aplicativo);
 *  3. Somente como fallback, encerra as conexões remanescentes.
 */
function fecharServidor(server, tetoMs = 4000) {
  return new Promise(resolve => {
    let fechado = false;
    const concluir = () => {
      if (fechado) return;
      fechado = true;
      clearTimeout(teto);
      resolve();
    };
    // Fallback no teto: encerra conexões remanescentes e conclui.
    const teto = setTimeout(() => {
      try { server.closeAllConnections && server.closeAllConnections(); } catch { /* Node antigo */ }
      concluir();
    }, tetoMs);
    if (teto.unref) teto.unref();
    try { server.close(concluir); } catch { concluir(); }
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
