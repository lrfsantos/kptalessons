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
 * @param {number} [opts.tetoMs]    Prazo GLOBAL ÚNICO do encerramento (do 1º
 *        recurso ao exit; criado no início, nunca depois da 1ª drenagem).
 * @param {number} [opts.janelaTardiasMs] Janela controlada para registros
 *        tardios (aoEncerrar durante o encerramento) após a drenagem inicial.
 */
function criarGerenciador({ runDir, exportarResultados = null, sair = process.exit, tetoMs = 15000, janelaTardiasMs = 250 }) {
  let execucao = null; // ÚNICA Promise do encerramento (chamadas concorrentes aguardam a mesma operação)
  const rotinas = []; // encerramentos de recursos registrados (servidores, painel, CDP...)
  let encerrando = false;
  let acordar = null; // sinaliza chegada de rotina tardia ao drenador

  // Executa cada rotina sob o prazo global; rotina lenta/eterna NUNCA trava
  // a limpeza (a Promise pendente é abandonada — o sair() encerra o processo).
  const drenar = async teto => {
    while (rotinas.length) {
      const fn = rotinas.pop();
      try { await Promise.race([Promise.resolve().then(fn), teto]); } catch { /* recurso já fechado: seguir com a limpeza */ }
    }
  };

  return {
    /** Registra o encerramento de um recurso ativo. Durante o encerramento a
     *  fila segue aberta e controlada: a rotina tardia acorda o drenador e é
     *  encerrada imediatamente, dentro do MESMO prazo global (não depende de
     *  ticks nem de Promise.resolve()). */
    aoEncerrar(fn) {
      if (typeof fn !== 'function') return;
      rotinas.push(fn);
      if (encerrando && acordar) acordar();
    },
    /** Encerramento completo. Idempotente; retorna a mesma Promise a cada chamada. */
    encerrar(codigo = 0) {
      if (execucao) return execucao;
      encerrando = true;
      const inicio = Date.now();
      const prazofinal = inicio + tetoMs;
      execucao = (async () => {
        // Prazo GLOBAL: criado AGORA, cobre recursos iniciais, tardios e a
        // exportação. unref: o processo nunca fica preso só pelo timer.
        const teto = new Promise(resolve => {
          const t = setTimeout(resolve, tetoMs);
          if (t.unref) t.unref();
        });
        // 1. Encerra recursos registrados ANTES do início, sob o prazo global.
        await drenar(teto);
        // 2. Janela controlada para registros tardios: cada aoEncerrar acorda
        //    o drenador imediatamente; a fila fecha só quando a janela acaba
        //    sem novos registros (ou no prazo).
        const fimJanela = Date.now() + janelaTardiasMs;
        while (Date.now() < fimJanela && Date.now() < prazofinal) {
          const sinal = new Promise(r => { acordar = r; });
          await Promise.race([sinal, new Promise(r => setTimeout(r, fimJanela - Date.now()))]);
          acordar = null;
          await drenar(teto);
        }
        // 3. Exporta apenas o que precisa sobreviver — AGUARDADA, dentro do
        //    mesmo prazo; 4. remove dados sensíveis depois da exportação
        //    (ou do prazo, se ela estourar).
        if (exportarResultados) {
          try { await Promise.race([Promise.resolve().then(exportarResultados), teto]); } catch { /* melhor esforço */ }
        }
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* melhor esforço */ }
        // 5. Sai somente depois da limpeza concluída (ou prazo); sem exit antecipado.
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
