// ============================================================
// CNA Corretor — SCRAPER (exporta as atividades escritas)
//
// Navega o portal do professor DE FORMA INDEPENDENTE e gera:
//   answers.json              -> dados estruturados (uso do executor)
//   lotes/lote-NN.md          -> documentos para a IA corrigir
//                                (INJECT + nonce no topo de cada lote)
//
// Atividades que falham na captura NÃO entram no MD: são
// registradas como capture_failed, avisadas no terminal com
// turma/aluno/ref e contadas no final. Resposta realmente em
// branco (página carregou e o campo está vazio) É capturada como
// "em branco" e entra normalmente.
//
// Uso:
//   npm run scrape            (lotes de 8 atividades)
//   npm run scrape -- --lote 5 --all
// Requer: login manual nesta execução (o wizard faz antes de coletar).
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
const loteSize = parseInt(arg('lote', String(CFG.LOTE_SIZE || 10)), 10) || 10;

(async () => {
  console.log('🚀 CNA Corretor — scrape (coleta de atividades escritas)');

  // A autenticação vem da sessão TEMPORÁRIA desta execução (criada pelo login).
  // Não existe mais session.json: o wizard sempre faz login antes de coletar.
  const { browser, page } = await launch({ headless: CFG.HEADLESS === true });
  const classes = [];
  const captureFailures = []; // { ref, turma, aluno, title }
  const blanks = [];          // respostas realmente em branco (informativo)

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

        // IMPORTANTE: monta a lista e CAPTURA no mesmo objeto que vai para o MD.
        // (Bug real antigo: a captura gravava em objetos que eram descartados
        //  e o MD saía com "(não capturado)"/"(vazia)".)
        const alunoLessons = [];
        for (const l of lessons) {
          const entry = {
            title: l.title.replace(/^.*?(?=(Unit|Welcome|Skills|Lesson))/, '').trim() || l.title,
            unit: l.unit,
            pending: l.status === 'A CORRIGIR',
            ids: l.ids,
          };

          if (entry.pending && entry.ids) {
            await page.goto(
              portal.activityUrl(entry.ids.classId, entry.ids.studentId, entry.ids.unitId, entry.ids.lessonId, entry.ids.activityId),
              { waitUntil: 'domcontentloaded' }
            );
            const d = await portal.readActivity(page);
            if (!d.captured) {
              entry.pending = false;          // não vai para o MD
              entry.capture_failed = true;
              captureFailures.push({ ref: md.refOf(entry.ids), turma: c.name, aluno: s.name, title: entry.title });
              console.warn(`⚠️  Falha de captura: ${c.name} → ${s.name} → ${entry.title} [${md.refOf(entry.ids)}]`);
            } else {
              entry.question = d.question;
              entry.answer = d.answer;
              entry.blank = d.blank;
              entry.prefilter = preFilter(d.answer); // (b) pré-filtro de injeção
              // (T6a) título do breadcrumb no portal — comparado antes de preencher
              const bc = await portal.readBreadcrumb(page);
              entry.breadcrumb = bc.ok ? bc.title : '';
              if (d.blank) blanks.push(md.refOf(entry.ids));
            }
          }
          alunoLessons.push(entry);
        }
        turma.students.push({ name: s.name, studentId: s.studentId, pending: s.pending, lessons: alunoLessons });
      }
      classes.push(turma);
    }

    // 3. Resumo de captura
    console.log('');
    if (captureFailures.length) {
      console.log(`⚠️  NÃO capturadas (${captureFailures.length}):`);
      for (const f of captureFailures) console.log(`     ${f.ref}  ${f.turma} → ${f.aluno} → ${f.title}`);
    } else {
      console.log('✅ Todas as atividades pendentes foram capturadas.');
    }
    if (blanks.length) console.log(`ℹ️  ${blanks.length} resposta(s) realmente em branco (foram incluídas): ${blanks.join('; ')}`);

    const pendentes = classes.reduce((a, c) => a + c.students.reduce((b, s) => b + s.lessons.filter(l => l.pending).length, 0), 0);
    if (!pendentes) {
      console.log('\n✅ Nenhuma pendência capturada. Nada a exportar.');
      console.log('   Se uma coleta anterior estava incompleta, seus lotes foram preservados.');
      return;
    }

    // 4. Gera os lotes MD (nonce novo + INJECT em cada lote) e salva a
    //    identidade da coleta junto com os dados estruturados (T12).
    const { nonce, files, total } = md.buildBatches(classes, { loteSize });
    const generatedAt = new Date().toISOString();
    const collection = {
      id: generatedAt,
      nonce,
      batches: files.map(f => ({ num: f.num, name: f.name, refs: f.refs, total: f.entries })),
    };
    fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify({
      generatedAt, collection, captureFailures, classes, appliedRefs: [],
    }, null, 2));
    console.log(`💾 answers.json (${classes.reduce((a, c) => a + c.students.length, 0)} aluno(s); ${pendentes} pendência(s)).`);
    console.log(`📄 ${files.length} lote(s) com ${total} atividade(s) em ${path.join(CFG.ROOT, 'lotes')}${path.sep} (nonce ${nonce}).`);
    if (captureFailures.length) {
      console.log(`\n👉 As ${captureFailures.length} atividade(s) não capturadas ficaram de fora do MD.`);
      console.log('   Depois de corrigir o problema, rode o scrape de novo.');
    }
    console.log('\n👉 Próximos passos:');
    console.log('   1. Abra os arquivos de lotes/, cole o conteúdo na sua IA e devolva');
    console.log('      cada um como lote-NN.devolvido.md na mesma pasta.');
    console.log('   2. Rode:  npm run apply');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
