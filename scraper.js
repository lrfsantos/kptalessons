// ============================================================
// CNA Corretor — SCRAPER (exporta as atividades escritas)
//
// Navega o portal do professor DE FORMA INDEPENDENTE e gera:
//   answers.json              -> dados estruturados (uso do executor)
//   lotes/lote-NN.md          -> documentos para a IA corrigir
//                                (INJECT + nonce no topo de cada lote)
//
// Uso:
//   npm run scrape            (lotes de 8 atividades)
//   npm run scrape -- --lote 5 --all
// Requer: session.json (rode `npm run login` antes).
// ============================================================
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const md = require('./lib/md');
const { preFilter } = require('./lib/guard');
const CFG = require('./lib/config');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const onlyPending = !process.argv.includes('--all');
const loteSize = parseInt(arg('lote', String(CFG.LOTE_SIZE || 8)), 10) || 8;

(async () => {
  console.log('🚀 CNA Corretor — scrape (coleta de atividades escritas)');

  if (!fs.existsSync(CFG.STATE_FILE)) {
    console.error('❌ Sessão não encontrada. Rode primeiro:  npm run login');
    process.exit(1);
  }

  const { browser, page } = await launch({ headless: CFG.HEADLESS === true });
  const classes = [];

  try {
    // 1. Turmas
    await page.goto(portal.CLASSES_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(portal.SEL.classLink, { timeout: CFG.NAV_TIMEOUT });
    const allClasses = await portal.listClasses(page);
    const withPending = onlyPending ? allClasses.filter(c => c.pending > 0) : allClasses;
    console.log(`🏫 ${allClasses.length} turma(s); ${withPending.length} com pendências.`);

    // 2. Alunos e lições de cada turma
    for (const c of withPending) {
      const turma = { name: c.name, level: c.level, shift: c.shift, classId: c.classId, students: [] };
      const students = await portal.listStudents(page, c.classId, { onlyPending });
      console.log(`   Turma ${c.name}: ${students.length} aluno(s) com pendências.`);

      for (const s of students) {
        const lessons = await portal.listLessons(page, c.classId, s.studentId);
        const pendentes = lessons.filter(l => l.status === 'A CORRIGIR' && l.ids);

        const aluno = {
          name: s.name, studentId: s.studentId, pending: s.pending,
          lessons: lessons.map(l => ({
            title: l.title.replace(/^.*?(?=(Unit|Welcome|Skills|Lesson))/, '').trim() || l.title,
            unit: l.unit, pending: l.status === 'A CORRIGIR', ids: l.ids,
          })),
        };

        // 3. Lê enunciado + resposta de cada pendente
        for (const l of pendentes) {
          await page.goto(portal.activityUrl(l.ids.classId, l.ids.studentId, l.ids.unitId, l.ids.lessonId, l.ids.activityId), { waitUntil: 'domcontentloaded' });
          const data = await portal.readActivity(page);
          l.question = data.question;
          l.answer = data.answer;
          l.prefilter = preFilter(data.answer); // (b) pré-filtro de injeção
        }
        turma.students.push(aluno);
      }
      classes.push(turma);
    }

    if (!classes.length) {
      console.log('✅ Nenhuma pendência encontrada. Nada a exportar.');
      return;
    }

    // 4. Salva dados estruturados
    fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), classes }, null, 2));
    console.log(`💾 answers.json (${classes.reduce((a, c) => a + c.students.length, 0)} aluno(s)).`);

    // 5. Gera os lotes MD (nonce novo + INJECT em cada lote)
    const { nonce, files, total } = md.buildBatches(classes, { loteSize });
    console.log(`📄 ${files.length} lote(s) com ${total} atividade(s) em ${path.join(CFG.ROOT, 'lotes')}${path.sep} (nonce ${nonce}).`);
    console.log('\n👉 Próximos passos:');
    console.log('   1. Abra os arquivos de lotes/, cole o conteúdo na sua IA e devolva');
    console.log('      cada um como lote-NN.devolvido.md na mesma pasta.');
    console.log('   2. Rode:  npm run apply');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
