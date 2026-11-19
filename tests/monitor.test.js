// Testes de finalização obrigatória e monitoramento — dados 100% fictícios
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const w = require('../corrigir');
const md = require('../lib/md');

const R = ref => ({ ref, status: 'PRONTA' });

test('appliedRefs: só entra ref com finalização confirmada', () => {
  const filled = [R('A'), { ...R('B'), finalized: true }, { ref: 'C', status: 'REVISAO', finalized: true }];
  assert.deepEqual(w.refsFinalizadas(filled, []), ['B']);
});

test('appliedRefs: preenchida sem finalizar NÃO é registrada (bug do --sem-finalizar)', () => {
  const filled = [R('A')]; // preenchida, finalized undefined
  assert.deepEqual(w.refsFinalizadas(filled, ['Z']), ['Z']);
});

test('appliedRefs: reexecução não duplica', () => {
  assert.deepEqual(w.refsFinalizadas([{ ...R('A'), finalized: true }], ['A', 'B']), ['A', 'B']);
});

test('estabilidade: tamanho/data precisam permanecer iguais em verificações consecutivas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-stable-'));
  const f = path.join(dir, 'lote-01.devolvido.md');
  fs.writeFileSync(f, 'abc');
  w.stableTracker.state.clear();
  const s1 = w.snapshotArquivos(dir, ['lote-01.devolvido.md']);
  assert.equal(w.stableTracker.update(s1).length, 0, 'primeira leitura: não estável');
  assert.equal(w.stableTracker.update(s1).length, 1, 'segunda leitura igual: estável');
  fs.writeFileSync(f, 'abcd'); // arquivo ainda sendo copiado
  const s2 = w.snapshotArquivos(dir, ['lote-01.devolvido.md']);
  assert.equal(w.stableTracker.update(s2).length, 0, 'mudou: volta a não estável');
  assert.equal(w.stableTracker.update(s2).length, 1);
});

test('retomada: coleta incompleta preserva lotes (não inicia nova)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-resume-'));
  fs.writeFileSync(path.join(dir, 'lote-01.md'), 'conteudo');
  const data = { collection: { nonce: 'abc', batches: [{ num: 1, name: 'lote-01.md', refs: ['A'] }] } };
  const CFG = require('../lib/config');
  const orig = CFG.LOTES_DIR;
  CFG.LOTES_DIR = dir;
  try { assert.equal(w.coletaIncompleta(data), true); }
  finally { CFG.LOTES_DIR = orig; }
});

test('monitoramento: não inicia com apenas parte dos lotes (validação usa inspectReturnedBatches)', () => {
  const NONCE = 'abcdef123456';
  const collection = { nonce: NONCE, batches: [
    { num: 1, name: 'lote-01.md', refs: ['C1 S2 U3 L4 A5'] },
    { num: 2, name: 'lote-02.md', refs: ['C1 S2 U3 L4 A6'] },
  ] };
  const doc = (num, ref) => `<!-- nonce ${NONCE} -->\n#### Atividade: A [${ref}]\n<<<RESPOSTA-INICIO-${NONCE}>>>\ntexto\n<<<RESPOSTA-FIM-${NONCE}>>>\n**Classificação:** CORRETO\n**Score:** 90\n**Flag:** NENHUM\n**Revisão:** NAO\n**Feedback:**\nOk.\n---\n`;
  const r = md.inspectReturnedBatches([{ name: 'lote-01.devolvido.md', text: doc(1, 'C1 S2 U3 L4 A5') }], collection);
  assert.equal(r.files[0].usable, true);
  assert.deepEqual(r.missingBatches, [2], 'lote 2 ainda pendente — não deve iniciar');
});
