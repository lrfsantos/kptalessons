// Verifica a réplica sanitizada da run de 46 (dados 100% fictícios)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const md = require('../lib/md');

const dir = path.join(__dirname, '..', 'exemplos', 'run-46');
const returnsDir = path.join(dir, 'retornos-da-IA');
const nums = ['01', '02', '03', '04', '05'];
const gerados = nums.map(n => fs.readFileSync(path.join(dir, 'lote-' + n + '.md'), 'utf8'));
const devolvidos = nums.map(n => fs.readFileSync(path.join(returnsDir, 'lote-' + n + '.md'), 'utf8'));
const collection = {
  nonce: md.extractNonce(gerados[0]),
  batches: gerados.map((text, i) => ({
    num: i + 1,
    name: 'lote-' + nums[i] + '.md',
    refs: md.parseFile(text).entries.map(e => e.ref),
    total: md.parseFile(text).entries.length,
  })),
};

test('exemplo sanitizado: 5 lotes com 10/10/10/10/6 atividades', () => {
  const contagens = gerados.map(t => (t.match(/^#### Atividade:/gm) || []).length);
  assert.deepEqual(contagens, [10, 10, 10, 10, 6]);
  assert.equal(contagens.reduce((a, b) => a + b, 0), 46);
});

test('exemplo sanitizado: 46 atividades preenchidas e marcadores íntegros', () => {
  const entries = md.parseReturned(devolvidos);
  assert.equal(entries.length, 46);
  assert.ok(entries.every(e => !e.error && !e.pending), 'nenhuma pendente/inválida');
  assert.ok(entries.every(e => e.feedback && e.feedback.length > 10));
  assert.ok(entries.every(e => e.nonceOk));
});

test('exemplo sanitizado: distribuição CORRETO 30 / INCORRETO 8 / PARCIAL 8', () => {
  const c = md.parseReturned(devolvidos).reduce((a, e) => (a[e.classification] = (a[e.classification] || 0) + 1, a), {});
  assert.deepEqual(c, { CORRETO: 30, INCORRETO: 8, PARCIAL: 8 });
  assert.ok(md.parseReturned(devolvidos).every(e => e.flag === 'NENHUM' && e.revisao && !e.revisao.sim));
  const scores = md.parseReturned(devolvidos).map(e => e.score);
  assert.equal(Math.round(scores.reduce((a,b)=>a+b,0)/scores.length), 81);
});

test('exemplo sanitizado: retorno único é redistribuído nos cinco lotes', () => {
  const result = md.inspectCombinedReturn(devolvidos.join('\n\n'), collection);
  assert.deepEqual(result.globalIssues, []);
  assert.deepEqual(result.acceptedBatches.map(b => b.num), [1,2,3,4,5]);
  assert.equal(result.acceptedBatches.reduce((sum,b)=>sum+b.activities,0),46);
});

test('exemplo sanitizado: nonce e referências fictícias; nenhum dado real', () => {
  const nonce = md.extractNonce(gerados[0]);
  assert.match(nonce, /^[0-9a-f]{12}$/);
  assert.ok(gerados.every(t => md.extractNonce(t) === nonce), 'mesmo nonce nos 5 lotes');
  const entries = md.parseReturned(devolvidos);
  assert.ok(entries.every(e => /^C000001 S00000[1-8] /.test(e.ref)), 'refs fictícias');
  const tudo = gerados.join('') + devolvidos.join('');
  assert.ok(!/S000003|S000004|S000005|S000006|C000003|f0f0f0f0f0f0/.test(tudo), 'sem refs/nonce reais da run');
  const blocos = tudo.split('\n').filter(l => /^## Turma:|^### Aluno:/.test(l)).join('\n');
  assert.ok(!/Mococa|CNA Mococa/.test(blocos), 'sem nome de unidade real nos cabeçalhos');
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w-]+/.test(tudo), 'sem e-mails');
});
