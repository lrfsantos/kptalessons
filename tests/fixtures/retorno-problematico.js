// Fixture sanitizada que reproduz o retorno real problemático da IA:
// 10 atividades, marcadores <<>>, campos com asteriscos escapados, alguns
// campos compactados em uma linha e relatório estatístico no fim.
// Dados 100% fictícios.
const NONCE = 'f1e2d3c4b5a6';
const REF = i => `C900001 S9000${String(i).padStart(2, '0')} U900010 L900020 A9000${String(30 + i)}`;

function atividade(i, opts = {}) {
  const ref = REF(i);
  const esc = opts.escaped !== false;
  const compact = Boolean(opts.compact);
  const marker = opts.marker || '<<>>';
  const label = name => esc ? `\\*\\*${name}:\\*\\*` : `**${name}:**`;
  const cls = i % 3 === 0 ? 'PARCIAL' : i % 3 === 1 ? 'CORRETO' : 'INCORRETO';
  const score = cls === 'CORRETO' ? 90 : cls === 'PARCIAL' ? 72 : 45;
  const feedback = i === 1
    ? 'Good work on the first sentence. Check the spelling of "smaller" and keep the paragraphs short.\n\nYou are improving a lot. Continue practicing every week.'
    : 'You answered the task clearly. Check the spelling and keep writing in complete sentences.';
  if (compact) {
    return [
      `#### Atividade: Unidade ${i} - Atividade fictícia ${i} [${ref}]`,
      `**Enunciado:** Write about your fictional weekend.`,
      `**Resposta do aluno:**`,
      marker,
      `Fictional answer number ${i} about a weekend trip.`,
      marker,
      `${label('Classificação')} ${cls}  ${label('Score')} ${score}  ${label('Flag')} NENHUM  ${label('Revisão')} NAO  ${label('Feedback')} ${feedback}`,
      `---`,
    ].join('\n');
  }
  return [
    `#### **Atividade: Unidade ${i} - Atividade fictícia ${i} [${ref}]**`,
    `**Enunciado:** Write about your fictional weekend.`,
    `**Resposta do aluno:**`,
    marker,
    `Fictional answer number ${i} about a weekend trip.`,
    marker,
    `${label('Classificação')} ${cls}`,
    `${label('Score')} ${score}`,
    `${label('Flag')} NENHUM`,
    `${label('Revisão')} NAO`,
    `${label('Feedback')}`,
    feedback,
    `---`,
  ].join('\n');
}

function linhaDezTratamentos() {
  return [
    '<<<RELATORIO',
    '| Aluno | Atividades | Média | CORRETO | PARCIAL | INCORRETO |',
    '| S900001 | 1 | 72% | 0 | 1 | 0 |',
    'RELATORIO>>>',
  ].join('\n');
}

// Cada atividade exercita uma variação de formatação.
function makeReturn({ nonceOverride = NONCE, duplicateRef = false, report = true } = {}) {
  const opts = [
    {},                                    // escapado
    { escaped: false },                    // markdown convencional
    { compact: true },                     // tudo em uma linha
    { marker: '<<<>>>' },                  // marcador alternativo
    { escaped: true, compact: true },
    {},
    { escaped: false },
    { compact: true },
    { marker: '<<<>>>' },
    { escaped: false, compact: true },
  ];
  const refs = Array.from({ length: 10 }, (_, i) => REF(i + 1));
  if (duplicateRef) refs[9] = refs[0];
  const atividades = refs.map((_, i) => {
    const a = atividade(i + 1, opts[i]);
    return duplicateRef && i === 9 ? a.replace(REF(10), REF(1)) : a;
  });
  const header = [
    `# Atividades escritas — lote 1 de 1`,
    `*Gerado em 19/11/2026, 22:03:07 pelo CNA Corretor. Atividades neste lote: 10.*`,
    ``,
  ].join('\n');
  const nonceLine = `<!-- CNA CORRETOR - lote 1/1 - nonce ${nonceOverride} -->`;
  return [nonceLine, '', header, ...atividades, report ? linhaDezTratamentos() : ''].join('\n');
}

function makeCollection(nonce = NONCE) {
  return {
    id: '2026-11-19T22:03:07.000Z',
    nonce,
    batches: [{
      num: 1,
      name: 'lote-01.md',
      total: 10,
      refs: Array.from({ length: 10 }, (_, i) => REF(i + 1)),
    }],
  };
}

// Versão gerada (AGUARDANDO) — usa os marcadores oficiais e rótulos normais.
function makeGenerated() {
  const parts = Array.from({ length: 10 }, (_, i) => {
    const ref = REF(i + 1);
    return [
      `#### Atividade: Unidade ${i + 1} - Atividade fictícia ${i + 1} [${ref}]`,
      `**Enunciado:** Write about your fictional weekend.`,
      `**Resposta do aluno:**`,
      `<<<RESPOSTA-INICIO-${NONCE}>>>`,
      `Fictional answer number ${i + 1} about a weekend trip.`,
      `<<<RESPOSTA-FIM-${NONCE}>>>`,
      `**Classificação:** AGUARDANDO`,
      `**Score:** AGUARDANDO`,
      `**Flag:** AGUARDANDO`,
      `**Revisão:** AGUARDANDO`,
      `**Feedback:**`,
      `AGUARDANDO`,
      `---`,
    ].join('\n');
  });
  return [
    `<!-- CNA CORRETOR - lote 1/1 - nonce ${NONCE} -->`,
    `# Atividades escritas — lote 1 de 1`,
    ...parts,
    `_Fim do lote 1._`,
  ].join('\n');
}

module.exports = { NONCE, REF, makeReturn, makeCollection, makeGenerated, atividade };
