// Testes de identificação de lotes e arquivamento — dados 100% fictícios
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const md = require('../lib/md');

const NONCE = 'abcdef123456';
const doc = (num, refs, nonce = NONCE) => [
  `<!-- CNA CORRETOR - lote ${num}/2 - nonce ${nonce} -->`,
  ...refs.map(r => [
    `#### Atividade: Unit 1 - A [${r}]`,
    `<<<RESPOSTA-INICIO-${nonce}>>>`, 'I went to the park.', `<<<RESPOSTA-FIM-${nonce}>>>`,
    '**Classificação:** CORRETO', '**Score:** 90', '**Flag:** NENHUM', '**Revisão:** NAO',
    '**Feedback:**', 'Ok.', '---', '',
  ].join('\n')),
  `_Fim do lote ${num}._`, '',
].join('\n');

const collection = {
  nonce: NONCE,
  batches: [
    { num: 1, name: 'lote-01.md', refs: ['C1 S2 U3 L4 A5'] },
    { num: 2, name: 'lote-02.md', refs: ['C1 S2 U3 L4 A6'] },
  ],
};

test('lote devolvido válido: nome, nonce e refs conferem', () => {
  const r = md.inspectReturnedBatches([{ name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A5']) }], collection);
  assert.deepEqual(r.files[0].issues, []);
  assert.equal(r.files[0].usable, true);
  assert.deepEqual(r.missingBatches, [2]);
});

test('nonce incorreto rejeita o lote', () => {
  const r = md.inspectReturnedBatches([{ name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A5'], '999999999999') }], collection);
  assert.ok(r.files[0].issues.some(x => x.includes('nonce incorreto')));
  assert.equal(r.files[0].usable, false);
});

test('nome alternativo (graded/corrigido) não é aceito', () => {
  for (const name of ['graded.md', 'lote-01.corrigido.md', 'LOTE-01.DEVOLVIDO.MD', 'lote-1.devolvido.md']) {
    const r = md.inspectReturnedBatches([{ name, text: doc(1, ['C1 S2 U3 L4 A5']) }], collection);
    assert.ok(r.files[0].issues.some(x => x.includes('nome inválido')), name);
  }
});

test('lote de coleta anterior não é aceito', () => {
  const r = md.inspectReturnedBatches([{ name: 'lote-03.devolvido.md', text: doc(3, ['C1 S2 U3 L4 A5']) }], collection);
  assert.ok(r.files[0].issues.some(x => x.includes('não pertence à coleta atual')));
});

test('refs ausentes e refs estranhas são identificadas', () => {
  const r = md.inspectReturnedBatches([{ name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A9']) }], collection);
  assert.ok(r.files[0].issues.some(x => x.includes('refs ausentes')));
  assert.ok(r.files[0].issues.some(x => x.includes('refs de outra atividade')));
});

test('arquivo duplicado e ref duplicada são detectados', () => {
  const r = md.inspectReturnedBatches([
    { name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A5']) },
    { name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A5']) },
  ], collection);
  assert.ok(r.files.some(f => f.issues.some(x => x.includes('duplicado'))));
  assert.ok(r.duplicateRefs.includes('C1 S2 U3 L4 A5'));
});

test('todos os lotes devolvidos: nenhum pendente', () => {
  const r = md.inspectReturnedBatches([
    { name: 'lote-01.devolvido.md', text: doc(1, ['C1 S2 U3 L4 A5']) },
    { name: 'lote-02.devolvido.md', text: doc(2, ['C1 S2 U3 L4 A6']) },
  ], collection);
  assert.deepEqual(r.missingBatches, []);
  assert.ok(r.files.every(f => f.usable));
});

test('arquivamento preserva nomes originais e tira os arquivos da pasta ativa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-arq-'));
  try {
    fs.writeFileSync(path.join(dir, 'lote-01.md'), doc(1, ['C1 S2 U3 L4 A5']));
    fs.writeFileSync(path.join(dir, 'lote-01.devolvido.md'), doc(1, ['C1 S2 U3 L4 A5']));
    const archive = md.archivePrevious(dir);
    assert.ok(archive && fs.existsSync(archive));
    const content = fs.readFileSync(archive, 'utf8');
    assert.ok(content.includes('## Arquivo: lote-01.md'));
    assert.ok(content.includes('## Arquivo: lote-01.devolvido.md'));
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.devolvido.md')), []);
    assert.deepEqual(fs.readdirSync(dir).filter(f => /^lote-\d+\.md$/.test(f)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
