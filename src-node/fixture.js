// ============================================================
// Fixture SINTETICA do painel da prova de conceito.
// Dados 100% ficticios (refs C900001/S900001/... nunca existem no portal).
// Espelha exatamente o formato validado pelos testes existentes:
// tests/fixtures/retorno-problematico.js (lote AGUARDANDO + retorno corrigido).
// ============================================================
const fs = require('fs');
const path = require('path');

const NONCE = 'a1b2c3d4e5f6';
const REF = i => `C900001 S900${String(i).padStart(2, '0')} U900010 L900020 A900${String(30 + i)}`;

function atividadeGerada(i) {
  const ref = REF(i);
  return [
    `#### Atividade: Unidade ${i} - Atividade ficticia ${i} [${ref}]`,
    `**Enunciado:** Write about your fictional weekend.`,
    `**Resposta do aluno:**`,
    `<<<RESPOSTA-INICIO-${NONCE}>>>`,
    `Fictional answer number ${i} about a weekend trip.`,
    `<<<RESPOSTA-FIM-${NONCE}>>>`,
    `**Classificação:** AGUARDANDO`,
    `**Score:** AGUARDANDO`,
    `**Flag:** AGUARDANDO`,
    `**Revisão:** AGUARDANDO`,
    `**Feedback:**`,
    `AGUARDANDO`,
    `---`,
  ].join('\n');
}

// Conteudo do lote original (o que o botao "copiar" entrega a IA).
function makeLote() {
  const parts = Array.from({ length: 10 }, (_, i) => atividadeGerada(i + 1));
  return [
    `<!-- CNA CORRETOR - lote 1/1 - nonce ${NONCE} -->`,
    `# Atividades escritas - lote 1 de 1`,
    `*Demonstracao com dados ficticios. Nenhuma atividade real foi tocada.*`,
    ...parts,
    `_Fim do lote 1._`,
  ].join('\n');
}

function atividadeCorrigida(i, opts = {}) {
  const ref = REF(i);
  const cls = i % 3 === 0 ? 'PARCIAL' : i % 3 === 1 ? 'CORRETO' : 'INCORRETO';
  const score = cls === 'CORRETO' ? 90 : cls === 'PARCIAL' ? 72 : 45;
  const feedback = 'You answered the task clearly. Check the spelling and keep writing in complete sentences.';
  return [
    `#### **Atividade: Unidade ${i} - Atividade ficticia ${i} [${ref}]**`,
    `**Enunciado:** Write about your fictional weekend.`,
    `**Resposta do aluno:**`,
    `<<>>`,
    `Fictional answer number ${i} about a weekend trip.`,
    `<<>>`,
    `**Classificação:** ${opts.cls || cls}`,
    `**Score:** ${score}`,
    `**Flag:** NENHUM`,
    `**Revisão:** NAO`,
    `**Feedback:**`,
    feedback,
    `---`,
  ].join('\n');
}

// Retorno corrigido valido (formato aceito pelo parser real).
function makeValidReturn(opts = {}) {
  const refs = Array.from({ length: 10 }, (_, i) => REF(i + 1));
  if (opts.duplicateRef) refs[9] = refs[0];
  const atividades = refs.map((_, i) => {
    const a = atividadeCorrigida(i + 1, { cls: opts.badClassification });
    return opts.duplicateRef && i === 9 ? a.replace(REF(10), REF(1)) : a;
  });
  const nonceLine = `<!-- CNA CORRETOR - lote 1/1 - nonce ${opts.wrongNonce ? 'ffffffffffff' : NONCE} -->`;
  return [
    nonceLine,
    '',
    `# Atividades escritas - lote 1 de 1`,
    `*Retorno ficticio gerado para demonstracao.*`,
    ``,
    ...atividades,
  ].join('\n');
}

function makeCollection() {
  return {
    id: '2026-11-20T00:00:00.000Z',
    nonce: NONCE,
    batches: [{
      num: 1,
      name: 'lote-01.md',
      total: 10,
      refs: Array.from({ length: 10 }, (_, i) => REF(i + 1)),
    }],
  };
}

// Grava o lote sintetico em um diretorio temporario proprio da execucao.
function writeFixture(lotesDir) {
  fs.mkdirSync(lotesDir, { recursive: true });
  fs.writeFileSync(path.join(lotesDir, 'lote-01.md'), makeLote(), 'utf8');
  return { collection: makeCollection(), validReturn: makeValidReturn() };
}

module.exports = {
  NONCE, REF, makeLote, makeValidReturn, makeCollection, writeFixture,
};
