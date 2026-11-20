// Teste ponta a ponta da fixture realista de 10 atividades (dados fictícios).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const md = require('../lib/md');
const { createPanel } = require('../lib/panel');
const { NONCE, REF, makeReturn, makeCollection, makeGenerated } = require('./fixtures/retorno-problematico');

function postJson(url, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    }).on('error', reject);
  });
}

test('parser lê as 10 atividades da fixture problemática (formatos A-G)', () => {
  const collection = makeCollection();
  const texto = makeReturn();
  const restored = md.restoreMangledMarkers(texto, NONCE);
  const { nonce, entries } = md.parseFile(restored);
  assert.equal(nonce, NONCE);
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.map(e => e.ref), collection.batches[0].refs);
  assert.ok(entries.every(e => e.error === null), 'sem erros de marcador');
  assert.ok(entries.every(e => e.nonceOk), 'marcadores recuperados');
  assert.ok(entries.every(e => !e.pending), 'nenhuma pendente');
  assert.ok(entries.every(e => e.classification && e.score != null && e.flag && e.revisao && e.feedback));
  assert.ok(entries[0].feedback.includes('\n\n'), 'feedback com parágrafos preservado');
});

test('inspectCombinedReturn aceita a fixture de 10 atividades', () => {
  const collection = makeCollection();
  const r = md.inspectCombinedReturn(makeReturn(), collection, []);
  assert.deepEqual(r.globalIssues, []);
  assert.equal(r.parsedActivities, 10);
  assert.equal(r.acceptedBatches.length, 1);
  assert.equal(r.acceptedBatches[0].activities, 10);
  assert.equal(r.rejectedBatches.length, 0);
  assert.ok(r.acceptedBatches[0].content.includes('**Feedback:**'));
});

test('caminho completo: /api/submit aceita, grava e atualiza o painel 10/10', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-fixture-'));
  const lotesDir = path.join(dir, 'lotes');
  const returnsDir = path.join(dir, 'retornos');
  fs.mkdirSync(lotesDir, { recursive: true });
  fs.writeFileSync(path.join(lotesDir, 'lote-01.md'), makeGenerated(), 'utf8');
  const collection = makeCollection();

  const panel = await createPanel({ collection, lotesDir, returnsDir });
  try {
    const state0 = await getJson(panel.url + 'api/state');
    assert.equal(state0.body.receivedActivities, 0);

    const r = await postJson(panel.url + 'api/submit', { text: makeReturn() });
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted.length, 1);
    assert.equal(r.body.accepted[0].activities, 10);
    assert.deepEqual(r.body.rejectedBatches, []);
    assert.equal(r.body.state.receivedBatches, 1);
    assert.equal(r.body.state.receivedActivities, 10);
    assert.equal(r.body.state.done, true);

    const saved = fs.readFileSync(path.join(returnsDir, 'lote-01.md'), 'utf8');
    const { entries } = md.parseFile(saved);
    assert.equal(entries.length, 10);
    assert.ok(entries.every(e => !e.pending));

    const state1 = await getJson(panel.url + 'api/state');
    assert.equal(state1.body.receivedActivities, 10);
    assert.equal(state1.body.receivedBatches, 1);
  } finally {
    await panel.close();
  }
});
