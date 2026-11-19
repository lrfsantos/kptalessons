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
function maskAnswer(answer, studentName) {
  let s = String(answer || '');
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]');          // e-mail
  s = s.replace(/(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]?\d{4}/g, '[TELEFONE]'); // BR phone
  s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');       // CPF
  s = s.replace(/https?:\/\/\S+|www\.\S+/g, '[LINK]');               // link
  // nome do aluno (chama ignorando acentos/caixa); SÓ com 3+ letras
  if (studentName) {
    for (const part of String(studentName).split(/\s+/)) {
      if (part.length >= 3) {
        const p = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(new RegExp(p, 'gi'), '[NOME]');
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
  const m = String(v || '').match(/\d{1,3}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
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

  const headingRe = /^#{3,5}\s*Atividade:\s*(.+)$/gm;
  const matches = [...src.matchAll(headingRe)];

  matches.forEach((m, i) => {
    const headingLine = m[1].trim();
    const refMatch = headingLine.match(/\[([^\]]*C\d+[^\]]*)\]/);
    const title = headingLine.replace(/\[[^\]]*\]\s*$/, '').replace(/⚠️\s*ATIVIDADE SINALIZADA.*/i, '').trim();
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : src.length;
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

    // Campos só a partir do texto após o marcador de fim.
    const clsMatch = fieldsBody.match(/\*\*Classificação:\*\*\s*([^\n*]+)/i);
    const scoreMatch = fieldsBody.match(/\*\*Score:\*\*\s*([^\n*]+)/i);
    const flagMatch = fieldsBody.match(/\*\*Flag:\*\*\s*([^\n*]+)/i);
    const revisaoMatch = fieldsBody.match(/\*\*Revisão:\*\*\s*([^\n*]+)/i);

    // T2: feedback cortado na 1ª linha só de traços (---), _Fim do lote ou <<<RELATORIO
    let feedback = '';
    const fbIdx = fieldsBody.search(/\*\*Feedback:\*\*/i);
    if (fbIdx >= 0) {
      let fb = fieldsBody.slice(fbIdx + '**Feedback:**'.length);
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
    const awaiting = flag == null || revisao == null || !classification ||
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
function extractActivityBlocks(text) {
  const src = String(text || '');
  const re = /^#{3,5}\s*Atividade:\s*(.+)$/gm;
  const matches = [...src.matchAll(re)];
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
function inspectCombinedReturn(text, collection, alreadyAccepted = []) {
  const src = String(text || '');
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
    if (invalid.length) reasons.push(invalid.length + ' atividade(s) com campos incompletos ou marcadores inválidos');
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

module.exports = { newNonce, answerStart, answerEnd, refOf, loadInject, buildBatches, parseFile, parseReturned, extractNonce, normalizeClassification, parseScore, normalizeFlag, parseRevisao, maskAnswer, extractReport, duplicateRefs, archivePrevious, extractActivityBlocks, inspectCombinedReturn, inspectReturnedBatches, RETURNED_NAME };
