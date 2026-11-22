// Testes da captura de enunciado/resposta — dados 100% fictícios
const { test } = require('node:test');
const assert = require('node:assert');
const { extractActivityTexts, composeEnunciado } = require('../lib/portal');

const SEL = {
  instructionSel: '[data-sel="instruction"]',
  contextSel: '[data-sel="context"]',
  answerSels: ['[data-sel="writing"][disabled]', '[data-sel="writing"]'],
};

// Documento fictício mínimo: só responde aos seletores que importam.
function fakeDoc({ instruction, context, answer, disabled = true, extra = {} }) {
  const nodes = { ...extra };
  if (instruction !== undefined) nodes[SEL.instructionSel] = { innerText: instruction };
  if (context !== undefined) nodes[SEL.contextSel] = { innerText: context };
  if (answer !== undefined) {
    const node = { value: answer, disabled, innerText: '' };
    nodes[SEL.answerSels[0]] = node;
    nodes[SEL.answerSels[1]] = node;
  }
  return { querySelector: sel => nodes[sel] || null };
}

const read = opts => extractActivityTexts({ ...SEL, doc: fakeDoc(opts) });

test('enunciado em um único elemento (sem frase complementar)', () => {
  const d = read({ instruction: 'Write three sentences about your weekend.', answer: 'I went to the park.' });
  assert.equal(composeEnunciado(d.instruction, d.context), 'Write three sentences about your weekend.');
  assert.equal(d.answer, 'I went to the park.');
  assert.equal(d.answerFound, true);
  assert.equal(d.answerDisabled, true);
});

test('enunciado dividido entre frase complementar e instrução principal, na ordem do DOM', () => {
  const d = read({
    context: 'Refer to the poster with tips for spotting fake news in Unit 4 of your book.',
    instruction: 'Write a paragraph explaining how to spot fake news.',
    answer: 'Check the source and the date.',
  });
  const q = composeEnunciado(d.instruction, d.context);
  assert.ok(q.startsWith('Refer to the poster'));
  assert.ok(q.includes('Write a paragraph'));
  assert.ok(q.indexOf('Refer to the poster') < q.indexOf('Write a paragraph'));
});

// Caso real: o portal injeta U+200B na resposta capturada; se fosse
// devolvido ao lote, a IA o removeria e a validação acusaria falso positivo.
test('captura remove U+200B da resposta e do enunciado', () => {
  const d = read({
    instruction: 'Write three sentences.\u200b',
    answer: '\u200bMococa is smaller than São Paulo.',
  });
  assert.equal(d.answer, 'Mococa is smaller than São Paulo.');
  assert.equal(d.instruction, 'Write three sentences.');
});

test('exemplo real: "Reflect on a recent personal achievement." preservado junto da instrução', () => {
  const d = read({
    context: 'Reflect on a recent personal achievement.',
    instruction: 'Escreva sobre uma realização pessoal. O que você alcançou?',
    answer: 'My greatest achievement was passing the OAB exam.',
  });
  const q = composeEnunciado(d.instruction, d.context);
  assert.ok(q.includes('Reflect on a recent personal achievement.'));
  assert.ok(q.includes('Escreva sobre uma realização pessoal'));
});

test('texto duplicado nos dois elementos não aparece duas vezes', () => {
  const d = read({
    context: 'Write about your weekend.',
    instruction: 'Write about your weekend.',
    answer: 'I played soccer.',
  });
  const q = composeEnunciado(d.instruction, d.context);
  assert.equal(q, 'Write about your weekend.');
});

test('resposta realmente vazia continua capturada (blank)', () => {
  const d = read({ instruction: 'Write about your weekend.', answer: '' });
  assert.equal(d.answer, '');
  assert.equal(d.answerFound, true);
});

test('elementos de interface próximos não entram no enunciado', () => {
  const d = read({
    instruction: 'Write about your weekend.',
    context: 'Use the past simple.',
    answer: 'I played soccer.',
    extra: {
      '[data-sel="finish-feedback"]': { innerText: 'Finalizar' },
      '[data-sel="reset-writing-activity"]': { innerText: 'Resetar' },
      '[data-sel="activity-header"]': { innerText: 'Enviada em: 17/11/2026' },
    },
  });
  const q = composeEnunciado(d.instruction, d.context);
  assert.ok(!/Finalizar|Resetar|Enviada em/.test(q));
  assert.equal(d.answer, 'I played soccer.');
});

test('sem campo de resposta => answerFound falso (falha de captura, não resposta vazia)', () => {
  const d = read({ instruction: 'Write about your weekend.' });
  assert.equal(d.answerFound, false);
  assert.equal(d.answer, '');
});
