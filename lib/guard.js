// ============================================================
// CNA Corretor — GUARDA (pré-filtro e validação)
//
// 1. preFilter(answer): procura frases de injeção de prompt e de
//    "texto de IA" na RESPOSTA DO ALUNO antes do MD ser gerado.
//    Retorna { flagged, reasons[] } — nunca bloqueia, só marca.
// 2. validateEntry(entry, original, nonce): valida o MD devolvido
//    pela IA antes de qualquer preenchimento no portal.
// ============================================================

// --- Pré-filtro ---------------------------------------------------
// Frases procuradas em minúsculas, sem acentos, como substrings.
const stripAccents = s =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const INJECTION_PATTERNS = [
  // instrução direta à IA
  'ignore previous', 'ignore as instrucoes', 'ignore qualquer instrucao',
  'desconsidere as instrucoes', 'instrucoes anteriores', 'instrucoes acima',
  'nova instrucao', 'instrucao importante', 'importante: voce deve',
  // manipulação de nota
  'marque como correto', 'classifique como correto', 'determine como correto',
  'mark as correct', 'mark this as correct', 'full marks', 'nota maxima',
  'de nota maxima', 'me da 100', 'give me 100', 'score this as',
  'grade this as correct', 'aprovado automaticamente',
  // assume papel / finge ser sistema
  'system prompt', 'you are now', 'act as', 'você agora é', 'voce agora e',
  'voce e um professor', 'você é um professor', 'finge que', 'pretend that',
  // vazamento de prompt
  'repita as instrucoes', 'revele as instrucoes', 'print your instructions',
];

const AI_TEXT_PATTERNS = [
  'here is the answer', 'aqui esta a resposta', 'espero que isso ajude',
  'espero ter ajudado', 'certainly!', 'claro!', 'as an ai', 'como uma ia',
  'sou uma ia', 'i cannot assist', 'nao posso ajudar', 'ai language model',
  'modelo de linguagem', 'clique em finalizar', 'click finish',
];

