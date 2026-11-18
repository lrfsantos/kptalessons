// Testes do parser de MD (dados 100% fictícios)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const md = require('../lib/md');

const ROOT = path.join(__dirname, '..');
const exemploGerado = fs.readFileSync(path.join(ROOT, 'exemplos', 'exemplo-gerado.md'), 'utf8');
const exemploDevolvido = fs.readFileSync(path.join(ROOT, 'exemplos', 'exemplo-devolvido.md'), 'utf8');

test('extractNonce acha o nonce do documento', () => {
  assert.equal(md.extractNonce(exemploDevolvido), 'a1b2c3d4e5f6');
  assert.equal(md.extractNonce('sem nonce aqui'), null);
});

test('parseFile extrai entradas do exemplo devolvido', () => {
  const { nonce, entries } = md.parseFile(exemploDevolvido);
  assert.equal(nonce, 'a1b2c3d4e5f6');
  assert.equal(entries.length, 2);
  const [ana, bruno] = entries;

  assert.equal(ana.classId, '100001');
  assert.equal(ana.studentId, '200001');
  assert.equal(ana.activityId, '500001');
  assert.equal(ana.classification, 'PARCIAL');
  assert.equal(ana.score, 70);
  assert.ok(ana.feedback.includes('went'));
  assert.equal(ana.pending, false);
  assert.equal(ana.nonceOk, true);
  assert.ok(ana.respostaLida.includes('goed to the park'));

  // entrada sinalizada pelo pré-filtro e devolvida CORRETO => vai para revisão
  assert.equal(bruno.flagged, true);
  assert.equal(bruno.classification, 'CORRETO');
});

test('classificações com sinônimos são normalizadas', () => {
  assert.equal(md.normalizeClassification('correto'), 'CORRETO');
  assert.equal(md.normalizeClassification('ERRADO'), 'INCORRETO');
  assert.equal(md.normalizeClassification('incompleto'), 'PARCIAL');
  assert.equal(md.normalizeClassification('PARTIAL'), 'PARCIAL');
  assert.equal(md.normalizeClassification('banana'), null);
});

test('entrada mal preenchida (faltando classificação) vira pending', () => {
  const txt = `nonce a1b2c3d4e5f6
#### Atividade: Unit 1 Lesson 1 - Atividade 2 [C1 S2 U3 L4 A5]
**Classificação:** AGUARDANDO
**Score:** AGUARDANDO
**Feedback:**
AGUARDANDO
`;
  const { entries } = md.parseFile(txt);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].pending, true);
  assert.equal(entries[0].feedback, '');
});

test('entrada sem ref é marcada com erro (vai para revisão)', () => {
  const txt = `#### Atividade: Unit 1 - Atividade 3
**Classificação:** CORRETO
**Score:** 90
**Feedback:**
Bom trabalho.
`;
  const { entries } = md.parseFile(txt);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].error);
  assert.equal(entries[0].ref, null);
});

test('ref incompleta é marcada com erro', () => {
  const txt = `#### Atividade: X [C1 S2]
**Classificação:** CORRETO
**Score:** 90
**Feedback:**
Ok.
`;
  const { entries } = md.parseFile(txt);
  assert.equal(entries[0].error, 'ref incompleta');
});

test('score inválido (fora de 0-100 ou sem número) é null', () => {
  assert.equal(md.parseScore('123'), null);
  assert.equal(md.parseScore('AGUARDANDO'), null);
  assert.equal(md.parseScore('72'), 72);
});

test('buildBatches respeita o tamanho de lote e usa nonce novo', () => {
  const mk = (classId, studentId, activityId) => ({
    ids: { classId, studentId, unitId: '3', lessonId: '4', activityId },
    title: 'Lesson 1 - Atividade 2', unit: 'Unit 1', pending: true,
    question: 'Pergunta exemplo?', answer: 'Resposta exemplo.',
    prefilter: { flagged: false, reasons: [] },
  });
  const classes = [{
    name: 'Turma Exemplo', shift: 'Manhã', classId: '1',
    students: [{ name: 'Aluno Exemplo', studentId: '2', pending: 3, lessons: [mk('1', '2', '5'), mk('1', '2', '6'), mk('1', '2', '7')] }],
  }];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cna-test-'));
  const { nonce, files, total } = md.buildBatches(classes, { loteSize: 2, outDir: tmp });
  assert.equal(total, 3);
  assert.equal(files.length, 2);
  assert.match(nonce, /^[0-9a-f]{12}$/);
  const content1 = fs.readFileSync(files[0].path, 'utf8');
  assert.ok(content1.includes(md.answerStart(nonce)));
  assert.ok(content1.includes('AGUARDANDO'));
  assert.ok(content1.includes('Turma Exemplo'));
});
