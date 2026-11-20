// Servidor HTTP local de progresso da inicialização (preflight/login/coleta).
// Mesmo modelo de segurança do Painel: bind em 127.0.0.1, token aleatório por
// execução, Cache-Control no-store. Nenhum dado de aluno é exposto aqui.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STEPS = [
  { id: 'preflight', label: 'Verificando componentes' },
  { id: 'login', label: 'Login no portal CNA' },
  { id: 'collect', label: 'Coletando atividades' },
  { id: 'panel', label: 'Correção com a IA' },
  { id: 'apply', label: 'Aplicando no portal' },
  { id: 'done', label: 'Concluído' },
];

function createStartupServer() {
  const token = crypto.randomBytes(18).toString('hex');
  const base = '/' + token;
  let current = 'preflight';
  let status = 'running'; // running | done | error
  const logs = [];
  let panelUrl = null;
  let redirectAt = null;
  const MAX_LOGS = 200;

  function getState() {
    return {
      status,
      current,
      steps: STEPS.map(s => ({
        id: s.id,
        label: s.label,
        state: s.id === current ? 'active' :
          STEPS.findIndex(x => x.id === s.id) < STEPS.findIndex(x => x.id === current) ? 'done' : 'pending',
      })),
      logs: logs.slice(-MAX_LOGS),
      panelUrl,
      redirectAt,
    };
  }

  function setStep(id) {
    if (STEPS.some(s => s.id === id)) { current = id; if (id === 'done') status = 'done'; }
  }
  function log(line) {
    if (!line) return;
    logs.push(String(line).replace(/\s+$/, ''));
    if (logs.length > MAX_LOGS) logs.shift();
  }
  function fail(message) { status = 'error'; log('ERRO: ' + message); }
  function readyForPanel(url) { panelUrl = url; redirectAt = Date.now(); setStep('panel'); }

  function sendJson(res, statusCode, value) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  }

  async function handle(req, res) {
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    if (!(pathname === base || pathname.startsWith(base + '/'))) {
      res.writeHead(404); res.end('Not found'); return;
    }
    if (req.method === 'GET' && (pathname === base || pathname === base + '/')) {
      const file = path.join(__dirname, '..', 'ui', 'inicio.html');
      if (!fs.existsSync(file)) { res.writeHead(500); res.end('Interface ausente.'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'GET' && pathname === base + '/api/state') {
      sendJson(res, 200, getState());
      return;
    }
    res.writeHead(404); res.end('Not found');
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handle(req, res)).catch(err => {
        if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Erro interno.' });
        else res.destroy();
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const port = server.address().port;
      resolve({
        url: 'http://127.0.0.1:' + port + base + '/',
        setStep, log, fail, readyForPanel, getState,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}

module.exports = { createStartupServer, STEPS };
