// Rodada 6, item 1: teste de INTEGRAÇÃO do caminho do orquestrador.
// Executa o PRÓPRIO src-node/orquestrador.js (via vm) com as fronteiras de
// E/S substituídas por mocks — mas com AbortController e vigiarConexao REAIS.
// Provoca a desconexão DURANTE a aplicação e prova que nenhum
// APPLICATION_COMPLETED é emitido depois. Nada de portal/dados reais.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const ORQ = path.join(__dirname, '..', 'src-node', 'orquestrador.js');
const FONTE = fs.readFileSync(ORQ, 'utf8');
const { vigiarConexao } = require('../src-node/saude');
const { sanitizarEvento, sanitizarExcecao } = require('../src-node/eventos');

// Executa o fluxo completo do orquestrador com mocks nas bordas.
// `abortar` provoca `browser.emit('disconnected')` dentro da aplicação.
function executarOrquestrador(abortar) {
  return new Promise((resolve, reject) => {
    try {
      const eventos = [];
      const fases = [];
      const encerramentos = [];
      const erros = [];
      let controlador = null;

      class AbortControllerSpy extends AbortController {
        constructor(...args) { super(...args); controlador = this; }
      }

      // --- páginas / navegador (mocks de CDP) --------------------------
      const page = {
        goto: async () => {}, waitForURL: async () => {},
        evaluate: async () => {}, addInitScript: async () => {},
      };
      const browser = new EventEmitter();
      browser.contexts = () => [{ pages: () => [page] }];
      browser.isConnected = () => true;
      browser.close = async () => {};

      // --- recursos de E/S (mocks) --------------------------------------
      const server = {
        listen: (_p, _h, cb) => setTimeout(cb, 0),
        address: () => ({ port: 1430 }),
      };
      const panel = {
        url: 'http://127.0.0.1:55555/abcdef123/',
        setPhase: f => fases.push(f),
        waitForComplete: async () => ({ receivedBatches: 1, receivedActivities: 1 }),
        close: async () => {},
      };
      const gerenciador = {
        encerrado: false,
        aoEncerrar() {},
        encerrar: c => encerramentos.push(c),
      };
      const fsMock = {
        mkdirSync() {}, appendFileSync() {}, copyFileSync() {}, rmSync() {},
        readdirSync: () => ['lote-01.md'],
        readFileSync: p => (String(p).includes('answers') ? '{}' : ''),
        existsSync: () => false, statSync: () => ({ size: 0 }),
      };
      const osMock = { tmpdir: () => 'C:\\tmp-cna-teste', homedir: () => 'C:\\Users\\teste' };
      const consoleMock = {
        log(...args) {
          const linha = args.join(' ');
          if (!linha.startsWith('CNA_EVENT ')) return;
          try { eventos.push(JSON.parse(linha.slice('CNA_EVENT '.length))); } catch { /* ignora */ }
        },
        error(...args) { erros.push(args.join(' ')); },
      };

      const modulos = {
        chromium: { connectOverCDP: async () => browser },
        createPanel: async () => panel,
        CFG: {},
        performLogin: async () => {},
        collectActivities: async () => ({
          status: 'OK', collection: { batches: [{ num: 1, name: 'lote-01.md', total: 1 }] },
        }),
        // O executor real emite APPLICATION_FAILED quando abortado; aqui o
        // sinal é abortado pela desconexão real no meio da aplicação.
        applyAcceptedCorrections: async ({ onProgress }) => {
          onProgress('APPLICATION_STARTED', {});
          if (abortar) browser.emit('disconnected');
          onProgress(abortar ? 'APPLICATION_FAILED' : 'APPLICATION_COMPLETED', {});
          // resolve no check phase: microtasks do orquestrador já drenaram
          setImmediate(() => resolve({ eventos, fases, encerramentos, erros, sinal: controlador.signal }));
          return {
            stats: { finalizadasNestaExecucao: 1, jaCorrigidasNoPortal: 0, revisaoManual: 0, falhasFinalizacao: 0 },
          };
        },
        criarGerenciador: () => gerenciador,
        fecharServidor: async () => {},
        limparExecucoesAbandonadas: () => {},
        irPara: async () => true,
      };
      const mod = id => String(id);
      const req = id => {
        const s = mod(id);
        if (s === 'http') return {};
        if (s === 'path') return path;
        if (s === 'fs') return fsMock;
        if (s === 'os') return osMock;
        if (s.endsWith('playwright-core')) return { chromium: modulos.chromium };
        if (s.endsWith('panel.js')) return { createPanel: modulos.createPanel };
        if (s.endsWith('config.js')) return modulos.CFG;
        if (s.endsWith('login.js')) return { performLogin: modulos.performLogin };
        if (s.endsWith('scraper.js')) return { collectActivities: modulos.collectActivities };
        if (s.endsWith('executor.js')) return { applyAcceptedCorrections: modulos.applyAcceptedCorrections };
        if (s.endsWith('ciclovida.js')) return modulos;
        if (s.endsWith('navegacao.js')) return { irPara: modulos.irPara };
        if (s.endsWith('saude.js')) return { vigiarConexao }; // REAL
        if (s.endsWith('eventos.js')) return { sanitizarEvento, sanitizarExcecao }; // REAL
        if (s.endsWith('telas.js')) return { criarServidorTelas: () => server };
        throw new Error('require inesperado no orquestrador: ' + s);
      };

      const contexto = vm.createContext({
        require: req, console: consoleMock, process: {
          argv: ['node', 'orquestrador.js', '9222'], env: {}, pid: 4242,
          stdin: Object.assign(new EventEmitter(), { setEncoding() {} }),
        },
        __dirname: path.dirname(ORQ), __filename: ORQ, module: { exports: {} },
        AbortController: AbortControllerSpy, URL, URLSearchParams,
        setTimeout, clearTimeout, setImmediate,
      });
      vm.runInContext(FONTE, contexto, { filename: ORQ });
    } catch (e) { reject(e); }
  });
}

test('integração/orquestrador: desconexão durante a aplicação NÃO emite APPLICATION_COMPLETED', async () => {
  const r = await executarOrquestrador(true);
  assert.equal(r.sinal.aborted, true, 'o sinal compartilhado foi abortado');
  assert.deepEqual(r.encerramentos, [1], 'encerramento seguro acionado pelo monitor de saúde');
  assert.ok(r.eventos.some(e => e.event === 'APPLICATION_FAILED'), 'executor emitiu falha');
  assert.ok(r.eventos.some(e => e.event === 'FLUXO_ERRO'), 'monitor emitiu ERRO_CONEXAO_PERDIDA');
  assert.equal(
    r.eventos.filter(e => e.event === 'APPLICATION_COMPLETED').length, 0,
    'o orquestrador NÃO anuncia conclusão bem-sucedida após o cancelamento',
  );
  assert.ok(r.fases.includes('applying'), 'a fase de aplicação foi iniciada');
  assert.ok(!r.fases.includes('done'), 'a fase done NÃO é marcada no painel');
});

test('integração/orquestrador: sem cancelamento, o fluxo conclui e emite APPLICATION_COMPLETED', async () => {
  // Controle: prova que o harness exercita o caminho real — se o teste acima
  // passasse apenas porque COMPLETED nunca ocorre, este garantiria o contrário.
  const r = await executarOrquestrador(false);
  assert.equal(r.sinal.aborted, false);
  assert.deepEqual(r.encerramentos, []);
  assert.ok(r.eventos.some(e => e.event === 'APPLICATION_COMPLETED'), 'conclusão emitida quando saudável');
  assert.ok(r.fases.includes('done'), 'fase done marcada apenas no caminho saudável');
});
