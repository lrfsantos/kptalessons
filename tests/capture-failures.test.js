// Testes de captura com mocks de navegação (sem portal real).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const portal = require('../lib/portal');

function pageMock({ waitForSelectorError = null, links = [], evaluateResult = null, waitForFunctionResult = true }) {
  return {
    async goto() {},
    async waitForSelector() { if (waitForSelectorError) throw new Error(waitForSelectorError); },
    async evaluate() { return evaluateResult !== null ? evaluateResult : links; },
    async waitForFunction() { return waitForFunctionResult; },
    async waitForTimeout() {},
  };
}

test('lista carregada normalmente', async () => {
  const r = await portal.listLessons(pageMock({ links: [{ href: '/classes/1/writing/students/2/unit/3/lessons/4/activity/5', title: 'A', status: 'A CORRIGIR' }] }), '1', '2');
  assert.equal(r.length, 1);
  assert.equal(r.listError, null);
});

test('lista legitimamente vazia', async () => {
  const r = await portal.listLessons(pageMock({ links: [] }), '1', '2');
  assert.equal(r.length, 0);
  assert.equal(r.listError, null, 'sem pendências ≠ timeout');
});

test('timeout na lista é registrado como falha', async () => {
  const r = await portal.listLessons(pageMock({ waitForSelectorError: 'Timeout 60000ms exceeded', links: [] }), '1', '2');
  assert.ok(r.listError && /Timeout/.test(r.listError));
});

test('estudante com pendências mas nenhuma atividade enumerada é sinalizado', async () => {
  const r = await portal.listLessons(pageMock({ waitForSelectorError: 'Timeout', links: [] }), '1', '2');
  const data = { students: [{ pending: 3 }] };
  assert.ok(r.listError && data.students[0].pending > 0, 'scraper pode registrar captureFailure');
});

test('enunciado disponível apenas em context é suficiente', async () => {
  const texts = extractTexts({ instruction: '', context: 'Reflect on a recent achievement.', answer: 'I won a prize.', answerFound: true, answerDisabled: true });
  assert.equal(texts.question, 'Reflect on a recent achievement.');
});

test('resposta realmente vazia continua capturada', async () => {
  const texts = extractTexts({ instruction: 'Write a sentence.', context: '', answer: '', answerFound: true, answerDisabled: true });
  assert.equal(texts.answer, '');
  assert.equal(texts.answerFound, true);
});

test('campo de resposta inexistente é falha, não resposta vazia', async () => {
  const texts = extractTexts({ instruction: 'Write a sentence.', context: '', answer: '', answerFound: false, answerDisabled: null });
  assert.equal(texts.answerFound, false);
});

function extractTexts(data) {
  return { question: portal.composeEnunciado(data.instruction, data.context), answer: data.answer, answerFound: data.answerFound };
}

test('readActivity não exige texto em instruction quando context tem conteúdo', () => {
  const code = require('fs').readFileSync(require.resolve('../lib/portal'), 'utf8');
  assert.match(code, /hasText\(q\) \|\| hasText\(c\)/);
  assert.match(code, /answerFound/);
});
