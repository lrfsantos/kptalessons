// ============================================================
// CNA Corretor — EXECUTOR (aplica as correções da IA)
//
// Lê os retornos aceitos pelo painel (lotes/retornos-da-IA/lote-NN.md),
// valida cada entrada (guard.js), preenche classificação + feedback
// no portal e FINALIZA cada atividade PRONTA (regra absoluta do produto).
// Entradas em revisao.md nunca são preenchidas nem finalizadas.
// appliedRefs só recebe refs com finalização CONFIRMADA no portal.
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
const { validateEntry, normText } = require('./lib/guard');
const CFG = require('./lib/config');

// Padrão: todos os lotes devolvidos na pasta lotes/
function findReturnedFiles() {
  const explicit = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (explicit.length) return explicit;
  if (fs.existsSync(CFG.RETURNS_DIR)) {
    const current = fs.readdirSync(CFG.RETURNS_DIR)
      .filter(f => /^lote-\d{2,}\.md$/i.test(f))
      .map(f => path.join(CFG.RETURNS_DIR, f));
    if (current.length) return current;
  }
  // Compatibilidade com coletas antigas, anteriores ao painel.
  if (!fs.existsSync(CFG.LOTES_DIR)) return [];
  return fs.readdirSync(CFG.LOTES_DIR)
    .filter(f => /^lote-\d{2,}\.devolvido\.md$/i.test(f))
    .map(f => path.join(CFG.LOTES_DIR, f));
}

// Finalização automática é a REGRA ABSOLUTA do produto (decisão do professor):
// cada entrada PRONTA é preenchida, confirmada e FINALIZADA (irreversível).
// Nenhuma opção desliga a finalização. Entradas em revisão nunca são tocadas.
// appliedRefs SÓ recebe uma ref depois da confirmação de finalização no portal.

// Índice answers.json por ref -> dados originais
function indexOriginals(data) {
  const map = new Map();
  for (const c of data.classes || []) for (const s of c.students || []) for (const l of s.lessons || []) {
    if (l.ids) map.set(mdrv.refOf(l.ids), { class: c, student: s, lesson: l });
  }
  return map;
}

