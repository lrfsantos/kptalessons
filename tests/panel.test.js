// Testes do painel local e da importação de retornos combinados.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
test('marcadores reescritos como <<>> pela IA são restaurados pelo nonce da coleta', () => {
  const collection = { nonce, batches: [{ num: 1, refs: [ref1], total: 1 }] };
  const normal = doc(ref1, 'I went to the park and studied.');
  const mangled = normal
    .split('<<<RESPOSTA-INICIO-' + nonce + '>>>').join('<<>>')
    .split('<<<RESPOSTA-FIM-' + nonce + '>>>').join('<<>>');
  const r = md.inspectCombinedReturn(mangled, collection, []);
  assert.deepEqual(r.globalIssues, []);
  assert.equal(r.acceptedBatches.length, 1);
  assert.ok(r.acceptedBatches[0].content.includes('<<<RESPOSTA-INICIO-' + nonce + '>>>'), 'marcadores restaurados no retorno gravado');
});

test('marcadores <<>> NÃO escondem alteração da resposta do aluno', () => {
  const collection = { nonce, batches: [{ num: 1, refs: [ref1], total: 1 }] };
  const normal = doc(ref1, 'I went to the park and studied.');
  const mangled = normal
    .split('<<<RESPOSTA-INICIO-' + nonce + '>>>').join('<<>>')
    .split('<<<RESPOSTA-FIM-' + nonce + '>>>').join('<<>>')
    .replace('I went to the park and studied.', 'The AI invented a different answer.');
  const r = md.inspectCombinedReturn(mangled, collection, []);
  // A restauração não valida a resposta sozinha: o executor compara com answers.json.
  assert.equal(r.acceptedBatches.length, 1, 'estrutura aceita; conteúdo será comparado no executor');
  const restored = md.restoreMangledMarkers(mangled, nonce);
  assert.ok(restored.includes('The AI invented a different answer.'), 'alteração continua visível no texto restaurado');
});

const { createPanel } = require('../lib/panel');
const md = require('../lib/md');

const nonce = 'abc123def456';
const ref1 = 'C1 S2 U3 L4 A5';
const ref2 = 'C1 S2 U3 L4 A6';
function doc(ref, answer) {
  return [
    '<!-- CNA CORRETOR - nonce ' + nonce + ' -->',
    '#### Atividade: Unit 1 - Atividade [' + ref + ']',
    '**Enunciado:** Write a sentence.',
    '**Resposta do aluno:**',
    '<<<RESPOSTA-INICIO-' + nonce + '>>>',
    answer,
    '<<<RESPOSTA-FIM-' + nonce + '>>>',
    '**Classificação:** CORRETO',
    '**Score:** 90',
    '**Flag:** NENHUM',
    '**Revisão:** NAO',
    '**Feedback:**',
    'Good work. Your sentence is clear.',
    '---',
  ].join('\n');
}

