// ============================================================
// Orquestrador Node do Corretor CNA (app Tauri) — fluxo REAL.
//
// Uma única janela WebView2 visível, um único contexto, uma única
// conexão Playwright/CDP. Reutiliza login.js/scraper.js/executor.js
// com a página injetada (nada de launch(), nada de process.exit aqui).
//
// Fluxo: início → login manual no portal (mesma janela) → coleta
// (mesma página, barra de progresso) → painel local real → retorno
// da IA validado → aplicação com finalização automática → conclusão.
//
// Protocolo com o Rust (stdout): CNA_SIDECAR_READY, CNA_CDP_CONECTADO,
// CNA_PORTS, CNA_EVENT. Encerramento gracioso: stdin "shutdown".
// Uso: node orquestrador.js <porta-cdp>
// ============================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP_PORT = Number(process.argv[2] || process.env.CNA_POC_CDP_PORT || 0);
if (!CDP_PORT) { console.error('[orquestrador] porta CDP ausente'); process.exit(1); }

const BASE = path.resolve(__dirname, '..');
const { chromium } = require(path.join(BASE, 'node_modules', 'playwright-core'));
const { createPanel } = require(path.join(BASE, 'lib', 'panel.js'));
const CFG = require(path.join(BASE, 'lib', 'config.js'));
const { performLogin } = require(path.join(BASE, 'login.js'));
const { collectActivities } = require(path.join(BASE, 'scraper.js'));
const { applyAcceptedCorrections } = require(path.join(BASE, 'executor.js'));

// Dados da execução em %TEMP%: em produção resources/ é somente leitura.
const RUN_DIR = path.join(os.tmpdir(), `cna-corretor-run-${process.pid}-${Date.now()}`);
fs.mkdirSync(RUN_DIR, { recursive: true });
for (const [chave, nome] of Object.entries({
  ANSWERS_FILE: 'answers.json', REPORT_FILE: 'report.json', REVISAO_FILE: 'revisao.md',
  RELATORIO_IA_FILE: 'relatorio-ia.md', LOTES_DIR: 'lotes', RETURNS_DIR: 'lotes/retornos-da-IA',
})) CFG[chave] = path.join(RUN_DIR, nome);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Evidências locais (JSONL) — sem dados pessoais: só contagens e estágios.
const EVIDENCE_DIR = path.join(RUN_DIR, 'evidencias');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const LOG_FILE = path.join(EVIDENCE_DIR, 'evidencias.jsonl');
function log(event, detail = {}) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), event, ...detail }) + '\n', 'utf8'); } catch { /* best effort */ }
}

// Protocolo estruturado com o Rust (nunca dados pessoais).
function evento(event, detail = {}) {
  console.log('CNA_EVENT ' + JSON.stringify({ event, ...detail }));
  log(event, detail);
}

// --- telas locais (início/progresso/conclusão) -------------------------
const PAGES = {
  '/': path.join(BASE, 'poc-ui', 'index.html'),
  '/progresso': path.join(BASE, 'poc-ui', 'progresso.html'),
  '/conclusao': path.join(BASE, 'poc-ui', 'conclusao.html'),
  '/styles.css': path.join(BASE, 'poc-ui', 'styles.css'),
  '/fluent.css': path.join(BASE, 'poc-ui', 'fluent.css'),
  '/app.js': path.join(BASE, 'poc-ui', 'app.js'),
  '/progresso.js': path.join(BASE, 'poc-ui', 'progresso.js'),
  '/conclusao.js': path.join(BASE, 'poc-ui', 'conclusao.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = PAGES[url.pathname];
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('não encontrado'); return; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
});

// --- CDP ---------------------------------------------------------------
async function conectar(cdpPort) {
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  const deadline = Date.now() + 90000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP(endpoint); }
    catch (e) { lastErr = e.message; await sleep(700); }
  }
  throw new Error('não foi possível conectar ao WebView2 por CDP: ' + lastErr);
}

async function primeiroProcessoWeb(browser) {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('WebView2 sem contexto disponível');
  let pages = ctx.pages();
  if (!pages.length) pages = await ctx.waitForEvent('page', { timeout: 15000 }).then(p => [p]);
  return { ctx, page: pages[0] };
}

// Barra de estado sobre as páginas do portal durante coleta/aplicação.
// sessionStorage persiste entre navegações da MESMA aba: a barra volta
// automaticamente em cada página (addInitScript) e some quando vazia.
async function barraEstado(page, texto) {
  try {
    await page.evaluate(t => sessionStorage.setItem('__cnaBar', t || ''), texto);
    await page.evaluate(t => {
      let bar = document.getElementById('cna-barra-fluxo');
      if (!t) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'cna-barra-fluxo';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0F6157;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,Segoe UI,sans-serif;text-align:center';
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.textContent = t;
    }, texto);
  } catch { /* página em navegação: addInitScript cuida da próxima */ }
}

// Registra a barra uma vez; ela reaparece automaticamente em cada navegação.
function registrarBarra(page) {
  return page.addInitScript(() => {
    const t = sessionStorage.getItem('__cnaBar');
    if (!t) return;
    const bar = document.createElement('div');
    bar.id = 'cna-barra-fluxo';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0F6157;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,Segoe UI,sans-serif;text-align:center';
    bar.textContent = t;
    (document.body || document.documentElement).appendChild(bar);
  });
}

async function irPara(page, destino) {
  await page.goto(destino, { waitUntil: 'domcontentloaded' }).catch(() => {});
}

