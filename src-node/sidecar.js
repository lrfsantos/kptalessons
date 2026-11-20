// ============================================================
// Sidecar Node da prova de conceito Tauri + WebView2.
//
// - Inicia um servidor HTTP local (127.0.0.1, porta aleatoria).
// - Cria o Painel Local REAL com fixture sintetica (lib/panel.js).
// - Conecta ao WebView2 embutido no Tauri via Playwright/CDP.
// - Navega a MESMA janela visivel: app -> portal CNA -> progresso -> painel -> conclusao.
// - Registra evidencias (JSONL + PNG em disco) sem dados pessoais.
//
// Uso: node sidecar.js <cdp-port>
// ============================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP_PORT = Number(process.argv[2] || process.env.CNA_POC_CDP_PORT || 0);
if (!CDP_PORT) { console.error('[sidecar] porta CDP ausente'); process.exit(1); }

const BASE = path.resolve(__dirname, '..');
const { chromium } = require(path.join(BASE, 'node_modules', 'playwright-core'));
const { createPanel } = require(path.join(BASE, 'lib', 'panel.js'));
const md = require(path.join(BASE, 'lib', 'md.js'));
const { writeFixture, makeValidReturn } = require('./fixture.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const stamp = Date.now();
const EVIDENCE_DIR = path.join(os.tmpdir(), `cna-poc-evidencias-${stamp}`);
const RUN_DIR = path.join(os.tmpdir(), `cna-poc-run-${process.pid}-${stamp}`);
const LOTES_DIR = path.join(RUN_DIR, 'lotes');
const RETURNS_DIR = path.join(RUN_DIR, 'retornos-da-IA');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.mkdirSync(LOTES_DIR, { recursive: true });
fs.mkdirSync(RETURNS_DIR, { recursive: true });

const LOG_FILE = path.join(EVIDENCE_DIR, 'evidencias.jsonl');
function log(event, detail = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail }) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf8');
  console.log('[sidecar]', event, JSON.stringify(detail));
}

async function shot(page, name) {
  const file = path.join(EVIDENCE_DIR, name + '.png');
  try { await page.screenshot({ path: file, fullPage: false }); }
  catch (e) { log('screenshot-falhou', { name, erro: e.message }); }
}

// --- páginas locais da demonstração (servidas pelo proprio sidecar) ----
const PAGES = {
  '/': path.join(BASE, 'poc-ui', 'index.html'),
  '/progresso': path.join(BASE, 'poc-ui', 'progresso.html'),
  '/conclusao': path.join(BASE, 'poc-ui', 'conclusao.html'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const fixture = writeFixture(LOTES_DIR);
let panel = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = PAGES[url.pathname];
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('nao encontrado'); return; }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const demoPort = server.address().port;
  log('servidor-local-pronto', { port: demoPort, evidence: EVIDENCE_DIR });
  panel = await createPanel({ collection: fixture.collection, lotesDir: LOTES_DIR, returnsDir: RETURNS_DIR });
  log('painel-criado', { url: panel.url });
  await rodarDemo(demoPort);
});

async function conectar(cdpPort) {
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  const deadline = Date.now() + 90000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (e) {
      lastErr = e.message;
      await sleep(700);
    }
  }
  throw new Error('não foi possivel conectar ao WebView2 por CDP: ' + lastErr);
}

async function primeiroProcessoWeb(browser) {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('WebView2 sem contexto disponivel');
  let pages = ctx.pages();
  if (!pages.length) pages = await ctx.waitForEvent('page', { timeout: 15000 }).then(p => [p]);
  return { ctx, page: pages[0] };
}

async function estado(url) {
  const r = await fetch(url);
  return r.json();
}

