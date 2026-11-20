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
//   npm run scrape            (até 10 atividades por lote)
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

function archivePreviousRun() {
  fs.mkdirSync(CFG.LOTES_DIR, { recursive: true });
  const existing = fs.readdirSync(CFG.LOTES_DIR)
    .some(f => /^lote-\d+\.md$|^lote-\d+\.devolvido\.md$|^historico-/.test(f)) ||
    fs.existsSync(CFG.ANSWERS_FILE);
  if (!existing) return false;
  const stamp = Date.now();
  const historyDir = path.join(CFG.LOTES_DIR, 'historico-run-' + stamp);
  const dataFiles = [
    CFG.ANSWERS_FILE, CFG.REPORT_FILE, CFG.REVISAO_FILE,
    CFG.RELATORIO_IA_FILE, CFG.RESUMO_FILE, CFG.ALL_ANSWERS_FILE,
  ].filter(file => fs.existsSync(file));
  if (dataFiles.length) {
    fs.mkdirSync(historyDir, { recursive: true });
    for (const file of dataFiles) {
      const destination = path.join(historyDir, path.basename(file));
      fs.renameSync(file, destination);
    }
  }
  md.archivePrevious(CFG.LOTES_DIR);
  return true;
}

(async () => {
  console.log('🚀 CNA Corretor — scrape (coleta de atividades escritas)');

  // Cada login pertence a uma única execução/professor. Arquive tudo da execução anterior
  // antes de coletar, evitando que answers.json ou lotes de outra conta sejam reutilizados.
  const archived = archivePreviousRun();
  if (archived) console.log('📦 Execução anterior arquivada (documentos preservados). Iniciando coleta nova.\n');
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
        if (lessons.listError) {
          // Pendências segundo o portal, mas a lista não pôde ser enumerada.
          captureFailures.push({
            turma: c.name, aluno: s.name, alunoId: s.studentId, turmaId: c.classId,
            stage: 'listLessons', reason: lessons.listError,
          });
          console.warn(`⚠️  Falha ao listar lições: ${c.name} → ${s.name}: ${lessons.listError}`);
          turma.students.push({ name: s.name, studentId: s.studentId, pending: s.pending, lessons: [] });
          continue;
        }

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
            try {
              await page.goto(
                portal.activityUrl(entry.ids.classId, entry.ids.studentId, entry.ids.unitId, entry.ids.lessonId, entry.ids.activityId),
                { waitUntil: 'domcontentloaded' }
              );
              const d = await portal.readActivity(page);
              if (!d.captured) {
                entry.pending = false;          // não vai para o MD
                entry.capture_failed = true;
                captureFailures.push({ ref: md.refOf(entry.ids), turma: c.name, aluno: s.name,
                  title: entry.title, stage: 'readActivity', reason: 'enunciado/resposta não carregaram' });
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
            } catch (err) {
              entry.pending = false;
              entry.capture_failed = true;
              captureFailures.push({ ref: md.refOf(entry.ids), turma: c.name, aluno: s.name,
                title: entry.title, stage: 'navegação', reason: err.message });
              console.warn(`⚠️  Falha isolada: ${c.name} → ${s.name} → ${entry.title}: ${err.message}`);
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
    const capturadas = classes.reduce((a, c) => a + c.students.reduce((b, s) => b + s.lessons.filter(l => l.pending && !l.capture_failed).length, 0), 0);
    const generatedAt = new Date().toISOString();
    if (!pendentes && !captureFailures.length) {
      // Caso A: nada pendente de verdade.
      fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify({ generatedAt, collection: null, captureFailures: [], classes, appliedRefs: [] }, null, 2));
      console.log('\n✅ Nenhuma atividade pendente. Nada a corrigir.');
      return;
    }
    if (!capturadas) {
      // Caso C: havia trabalho, mas nada pôde ser capturado.
      fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify({ generatedAt, collection: null, captureFailures, classes, appliedRefs: [], captureFailed: true }, null, 2));
      console.error(`\n❌ Havia ${captureFailures.length} atividade(s)/aluno(s) pendente(s), mas nenhuma pôde ser capturada.`);
      console.error('   O diagnóstico ficou em answers.json (captureFailures). Nenhum lote foi gerado.');
      process.exit(2);
    }
    // Caso B: captura parcial — processa o que deu certo e reporta o resto.

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
    console.log('   No fluxo completo (npm run corrigir), o Painel Local abre automaticamente.');
    console.log('   Copie um lote ou todos, envie à IA e cole o retorno no painel.');
    console.log('   Não é necessário criar, salvar ou renomear arquivos devolvidos.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
