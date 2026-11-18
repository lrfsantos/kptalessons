// ============================================================
// CNA Corretor — EXECUTOR (aplica as correções da IA)
//
// Lê os lotes devolvidos pela IA (lotes/lote-NN.devolvido.md),
// valida cada entrada (guard.js) e preenche classificação + feedback
// no portal. NUNCA clica em Finalizar — o professor revisa no portal
// e finaliza manualmente (ação irreversível).
//
// Gera:
//   report.json  -> resultado por atividade + estatísticas calculadas aqui
//   revisao.md   -> entradas que exigem atenção manual (tela de revisão)
//
// Uso:
//   npm run apply
//   npm run apply -- lotes/lote-01.devolvido.md   (arquivos específicos)
// ============================================================
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const mdrv = require('./lib/md');
const { validateEntry } = require('./lib/guard');
const CFG = require('./lib/config');

// Padrão: todos os lotes devolvidos na pasta lotes/
function findReturnedFiles() {
  const explicit = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (explicit.length) return explicit;
  if (!fs.existsSync(CFG.LOTES_DIR)) return [];
  return fs.readdirSync(CFG.LOTES_DIR)
    .filter(f => /\.devolvido\.md$/i.test(f))
    .map(f => path.join(CFG.LOTES_DIR, f));
}

// Índice answers.json por ref -> dados originais
function indexOriginals(data) {
  const map = new Map();
  for (const c of data.classes || []) for (const s of c.students || []) for (const l of s.lessons || []) {
    if (l.ids) map.set(mdrv.refOf(l.ids), { class: c, student: s, lesson: l });
  }
  return map;
}

(async () => {
  console.log('🚀 CNA Corretor — apply (preenche correções; NÃO finaliza)');

  const files = findReturnedFiles();
  if (!files.length) {
    console.error(`❌ Nenhum arquivo *.devolvido.md em ${CFG.LOTES_DIR}. Devolva os lotes corrigidos pela IA.`);
    process.exit(1);
  }
  if (!fs.existsSync(CFG.ANSWERS_FILE)) {
    console.error('❌ answers.json não existe. Rode primeiro:  npm run scrape');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
  const originals = indexOriginals(data);
  const entries = mdrv.parseReturned(files);
  console.log(`📄 ${entries.length} entrada(s) em ${files.length} arquivo(s).`);

  if (!entries.length) { console.error('⚠️  Nenhuma atividade encontrada nos arquivos.'); process.exit(1); }

  // ---- Validação ANTES de qualquer navegação --------------------
  const results = [];
  for (const e of entries) {
    const original = originals.get(e.ref);
    const orig = original ? {
      question: original.lesson.question || '',
      answer: original.lesson.answer || '',
    } : null;

    if (e.error) {
      results.push({ ...e, status: 'REVISAO', reasons: [e.error] });
      continue;
    }
    if (e.pending) {
      results.push({ ...e, status: 'REVISAO', reasons: ['IA não preencheu classificação/feedback'] });
      continue;
    }
    const v = validateEntry({ ...e, prefilter: original ? original.lesson.prefilter : null, pergunta: original ? orig.question : e.pergunta, respostaLida: e.respostaLida }, orig);
    // nota: se respostaLida é null (nonce ausente), validateEntry detecta a diferença
    results.push({
      ...e,
      status: v.review ? 'REVISAO' : 'PRONTA',
      reasons: v.reasons,
    });
  }

  const prontas = results.filter(r => r.status === 'PRONTA');
  console.log(`✅ ${prontas.length} pronta(s) para preencher; ${results.length - prontas.length} para revisão manual.`);

  // ---- Preenche no portal --------------------------------------
  const { browser, page } = await launch();
  const filled = [];
  try {
    for (const r of prontas) {
      const url = portal.activityUrl(r.classId, r.studentId, r.unitId, r.lessonId, r.activityId);
      process.stdout.write(`   ${r.ref} ... `);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
        const res = await portal.fillCorrection(page, r.classification, r.feedback);
        if (res.ok) { filled.push(r); console.log(`preenchida (${r.classification}, score ${r.score}) — aguardando Finalizar do professor`); }
        else { r.status = 'REVISAO'; r.reasons = [...(r.reasons || []), res.error]; console.log(`FALHOU: ${res.error}`); }
      } catch (err) {
        r.status = 'REVISAO'; r.reasons = [...(r.reasons || []), 'erro de navegação: ' + err.message];
        console.log(`ERRO: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // ---- Relatório (médias/contagens SEMPRE calculadas aqui) ------
  const aplicadas = filled.filter(r => r.status === 'PRONTA');
  const stats = {
    geradoEm: new Date().toISOString(),
    totalEntradas: results.length,
    prontas: results.filter(r => r.status === 'PRONTA').length,
    preenchidasNoPortal: aplicadas.length,
    revisaoManual: results.filter(r => r.status === 'REVISAO').length,
    jaCorrigidas: results.filter(r => /já está corrigida/.test((r.reasons || []).join(' '))).length,
    mediaScore: aplicadas.length ? Math.round(aplicadas.reduce((a, r) => a + (r.score || 0), 0) / aplicadas.length) : null,
    porClassificacao: aplicadas.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] || 0) + 1; return acc; }, {}),
  };
  fs.writeFileSync(CFG.REPORT_FILE, JSON.stringify({ stats, results: results.map(({ respostaLida, feedback, ...rest }) => ({ ...rest, feedbackLength: (feedback || '').length })), aplicadas: aplicadas.map(r => r.ref) }, null, 2));

  // ---- Tela de revisão (nada é finalizado pelo programa) --------
  const rev = results.filter(r => r.status === 'REVISAO');
  let revisao = '# Revisão manual necessária\n\n';
  revisao += '_O programa NUNCA finaliza atividades. Revise cada caso abaixo no portal e finalize você mesmo(a)._\n\n';
  if (!rev.length) revisao += '_Nenhuma. Todas as entradas válidas foram preenchidas._\n';
  for (const r of rev) {
    revisao += `## ${r.title || '(sem título)'} [${r.ref || 'sem ref'}]\n\n`;
    revisao += `- Fonte: ${r.sourceFile || '(entrada colada)'}\n`;
    revisao += `- Motivo(s): ${(r.reasons || []).join('; ')}\n`;
    revisao += `- Classificação devolvida: ${r.classification || '(vazia)'}${r.score != null ? ` | Score: ${r.score}` : ''}\n\n`;
  }
  fs.writeFileSync(CFG.REVISAO_FILE, revisao);

  console.log(`\n📊 ${stats.preenchidasNoPortal} preenchida(s) | ${stats.revisaoManual} em revisão | média ${stats.mediaScore ?? '—'}`);
  console.log('💾 report.json e revisao.md gerados.');
  console.log('👉 Abra o portal, revise as lições preenchidas e clique em Finalizar em cada uma.');
  console.log('   (Reveja também revisao.md antes de finalizar.)');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
