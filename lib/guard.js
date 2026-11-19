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

// --- Normalização para comparação ----------------------------------
function normText(s) {
  return stripAccents(s).replace(/\s+/g, ' ').trim();
}

// T5c: detecta português na resposta — triagem, não prova. Falso positivo
// só vai para revisão (nunca bloqueia preenchimento correto).
function hasPortuguese(text) {
  const raw = String(text || '');
  const t = stripAccents(raw); // minúsculas, sem acentos
  if (/[ãõç]/.test(raw)) return true; // acentos inconfundíveis
  // 2+ palavras comuns do português (versão sem acento, palavra inteira)
  const COMMON = ['nao', 'voce', 'para', 'que', 'uma', 'com', 'por', 'como'];
  let hits = 0;
  for (const w of COMMON) {
    const re = new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i');
    if (re.test(t)) { hits++; if (hits >= 2) return true; }
  }
  return false;
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

  // 2. Coerência classificação x score (80+ Correto, 65-79 Parcial, <65 Incorreto)
  if (entry.classification && entry.score != null && !Number.isNaN(Number(entry.score))) {
    const sc = Number(entry.score);
    const expected = sc >= 80 ? 'CORRETO' : sc >= 65 ? 'PARCIAL' : 'INCORRETO';
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
