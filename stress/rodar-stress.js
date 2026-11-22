// ============================================================
// CNA Corretor — STRESS TEST do fluxo completo (uso local apenas).
// Portal falso em 127.0.0.1 com centenas de atividades fictícias
// (100% texto, sem mídia). Roda o fluxo REAL do programa:
//   captura (scraper) → lotes → painel → retorno simulado da IA →
//   aplicação + finalização (executor) no portal falso.
// NUNCA toca no portal real. Dados 100% fictícios.
//
// Uso:  node stress/rodar-stress.js [--turmas 4] [--alunos 13] [--ativ 10]
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./mock-portal');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// O portal falso usa porta FIXA e o env precisa existir ANTES de os módulos
// lerem a config (scraper/executor capturam as URLs no require).
const PORTA = parseInt(arg('porta', '8899'), 10);
process.env.CNA_PORTAL_URL = `http://127.0.0.1:${PORTA}`;

const CFG = require('../lib/config');
const { collectActivities } = require('../scraper');
const { createPanel } = require('../lib/panel');
const { applyAcceptedCorrections } = require('../executor');
const md = require('../lib/md');
const { chromium } = require('playwright-core');

const TURMAS = parseInt(arg('turmas', '4'), 10);
const ALUNOS = parseInt(arg('alunos', '13'), 10);
const ATIVS = parseInt(arg('ativ', '10'), 10);

