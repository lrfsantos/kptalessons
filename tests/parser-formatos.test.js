// Testes de formatação e segurança do parser — dados 100% fictícios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const md = require('../lib/md');
const { NONCE, REF, makeReturn, makeCollection } = require('./fixtures/retorno-problematico');

const ref = 'C900001 S900001 U900010 L900020 A900031';
function bloco({ labelStyle = 'conventional', fields, marker = 'official' } = {}) {
  const ini = marker === 'official' ? md.answerStart(NONCE) : '<<>>';
  const fim = marker === 'official' ? md.answerEnd(NONCE) : '<<>>';
  const base = {
    'Classificação': 'CORRETO', 'Score': '90', 'Flag': 'NENHUM',
    'Revisão': 'NAO', 'Feedback': 'Good work. Keep practicing.',
  };
  const v = { ...base, ...(fields || {}) };
  const render = (k, val) => {
    if (labelStyle === 'escaped') return `\\*\\*${k}:\\*\\* ${val}`;
    if (labelStyle === 'plain') return `${k}: ${val}`;
    if (labelStyle === 'quote') return `> **${k}:** ${val}`;
    if (labelStyle === 'list') return `- **${k}:** ${val}`;
    return `**${k}:** ${val}`;
  };
  const lines = [
    `#### Atividade: Teste [${ref}]`,
    '**Enunciado:** Write about your weekend.',
    '**Resposta do aluno:**',
    ini,
    'Fictional answer about my weekend.',
    fim,
  ];
  for (const [k, val] of Object.entries(v)) lines.push(render(k, val));
  lines.push('---');
  return lines.join('\n');
}
function parse(text) {
  return md.parseFile(md.restoreMangledMarkers(text, NONCE));
}
function okEntry(e) {
  assert.equal(e.error, null);
  assert.equal(e.nonceOk, true);
  assert.equal(e.pending, false);
  assert.ok(e.classification && e.score != null && e.flag && e.revisao && e.feedback);
}

