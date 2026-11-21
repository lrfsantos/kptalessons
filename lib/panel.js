// Painel local de transferência entre o professor e a IA.
// Não usa APIs externas, contas de IA, servidor remoto ou dependências adicionais.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const md = require('./md');

const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > MAX_BODY) {
        reject(new Error('O retorno ultrapassa o limite de 8 MB.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function createPanel({ collection, lotesDir, returnsDir }) {
  if (!collection || !Array.isArray(collection.batches)) {
    throw new Error('Coleta inválida: lista de lotes ausente.');
  }
  fs.mkdirSync(returnsDir, { recursive: true });
  const token = crypto.randomBytes(18).toString('hex');
  const base = '/' + token;
  let phase = 'waiting';
  let resolveComplete;
  let rejectComplete;
  let completeResolved = false;
  const completePromise = new Promise((resolve, reject) => { resolveComplete = resolve; rejectComplete = reject; });

  const expectedBatches = collection.batches.map(b => ({
    num: Number(b.num),
    name: 'lote-' + String(Number(b.num)).padStart(2, '0') + '.md',
    total: Number(b.total || (b.refs || []).length),
    refs: b.refs || [],
  }));

  function validReturnedFile(batch) {
    const file = path.join(returnsDir, batch.name);
    if (!fs.existsSync(file)) return false;
    try {
      const content = fs.readFileSync(file, 'utf8');
      const checked = md.inspectCombinedReturn(content, collection, []);
      return !checked.globalIssues.length &&
        checked.acceptedBatches.some(item => item.num === batch.num);
    } catch {
      return false;
    }
  }

  function receivedNums() {
    return expectedBatches.filter(validReturnedFile).map(b => b.num);
  }

  function getState() {
    const received = new Set(receivedNums());
    const batches = expectedBatches.map(b => ({
      num: b.num,
      total: b.total,
      received: received.has(b.num),
      status: received.has(b.num) ? 'received' : 'waiting',
    }));
    const receivedActivities = batches.filter(b => b.received).reduce((n, b) => n + b.total, 0);
    const totalActivities = batches.reduce((n, b) => n + b.total, 0);
    const done = batches.length > 0 && batches.every(b => b.received);
    return {
      phase,
      totalActivities,
      receivedActivities,
      batchCount: batches.length,
      receivedBatches: batches.filter(b => b.received).length,
      done,
      batches,
    };
  }

  function checkComplete() {
    if (!completeResolved && getState().done) {
      completeResolved = true;
      resolveComplete(getState());
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (!(pathname === base || pathname.startsWith(base + '/'))) {
      res.writeHead(404); res.end('Not found'); return;
    }

    // Folhas de estilo do painel (layout local + design system compartilhado).
    if (req.method === 'GET' && (pathname === base + '/painel.css' || pathname === base + '/fluent.css')) {
      const file = pathname.endsWith('/fluent.css')
        ? path.join(__dirname, '..', 'poc-ui', 'fluent.css')
        : path.join(__dirname, '..', 'ui', 'painel.css');
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (req.method === 'GET' && (pathname === base || pathname === base + '/')) {
      const file = path.join(__dirname, '..', 'ui', 'painel.html');
      if (!fs.existsSync(file)) {
        res.writeHead(500); res.end('Painel HTML ausente.'); return;
      }
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
      json(res, 200, getState());
      return;
    }

    const batchSuffix = pathname.startsWith(base + '/api/batch/') ? pathname.slice((base + '/api/batch/').length) : '';
    const batchMatch = batchSuffix.match(/^(\d+)$/);
    if (req.method === 'GET' && batchMatch) {
      const num = Number(batchMatch[1]);
      const batch = expectedBatches.find(b => b.num === num);
      if (!batch) { json(res, 404, { error: 'Lote não encontrado.' }); return; }
      const file = path.join(lotesDir, batch.name);
      if (!fs.existsSync(file)) { json(res, 404, { error: 'Arquivo original do lote não encontrado.' }); return; }
      json(res, 200, { num, name: batch.name, content: fs.readFileSync(file, 'utf8') });
      return;
    }

    if (req.method === 'POST' && pathname === base + '/api/submit') {
      try {
        const raw = await readBody(req);
        let payload;
        try { payload = JSON.parse(raw); } catch { json(res, 400, { error: 'Formato da requisição inválido.' }); return; }
        const pasted = String(payload.text || '');
        if (!pasted.trim()) { json(res, 400, { error: 'Cole primeiro a resposta da IA.' }); return; }
        const already = receivedNums();
        const inspected = md.inspectCombinedReturn(pasted, collection, already);
        if (inspected.globalIssues && inspected.globalIssues.length) {
          json(res, 422, {
            error: 'Não foi possível validar este retorno.',
            globalIssues: inspected.globalIssues,
            parsedActivities: inspected.parsedActivities,
          });
          return;
        }

        const accepted = [];
        for (const batch of inspected.acceptedBatches || []) {
          const spec = expectedBatches.find(b => b.num === batch.num);
          if (!spec) continue;
          const destination = path.join(returnsDir, spec.name);
          if (fs.existsSync(destination)) {
            if (validReturnedFile(spec)) continue;
            const rejectedDir = path.join(returnsDir, 'rejeitados');
            fs.mkdirSync(rejectedDir, { recursive: true });
            const quarantine = path.join(rejectedDir, spec.name.replace(/\.md$/i, '') +
              '-invalido-' + Date.now() + '.md');
            fs.renameSync(destination, quarantine);
          }
          const temporary = path.join(returnsDir, '.tmp-' + process.pid + '-' + crypto.randomBytes(5).toString('hex'));
          try {
            fs.writeFileSync(temporary, batch.content, { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(temporary, destination);
            accepted.push({ num: batch.num, activities: batch.activities });
          } finally {
            try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* limpeza best effort */ }
          }
        }
        checkComplete();
        json(res, 200, {
          accepted,
          rejectedBatches: inspected.rejectedBatches || [],
          missingBatches: inspected.missingBatches || [],
          parsedActivities: inspected.parsedActivities,
          state: getState(),
        });
        return;
      } catch (error) {
        json(res, 400, { error: error.message || 'Falha ao processar retorno.' });
        return;
      }
    }

    json(res, 404, { error: 'Rota não encontrada.' });
  }

  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(error => {
      if (!res.headersSent) json(res, 500, { error: error.message || 'Erro interno do painel.' });
      else res.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      const handleResult = {
        url: 'http://127.0.0.1:' + address.port + base + '/',
        waitForComplete: () => {
          checkComplete();
          return completePromise;
        },
        getState,
        abort(reason) {
          if (!completeResolved) {
            completeResolved = true;
            rejectComplete(new Error(reason || 'Painel encerrado antes do recebimento de todos os lotes.'));
          }
        },
        setPhase(value) {
          if (['waiting', 'applying', 'done', 'error'].includes(value)) phase = value;
        },
        close: () => new Promise(done => server.close(() => done())),
      };
      checkComplete();
      resolve(handleResult);
    });
  });
}

module.exports = { createPanel };
