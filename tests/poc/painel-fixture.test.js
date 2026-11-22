// Testes da prova de conceito: fixture sintetica + painel real.
// Nenhum dado real; nada e finalizado no portal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const md = require('../../lib/md');
const { createPanel } = require('../../lib/panel');
const fx = require('../../src-node/fixture');

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cna-poc-test-'));
}

test('fixture: retorno valido passa no parser real', () => {
  const r = md.inspectCombinedReturn(fx.makeValidReturn(), fx.makeCollection(), []);
  assert.deepEqual(r.globalIssues, [], 'sem problemas globais');
  assert.equal(r.acceptedBatches.length, 1);
});

test('fixture: nonce errado e rejeitado', () => {
  const r = md.inspectCombinedReturn(fx.makeValidReturn({ wrongNonce: true }), fx.makeCollection(), []);
  assert.ok(
    r.globalIssues.length > 0 || !(r.acceptedBatches || []).length,
    'nonce divergente deve invalidar o retorno'
  );
});

test('fixture: ref duplicada e rejeitada', () => {
  const r = md.inspectCombinedReturn(fx.makeValidReturn({ duplicateRef: true }), fx.makeCollection(), []);
  assert.ok(
    r.globalIssues.length > 0 || (r.rejectedBatches || []).length > 0 ||
      (r.acceptedBatches || []).length === 0,
    'ref duplicada nao pode ser aceita como valida'
  );
});

test('fixture: classificacao invalida e rejeitada', () => {
  const r = md.inspectCombinedReturn(fx.makeValidReturn({ badClassification: 'MEIO' }), fx.makeCollection(), []);
  assert.ok(
    r.globalIssues.length > 0 || (r.rejectedBatches || []).length > 0 ||
      (r.acceptedBatches || []).length === 0,
    'classificacao fora do padrao nao pode ser aceita'
  );
});

test('painel real: aceita retorno valido e rejeita nonce errado', async () => {
  const dir = tmpDir();
  try {
    const lotes = path.join(dir, 'lotes');
    const retornos = path.join(dir, 'retornos-da-IA');
    fx.writeFixture(lotes);
    const panel = await createPanel({ collection: fx.makeCollection(), lotesDir: lotes, returnsDir: retornos });

    const invalido = await postJson(panel.url + 'api/submit', { text: fx.makeValidReturn({ wrongNonce: true }) });
    assert.notEqual(invalido.status, 200, 'retorno com nonce errado deve falhar');
    let st = (await (await fetch(panel.url + 'api/state')).json());
    assert.equal(st.receivedActivities, 0, 'nada recebido apos rejeicao');

    const valido = await postJson(panel.url + 'api/submit', { text: fx.makeValidReturn() });
    assert.equal(valido.status, 200, 'retorno valido deve ser aceito: ' + JSON.stringify(valido.body));
    assert.equal(valido.body.state.receivedActivities, 10);

    st = (await (await fetch(panel.url + 'api/state')).json());
    assert.equal(st.done, true, 'todos os lotes recebidos');
    assert.ok(fs.existsSync(path.join(retornos, 'lote-01.md')), 'retorno gravado');

    await panel.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
