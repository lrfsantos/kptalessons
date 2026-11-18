// ============================================================
// CNA Corretor — motor de avaliação gramatical
// Sem gabarito: corrige pela CORREÇÃO GRAMATICAL do texto.
// Heurísticas offline, extensíveis. Cada critério devolve:
//   { ok, points, max, note }
// O total é a soma dos pontos / soma dos máximos (0–100).
// ============================================================

// --- Utilitários -------------------------------------------------

function norm(s) {
  return String(s == null ? '' : s)
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

// Divide em sentenças (termina em . ! ? ou ;)
function sentences(text) {
  const parts = norm(text).split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : (norm(text) ? [norm(text)] : []);
}

function words(text) {
  return (norm(text).toLowerCase().match(/[a-zà-úâ-ûã-õ'’-]+/g) || []);
}

function uniqueCount(arr, f = x => x) {
  return new Set(arr.map(f)).size;
}

// Distância de Levenshtein (para pequenos trechos).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
      );
  return dp[m][n];
}

// Lista de palavras funcionais comuns do inglês (funcionam como
// "stopword"/contexto). Não é dicionário completo — usada para
// heurísticas de duplicação e de qualidade de vocabulário.
const FUNCTIONAL = new Set((
  'a an the and or but if so then than as of to for in on at by with without from up down out off over under ' +
  'i you he she it we they me him her us them my your his its our their mine yours hers ours theirs this that ' +
  'these those what which who whom whose some any no all both each few more most other another such ' +
  'be am is are was were been being do does did done doing have has had having can could will would shall should ' +
  'may might must not n\'t dont dont dont no yes'
).split(/\s+/).filter(Boolean));


// --- Critérios ----------------------------------------------------

// 1. Capacidade de gerar texto (não pode estar vazio / minúsculo demais)
function criterion_content_is_present(textInfo) {
  const wc = textInfo.wordCount;
  const max = 20;
  if (wc === 0) return { ok: false, points: 0, max, note: 'Resposta vazia — nada para avaliar.' };
  if (wc < 4) return { ok: false, points: Math.round(max * 0.3), max, note: 'Resposta muito curta (palavras: ' + wc + ').' };
  return { ok: true, points: max, max, note: wc + ' palavras.' };
}

// 2. Letra maiúscula no início de cada sentença
function criterion_capitalization(textInfo) {
  const max = 15;
  const sents = textInfo.sentences;
  if (!sents.length) return { ok: false, points: 0, max, note: 'Sem sentenças.' };
  let bad = 0;
  for (const s of sents) {
    const m = s.match(/^[a-zà-ú]/);
    if (m) bad++;
  }
  if (bad === 0) return { ok: true, points: max, max, note: 'Todas as sentenças iniciam com maiúscula.' };
  const pts = Math.round(max * (1 - bad / sents.length));
  return { ok: false, points: pts, max, note: bad + ' de ' + sents.length + ' sentenças iniciam minúscula.' };
}

// 3. Pontuação final (todas as sentenças terminam em . ! ?)
function criterion_terminal_punctuation(textInfo) {
  const max = 10;
  const sents = textInfo.sentences;
  if (!sents.length) return { ok: false, points: 0, max, note: 'Sem sentenças.' };
  let bad = 0;
  for (const s of sents) if (!/[.!?]$/.test(s)) bad++;
  if (bad === 0) return { ok: true, points: max, max, note: 'Pontuação final correta.' };
  const pts = Math.round(max * (1 - bad / sents.length));
  return { ok: false, points: pts, max, note: bad + ' de ' + sents.length + ' sentenças sem pontuação final.' };
}

// 4. Espaçamento (sem espaços duplos, sem ausência de espaço após , . ! ?)
function criterion_spacing(textInfo) {
  const max = 8;
  const t = textInfo.text;
  const dbl = (t.match(/ {2,}/g) || []).length;
  const noSpaceAfter = (t.match(/[,.!?;]["']?[A-Za-zà-ú]/g) || []).length;
  const tot = dbl + noSpaceAfter;
  if (tot === 0) return { ok: true, points: max, max, note: 'Espaçamento correto.' };
  const pts = Math.max(0, Math.round(max * (1 - tot / 5)));
  return { ok: false, points: pts, max, note: tot + ' problema(s) de espaço.' };
}

// 5. Palavra repetida adjacente ("the the", "and and")
function criterion_repeated_word(textInfo) {
  const max = 10;
  const t = ' ' + norm(textInfo.text).toLowerCase() + ' ';
  const re = / ([a-zà-ú'-]+) \1 /g;
  const found = [];
  let m;
  while ((m = re.exec(t))) { if (!FUNCTIONAL.has(m[1])) found.push(m[1]); re.lastIndex -= m[1].length; }
  if (found.length === 0) return { ok: true, points: max, max, note: 'Sem palavras duplicadas.' };
  return { ok: false, points: 0, max, note: 'Palavra repetida: ' + found.join(', ') };
}

// 6. Variedade de vocabulário (funcionais < 80% é sinal de texto mais rico)
function criterion_vocabulary(textInfo) {
  const max = 7;
  const w = textInfo.words;
  if (!w.length) return { ok: false, points: 0, max, note: 'Sem palavras.' };
  const functional = w.filter(x => FUNCTIONAL.has(x)).length;
  const ratio = functional / w.length;
  if (ratio < 0.45) return { ok: true, points: max, max, note: 'Boa variedade de vocabulário.' };
  if (ratio < 0.65) return { ok: true, points: Math.round(max * 0.7), max, note: 'Vocabulário razoável.' };
  return { ok: false, points: Math.round(max * 0.3), max, note: 'Vocabulário limitado (muitas palavras funcionais).' };
}

// 7. Ortografia — padrões comuns de erro (encaixes, gíria, repetição de letra)
const COMMON_ERRORS = [
  [/\bwanna\b/, 'wanna → want to'],
  [/\bgonna\b/, 'gonna → going to'],
  [/\baint\b/, "ain't → am/is/are not"],
  [/\bcoz\b|\bcuz\b/, 'coz → because'],
  [/\bdont\b/, 'dont → don\'t'],
  [/\bdoesnt\b/, 'doesnt → doesn\'t'],
  [/\bbreaked\b|\bbed\b(?!room)/, 'verbo irregular'],
  [/\bgived\b/, 'gived → gave'],
  [/\bgoed\b/, 'goed → went'],
  [/\bcom a\b/ig, 'spacing'],
];

function criterion_spelling(textInfo) {
  const max = 10;
  const t = norm(textInfo.text);
  let issues = 0;
  const notes = [];
  for (const [re, label] of COMMON_ERRORS) {
    const mm = t.match(re);
    if (mm) { issues++; notes.push(label); }
  }
  // extensão exagerada de vogal ("looooove")
  const stretched = (t.match(/([aeiou])\1{2,}/gi) || []).length;
  if (stretched) { issues += stretched; notes.push('letra repetida exagerada'); }
  if (issues === 0) return { ok: true, points: max, max, note: 'Nenhum padrão de erro ortográfico detectado.' };
  return { ok: false, points: Math.max(0, Math.round(max * (1 - issues / 3))), max, note: notes.slice(0, 3).join('; ') };
}

// 8. Estrutura/comprimento médio de sentença (equilíbrio, não só frases curtas)
function criterion_sentence_length(textInfo) {
  const max = 10;
  const sents = textInfo.sentences;
  if (!sents.length) return { ok: false, points: 0, max, note: 'Sem sentenças.' };
  const lens = sents.map(s => (s.match(/[a-zà-ú'’-]+/gi) || []).length);
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (avg >= 3) return { ok: true, points: max, max, note: 'Tamanho médio de sentença: ' + avg.toFixed(1) + ' palavras.' };
  return { ok: false, points: Math.round(max * 0.5), max, note: 'Sentenças muito curtas (média ' + avg.toFixed(1) + ').' };
}

// 9. Coesão — presença de conectivos (and, but, because, so, when...)
const CONNECTIVES = ['and', 'but', 'because', 'so', 'when', 'if', 'then', 'although', 'however', 'therefore'];
function criterion_cohesion(textInfo) {
  const max = 5;
  const w = textInfo.words;
  const hits = CONNECTIVES.filter(c => w.includes(c)).length;
  if (hits >= 2) return { ok: true, points: max, max, note: hits + ' conectivo(s) usado(s).' };
  return { ok: false, points: Math.round(max * 0.5), max, note: 'Poucos conectivos para ligar as ideias.' };
}

// 10. Coerência — não repetir demais a mesma palavra (além de funcionais)
function criterion_repetition(textInfo) {
  const max = 5;
  const w = textInfo.words.filter(x => !FUNCTIONAL.has(x));
  if (w.length < 6) return { ok: true, points: Math.round(max * 0.8), max, note: 'Texto curto demais para avaliar repetição.' };
  const u = uniqueCount(w);
  const ratio = u / w.length;
  if (ratio >= 0.6) return { ok: true, points: max, max, note: 'Boa variedade de palavras (não repete).' };
  return { ok: false, points: Math.round(max * 0.4), max, note: 'Repete muito as mesmas palavras.' };
}

const CRITERIA = [
  criterion_content_is_present,
  criterion_capitalization,
  criterion_terminal_punctuation,
  criterion_spacing,
  criterion_repeated_word,
  criterion_vocabulary,
  criterion_spelling,
  criterion_sentence_length,
  criterion_cohesion,
  criterion_repetition,
];

// --- API pública -------------------------------------------------

// Avalia um texto e devolve { score, max, percent, criteria, textInfo }
function grade(text) {
  const raw = norm(text);
  const textInfo = {
    text: raw,
    sentences: sentences(raw),
    words: words(raw),
    wordCount: words(raw).length,
  };

  // Resposta em branco => nota zero (sem critérios a serem "bônus")
  if (textInfo.wordCount === 0) {
    return {
      raw,
      score: 0,
      max: 0,
      percent: 0,
      criteria: [],
      textInfo,
    };
  }

  const criteria = CRITERIA.map(fn => {
    try { return fn(textInfo); }
    catch (e) { return { ok: false, points: 0, max: 0, note: 'erro: ' + e.message, error: true }; }
  });

  const points = criteria.reduce((a, c) => a + c.points, 0);
  const max = criteria.reduce((a, c) => a + c.max, 0) || 1;
  const percent = Math.round((points / max) * 100);

  return {
    raw,
    score: points,
    max,
    percent,
    criteria,
    textInfo,
  };
}

module.exports = {
  grade,
  norm,
  sentences,
  words,
  levenshtein,
};
