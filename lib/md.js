// ============================================================
// CNA Corretor — documento MD (contrato programa <-> IA <-> programa)
//
// buildBatches(classes, { loteSize }) -> lotes do MD para a IA
//   Cada lote: instruções (com nonce) + N atividades.
//   Resposta do aluno entre marcadores <<<RESPOSTA-INICIO-{nonce}>>> ...
// parseReturned(files) -> entradas corrigidas, uma por atividade.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CFG = require('./config');
const { preFilter } = require('./guard');

// --- Nonce ---------------------------------------------------------
// Um token aleatório NOVO por documento; substitui {{NONCE}} no
// template de instruções e entra nos marcadores da resposta.
function newNonce() {
  return crypto.randomBytes(6).toString('hex'); // 12 caracteres
}

const answerStart = nonce => `<<<RESPOSTA-INICIO-${nonce}>>>`;
const answerEnd = nonce => `<<<RESPOSTA-FIM-${nonce}>>>`;
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Ref compacta e estável de uma atividade: C{class} S{student} U{unit} L{lesson} A{activity}
const refOf = a => `C${a.classId} S${a.studentId} U${a.unitId} L${a.lessonId} A${a.activityId}`;

// Lê as instruções (template) e substitui {{NONCE}}.
function loadInject(nonce) {
  const file = path.join(CFG.ROOT, 'instrucoes_correcao.md');
  const tpl = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim()
    : 'Instruções ausentes. Preencha Classificação, Score e Feedback de cada atividade.';
  return tpl.split('{{NONCE}}').join(nonce);
}

// --- GERAR (lotes) --------------------------------------------------
// classes: [{ name, shift, classId, students: [{ name, studentId, pending, lessons: [...] }] }]
// lessons: { title, unit, pending, question, answer, ids:{classId,studentId,unitId,lessonId,activityId} }
function entryBlock(l, nonce) {
  const flags = l.prefilter && l.prefilter.flagged
    ? `\n\n⚠️ **ATIVIDADE SINALIZADA:** a resposta contém texto que pode ser instrução à IA ou conteúdo de IA (${l.prefilter.reasons.join('; ')}). Informação apenas.`
    : '';
  return [
    `#### Atividade: ${l.unit} ${l.title} [${refOf(l.ids)}]${flags}`,
    ``,
    `**Enunciado:**`,
    l.question || '(não capturado)',
    ``,
    `**Resposta do aluno:**`,
    answerStart(nonce),
    l.answer || '(vazia)',
    answerEnd(nonce),
    ``,
    `**Classificação:** AGUARDANDO`,
    ``,
    `**Score:** AGUARDANDO`,
    ``,
    `**Flag:** AGUARDANDO`,
    ``,
    `**Revisão:** AGUARDANDO`,
    ``,
    `**Feedback:**`,
    `AGUARDANDO`,
    ``,
    `---`,
    ``,
  ].join('\n');
}

// Mascara dados pessoais antes de mandar para a IA (T10):
// e-mails, telefones brasileiros, CPF, links e o nome do próprio aluno.
// Ex.: maskAnswer('Me chamo Ana Silva, tel 11 91234-5678', 'Ana Silva')
//   -> 'Me chamo [NOME], tel [TELEFONE]'
const foldText = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isWordChar = ch => ch ? /[\p{L}\p{N}]/u.test(ch) : false;