(async () => {
  console.log('🚀 CNA Corretor — apply');
  console.log('⚠️  As atividades PRONTAS serão FINALIZADAS automaticamente (ação irreversível).');

  const files = findReturnedFiles();
  if (!files.length) {
    console.error(`❌ Nenhum retorno válido em ${CFG.RETURNS_DIR}. Cole as respostas no Painel de Correção.`);
    process.exit(1);
  }
  if (!fs.existsSync(CFG.ANSWERS_FILE)) {
    console.error('❌ answers.json não existe. Rode primeiro:  npm run scrape');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
  const collection = data.collection;
  if (!collection || !collection.nonce || !Array.isArray(collection.batches)) {
    console.error('❌ answers.json sem identidade de coleta. Rode:  npm run scrape');
    process.exit(1);
  }
  const applied = new Set(data.appliedRefs || []);
  // T12: valida cada devolvido contra a coleta atual antes de qualquer navegação.
  const inspected = mdrv.inspectReturnedBatches(files.map(f => ({ path: f })), collection);
  for (const f of inspected.files) {
    if (f.issues.length) console.log(`⚠️  ${f.name}: ${f.issues.join('; ')}`);
  }
  if (inspected.missingBatches.length)
    console.log(`ℹ️  Lotes ainda não devolvidos: ${inspected.missingBatches.map(n => String(n).padStart(2, '0')).join(', ')}`);
  if (inspected.duplicateRefs.length)
    console.log(`⚠️  Refs duplicadas nos devolvidos: ${inspected.duplicateRefs.join(', ')}`);
  const fileIssues = new Map();
  for (const f of inspected.files) if (f.issues.length) fileIssues.set(f.name, f.issues.join('; '));
  const originals = indexOriginals(data);
  const entries = mdrv.parseReturned(files);
  console.log(`📄 ${entries.length} entrada(s) em ${files.length} arquivo(s).`);

  if (!entries.length) { console.error('⚠️  Nenhuma atividade encontrada nos arquivos.'); process.exit(1); }

  // ---- Validação ANTES de qualquer navegação --------------------
  // T6c: ref duplicada nos devolvidos => as DUAS entradas vão para revisão.
  const dupRefs = mdrv.duplicateRefs(entries);
  const results = [];
  for (const e of entries) {
    const original = originals.get(e.ref);
    const orig = original ? {
      question: original.lesson.question || '',
      answer: original.lesson.answer || '',
      answerMasked: mdrv.maskAnswer(original.lesson.answer, original.student && original.student.name),
    } : null;

    const issuesArquivo = e.sourceFile ? fileIssues.get(path.basename(e.sourceFile)) : null;
    if (issuesArquivo) {
      results.push({ ...e, status: 'REVISAO', reasons: [`lote devolvido inválido: ${issuesArquivo}`] });
      continue;
    }
    if (e.error) {
      results.push({ ...e, status: 'REVISAO', reasons: [e.error] });
      continue;
    }
    if (e.ref && applied.has(e.ref)) {
      results.push({ ...e, status: 'JA_APLICADA', reasons: ['já preenchida/finalizada nesta coleta — não aplicar de novo'] });
      continue;
    }
    if (e.ref && dupRefs.has(e.ref)) {
      results.push({ ...e, status: 'REVISAO', reasons: [`ref ${e.ref} duplicada nos devolvidos`] });
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

  // ---- T7: relatório da IA (só consulta; o oficial é o calculado aqui) ----
  const reports = [];
  for (const f of files) {
    const text = typeof f === 'string' && /<|#/i.test(f) ? f : fs.readFileSync(f, 'utf8');
    const rep = mdrv.extractReport(text);
    if (rep) reports.push(`## ${typeof f === 'string' && /<|#/i.test(f) ? 'colado' : f}\n\n${rep}`);
  }
  if (reports.length) {
    fs.writeFileSync(CFG.RELATORIO_IA_FILE, `# Relatório da IA (somente consulta)\n\n_O relatório oficial é o calculado pelo programa, em report.json/terminal._\n\n` + reports.join('\n\n---\n\n') + '\n');
    console.log(`📝 relatorio-ia.md salvo (relatório da IA — só consulta).`);
  }

  // ---- Preenche no portal --------------------------------------
  const { browser, page } = await launch();
  const filled = [];
  try {
    for (const r of prontas) {
      const url = portal.activityUrl(r.classId, r.studentId, r.unitId, r.lessonId, r.activityId);
      process.stdout.write(`   ${r.ref} ... `);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });

        // T6a: cabeçalho/breadcrumb do portal deve bater com o título guardado
        const origL = originals.get(r.ref) ? originals.get(r.ref).lesson : null;
        const bc = await portal.readBreadcrumb(page);
        if (origL && origL.breadcrumb) {
          // Breadcrumb esperado existe: a leitura PRECISA ser bem-sucedida e bater.
          if (!bc.ok || !bc.title || normText(bc.title) !== normText(origL.breadcrumb)) {
            r.status = 'REVISAO';
            r.reasons = [...(r.reasons || []), `cabeçalho do portal não conferido (atual: "${bc.title || '(ilegível)'}"; esperado: "${origL.breadcrumb}")`];
            console.log(`REVISÃO: cabeçalho não confere`);
            continue;
          }
        }

        // T6b: releia enunciado/resposta da página e compare com o original
        const reread = await portal.readActivity(page);
        const q = origL ? (origL.question || '') : '';
        const a = origL ? (origL.answer || '') : '';
        if (!reread.captured || normText(reread.question) !== normText(q) || normText(reread.answer) !== normText(a)) {
          r.status = 'REVISAO';
          r.reasons = [...(r.reasons || []), 'enunciado/resposta do portal difere do capturado'];
          console.log(`REVISÃO: conteúdo diverge do capturado`);
          continue;
        }

        // 3.2: só reconhece "já corrigida" com EVIDÊNCIA POSITIVA do portal.
        // Status próprio: não é uma finalização feita nesta execução.
        if (await portal.isCorrected(page)) {
          r.status = 'JA_CORRIGIDA';
          r.finalized = true;
          filled.push(r);
          console.log(`já estava CORRIGIDA no portal — registrada como concluída, sem novo clique`);
          continue;
        }

        const res = await portal.fillCorrection(page, r.classification, r.feedback);
        if (res.ok) {
          const fin = await portal.finalize(page);
          if (fin.ok) { r.finalized = true; filled.push(r); console.log(`${r.classification} — FINALIZADA`); }
          else { r.status = 'REVISAO'; r.reasons = [...(r.reasons || []), fin.error]; console.log(`FALHA NA FINALIZAÇÃO: ${fin.error} — não registrada como concluída`); }
        }
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
  // REGRA ABSOLUTA: só entra em appliedRefs quem teve a finalização CONFIRMADA
  // (r.finalized). Nunca gravar refs de preenchidas-sem-finalizar.
  const aplicadas = filled.filter(r => r.finalized && (r.status === 'PRONTA' || r.status === 'JA_CORRIGIDA'));
  const finalizadasAgora = aplicadas.filter(r => r.status === 'PRONTA' && r.finalized);
  const jaCorrigidas = aplicadas.filter(r => r.status === 'JA_CORRIGIDA');
  if (aplicadas.length) {
    data.appliedRefs = [...new Set([...applied, ...aplicadas.map(r => r.ref)])];
    fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify(data, null, 2));
  }
  const falhasFinalizacao = results.filter(r => /finalização|Finalizar|corrigida/i.test((r.reasons || []).join(' ')) && r.status === 'REVISAO').length;
  const stat = n => results.filter(r => r.status === 'PRONTA').length;
  const stats = {
    geradoEm: new Date().toISOString(),
    totalEntradas: results.length,
    prontas: stat(),
    preenchidasNoPortal: filled.filter(r => r.status === 'PRONTA').length,
    jaAplicadasAntes: results.filter(r => r.status === 'JA_APLICADA').length,
    finalizarAtivado: true,
    finalizadasNestaExecucao: finalizadasAgora.length,
    jaCorrigidasNoPortal: jaCorrigidas.length,
    falhasFinalizacao,
    notaPedidoProfessor: 'Finalização automática obrigatória (decisão do professor): só entram em appliedRefs as atividades com finalização CONFIRMADA no portal.',
    revisaoManual: results.filter(r => r.status === 'REVISAO').length,
    lotesNaoDevolvidos: inspected.missingBatches.map(n => String(n).padStart(2, '0')),
    jaCorrigidas: jaCorrigidas.length,
    incoerentes: results.filter(r => /incoerente|Flag\b|marcou revis/.test((r.reasons || []).join(' '))).length,
    mediaScore: aplicadas.length ? Math.round(aplicadas.reduce((a, r) => a + (r.score || 0), 0) / aplicadas.length) : null,
    porClassificacao: aplicadas.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] || 0) + 1; return acc; }, {}),
    porFlag: aplicadas.reduce((acc, r) => { const k = r.flag || 'NENHUM'; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
  };
  fs.writeFileSync(CFG.REPORT_FILE, JSON.stringify({ stats, results: results.map(({ respostaLida, feedback, ...rest }) => ({ ...rest, feedbackLength: (feedback || '').length })), aplicadas: aplicadas.map(r => r.ref) }, null, 2));

  // ---- Tela de revisão --------
  const rev = results.filter(r => r.status === 'REVISAO');
  let revisao = '# Revisão manual necessária\n\n';
  revisao += '_O programa finaliza automaticamente as atividades PRONTAS. As entradas abaixo NÃO foram preenchidas nem finalizadas — exigem atenção manual._\n\n';
  if (!rev.length) revisao += '_Nenhuma revisão pendente. Todas as entradas válidas foram preenchidas e finalizadas._\n';
  if (inspected.missingBatches.length)
    revisao += `- Lotes ainda não devolvidos nesta coleta: ${inspected.missingBatches.map(n => String(n).padStart(2, '0')).join(', ')}\n\n`;
  for (const r of rev) {
    revisao += `## ${r.title || '(sem título)'} [${r.ref || 'sem ref'}]\n\n`;
    revisao += `- Fonte: ${r.sourceFile || '(entrada colada)'}\n`;
    revisao += `- Motivo(s): ${(r.reasons || []).join('; ')}\n`;
    revisao += `- Classificação devolvida: ${r.classification || '(vazia)'}${r.score != null ? ` | Score: ${r.score}` : ''}\n\n`;
  }
  fs.writeFileSync(CFG.REVISAO_FILE, revisao);

  console.log('\n' + '='.repeat(48));
  console.log('📊 RELATÓRIO (calculado pelo programa, não pela IA)');
  console.log('='.repeat(48));
  console.log(`  Total de entradas        : ${stats.totalEntradas}`);
  console.log(`  Preenchidas no portal    : ${stats.preenchidasNoPortal}`);
  console.log(`  FINALIZADAS nesta execução: ${stats.finalizadasNestaExecucao}`);
  console.log(`  Já corrigidas no portal  : ${stats.jaCorrigidasNoPortal} (sem novo clique)`);
  console.log(`  Em revisão manual        : ${stats.revisaoManual}`);
  if (stats.falhasFinalizacao) console.log(`  Falhas de finalização    : ${stats.falhasFinalizacao} (NÃO registradas como concluídas)`);
  if (stats.jaAplicadasAntes) console.log(`  Já aplicadas (ignoradas) : ${stats.jaAplicadasAntes}`);
  if (stats.lotesNaoDevolvidos.length) console.log(`  Lotes não devolvidos     : ${stats.lotesNaoDevolvidos.join(', ')}`);
  console.log(`  Média de score           : ${stats.mediaScore ?? '—'}`);
  console.log(`  Por classificação        : ` + (Object.entries(stats.porClassificacao).map(([k, v]) => `${k}=${v}`).join(' | ') || '—'));
  console.log(`  Por flag (devolvido)     : ` + (Object.entries(stats.porFlag).map(([k, v]) => `${k}=${v}`).join(' | ') || '—'));
  if (stats.jaCorrigidas) console.log(`  Já corrigidas no portal  : ${stats.jaCorrigidas}`);
  if (stats.incoerentes) console.log(`  Incoerências detectadas : ${stats.incoerentes}`);

  console.log('💾 report.json e revisao.md gerados.');
  console.log('👉 Finalização automática: as PRONTAS foram finalizadas no portal.');
  console.log('   Entradas em revisao.md ou com falha de finalização NÃO foram registradas como concluídas —');
  console.log('   a coleta e os lotes foram preservados para nova tentativa.');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