function preFilter(answer) {
  const t = stripAccents(answer);
  const reasons = [];
  for (const p of INJECTION_PATTERNS) if (t.includes(p)) reasons.push(`possível injeção: "${p}"`);
  for (const p of AI_TEXT_PATTERNS) if (t.includes(p)) reasons.push(`texto suspeito de IA: "${p}"`);

  // T1: resposta contém os RÓTULOS dos campos do retorno, os marcadores de
  // resposta ou linhas de heading/separador — padrão do ataque de P1 (clonar
  // os campos dentro da resposta). Linha a linha, para não pegar comentários.
  const FIELD_LABELS = ['classificacao:**', 'score:**', 'flag:**', 'revisao:**', 'feedback:**'];
  for (const line of String(answer || '').split(/\r?\n/)) {
    const l = stripAccents(line.trim());
    if (FIELD_LABELS.some(lbl => l.includes(lbl)))
      reasons.push(`resposta contém rótulo de campo do retorno: "${l}"`);
    if (/^<<<resposta-(inicio|fim)-/i.test(l))
      reasons.push(`resposta contém marcador de resposta: "${l}"`);
    if (/^(---|\*\*\*|_+)\s*$/.test(l) || /^#{3,}/.test(l))
      reasons.push(`resposta contém linha de separador/cabeçalho: "${l}"`);
  }
  return { flagged: reasons.length > 0, reasons };
}

const { expectedClassification } = require('./notas');

// --- Normalização para comparação ----------------------------------
function normText(s) {
  return stripAccents(s).replace(/\s+/g, ' ').trim();
}

// T5c: detecta português na resposta — triagem contextual, não prova.
// Falso positivo só vai para revisão (nunca bloqueia preenchimento correto).
// Não marca por nome próprio isolado (São, João) nem por UMA palavra de
// autocorreto: exige 2+ sinais de português e proporção mínima do texto.
// Rodada 3 (item 9): a maiúscula INICIAL de uma frase não esconde português —
// só palavras MAIÚSCULAS NO MEIO da frase (nomes próprios/estrangeiras) são
// ignoradas, e mesmo elas contam quando são marcadores fortes (PT_WORDS ou
// diacríticos exclusivos ã/õ/ç). Não é uma lista simplista: continua exigindo
// 2+ sinais e proporção mínima.
const PT_WORDS = new Set([
  'nao', 'voce', 'para', 'que', 'uma', 'com', 'por', 'como', 'eu', 'em',
  'mas', 'muito', 'mais', 'tambem', 'ate', 'esta', 'isso', 'aqui', 'entao',
  'porque', 'quando', 'onde', 'seu', 'sua', 'foi', 'era', 'meu', 'minha',
  'escola', 'trabalho', 'casa',
  // Comuns em respostas curtas do aluno (ausentes no inglês comum):
  'entendi', 'pergunta', 'tarefa', 'licao', 'professor', 'aluno',
  'hoje', 'ontem', 'ainda', 'vou', 'vai', 'estudo',
]);

function hasPortuguese(text) {
  let pt = 0;
  let total = 0;
  for (const frase of String(text || '').split(/[.!?]+/)) {
    const words = frase.match(/[A-Za-zÀ-ÿ]+/g) || [];
    words.forEach((raw, i) => {
      total++;
      const w = raw.toLowerCase();
      const forte = PT_WORDS.has(w) || /[ãõç]/.test(w);
      // Início de frase: só marcador forte conta (evita inglês "This/However...").
      if (i === 0) { if (forte) pt++; return; }
      // Meio de frase: maiúscula sem marcador forte = nome próprio/estrangeira.
      if (/^[A-ZÀ-Þ]/.test(raw) && !forte) return;
      if (forte) pt++;
    });
  }
  if (total < 4) return false; // texto curto demais para triagem contextual
  return pt >= 2 && pt / total >= 0.12;
}

// conta parágrafos como blocos separados por linha em branco
function countParagraphs(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return blocks.length;
}

// --- Validação da entrada devolvida pela IA -------------------------
// entry: saída do parser (classificação, score, feedback, respostaLida...)
// original: dados de answers.json para o mesmo ref
// Retorna { ok, review, reasons[] } — review=true => revisão manual.
function validateEntry(entry, original) {
  const reasons = [];

  // 1. Campos obrigatórios presentes
  if (!entry.classification) reasons.push('classificação ausente ou inválida');
  if (entry.score == null || Number.isNaN(Number(entry.score)))
    reasons.push('score ausente ou inválido');
  if (!entry.feedback || !entry.feedback.trim())
    reasons.push('feedback vazio');

  // 2. Coerência classificação x score (75+ Correto, 50-74 Parcial, <50 Incorreto)
  //    Limites centralizados em lib/notas.js (espelham instrucoes_correcao.md).
  if (entry.classification && entry.score != null && !Number.isNaN(Number(entry.score))) {
    const sc = Number(entry.score);
    const expected = expectedClassification(sc);
    if (expected !== entry.classification)
      reasons.push(`classificação "${entry.classification}" incoerente com score ${sc} (esperado ${expected})`);
  }

  // 3. Enunciado e resposta não alterados (comparação com a cópia interna)
  if (original) {
    if (normText(entry.pergunta || '') !== normText(original.question || ''))
      reasons.push('enunciado alterado pela IA');
    // A IA recebe a resposta MASCARADA; comparar com a versão crua geraria
    // falsa divergência. answerMasked, quando presente, é a referência correta.
    const expectedAnswer = original.answerMasked !== undefined ? original.answerMasked : original.answer;
    if (normText(entry.respostaLida || '') !== normText(expectedAnswer || ''))
      reasons.push('resposta do aluno alterada pela IA');
  } else {
    reasons.push('atividade não encontrada em answers.json (ref desconhecida)');
  }

  // 4. Entrada sinalizada pelo pré-filtro e devolvida como CORRETO => revisão manual
  if (entry.prefilter && entry.prefilter.flagged && entry.classification === 'CORRETO')
    reasons.push('entrada sinalizada pelo pré-filtro e devolvida como CORRETO');

  // 5. Flag ≠ NENHUM exige Classificação INCORRETO e Score 0
  if (entry.flag && entry.flag !== 'NENHUM') {
    if (entry.classification !== 'INCORRETO')
      reasons.push(`Flag ${entry.flag} exige Classificação INCORRETO`);
    if (entry.score !== 0)
      reasons.push(`Flag ${entry.flag} exige Score 0`);
    // T5b: flag armada exige Revisão SIM
    if (!entry.revisao || !entry.revisao.sim)
      reasons.push(`Flag ${entry.flag} exige Revisão SIM`);
  }

  // 6. IA marcou para revisão manual
  if (entry.revisao && entry.revisao.sim)
    reasons.push(`IA marcou revisão: ${entry.revisao.motivo || 'sem motivo'}`);

  // 7. T5c: CORRETO com português na resposta => triagem -> revisão
  if (entry.classification === 'CORRETO' && hasPortuguese(entry.respostaLida))
    reasons.push('resposta CORRETO contém português (triagem)');

  // 8. T5e: feedback com mais de 2 parágrafos
  if (entry.feedback && countParagraphs(entry.feedback) > 2)
    reasons.push(`feedback com ${countParagraphs(entry.feedback)} parágrafos (máx. 2)`);

  return { ok: reasons.length === 0, review: reasons.length > 0, reasons };
}

module.exports = { preFilter, validateEntry, normText, hasPortuguese, INJECTION_PATTERNS, AI_TEXT_PATTERNS };