async function rodarDemo(demoPort) {
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const browser = await conectar(CDP_PORT);
  log('cdp-conectado', { endpointLoopback: true });
  const { ctx, page } = await primeiroProcessoWeb(browser);
  page.on('response', async r => {
    if (!r.url().includes('/api/submit')) return;
    let corpo = '';
    try { corpo = (await r.text()).slice(0, 300); } catch { /*ignora*/ }
    log('resposta-submit', { status: r.status(), corpo });
  });

  // 1. Identidade da pagina inicial (deve ser a pagina local do app Tauri).
  const identidade = { url: page.url(), titulo: await page.title().catch(() => '') };
  log('pagina-inicial', identidade);

  // 2. Portal CNA na MESMA janela, sem login.
  await page.goto('https://app.cna.com.br/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  const portal = { url: page.url(), titulo: await page.title().catch(() => '') };
  const semLogin = !(await page.locator('input[type=password]').count());
  log('portal-aberto-mesma-janela', { ...portal, campoSenhaPresente: !semLogin });
  await shot(page, '02-portal-login');

  // 3. Retorno ao aplicativo (progresso simulado).
  await page.goto(demoBase + '/progresso', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  log('retorno-app-progresso', { url: page.url() });
  await shot(page, '03-progresso');

  // 4. Painel real com lote sintetico.
  await page.goto(panel.url, { waitUntil: 'domcontentloaded' });
  await page.locator('#answer').waitFor({ state: 'visible', timeout: 30000 });
  const painelInfo = await page.evaluate(() => ({
    titulo: document.title,
    total: document.getElementById('total').textContent.trim(),
    recebidas: document.getElementById('received').textContent.trim(),
    lotes: document.querySelectorAll('#batches .batch, #batches li, #batches > *').length,
    botaoCopiar: Boolean(document.getElementById('copyAll')),
    textarea: Boolean(document.getElementById('answer')),
  }));
  const conteudoLote = await (await fetch(panel.url + 'api/batch/1')).json();
  log('painel-carregado', {
    ...painelInfo,
    loteBytes: (conteudoLote.content || '').length,
    nonceNaPagina: (conteudoLote.content || '').includes(fixture.collection.nonce),
  });
  await shot(page, '04-painel-lote');

  // 5. Retorno INVALIDO (nonce errado) deve ser rejeitado pelo parser real.
  const invalido = makeValidReturn({ wrongNonce: true });
  await page.fill('#answer', invalido);
  await page.click('#submit');
  await page.waitForFunction(() => {
    const el = document.getElementById('result');
    return el && !el.classList.contains('hidden') && el.textContent.trim().length > 0;
  }, { timeout: 30000 }).catch(() => {});
  const aposInvalido = await page.evaluate(() => {
    const el = document.getElementById('result');
    return { visivel: !el.classList.contains('hidden'), texto: el.textContent.trim().slice(0, 160) };
  });
  const estadoAposInvalido = await estado(panel.url + 'api/state');
  log('retorno-invalido-rejeitado', {
    mensagem: aposInvalido.texto,
    recebidas: estadoAposInvalido.receivedActivities,
  });
  await shot(page, '05-retorno-invalido');

  // 6. Retorno VALIDO aceito pelo parser real.
  const valido = makeValidReturn();
  await page.fill('#answer', valido);
  await page.click('#submit');
  await page.waitForFunction(() => {
    const el = document.getElementById('complete');
    return el && !el.classList.contains('hidden');
  }, { timeout: 30000 }).catch(() => {});
  const estadoFinal = await estado(panel.url + 'api/state');
  const completoVisivel = await page.evaluate(() => {
    const el = document.getElementById('complete');
    return Boolean(el && !el.classList.contains('hidden'));
  });
  log('retorno-valido-aceito', {
    completoVisivel,
    recebidas: estadoFinal.receivedActivities,
    lotesRecebidos: estadoFinal.receivedBatches,
    total: estadoFinal.totalActivities,
    done: estadoFinal.done,
  });
  await shot(page, '06-retorno-valido');

  // 7. Conclusao explicita (demonstracao, nada aplicado no portal).
  await page.goto(demoBase + '/conclusao', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  log('conclusao', { url: page.url() });
  await shot(page, '07-conclusao');

  // 8. Verificacoes estruturais: uma unica janela/contexto, sem Chromium externo.
  const paginas = ctx.pages().map(p => p.url());
  const processos = await listarProcessosNavegador();
  log('verificacao-estrutural', { paginasNoContexto: paginas, navegadoresExternos: processos });

  log('demo-concluida', { evidencias: EVIDENCE_DIR });
}

async function listarProcessosNavegador() {
  return new Promise(resolve => {
    const { execFile } = require('child_process');
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (err, out) => {
      if (err) return resolve({ erro: err.message });
      const names = String(out).toLowerCase();
      const chrome = (names.match(/chrome\.exe/g) || []).length;
      const chromium = (names.match(/chromium/g) || []).length;
      const edge = (names.match(/msedge\.exe/g) || []).length;
      const webview = (names.match(/msedgewebview2\.exe/g) || []).length;
      resolve({ chromeExe: chrome, chromium, msedge: edge, msedgewebview2: webview });
    });
  });
}

async function limpar() {
  try { if (panel) await panel.close(); } catch {}
  try { fs.rmSync(RUN_DIR, { recursive: true, force: true }); } catch {}
}

process.on('SIGINT', async () => { await limpar(); process.exit(0); });
process.on('SIGTERM', async () => { await limpar(); process.exit(0); });
