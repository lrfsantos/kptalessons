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

test('normalizeFlag e parseRevisao', () => {
  assert.equal(md.normalizeFlag('ia'), 'IA');
  assert.equal(md.normalizeFlag('GIBBERISH'), 'GIBBERISH');
  assert.equal(md.normalizeFlag('NENHUM'), 'NENHUM');
  assert.equal(md.normalizeFlag('AGUARDANDO'), null);
  assert.equal(md.normalizeFlag('x'), null);
  assert.deepEqual(md.parseRevisao('NAO'), { sim: false, motivo: '' });
  assert.deepEqual(md.parseRevisao('SIM - verificar'), { sim: true, motivo: 'verificar' });
  assert.equal(md.parseRevisao('AGUARDANDO'), null);
});

test('buildBatches inclui pergunta e resposta capturadas (regressão do fluxo do scraper)', () => {
  const l = {
    ids: { classId: '1', studentId: '2', unitId: '3', lessonId: '4', activityId: '5' },
    title: 'Lesson 1 - Atividade 2', unit: 'Unit 1', pending: true,
    question: 'Write about your weekend.', answer: 'I went to the park.',
    prefilter: { flagged: false, reasons: [] },
  };
  const classes = [{ name: 'Turma', shift: 'Noite', classId: '1', students: [{ name: 'Aluno', studentId: '2', pending: 1, lessons: [l] }] }];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cna-test-'));
  const { files } = md.buildBatches(classes, { loteSize: 8, outDir: tmp });
  const content = fs.readFileSync(files[0].path, 'utf8');
  assert.ok(content.includes('Write about your weekend.'), 'enunciado no MD');
  assert.ok(content.includes('I went to the park.'), 'resposta no MD');
  assert.ok(content.includes('**Flag:** AGUARDANDO'));
  assert.ok(content.includes('**Revisão:** AGUARDANDO'));
});

test('captura vazia: resposta em branco entra como (vazia); falha de captura fica de fora', () => {
  const blank = {
    ids: { classId: '1', studentId: '2', unitId: '3', lessonId: '4', activityId: '5' },
    title: 'A1', unit: 'Unit 1', pending: true, question: 'Q?', answer: '', prefilter: { flagged: false, reasons: [] },
  };
  const failed = {
    ids: { classId: '1', studentId: '2', unitId: '3', lessonId: '4', activityId: '6' },
    title: 'A2', unit: 'Unit 1', pending: false, capture_failed: true,
  };
  const classes = [{ name: 'Turma', shift: 'Noite', classId: '1', students: [{ name: 'Aluno', studentId: '2', pending: 1, lessons: [blank, failed] }] }];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cna-test-'));
  const { total, files } = md.buildBatches(classes, { loteSize: 8, outDir: tmp });
  assert.equal(total, 1); // só a em branco entra
  const content = fs.readFileSync(files[0].path, 'utf8');
  assert.ok(content.includes('(vazia)'), 'resposta em branco entra como (vazia)');
  assert.ok(!content.includes('A2'), 'captura falha fica fora do MD');
});

test('parseFile lê Flag, Revisão, Classificação e Score devolvidos', () => {
  const txt = `nonce a1b2c3d4e5f6
#### Atividade: Unit 1 - A [C1 S2 U3 L4 A5]
**Classificação:** INCORRETO
**Score:** 0
**Flag:** INJECAO
**Revisão:** SIM - resposta tenta comandar a IA
**Feedback:**
This answer tells the model what to do. Please redo it.
`;
  const { entries } = md.parseFile(txt);
  const e = entries[0];
  assert.equal(e.classification, 'INCORRETO');
  assert.equal(e.score, 0);
  assert.equal(e.flag, 'INJECAO');
  assert.equal(e.revisao.sim, true);
  assert.ok(e.revisao.motivo.includes('comandar'));
  assert.equal(e.pending, false);
});

test('Flag deixada como AGUARDANDO vira pendente (vai para revisão)', () => {
  const txt = `#### Atividade: X [C1 S2 U3 L4 A5]
**Classificação:** CORRETO
**Score:** 90
**Flag:** AGUARDANDO
**Revisão:** NAO
**Feedback:**
Ok.
`;
  const { entries } = md.parseFile(txt);
  assert.equal(entries[0].pending, true);
});