function maskAnswer(answer, studentName) {
  let s = String(answer || '');
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]');          // e-mail
  s = s.replace(/(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}/g, '[TELEFONE]'); // BR phone
  s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');       // CPF
  s = s.replace(/https?:\/\/\S+|www\.\S+/g, '[LINK]');               // link

  // Nome do aluno: comparação insensível a acentos/caixa, mas com LIMITES DE
  // PALAVRA — "Ana" não pode alterar "bananas", nem "May" alterar "maybe".
  // A versão "folded" tem o mesmo comprimento do original (NFC => 1 char por
  // letra acentuada), então os índices são reutilizáveis sem alterar o texto.
  if (studentName) {
    const compost = /['’\-\s]/.test(String(studentName));
    const min = compost ? 1 : 2;
    const parts = String(studentName).split(/[\s'’-]+/).map(p => foldText(p)).filter(p => p.length >= min);
    for (const part of parts) {
      const folded = foldText(s);
      const ranges = [];
      let from = 0;
      for (;;) {
        const idx = folded.indexOf(part, from);
        if (idx < 0) break;
        const before = idx > 0 ? folded[idx - 1] : '';
        const after = folded[idx + part.length] || '';
        if (!isWordChar(before) && !isWordChar(after)) ranges.push([idx, idx + part.length]);
        from = idx + 1;
      }
      // Substitui de trás para frente para não invalidar os índices.
      for (let i = ranges.length - 1; i >= 0; i--) {
        const [a, b] = ranges[i];
        s = s.slice(0, a) + '[NOME]' + s.slice(b);
      }
    }
  }
  return s;
}

// Arquiva originais e retornos da coleta anterior sem misturar os diretórios ativos.
function archivePrevious(outDir) {
  if (!fs.existsSync(outDir)) return null;
  const returnedDir = path.join(outDir, 'retornos-da-IA');
  const records = [];
  for (const f of fs.readdirSync(outDir)) {
    if (/^lote-\d{2,}\.md$/i.test(f) || /^lote-\d{2,}\.devolvido\.md$/i.test(f)) {
      records.push({ label: f, file: path.join(outDir, f) });
    }
  }
  if (fs.existsSync(returnedDir)) {
    for (const f of fs.readdirSync(returnedDir)) {
      if (/^lote-\d{2,}\.md$/i.test(f)) {
        records.push({ label: 'retornos-da-IA/' + f, file: path.join(returnedDir, f) });
      }
    }
  }
  if (!records.length) return null;
  const stamp = Date.now() + '-' + crypto.randomBytes(2).toString('hex');
  const archive = path.join(outDir, 'historico-' + stamp + '.md');
  const fence = String.fromCharCode(96).repeat(3);
  let body = '# Histórico de lotes — arquivado em ' + new Date().toISOString() + '\n\n';
  for (const item of records) {
    body += '## Arquivo: ' + item.label + '\n\n' + fence + 'md\n';
    body += fs.readFileSync(item.file, 'utf8').trim() + '\n' + fence + '\n\n';
  }
  fs.writeFileSync(archive, body, 'utf8');
  for (const item of records) fs.unlinkSync(item.file);
  try {
    if (fs.existsSync(returnedDir) && fs.readdirSync(returnedDir).length === 0) fs.rmdirSync(returnedDir);
  } catch { /* diretório pode estar em uso */ }
  return archive;
}

// Gera os lotes. Retorna { nonce, files: [{ path, name, num, refs, entries }] }.
function buildBatches(classes, { loteSize = 10, outDir = null, title = 'Atividades escritas' } = {}) {
  // Teto fixo de 10 atividades por lote; variável de ambiente só pode reduzir.
  const size = Math.min(10, parseInt(loteSize, 10) > 0 ? parseInt(loteSize, 10) : 10);
  outDir = outDir || path.join(CFG.ROOT, 'lotes');
  fs.mkdirSync(outDir, { recursive: true });
  archivePrevious(outDir);
  fs.mkdirSync(path.join(outDir, 'retornos-da-IA'), { recursive: true });
  const nonce = newNonce();
  const inject = loadInject(nonce);
  const gerado = new Date().toLocaleString('pt-BR');

  // Achata as pendentes mantendo turma/aluno
  const flat = [];
  for (const c of classes) for (const s of c.students) {
    for (const l of s.lessons.filter(x => x.pending)) {
      // T10: resposta mascarada é a que vai para a IA (o original fica em answers.json)
      flat.push({ class: c, student: s, lesson: l, answerMasked: maskAnswer(l.answer, s.name) });
    }
  }

  const files = [];
  const lotes = Math.max(1, Math.ceil(flat.length / size));
  for (let i = 0; i < lotes; i++) {
    const slice = flat.slice(i * size, (i + 1) * size);
    let md = `<!-- CNA CORRETOR - lote ${i + 1}/${lotes} - nonce ${nonce} -->\n\n`;
    md += `${inject}\n\n`;
    md += `---\n\n# ${title} — lote ${i + 1} de ${lotes}\n\n`;
    md += `_Gerado em ${gerado} pelo CNA Corretor. Atividades neste lote: ${slice.length}._\n\n`;
    md += `Preencha **Classificação**, **Score**, **Flag**, **Revisão** e **Feedback** de cada atividade AGUARDANDO.\n\n`;

    // Agrupa por turma/aluno dentro do lote para leitura fácil
    let lastKey = '';
    for (const { class: c, student: s, lesson: l, answerMasked } of slice) {
      const key = `C${c.classId}|S${s.studentId}`;
      if (key !== lastKey) {
        md += `## Turma: C${c.classId} [C${c.classId}]\n\n`;
        md += `### Aluno: S${s.studentId} [S${s.studentId}]\n\n`;
        lastKey = key;
      }
      md += entryBlock({ ...l, answer: answerMasked }, nonce);
    }
    md += `_Fim do lote ${i + 1}._\n`;

    const num = String(i + 1).padStart(2, '0');
    const name = `lote-${num}.md`;
    const file = path.join(outDir, name);
    fs.writeFileSync(file, md);
    files.push({
      path: file, name, num: i + 1, nonce, entries: slice.length,
      refs: slice.map(x => refOf(x.lesson.ids)),
    });
  }
  return { nonce, files, total: flat.length };
}

// --- LER (MD devolvido pela IA) -------------------------------------
function normalizeClassification(v) {
  const s = String(v || '').trim().toUpperCase();
  if (/^(CORRETO|HIT|C)$/.test(s)) return 'CORRETO';
  if (/^(PARCIAL|INCOMPLETO|PARTIAL|P)$/.test(s)) return 'PARCIAL';
  if (/^(INCORRETO|ERRADO|MISS|I|E)$/.test(s)) return 'INCORRETO';
  return null;
}

function parseScore(v) {
  const s = String(v || '').trim();
  // Apenas um número isolado de 0 a 100 (com % opcional). Intervalos, dois
  // números conflitantes, negativos e texto com número solto são rejeitados.
  if (!/^\d{1,3}\s*%?$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 0 && n <= 100 ? n : null;
}

// Flag: NENHUM | IA | INJECAO | GIBBERISH (1 palavra). AGUARDANDO/inválido -> null.
const FLAGS = ['NENHUM', 'IA', 'INJECAO', 'GIBBERISH'];
function normalizeFlag(v) {
  const s = String(v || '').trim().toUpperCase();
  return FLAGS.includes(s) ? s : null;
}

// Revisão: "NAO" ou "SIM - motivo".
function parseRevisao(v) {
  const s = String(v || '').trim();
  if (/^NAO\b/i.test(s)) return { sim: false, motivo: '' };
  if (/^SIM\b/i.test(s)) {
    return { sim: true, motivo: s.replace(/^SIM\b\s*-?\s*/i, '').trim() };
  }
  return null; // inválido (inclui AGUARDANDO)
}

// Extrai o nonce do documento (primeira ocorrência nos marcadores ou no comentário).
function extractNonce(text) {
  const m = String(text).match(/RESPOSTA-INICIO-([0-9a-f]{6,32})/i)
    || String(text).match(/nonce\s+([0-9a-f]{6,32})/i);
  return m ? m[1] : null;
}

// Extrai os cinco campos obrigatórios da região PÓS-resposta, exigindo ordem
// e unicidade. Qualquer ambiguidade => estrutura inválida.
function extractFields(region) {
  const norm = normalizeFieldLabels(region);
  const labels = FIELD_LABELS;
  const found = [];
  const re = /\*\*(Classificação|Score|Flag|Revisão|Feedback):\*\*[ \t]*/gi;
  let m;
  while ((m = re.exec(norm)) !== null) {
    const key = m[1].toLowerCase().normalize('NFD').replace(DIACRITIC_RE, '');
    const canon = FIELD_ALIASES[key];
    const start = m.index + m[0].length;
    const next = norm.slice(start).search(re) ;
    const end = next < 0 ? norm.length : start + next;
    found.push({ name: canon, value: norm.slice(start, end) });
  }
  const names = found.map(f => f.name);
  const expected = labels;
  const valid = names.length === expected.length && expected.every((n, i) => names[i] === n);
  const out = {};
  for (const f of found) out[f.name] = (out[f.name] || '') + f.value;
  return { valid, fields: out };
}

// Normalização de formatação aplicada SOMENTE à região dos campos (depois do
// marcador de fim). A resposta do aluno NÃO é tocada aqui — isso preserva a
// comparação de integridade no executor.
const FIELD_LABELS = ['Classificação', 'Score', 'Flag', 'Revisão', 'Feedback'];
const FIELD_ALIASES = {
  classificacao: 'Classificação', score: 'Score', flag: 'Flag',
  revisao: 'Revisão', revisão: 'Revisão', feedback: 'Feedback',
};
const DIACRITIC_RE = /[\u0300-\u036f]/g;

// Remove BOM, normaliza quebras de linha, NBSP e caracteres invisíveis usados
// por IAs ao reformatar Markdown. Não altera o conteúdo das frases.
function cleanFormatting(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f\u2060\ufeff]/g, ' ')
    .replace(/[\u200b\u200c\u200d]/g, '');
}

// Converte qualquer uma das formas abaixo para `**Rótulo:** valor`, cada
// rótulo em sua própria linha:
//   **Rótulo:**  /  \*\*Rótulo:\*\*  /  Rótulo:  /  > **Rótulo:**  /  - **Rótulo:**
// IAs também compactam todos os campos em uma linha só; ao inserir `\n` antes
// de cada rótulo reconhecido, os limites voltam a ficar explícitos.
function normalizeFieldLabels(region) {
  let s = cleanFormatting(region);

  // 0) IAs escapam os asteriscos do Markdown (\*\*Rótulo:\*\*). Como isto é
  //    aplicado SOMENTE depois do marcador de fim, não afeta a resposta do
  //    aluno. Desescapar aqui simplifica todas as formas restantes.
  s = s.replace(/\\\*/g, '*');

  // 1) Rótulos com Markdown — podem aparecer em qualquer posição da linha
  //    (formato compacto). Ex.: **Score:** 88
  const mdLabelRe = /\*\*\s*(Classifica[çc][aã]o|Score|Flag|Revis[aã]o|Feedback)[ \t]*:[ \t]*\*\*?[ \t]*/gi;
  s = s.replace(mdLabelRe, (full, label) => {
    const key = String(label).toLowerCase().normalize('NFD').replace(DIACRITIC_RE, '');
    return '\n**' + FIELD_ALIASES[key] + ':** ';
  });

  // 2) Rótulos em texto simples / blockquote / lista — exigem início de linha.
  const plainLabelRe = /(^|\n)[ \t]*(?:>[ \t]*)?(?:[-*+][ \t]+)?(Classifica[çc][aã]o|Score|Flag|Revis[aã]o|Feedback)[ \t]*:[ \t]*/gi;
  s = s.replace(plainLabelRe, (full, pre, label) => {
    const key = String(label).toLowerCase().normalize('NFD').replace(DIACRITIC_RE, '');
    return '\n**' + FIELD_ALIASES[key] + ':** ';
  });

  // Remove linhas em branco em excesso, mas preserva parágrafos do feedback.
  return s.replace(/\n{3,}/g, '\n\n');
}

// Faz o parse de UM arquivo devolvido. Retorna entradas (uma por atividade).
// T1: TODOS os campos (Classificação/Score/Flag/Revisão/Feedback) são lidos
// SOMENTE no texto DEPOIS do marcador RESPOSTA-FIM-{nonce} do bloco. Se o
// marcador de fim não existir, ou o de início/fim aparecer mais de uma vez,
// ou a ordem estiver errada, a entrada vai para revisão (o aluno poderia ter
// clonado os rótulos DENTRO da resposta — não podemos confiar nos campos).
function parseFile(text) {
  const src = String(text || '');
  const nonce = extractNonce(src);
  const entries = [];

  const matches = findStructuralHeadings(src);

  matches.forEach((m, i) => {
    const headingLine = m[1].trim();
    const refMatch = headingLine.match(/\[([^\]]*C\d+[^\]]*)\]/);
    const title = headingLine.replace(/\[[^\]]*\]\s*$/, '').replace(/⚠️\s*ATIVIDADE SINALIZADA.*/i, '').trim();
    const start = m.index + m[0].length;
    const nextHeading = i + 1 < matches.length ? matches[i + 1].index : src.length;
    let end = nextHeading;
    // Quando vários lotes completos são colados em sequência, não deixe o
    // último bloco de um lote absorver as instruções/markers do lote seguinte.
    // Só reconhecemos o fim do lote depois do marcador de fim da resposta,
    // para que texto do aluno não consiga forjar essa fronteira.
    if (nonce) {
      const answerEndAt = src.indexOf(answerEnd(nonce), start);
      if (answerEndAt >= 0 && answerEndAt < nextHeading) {
        const afterAnswer = answerEndAt + answerEnd(nonce).length;
        const tail = src.slice(afterAnswer, nextHeading);
        const lotEndAt = tail.search(/^_Fim do lote\s+\d+\._\s*$/m);
        if (lotEndAt >= 0) end = afterAnswer + lotEndAt;
      }
    }
    const body = src.slice(start, end);
    // Sinalização do pré-filtro: na linha do título OU no corpo da entrada
    const flagged = /ATIVIDADE SINALIZADA/i.test(headingLine) || /ATIVIDADE SINALIZADA/i.test(body);

    if (!refMatch) { entries.push({ title, flagged, ref: null, error: 'sem ref [C.. S.. U.. L.. A..]' }); return; }
    const p = {};
    for (const kv of refMatch[1].matchAll(/([CSULA])(\d+)/g)) p[kv[1]] = kv[2];
    if (!(p.C && p.S && p.U && p.L && p.A)) {
      entries.push({ title, flagged, ref: refMatch[1], error: 'ref incompleta' });
      return;
    }

    // ---- Integridade dos marcadores (T1) ------------------------------
    // Só com o marcador de fim presente, corretamente ordenado e único,
    // passamos a confiar nos campos lidos depois dele.
    let integrityError = null;
    let fieldsBody = '';   // texto DEPOIS do marcador de fim (onde ficam os campos)
    let respostaLida = null;
    let nonceOk = false;
    if (nonce) {
      const startRe = new RegExp(escapeRegExp(answerStart(nonce)), 'g');
      const endRe = new RegExp(escapeRegExp(answerEnd(nonce)), 'g');
      const starts = body.match(startRe) || [];
      const ends = body.match(endRe) || [];
      if (starts.length === 0 || ends.length === 0) {
        integrityError = 'marcadores de resposta ausentes';
      } else if (starts.length > 1 || ends.length > 1) {
        integrityError = 'marcador de resposta repetido';
      } else if (body.search(startRe) > body.search(endRe)) {
        integrityError = 'ordem dos marcadores incorreta';
      } else {
        const aIdx = body.search(startRe) + starts[0].length;
        const bIdx = body.search(endRe);
        respostaLida = body.slice(aIdx, bIdx).trim();
        nonceOk = true;
        fieldsBody = body.slice(bIdx + ends[0].length);
      }
    } else {
      integrityError = 'nonce ausente no documento';
    }

    // Campos só a partir do texto depois do marcador de fim. A normalização
    // atinge APENAS esta região — nunca a resposta do aluno.
    const extracted = extractFields(fieldsBody);
    const normFields = normalizeFieldLabels(fieldsBody);
    const clsMatch = normFields.match(/\*\*Classificação:\*\*\s*([^\n*]+)/i);
    const scoreMatch = normFields.match(/\*\*Score:\*\*\s*([^\n*]+)/i);
    const flagMatch = normFields.match(/\*\*Flag:\*\*\s*([^\n*]+)/i);
    const revisaoMatch = normFields.match(/\*\*Revisão:\*\*\s*([^\n*]+)/i);

    // T2: feedback cortado na 1ª linha só de traços (---), _Fim do lote ou <<<RELATORIO
    let feedback = '';
    const fbIdx = normFields.search(/\*\*Feedback:\*\*/i);
    if (fbIdx >= 0) {
      let fb = normFields.slice(fbIdx + '**Feedback:**'.length);
      // corta na primeira ocorrência de: linha só de --- ou ``` , _Fim do lote, <<<RELATORIO
      const cut = fb.search(/(^|\n)(?:---|`{3,})\s*$|_Fim do lote|<<<RELATORIO/im);
      if (cut >= 0) fb = fb.slice(0, cut);
      feedback = fb.replace(/^\s*[-*]?\s*/, '').trim();
    }

    const classification = normalizeClassification(clsMatch ? clsMatch[1] : '');
    const score = parseScore(scoreMatch ? scoreMatch[1] : null);
    const flag = normalizeFlag(flagMatch ? flagMatch[1] : '');
    const revisao = parseRevisao(revisaoMatch ? revisaoMatch[1] : '');
    // Campos obrigatórios (Flag/Revisão inclusos): faltando ou inválidos => pending
    const awaiting = !extracted.valid || flag == null || revisao == null || !classification || score == null ||
      /^\s*AGUARDANDO\s*$/i.test(feedback) || !feedback;

    // T1: integridade dos marcadores comprometida => não confiar nos campos.
    entries.push({
      title,
      flagged,
      ref: refMatch[1],
      classId: p.C, studentId: p.S, unitId: p.U, lessonId: p.L, activityId: p.A,
      classification,
      score,
      flag,
      revisao,
      feedback: awaiting || integrityError ? '' : feedback,
      respostaLida,
      nonceOk,
      pending: awaiting,
      error: integrityError,
    });
  });

  return { nonce, entries };
}

// Parse de vários arquivos devolvidos (lotes). Aceita caminhos ou conteúdo.
function parseReturned(files) {
  const out = [];
  for (const f of files) {
    const text = typeof f === 'string' && /<|#/i.test(f) ? f : fs.readFileSync(f, 'utf8');
    const { nonce, entries } = parseFile(text);
    for (const e of entries) out.push({ ...e, sourceFile: typeof f === 'string' && /<|#/i.test(f) ? null : f });
  }
  return out;
}

// Extrai o relatório da IA (T7): o texto entre <<<RELATORIO e RELATORIO>>>.
// Apenas para consulta — o relatório oficial é o calculado pelo programa.
function extractReport(text) {
  const m = String(text || '').match(/<<<RELATORIO([\s\S]*?)RELATORIO>>>/i);
  return m ? m[1].trim() : null;
}

// T6c: refs que aparecem mais de uma vez nos devolvidos (as DUAS entradas
// vão para revisão). Cada ref completa é uma atividade independente.
function duplicateRefs(entries) {
  const count = {};
  for (const e of entries) if (e.ref) count[e.ref] = (count[e.ref] || 0) + 1;
  return new Set(Object.keys(count).filter(r => count[r] > 1));
}

// Extrai cada bloco de atividade sem depender do nome do arquivo ou da ordem dos lotes.
// Cabeçalhos podem vir com negrito (#### **Atividade: ...**) quando a IA reformata.
const HEADING_RE = /^#{3,5}\s*\*{0,2}\s*Atividade:\s*(.+?)\s*\*{0,2}\s*$/gm;
// Encontra cabeçalhos `#### Atividade:` SOMENTE fora da região da resposta do
// aluno. Texto dentro dos marcadores (mesmo parecendo cabeçalho) é dado.
function findStructuralHeadings(src) {
  const out = [];
  const re = new RegExp(HEADING_RE.source, 'gm');
  let pos = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Determine se este cabeçalho está dentro de uma resposta delimitada.
    const before = src.slice(pos, m.index);
    const starts = [...before.matchAll(/<<<RESPOSTA-INICIO-[0-9a-f]{6,32}>>>/gi)];
    const ends = [...before.matchAll(/<<<RESPOSTA-FIM-[0-9a-f]{6,32}>>>/gi)];
    const lastStart = starts.length ? starts[starts.length - 1].index + pos : -1;
    const lastEnd = ends.length ? ends[ends.length - 1].index + pos + ends[ends.length - 1][0].length : -1;
    if (lastStart > lastEnd) {
      // Dentro de uma resposta: ignora e avança a varredura.
      continue;
    }
    out.push(m);
    pos = m.index + m[0].length;
    re.lastIndex = pos;
  }
  return out;
}

function extractActivityBlocks(text) {
  const src = String(text || '');
  const matches = findStructuralHeadings(src);
  return matches.map((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : src.length;
    let block = src.slice(m.index, end);
    const heading = m[1].trim();
    const refMatch = heading.match(/\[([^\]]*C\d+[^\]]*)\]/);
    const feedbackAt = block.search(/\*\*Feedback:\*\*/i);
    if (feedbackAt >= 0) {
      const rest = block.slice(feedbackAt);
      const separatorAt = rest.search(/\r?\n---(?:\r?\n|$)/);
      if (separatorAt >= 0) block = block.slice(0, feedbackAt + separatorAt);
    }
    return { ref: refMatch ? refMatch[1].trim() : null, block: block.trim() };
  });
}

// Valida texto colado no painel. Aceita um ou vários lotes no mesmo retorno,
// encontra atividades pelas refs e só salva grupos de lote completos.
// IAs gratuitas frequentemente reescrevem `<<<RESPOSTA-INICIO-{nonce}>>>` como
// `<<>>` (ou `<<<>>>`). Restauramos os marcadores usando o nonce que o PROGRAMA
// já conhece da coleta — não é uma credencial da IA. A integridade continua
// garantida pela comparação da resposta com o original em validateEntry().
// IAs gratuitas frequentemente reescrevem os marcadores `<<<RESPOSTA-INICIO/FIM-{nonce}>>>`
// como `<<>>`, `<<<>>>` ou blockquotes (`> >`). O nonce é conhecido pelo
// PROGRAMA (não é uma credencial da IA) e permite restaurar cada marcador
// individualmente, mesmo quando apenas um dos dois foi alterado.
// A restauração é delimitada por atividade: nunca cruza para outra atividade
// e nunca inventa delimitadores em estruturas ambíguas.
const MANGLED_LINE_RE = /^\s*(?:<{2,3}\s*>{2,3}|>{1,3}\s*>{1,3})\s*$/;

function restoreMarkersInBlock(block, startTok, endTok, nonce) {
  // Se este bloco declara explicitamente OUTRO nonce (cabeçalho do lote ou
  // marcador preservado), não restaurar: é lote de outra coleta.
  const declared = block.match(/RESPOSTA-(?:INICIO|FIM)-([0-9a-f]{6,32})/i)
    || block.match(/nonce\s+([0-9a-f]{6,32})/i);
  if (declared && declared[1].toLowerCase() !== nonce) return block;
  const hasStart = block.includes(startTok);
  const hasEnd = block.includes(endTok);
  if (hasStart && hasEnd) return block; // ambos intactos: nada a fazer

  const lines = block.split('\n');
  const idx = [];
  lines.forEach((line, i) => { if (MANGLED_LINE_RE.test(line)) idx.push(i); });

  const need = (hasStart ? 0 : 1) + (hasEnd ? 0 : 1);
  // Estrutura ambígua: não inventar delimitadores.
  if (idx.length !== need) return block;

  const out = lines.slice();
  let k = 0;
  if (!hasStart) out[idx[k++]] = startTok;
  if (!hasEnd) out[idx[k++]] = endTok;

  // Blockquotes: remove o prefixo ">" das linhas entre início e fim.
  const sIdx = out.findIndex(l => l === startTok);
  const eIdx = out.findIndex(l => l === endTok);
  if (sIdx >= 0 && eIdx > sIdx) {
    for (let i = sIdx + 1; i < eIdx; i++) {
      if (/^\s*>/.test(out[i])) out[i] = out[i].replace(/^\s*>\s?/, '').replace(/\\\s*$/, '');
    }
  }
  return out.join('\n');
}

function restoreMangledMarkers(text, nonce) {
  let src = cleanFormatting(text);
  if (!nonce) return src;
  // Segurança: se o documento declara explicitamente OUTRO nonce (comentário
  // de cabeçalho ou marcador preservado), não restaurar — a validação deve
  // rejeitar o retorno como proveniente de outra coleta/conta.
  const declared = extractNonce(src);
  if (declared && declared !== nonce) return src;
  const startTok = answerStart(nonce);
  const endTok = answerEnd(nonce);
  // NÃO usar verificação global "ambos intactos": em retornos com vários
  // lotes, um lote pode estar intacto e outro com marcadores alterados.
  // A decisão é tomada por bloco de atividade em restoreMarkersInBlock().

  const heads = [...src.matchAll(HEADING_RE)];
  const ranges = [];
  if (heads.length) {
    for (let i = 0; i < heads.length; i++) {
      const s = heads[i].index + heads[i][0].length;
      const e = i + 1 < heads.length ? heads[i + 1].index : src.length;
      ranges.push([s, e]);
    }
  } else {
    ranges.push([0, src.length]);
  }

  // De trás para frente para manter os índices válidos.
  let out = src;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [s, e] = ranges[i];
    const bloco = restoreMarkersInBlock(out.slice(s, e), startTok, endTok, nonce);
    out = out.slice(0, s) + bloco + out.slice(e);
  }
  return out;
}

