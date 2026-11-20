// Testa o servidor de progresso da interface de inicialização.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createStartupServer, STEPS } = require('../lib/startup');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(b) }));
    }).on('error', reject);
  });
}
function getRaw(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}

test('startup sobe em 127.0.0.1 com token e estado inicial', async () => {
  const ui = await createStartupServer();
  try {
    assert.match(ui.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{36}\/$/);
    const s = await getJson(ui.url + 'api/state');
    assert.equal(s.status, 200);
    assert.equal(s.headers['cache-control'], 'no-store');
    assert.equal(s.body.status, 'running');
    assert.equal(s.body.current, 'preflight');
    assert.equal(s.body.steps.length, STEPS.length);
    assert.equal(s.body.steps[0].state, 'active');
    assert.deepEqual(s.body.logs, []);
  } finally { await ui.close(); }
});

test('rota fora do token retorna 404', async () => {
  const ui = await createStartupServer();
  try {
    const base = ui.url.replace(/\/[0-9a-f]{36}\/$/, '/');
    const r = await getRaw(base + 'api/state');
    assert.equal(r.status, 404);
  } finally { await ui.close(); }
});

test('setStep/log/fail/readyForPanel atualizam o estado', async () => {
  const ui = await createStartupServer();
  try {
    ui.log('linha 1'); ui.log('linha 2');
    ui.setStep('login');
    let s = (await getJson(ui.url + 'api/state')).body;
    assert.equal(s.current, 'login');
    assert.equal(s.steps[0].state, 'done');
    assert.deepEqual(s.logs, ['linha 1', 'linha 2']);

    ui.setStep('collect');
    ui.readyForPanel('http://127.0.0.1:9999/painel/');
    s = (await getJson(ui.url + 'api/state')).body;
    assert.equal(s.current, 'panel');
    assert.equal(s.panelUrl, 'http://127.0.0.1:9999/painel/');
    assert.ok(s.redirectAt > 0);

    ui.fail('login recusado');
    s = (await getJson(ui.url + 'api/state')).body;
    assert.equal(s.status, 'error');
    assert.ok(s.logs.some(l => /login recusado/.test(l)));
  } finally { await ui.close(); }
});

test('serve a interface HTML com no-store', async () => {
  const ui = await createStartupServer();
  try {
    const r = await getRaw(ui.url);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.body, /CORRETOR CNA/);
    assert.match(r.body, /api\/state/);
  } finally { await ui.close(); }
});

test('limita tamanho do log', async () => {
  const ui = await createStartupServer();
  try {
    for (let i = 0; i < 250; i++) ui.log('linha ' + i);
    const s = (await getJson(ui.url + 'api/state')).body;
    assert.equal(s.logs.length, 200);
    assert.equal(s.logs[0], 'linha 50');
  } finally { await ui.close(); }
});