// BFCache acumula páginas mortas na memória (crash com centenas de
// navegações); dev-shm evita pressão de memória compartilhada.
async function abrirNavegador() {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: String(arg('headless', 'false')) === 'true', // headless do Edge morre em pontos aleatórios; headful sobreviveu às 520
    args: ['--disable-back-forward-cache', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(CFG.NAV_TIMEOUT);
  browser.on('disconnected', () => {
    const p = typeof browser.process === 'function' ? browser.process() : null;
    const saida = p ? `exitCode=${p.exitCode} signal=${p.signalCode} killed=${p.killed}` : 'sem processo';
    console.log(`⚡ BROWSER DISCONNECTED (${saida})`);
  });
  page.on('crash', () => console.log('⚡ PAGE CRASH'));
  return { browser, page };
}

// Retorno simulado da IA: mantém o lote byte a byte e substitui os 5 campos
// AGUARDANDO de cada atividade (ordem fixa do bloco). Triagem fictícia:
// injeção/IA/gibberish → INCORRETO + Score 0 + Flag; português/vazio →
// INCORRETO; resto alterna CORRETO/PARCIAL. 1 a cada 50 atividades vai para
// revisão manual (Revisão: SIM) para exercitar esse caminho em escala.
// contador global do retorno fictício (para o relatório de stress)
const devolverStats = { sim: 0 };

function devolverLote(caminhoLote) {
  const lote = fs.readFileSync(caminhoLote, 'utf8');
  const numLote = parseInt(path.basename(caminhoLote).match(/lote-(\d+)/)[1], 10);
  const respostas = lote.match(/<<<RESPOSTA-INICIO[^>]*>>>\n([\s\S]*?)\n<<<RESPOSTA-FIM/g) || [];
  const blocos = lote.match(/\*\*Classificação:\*\* AGUARDANDO\n\n\*\*Score:\*\* AGUARDANDO\n\n\*\*Flag:\*\* AGUARDANDO\n\n\*\*Revisão:\*\* AGUARDANDO\n\n\*\*Feedback:\*\*\nAGUARDANDO/g) || [];
  if (blocos.length !== 10) throw new Error(`${path.basename(caminhoLote)}: ${blocos.length} blocos AGUARDANDO (esperado 10)`);
  let idx = -1;
  return lote.replace(/\*\*Classificação:\*\* AGUARDANDO\n\n\*\*Score:\*\* AGUARDANDO\n\n\*\*Flag:\*\* AGUARDANDO\n\n\*\*Revisão:\*\* AGUARDANDO\n\n\*\*Feedback:\*\*\nAGUARDANDO/g, () => {
    idx++;
    // texto da resposta DESTE bloco (dentro do próprio lote)
    const texto = (respostas[idx] || '').replace(/^<<<RESPOSTA-INICIO[^>]*>>>\n/, '').replace(/\n<<<RESPOSTA-FIM>$/, '');
    const vazia = texto.trim() === '(vazia)';
    const portugues = /[çãáéíóúâêôõ]|eu |minha |não /i.test(texto);
    const injecao = /ignore previous/i.test(texto);
    const ia = /here is the answer/i.test(texto);
    const gibberish = /asdfgh/i.test(texto);
    let cls = 'CORRETO', score = 88, flag = 'NENHUM', revisao = 'NAO';
    if (idx % 2 === 1 && !vazia && !portugues && !injecao && !ia && !gibberish) { cls = 'PARCIAL'; score = 62; }
    if (vazia || portugues) { cls = 'INCORRETO'; score = vazia ? 0 : 20; }
    if (injecao) { cls = 'INCORRETO'; score = 0; flag = 'INJECAO'; }
    if (ia) { cls = 'INCORRETO'; score = 0; flag = 'IA'; }
    if (gibberish) { cls = 'INCORRETO'; score = 0; flag = 'GIBBERISH'; }
    if (flag !== 'NENHUM') revisao = 'SIM'; // regra T5b do guard: Flag exige Revisão SIM
    if (revisao === 'SIM') devolverStats.sim++;
    const feedback = vazia
      ? 'Your answer was empty. Please complete the task and resubmit it.'
      : 'You addressed the task. Check the spelling and keep writing complete sentences.';
    return `**Classificação:** ${cls}\n\n**Score:** ${score}\n\n**Flag:** ${flag}\n\n**Revisão:** ${revisao}\n\n**Feedback:**\n${feedback}`;
  });
}

(async () => {
  const t0 = Date.now();
  const mem = () => process.memoryUsage().rss / 1e6;

  // 1. Portal falso local (mesmo DOM do CNA), porta fixa.
  const portal = await mock.start({ classes: TURMAS, studentsPerClass: ALUNOS, actsPerStudent: ATIVS, port: PORTA });
  console.log(`🧪 Portal falso: http://127.0.0.1:${PORTA} (${portal.total} atividades fictícias)`);

  // 2. RUN_DIR próprio (como o orquestrador faz em produção).
  const RUN_DIR = path.join(os.tmpdir(), `cna-stress-run-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(RUN_DIR, 'lotes'), { recursive: true });
  for (const [chave, nome] of Object.entries({
    ANSWERS_FILE: 'answers.json', REPORT_FILE: 'report.json', REVISAO_FILE: 'revisao.md',
    RELATORIO_IA_FILE: 'relatorio-ia.md', LOTES_DIR: 'lotes', RETURNS_DIR: 'lotes/retornos-da-IA',
  })) CFG[chave] = path.join(RUN_DIR, nome);

  let navegador = null;
  let painel = null;
  const fecharNavegador = async () => { if (navegador) { await navegador.browser.close().catch(() => {}); navegador = null; } };

  try {
    // 3. Captura com o scraper REAL, UMA TURMA POR NAVEGADOR (o msedge lançado
    //    morre em pontos aleatórios em sessões longas; 130 navegações/turma
    //    estão bem dentro do que ele aguenta — repro mínimo: 520 gotos OK).
    const tColeta = Date.now();
    const classes = [];
    const falhas = [];
    let capturadas = 0;
    for (let c = 1; c <= TURMAS; c++) {
      portal.setFiltro(c);
      let parcial = null;
      for (let tent = 1; tent <= 5 && !parcial; tent++) {
        try {
          navegador = await abrirNavegador();
          const coleta = await collectActivities({ page: navegador.page, onProgress: () => {} });
          if (coleta.status !== 'OK') throw new Error(coleta.status);
          parcial = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
          falhas.push(...coleta.captureFailures);
          capturadas += coleta.capturadas;
        } catch (e) {
          console.warn(`⚠️ turma ${c}, tentativa ${tent}: ${e.message.slice(0, 100)}`);
          parcial = null;
        }
        await fecharNavegador();
      }
      if (!parcial) throw new Error(`turma ${c} não convergiu em 5 tentativas`);
      classes.push(...parcial.classes);
      console.log(`   turma ${c}/${TURMAS}: ${parcial.classes.reduce((a, t) => a + t.students.length, 0)} aluno(s) capturados`);
    }
    portal.setFiltro(null);
    const coletaMs = Date.now() - tColeta;
    console.log(`📄 Captura: ${capturadas} capturadas | ${coletaMs} ms | RSS ${Math.round(mem())} MB`);
    if (!classes.length) {
      console.error(`❌ Captura não produziu coleção. Falhas: ${falhas.length}`);
      process.exitCode = 1;
      return;
    }
    // Reconstroi answers.json + lotes com as turmas mescladas (mesmo
    // formato que o scraper grava — executor e painel consomem isso).
    const { nonce, files, total: totalLote } = md.buildBatches(classes, { loteSize: 10, outDir: CFG.LOTES_DIR });
    const collection = { id: new Date().toISOString(), nonce, batches: files.map(f => ({ num: f.num, name: f.name, refs: f.refs, total: f.entries })) };
    fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify({ generatedAt: collection.id, collection, captureFailures: falhas, classes, appliedRefs: [] }, null, 2));
    console.log(`📄 ${files.length} lote(s) com ${totalLote} atividade(s) mescladas.`);

    // 4. Painel REAL com os lotes da coleta; retorno simulado lote a lote.
    const tPainel = Date.now();
    painel = await createPanel({ collection, lotesDir: CFG.LOTES_DIR, returnsDir: CFG.RETURNS_DIR });
    let rejeitados = 0;
    const lotes = fs.readdirSync(CFG.LOTES_DIR).filter(f => /^lote-\d+\.md$/.test(f)).sort();
    let enviados = 0;
    for (const f of lotes) {
      const devolvido = devolverLote(path.join(CFG.LOTES_DIR, f));
      const r = await fetch(painel.url + 'api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: devolvido }), signal: AbortSignal.timeout(30000),
      }).catch(e => { console.error(`❌ fetch lote ${f}: ${e.message.slice(0, 80)}`); return { ok: false, status: 'FETCH' }; });
      enviados++;
      if (enviados % 10 === 0) console.log(`   submetidos ${enviados}/${lotes.length} lote(s)…`);
      if (!r.ok) { rejeitados++; console.error(`❌ lote ${f} rejeitado: ${r.status}`); }
      else {
        const corpo = await r.json().catch(() => ({}));
        const nAceitos = (corpo.accepted || []).length;
        if (nAceitos === 0) { rejeitados++; console.error(`❌ lote ${f}: 200 mas nada aceito (${JSON.stringify(corpo).slice(0, 150)})`); }
      }
    }
    const vistos = setInterval(() => {
      try { const s = painel.getState(); console.log(`   ⏱ painel: ${s.receivedBatches}/${s.batchCount} lotes, fase ${s.phase}`); } catch { /* fim */ }
    }, 60000);
    const estado = await painel.waitForComplete();
    clearInterval(vistos);
    const validacaoMs = Date.now() - tPainel;
    console.log(`✅ Painel: ${estado.receivedBatches}/${lotes.length} lote(s), ${estado.receivedActivities} atividade(s), ${rejeitados} rejeitado(s) | ${validacaoMs} ms`);

    // 5. Aplicação com o executor REAL no portal falso (finalização segura).
    // O executor aceita re-invocação: appliedRefs (persistido em data) pula
    // o que já foi confirmado; o resto é reprocessado com navegador novo.
    painel.setPhase('applying');
    const tAplic = Date.now();
    const retornoFiles = fs.readdirSync(CFG.RETURNS_DIR).filter(f => /^lote-\d{2,}\.md$/i.test(f)).map(f => path.join(CFG.RETURNS_DIR, f));
    const data = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
    // Esperados: flags vão a revisão por design (T5b); respostas em branco
    // TAMBÉM caem em revisão no guard atual (lote exibe "(vazia)", guard
    // compara com a resposta vazia original → "alterada pela IA") — achado
    // a reportar ao auditor; contabilizado aqui para o esperado bater.
    const blanks = data.classes.flatMap(c => c.students).flatMap(s => s.lessons)
      .filter(l => l.blank && !l.capture_failed).length;
    const esperado = portal.total - devolverStats.sim - blanks;
    let stats = null, finalizadas = 0;
    for (let tent = 1; tent <= 4 && finalizadas < esperado; tent++) {
      navegador = await abrirNavegador();
      const aplicLog = { n: 0 };
      const r = await applyAcceptedCorrections({
        page: navegador.page, files: retornoFiles, data,
        onProgress: (ev, d) => {
          if (ev === 'ACTIVITY_APPLIED' || ev === 'ACTIVITY_REVIEW' || ev === 'ACTIVITY_FAILED') aplicLog.n++;
          if (aplicLog.n % 50 === 1) console.log(`   aplicando… ${aplicLog.n} | ${ev}`);
        },
      }).catch(e => { console.warn(`⚠️ aplicação (tentativa ${tent}): ${e.message.slice(0, 100)}`); return null; });
      await fecharNavegador();
      if (!r) continue;
      stats = r.stats;
      finalizadas = portal.finalizados.size; // verdade do servidor mock
      console.log(`   tentativa ${tent}: ${finalizadas}/${esperado} finalizadas no mock`);
      const revisados = r.results.filter(x => x.status === 'REVISAO');
      if (tent > 1 && revisados.length) {
        console.log(`   ${revisados.length} REVISAO; motivos das 3 primeiras:`);
        revisados.slice(0, 3).forEach(x => console.log(`     ${x.ref}: ${(x.reasons || []).join(' | ').slice(0, 200)}`));
      }
    }
    if (!stats) throw new Error('aplicação não convergiu em 4 tentativas');
    const aplicMs = Date.now() - tAplic;

    // 6. Relatório de stress.
    const totalMs = Date.now() - t0;
    const noServidor = portal.finalizados.size;
    console.log('\n===== STRESS REPORT =====');
    console.log(`Atividades fictícias : ${portal.total}`);
    console.log(`Capturadas           : ${capturadas} (${coletaMs} ms)`);
    console.log(`Lotes validados      : ${estado.receivedBatches}/${lotes.length} (${validacaoMs} ms, ${rejeitados} rejeitados)`);
    console.log(`Finalizadas (mock)   : ${noServidor}/${esperado} + revisão: ${devolverStats.sim} flags(SIM) + ${blanks} em branco (${aplicMs} ms)`);
    console.log(`Falhas de finalização: ${stats.falhasFinalizacao}`);
    console.log(`RSS pico aprox.      : ${Math.round(mem())} MB`);
    console.log(`Tempo total          : ${(totalMs / 1000).toFixed(1)} s`);
    if (noServidor !== esperado || stats.falhasFinalizacao > 0 || rejeitados > 0) process.exitCode = 1;
  } finally {
    await fecharNavegador();
    if (painel) await painel.close().catch(() => {});
    await portal.close().catch(() => {});
    fs.rmSync(RUN_DIR, { recursive: true, force: true });
  }
})().catch(e => { console.error('STRESS ERRO:', e.message); process.exit(1); });