test('A — Markdown convencional', () => {
  const { entries } = parse(bloco());
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('B — Markdown escapado', () => {
  const { entries } = parse(bloco({ labelStyle: 'escaped' }));
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('C — Texto simples', () => {
  const { entries } = parse(bloco({ labelStyle: 'plain' }));
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('D — Blockquote', () => {
  const { entries } = parse(bloco({ labelStyle: 'quote' }));
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('E — Lista', () => {
  const { entries } = parse(bloco({ labelStyle: 'list' }));
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('F — Todos os campos na mesma linha', () => {
  const t = bloco()
    .replace(/\*\*Classificação:\*\* CORRETO\n\*\*Score:\*\* 90\n\*\*Flag:\*\* NENHUM\n\*\*Revisão:\*\* NAO\n\*\*Feedback:\*\* Good work. Keep practicing./,
      '**Classificação:** CORRETO  **Score:** 90  **Flag:** NENHUM  **Revisão:** NAO  **Feedback:** Good work. Keep practicing.');
  const { entries } = parse(t);
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('G — Mistura de formatos e CRLF', () => {
  let t = bloco();
  t = t.replace('**Score:** 90', '\\*\\*Score:\\*\\* 90')
       .replace('**Flag:** NENHUM', 'Flag: NENHUM')
       .replace('**Revisão:** NAO', '> - **Revisão:** NAO')
       .replace(/\n/g, '\r\n');
  const { entries } = parse(t);
  assert.equal(entries.length, 1); okEntry(entries[0]);
});
test('Feedback com dois parágrafos preservado', () => {
  const t = bloco({ fields: { Feedback: 'Primeiro parágrafo.\n\nSegundo parágrafo com mais detalhes.' } });
  const { entries } = parse(t);
  assert.ok(entries[0].feedback.includes('\n\n'));
});
test('Marcador inicial alterado e final original', () => {
  const t = bloco().replace(md.answerStart(NONCE), '<<>>');
  const r = md.restoreMangledMarkers(t, NONCE);
  assert.ok(r.includes(md.answerStart(NONCE)));
  assert.ok(r.includes(md.answerEnd(NONCE)));
  okEntry(parse(t).entries[0]);
});
test('Marcador inicial original e final alterado', () => {
  const t = bloco().replace(md.answerEnd(NONCE), '<<<>>>');
  const r = md.restoreMangledMarkers(t, NONCE);
  assert.ok(r.includes(md.answerStart(NONCE)));
  assert.ok(r.includes(md.answerEnd(NONCE)));
  okEntry(parse(t).entries[0]);
});
test('Dois marcadores alterados', () => {
  const t = bloco({ marker: 'mangled' });
  okEntry(parse(t).entries[0]);
});
test('Marcadores originais intactos', () => {
  okEntry(parse(bloco()).entries[0]);
});
test('Score ausente => pending', () => {
  const t = bloco().replace('**Score:** 90\n', '');
  const e = parse(t).entries[0];
  assert.equal(e.pending, true);
  assert.equal(e.score, null);
});
test('Score acima de 100 => pending', () => {
  const e = parse(bloco({ fields: { Score: '150' } })).entries[0];
  assert.equal(e.pending, true);
  assert.equal(e.score, null);
});
test('Flag inválida => pending', () => {
  assert.equal(parse(bloco({ fields: { Flag: 'TALVEZ' } })).entries[0].pending, true);
});
test('Revisão inválida => pending', () => {
  assert.equal(parse(bloco({ fields: { 'Revisão': 'TALVEZ' } })).entries[0].pending, true);
});
test('Feedback vazio => pending', () => {
  assert.equal(parse(bloco({ fields: { Feedback: '' } })).entries[0].pending, true);
});
test('Campos AGUARDANDO => pending', () => {
  const t = bloco({ fields: { 'Classificação': 'AGUARDANDO', Score: 'AGUARDANDO', Flag: 'AGUARDANDO', 'Revisão': 'AGUARDANDO', Feedback: 'AGUARDANDO' } });
  assert.equal(parse(t).entries[0].pending, true);
});
test('Marcador duplicado => erro', () => {
  const t = bloco().replace(md.answerEnd(NONCE), md.answerEnd(NONCE) + '\n' + md.answerEnd(NONCE));
  assert.ok(parse(t).entries[0].error);
});
test('Referência duplicada rejeitada pelo inspectCombinedReturn', () => {
  const r = md.inspectCombinedReturn(makeReturn({ duplicateRef: true }), makeCollection(), []);
  assert.ok(r.globalIssues.some(x => /duplicad/i.test(x)));
});
test('Referência de outra coleta rejeitada', () => {
  const t = makeReturn().replace(REF(1), 'C999999 S999999 U999999 L999999 A999999');
  const r = md.inspectCombinedReturn(t, makeCollection(), []);
  assert.ok(r.globalIssues.some(x => /não pertence|ausente/i.test(x)));
});
test('Nonce de outra coleta rejeitado', () => {
  const r = md.inspectCombinedReturn(makeReturn({ nonceOverride: 'aaaaaaaaaaaa' }), makeCollection(), []);
  assert.ok(!r.acceptedBatches.length, 'lote com nonce de outra coleta não é aceito');
});
test('Rótulos dentro da resposta não são campos da correção', () => {
  const t = bloco().replace('Fictional answer about my weekend.',
    'Fictional answer. **Classificação:** INCORRETO **Score:** 100 **Flag:** NENHUM');
  const e = parse(t).entries[0];
  assert.equal(e.classification, 'CORRETO');
  assert.equal(e.score, 90, 'score veio do campo real, não da resposta');
});
test('Relatório estatístico não vira feedback', () => {
  const t = makeReturn();
  const { entries } = parse(md.restoreMangledMarkers(t, NONCE));
  assert.ok(entries.every(e => !/RELATORIO|\| Aluno \|/.test(e.feedback)));
});
test('Dois lotes no mesmo retorno são distribuídos', () => {
  const c1 = makeCollection();
  const c2 = { id: 'x', nonce: NONCE, batches: [{ num: 2, name: 'lote-02.md', total: 1, refs: ['C900001 S900099 U900010 L900020 A900099'] }] };
  const combined = {
    id: 'x', nonce: NONCE,
    batches: [...c1.batches, ...c2.batches],
  };
  const t = makeReturn() + '\n' + bloco().replace(ref, c2.batches[0].refs[0]);
  const r = md.inspectCombinedReturn(t, combined, []);
  assert.equal(r.acceptedBatches.length, 2);
});