function inspectCombinedReturn(text, collection, alreadyAccepted = []) {
  const src = restoreMangledMarkers(text, collection.nonce);
  const parsed = parseFile(src);
  const entries = parsed.entries || [];
  const blocks = extractActivityBlocks(src);
  const expectedByRef = new Map();
  for (const batch of collection.batches || []) {
    for (const ref of batch.refs || []) {
      if (expectedByRef.has(ref)) {
        return { nonce: parsed.nonce, parsedActivities: entries.length, acceptedBatches: [], rejectedBatches: [], globalIssues: ['a coleta contém refs duplicadas: ' + ref] };
      }
      expectedByRef.set(ref, Number(batch.num));
    }
  }
  const globalIssues = [];
  if (!src.trim()) globalIssues.push('nenhum conteúdo foi colado');
  if (parsed.nonce !== collection.nonce) globalIssues.push('nonce da resposta não corresponde à coleta atual');
  // Todos os nonces declarados no documento devem pertencer à coleta atual.
  const declaredNonces = [...src.matchAll(/nonce\s+([0-9a-f]{6,32})/gi)].map(m => m[1].toLowerCase());
  if (declaredNonces.some(n => n !== collection.nonce))
    globalIssues.push('o documento contém nonce de outra coleta');
  if (!entries.length) globalIssues.push('nenhuma atividade reconhecida no conteúdo');
  if (blocks.length !== entries.length) globalIssues.push('não foi possível separar todos os blocos de atividade');
  const counts = new Map();
  const groups = new Map();
  entries.forEach((entry, i) => {
    if (!entry.ref || !expectedByRef.has(entry.ref)) {
      globalIssues.push('referência ausente ou não pertence à coleta atual: ' + (entry.ref || '(sem ref)'));
      return;
    }
    counts.set(entry.ref, (counts.get(entry.ref) || 0) + 1);
    const num = expectedByRef.get(entry.ref);
    if (!groups.has(num)) groups.set(num, []);
    groups.get(num).push({ entry, block: blocks[i] ? blocks[i].block : '' });
  });
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([ref]) => ref);
  if (duplicates.length) globalIssues.push('referências duplicadas: ' + duplicates.join(', '));
  if (globalIssues.length) {
    return { nonce: parsed.nonce, parsedActivities: entries.length, acceptedBatches: [], rejectedBatches: [], globalIssues };
  }

  const acceptedSet = new Set((alreadyAccepted || []).map(Number));
  const acceptedBatches = [];
  const rejectedBatches = [];
  for (const batch of collection.batches || []) {
    const num = Number(batch.num);
    const group = groups.get(num) || [];
    if (!group.length) continue;
    const found = new Set(group.map(x => x.entry.ref));
    const missing = (batch.refs || []).filter(ref => !found.has(ref));
    const invalid = group.filter(({entry, block}) =>
      !block || entry.error || !entry.nonceOk || entry.pending ||
      !entry.classification || entry.score == null || !entry.flag || !entry.revisao ||
      !entry.feedback || /^AGUARDANDO$/i.test(entry.feedback.trim())
    );
    const reasons = [];
    if (missing.length) reasons.push('faltam ' + missing.length + ' atividade(s) deste lote: ' + missing.join(', '));
    if (invalid.length) {
      const details = invalid.map(({entry, block}) => {
        const missing = [];
        if (!block) missing.push('bloco');
        if (entry.error) missing.push(entry.error);
        if (!entry.nonceOk) missing.push('nonce/marcadores');
        if (entry.pending) missing.push('campos pendentes');
        if (!entry.classification) missing.push('classificação');
        if (entry.score == null) missing.push('score');
        if (!entry.flag) missing.push('flag');
        if (!entry.revisao) missing.push('revisão');
        if (!entry.feedback || /^AGUARDANDO$/i.test(entry.feedback.trim())) missing.push('feedback');
        return (entry.ref || '(sem ref)') + ': ' + missing.join(', ');
      });
      reasons.push(invalid.length + ' atividade(s) com campos incompletos ou marcadores inválidos: ' + details.join('; '));
    }
    if (acceptedSet.has(num)) reasons.push('este lote já foi recebido anteriormente');
    if (!reasons.length) {
      const content = '<!-- CNA CORRETOR - retorno recebido no painel - lote ' + num +
        ' - nonce ' + collection.nonce + ' -->\n\n' +
        group.map(x => x.block).join('\n\n') +
        '\n\n_Fim do lote ' + num + '._\n';
      acceptedBatches.push({ num, activities: group.length, refs: group.map(x => x.entry.ref), content });
    } else {
      rejectedBatches.push({ num, activities: group.length, reasons });
    }
  }
  const receivedBatches = new Set(groups.keys());
  const missingBatches = (collection.batches || []).map(b => Number(b.num)).filter(n => !receivedBatches.has(n));
  return { nonce: parsed.nonce, parsedActivities: entries.length, acceptedBatches, rejectedBatches, missingBatches, globalIssues };
}