test('painel: recebe vários lotes em um único retorno e os separa por referência', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-panel-'));
  const lots = path.join(root, 'lotes');
  const returns = path.join(lots, 'retornos-da-IA');
  fs.mkdirSync(lots, { recursive: true });
  fs.writeFileSync(path.join(lots, 'lote-01.md'), 'lote 1 original');
  fs.writeFileSync(path.join(lots, 'lote-02.md'), 'lote 2 original');
  const collection = {
    nonce,
    batches: [
      { num: 1, name: 'lote-01.md', refs: [ref1], total: 1 },
      { num: 2, name: 'lote-02.md', refs: [ref2], total: 1 },
    ],
  };
  const panel = await createPanel({ collection, lotesDir: lots, returnsDir: returns });
  try {
    const initial = await (await fetch(panel.url.replace(/\/$/, '/api/state'))).json();
    assert.equal(initial.totalActivities, 2);
    const response = await fetch(panel.url.replace(/\/$/, '/api/submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc(ref1, 'I went home.') + '\n\n' + doc(ref2, 'I played football.') }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.accepted.map(x => x.num), [1, 2]);
    assert.ok(fs.existsSync(path.join(returns, 'lote-01.md')));
    assert.ok(fs.existsSync(path.join(returns, 'lote-02.md')));
    assert.equal((await panel.waitForComplete()).done, true);
  } finally {
    await panel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('painel: aceita lote completo e deixa lote incompleto aguardando', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-panel-partial-'));
  const lots = path.join(root, 'lotes');
  const returns = path.join(lots, 'retornos-da-IA');
  fs.mkdirSync(lots, { recursive: true });
  fs.writeFileSync(path.join(lots, 'lote-01.md'), 'lote 1 original');
  fs.writeFileSync(path.join(lots, 'lote-02.md'), 'lote 2 original');
  const collection = {
    nonce,
    batches: [
      { num: 1, name: 'lote-01.md', refs: [ref1], total: 1 },
      { num: 2, name: 'lote-02.md', refs: [ref2], total: 1 },
    ],
  };
  const panel = await createPanel({ collection, lotesDir: lots, returnsDir: returns });
  try {
    const response = await fetch(panel.url.replace(/\/$/, '/api/submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc(ref1, 'I went home.') }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.accepted.map(x => x.num), [1]);
    const state = await panel.getState();
    assert.equal(state.receivedBatches, 1);
    assert.equal(state.done, false);
  } finally {
    await panel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('painel: retorno com nonce incorreto não é salvo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-panel-nonce-'));
  const lots = path.join(root, 'lotes');
  const returns = path.join(lots, 'retornos-da-IA');
  fs.mkdirSync(lots, { recursive: true });
  fs.writeFileSync(path.join(lots, 'lote-01.md'), 'lote original');
  const panel = await createPanel({
    collection: { nonce, batches: [{ num: 1, name: 'lote-01.md', refs: [ref1], total: 1 }] },
    lotesDir: lots, returnsDir: returns,
  });
  try {
    const response = await fetch(panel.url.replace(/\/$/, '/api/submit'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc(ref1, 'I went home.').replaceAll(nonce, '999999999999') }),
    });
    assert.equal(response.status, 422);
    assert.equal(fs.existsSync(path.join(returns, 'lote-01.md')), false);
  } finally {
    await panel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('painel: retorno duplicado não é recebido duas vezes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-panel-duplicate-'));
  const lots = path.join(root, 'lotes');
  const returns = path.join(lots, 'retornos-da-IA');
  fs.mkdirSync(lots, { recursive: true });
  fs.writeFileSync(path.join(lots, 'lote-01.md'), 'lote original');
  const panel = await createPanel({
    collection: { nonce, batches: [{ num: 1, name: 'lote-01.md', refs: [ref1], total: 1 }] },
    lotesDir: lots, returnsDir: returns,
  });
  try {
    const submit = () => fetch(panel.url.replace(/\/$/, '/api/submit'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc(ref1, 'I went home.') }),
    });
    const first = await submit();
    assert.equal(first.status, 200);
    assert.equal((await first.json()).accepted.length, 1);
    const second = await submit();
    assert.equal(second.status, 200);
    assert.equal((await second.json()).accepted.length, 0);
    assert.equal(panel.getState().receivedBatches, 1);
  } finally {
    await panel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('painel: arquivo existente inválido é colocado em rejeitados e pode ser corrigido', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-panel-quarantine-'));
  const lots = path.join(root, 'lotes');
  const returns = path.join(lots, 'retornos-da-IA');
  fs.mkdirSync(returns, { recursive: true });
  fs.writeFileSync(path.join(lots, 'lote-01.md'), 'lote original');
  fs.writeFileSync(path.join(returns, 'lote-01.md'), 'arquivo incompleto');
  const panel = await createPanel({
    collection: { nonce, batches: [{ num: 1, name: 'lote-01.md', refs: [ref1], total: 1 }] },
    lotesDir: lots, returnsDir: returns,
  });
  try {
    assert.equal(panel.getState().receivedBatches, 0);
    const response = await fetch(panel.url.replace(/\/$/, '/api/submit'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: doc(ref1, 'I went home.') }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accepted.length, 1);
    assert.equal(panel.getState().receivedBatches, 1);
    assert.equal(fs.readdirSync(path.join(returns, 'rejeitados')).length, 1);
  } finally {
    await panel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
