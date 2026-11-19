// Regressão do falso positivo em isCorrected()/finalize() — dados 100% fictícios
const { test } = require('node:test');
const assert = require('node:assert');
const { isCorrected, finalize, fillCorrection, positiveCorrectionEvidence } = require('../lib/portal');

// DOM falso: só responde ao que as funções consultam.
function fakePage({ text = '', correctedBadge = false, finishButton = true, enabled = true, confirmOnClick = true }) {
  let state = { text, correctedBadge, finishButton, enabled };
  const page = {
    evaluate(fn, arg) { return fn(arg); },
    waitForFunction(fn) {
      // reavalia a condição no estado atual (após o clique, se houve clique)
      return Promise.resolve(fn()).then(v => { if (!v) throw new Error('timeout'); return v; });
    },
    once() {},
    locator() {
      return {
        async click() {
          if (confirmOnClick) state = { ...state, text: 'Corrigida em: 19/11/2026 às 10:00', correctedBadge: true };
          else state = { ...state, finishButton: false }; // botão some SEM confirmação
        },
      };
    },
    _state: () => state,
  };
  // document global usado pelas callbacks injetadas no evaluate
  global.document = {
    body: { get innerText() { return state.text; } },
    querySelector(sel) {
      if (sel === '[data-sel="activity-corrected"]') return state.correctedBadge ? {} : null;
      if (sel === '[data-sel="finish-feedback"]') return state.finishButton ? { disabled: !state.enabled } : null;
      return null;
    },
  };
  return page;
}

test('A: atividade pendente — sem botão Finalizar, sem badge, sem "Corrigida em:" => false', async () => {
  const p = fakePage({ finishButton: false });
  assert.equal(await isCorrected(p), false);
  assert.equal(positiveCorrectionEvidence(''), false);
});

test('A2: atividade pendente com resposta e 3 opções, mas sem caixa de feedback/botão => false', async () => {
  const p = fakePage({ text: 'Resposta do aluno: I went to the park. Incorreto Parcial Correto', finishButton: false });
  assert.equal(await isCorrected(p), false);
});

test('B: texto positivo "Corrigida em:" => true', async () => {
  const p = fakePage({ text: 'Corrigida em: 19/11/2026 às 10:00', finishButton: false });
  assert.equal(await isCorrected(p), true);
  assert.equal(positiveCorrectionEvidence('Corrigida em: 19/11/2026'), true);
});

test('B2: badge activity-corrected => true', async () => {
  const p = fakePage({ correctedBadge: true, finishButton: false });
  assert.equal(await isCorrected(p), true);
});

test('D: botão ausente antes da classificação NÃO marca concluída', async () => {
  assert.equal(positiveCorrectionEvidence('texto da atividade pendente', false), false);
  const p = fakePage({ finishButton: false });
  assert.equal(await isCorrected(p), false);
});

test('C: sequência completa — radio, feedback, botão habilitado, clique, confirmação => finalize ok', async () => {
  const p = fakePage({ enabled: true, confirmOnClick: true });
  const r = await finalize(p);
  assert.deepEqual(r, { ok: true });
  assert.match(p._state().text, /Corrigida em:/);
});

test('E: botão desaparece sem confirmação explícita => falha, NÃO conclusão', async () => {
  const p = fakePage({ enabled: true, confirmOnClick: false });
  const r = await finalize(p);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('portal não confirmou'));
});

test('E2: finalize sem botão habilitado => falha', async () => {
  const p = fakePage({ enabled: false });
  const r = await finalize(p);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('não está habilitado'));
});

test('F: evidência positiva é necessária mesmo com texto de interface ruidoso', () => {
  const ruidoso = 'Voltar EN BR Resetar Unit 2 Lesson 3 Atividade 10 Enviada em: 17/11/2026';
  assert.equal(positiveCorrectionEvidence(ruidoso, false), false);
  assert.equal(positiveCorrectionEvidence(ruidoso + ' Corrigida em: 19/11/2026', false), true);
});

// Sequência C completa: isCorrected → fillCorrection → finalize, com mocks.
test('C2: sequência completa com mocks — pendente → preencher → conferir → finalizar', async () => {
  const steps = [];
  let state = { text: 'Resposta do aluno. Incorreto Parcial Correto', finishButton: false, enabled: false, fbText: '', radio: null };
  global.document = {
    body: { get innerText() { return state.text; } },
    querySelector(sel) {
      if (sel === '[data-sel="activity-corrected"]') return null;
      if (sel === '[data-sel="finish-feedback"]') return state.finishButton ? { disabled: !state.enabled } : null;
      return null;
    },
  };
  const mkLocator = (kind) => ({
    count: async () => (kind === 'classification' ? 1 : 0),
    locator: () => ({
      first: () => ({
        getAttribute: async () => 'r1',
        click: async () => {
          steps.push('radio clicado');
          state.radio = 'HIT';
          state.finishButton = true;
          state.enabled = true;
        },
      }),
      count: async () => 1,
      getAttribute: async () => state.radio,
    }),
    getAttribute: async () => state.radio,
  });
  function locator(sel) {
    if (sel === '[data-sel="activity-corrected"]') return { count: async () => 0 };
    if (sel === '[data-sel="finish-feedback"]') return {
      click: async () => {
        steps.push('Finalizar clicado');
        state = { ...state, text: 'Corrigida em: 19/11/2026 às 10:00' };
      },
    };
    if (sel === '[data-sel="feedback-selection"]') return mkLocator('classification');
    if (sel === '[data-sel="writing"]:not([disabled])') return {
      first: () => ({
        waitFor: async () => { steps.push('caixa de feedback apareceu'); },
        fill: async t => { steps.push('feedback digitado'); state.fbText = t; },
        inputValue: async () => state.fbText,
      }),
    };
    return { count: async () => 0 };
  }
  const page = {
    evaluate(fn, arg) {
      // quando chamado sem função de estado (isCorrected/finalize), usa document global
      return fn(arg);
    },
    waitForFunction(fn) { return Promise.resolve(fn()).then(v => { if (!v) throw new Error('timeout'); return v; }); },
    once() {},
    locator,
  };

  assert.equal(await isCorrected(page), false, '1. ainda pendente');
  steps.push('isCorrected=false');
  const res = await fillCorrection(page, 'CORRETO', 'Good work!');
  assert.deepEqual(res, { ok: true, readyToFinish: true });
  const fin = await finalize(page);
  assert.deepEqual(fin, { ok: true }, '3. clique + confirmação');

  assert.deepEqual(steps, [
    'isCorrected=false', 'radio clicado', 'caixa de feedback apareceu', 'feedback digitado', 'Finalizar clicado',
  ]);
  assert.equal(state.radio, 'HIT');
  assert.equal(state.fbText, 'Good work!');
  assert.match(state.text, /Corrigida em:/);
});