// T12: identifica os lotes devolvidos pela coleta atual — nome exato, nonce,
// refs esperadas, refs ausentes/estranhas, arquivos duplicados e lotes ainda
// não devolvidos. `files` aceita { path } ou { name, text } (para testes).
const RETURNED_NAME = /^lote-(\d{2,})(?:\.devolvido)?\.md$/;
function inspectReturnedBatches(files, collection) {
  const expected = new Map((collection.batches || []).map(b => [Number(b.num), b]));
  const out = [];
  const seenNums = new Set();
  const allEntries = [];
  for (const f of files) {
    const name = f.name || path.basename(String(f.path || ''));
    const m = name.match(RETURNED_NAME);
    const num = m ? Number(m[1]) : null;
    const issues = [];
    const text = f.text !== undefined ? f.text : fs.readFileSync(f.path, 'utf8');
    const nonce = extractNonce(text);
    const entries = parseFile(text).entries;
    allEntries.push(...entries);
    if (!m) issues.push(`nome inválido: ${name} (esperado lote-NN.md dentro de retornos-da-IA/)`);
    if (nonce !== collection.nonce) issues.push(`nonce incorreto (${nonce || 'ausente'})`);
    if (num != null && seenNums.has(num)) issues.push(`lote ${num} duplicado`);
    if (num != null) seenNums.add(num);
    const batch = expected.get(num);
    if (num != null && !batch) issues.push(`lote ${num} não pertence à coleta atual`);
    const refs = entries.map(e => e.ref).filter(Boolean);
    const missing = batch ? batch.refs.filter(r => !refs.includes(r)) : [];
    const unexpected = batch ? refs.filter(r => !batch.refs.includes(r)) : refs;
    if (missing.length) issues.push(`refs ausentes: ${missing.join(', ')}`);
    if (unexpected.length) issues.push(`refs de outra atividade no lote: ${unexpected.join(', ')}`);
    out.push({ name, num, nonce, refs, issues, usable: issues.length === 0 });
  }
  const missingBatches = (collection.batches || [])
    .map(b => Number(b.num)).filter(n => !seenNums.has(n));
  return { files: out, missingBatches, duplicateRefs: [...duplicateRefs(allEntries)] };
}

module.exports = { newNonce, answerStart, answerEnd, refOf, loadInject, buildBatches, parseFile, parseReturned, extractNonce, normalizeClassification, parseScore, normalizeFlag, parseRevisao, maskAnswer, extractReport, duplicateRefs, archivePrevious, extractActivityBlocks, inspectCombinedReturn, restoreMangledMarkers, normalizeFieldLabels, extractFields, cleanFormatting, inspectReturnedBatches, RETURNED_NAME };