// --- fluxo completo -----------------------------------------------------
async function rodarFluxo(demoPort) {
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const browser = await conectar(CDP_PORT);
  console.log('CNA_CDP_CONECTADO');
  const { ctx, page } = await primeiroProcessoWeb(browser);
  registrarBarra(page);
  evento('APP_PRONTO', {});

  // 1. Usuário clica "Iniciar correção" → portal CNA na MESMA janela.
  evento('INICIO_AGUARDANDO', {});
  await page.waitForURL('https://app.cna.com.br/**', { timeout: 0 });

  // 2. Login manual no portal (reutiliza performLogin; NÃO salva cookies:
  //    a sessão vive apenas no perfil temporário do WebView2).
  evento('LOGIN_REQUIRED', {});
  await performLogin({ page, onStatus: ev => evento(ev) });

  // 3. Coleta de atividades pendentes na MESMA página (mesma sessão).
  await barraEstado(page, 'Coletando atividades pendentes…');
  evento('COLLECTION_STARTED', {});
  const coleta = await collectActivities({ page, onProgress: (ev, d) => evento(ev, d) });
  log('coleta-status', { status: coleta.status, pendentes: coleta.pendentes });

  if (coleta.status === 'EMPTY') {
    await barraEstado(page, '');
    await irPara(page, demoBase + '/conclusao?modo=vazio');
    evento('COLLECTION_COMPLETED', { atividades: 0, lotes: 0 });
    return;
  }
  if (coleta.status === 'CAPTURE_FAILED') {
    await barraEstado(page, '');
    await irPara(page, demoBase + '/conclusao?erro=' + encodeURIComponent(
      'Havia atividades pendentes, mas nenhuma pôde ser capturada. Feche o aplicativo e tente novamente.'));
    evento('APPLICATION_FAILED', { etapa: 'coleta' });
    return;
  }

  // 4. Painel local REAL com os lotes da coleta (porta anunciada à allowlist).
  const panel = await createPanel({
    collection: coleta.collection,
    lotesDir: CFG.LOTES_DIR,
    returnsDir: CFG.RETURNS_DIR,
  });
  const panelPort = Number(new URL(panel.url).port);
  console.log('CNA_PORTS ' + JSON.stringify({ ports: [demoPort, panelPort] }));
  evento('PANEL_READY', { lotes: coleta.collection.batches.length, atividades: coleta.collection.batches.reduce((n, b) => n + b.total, 0) });
  await barraEstado(page, '');
  await irPara(page, panel.url);

  // 5. Professor copia lotes → IA (fora do app) → cola retorno → valida.
  //    O painel aceita/rejeita com o parser real e grava retornos-da-IA.
  const estado = await panel.waitForComplete(); // aguarda todos os lotes
  evento('RETURN_ACCEPTED', { lotes: estado.receivedBatches, atividades: estado.receivedActivities });

  // 6. Aplicação: preenche e FINALIZA as PRONTAS (regra absoluta do produto);
  //    revisões nunca são tocadas; appliedRefs só com confirmação positiva.
  panel.setPhase('applying');
  evento('APPLICATION_STARTED', {});
  await barraEstado(page, 'Aplicando as correções no portal…');
  const files = fs.readdirSync(CFG.RETURNS_DIR)
    .filter(f => /^lote-\d{2,}\.md$/i.test(f))
    .map(f => path.join(CFG.RETURNS_DIR, f));
  const data = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
  const { stats } = await applyAcceptedCorrections({ page, files, data, onProgress: (ev, d) => evento(ev, d) });
  panel.setPhase('done');

  // 7. Conclusão com resumo honesto (só contagens confirmadas).
  await barraEstado(page, '');
  const params = new URLSearchParams({
    finalizadas: String(stats.finalizadasNestaExecucao),
    jaCorrigidas: String(stats.jaCorrigidasNoPortal),
    revisao: String(stats.revisaoManual),
    falhas: String(stats.falhasFinalizacao),
  });
  await irPara(page, demoBase + '/conclusao?' + params.toString());
  log('fluxo-concluido', { finalizadas: stats.finalizadasNestaExecucao, revisao: stats.revisaoManual });
  evento('APPLICATION_COMPLETED', {
    finalizadas: stats.finalizadasNestaExecucao,
    jaCorrigidas: stats.jaCorrigidasNoPortal,
    revisao: stats.revisaoManual,
  });
}

server.listen(0, '127.0.0.1', async () => {
  const demoPort = server.address().port;
  log('servidor-local-pronto', { port: demoPort });
  console.log('CNA_SIDECAR_READY ' + JSON.stringify({ demoPort }));
  // Encerramento gracioso: Rust escreve "shutdown" no stdin.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (String(chunk).trim() !== 'shutdown') return;
    (async () => {
      try { server.close(); } catch { /* já fechado */ }
      process.exit(0);
    })();
  });
  try {
    await rodarFluxo(demoPort);
  } catch (e) {
    // Mensagem humana; detalhes técnicos ficam só nas evidências locais.
    log('fluxo-erro', { mensagem: e.message });
    evento('APPLICATION_FAILED', { etapa: 'fluxo' });
    try {
      const { page } = await primeiroProcessoWeb(await conectar(CDP_PORT));
      await irPara(page, `http://127.0.0.1:${demoPort}/conclusao?erro=` + encodeURIComponent(
        'Algo inesperado interrompeu o fluxo. Feche o aplicativo e tente novamente.'));
    } catch { /* janela já fechada */ }
  }
});
