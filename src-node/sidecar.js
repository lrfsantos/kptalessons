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
// Tempo que o sidecar espera cada acao do usuario antes de encerrar a observacao.
const ESPERA_USUARIO = 15 * 60 * 1000;

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
const { criarServidorTelas } = require(path.join(__dirname, 'telas.js'));

const fixture = writeFixture(LOTES_DIR);
let panel = null;

const server = criarServidorTelas();

server.listen(0, '127.0.0.1', async () => {
  const demoPort = server.address().port;
  log('servidor-local-pronto', { port: demoPort, evidence: EVIDENCE_DIR });
  panel = await createPanel({ collection: fixture.collection, lotesDir: LOTES_DIR, returnsDir: RETURNS_DIR });
  log('painel-criado', { url: panel.url });
  // Handshake com o Rust: portas locais vão para a allowlist de navegação.
  console.log('CNA_SIDECAR_READY ' + JSON.stringify({ demoPort, panelPort: panel.port != null ? panel.port : Number(new URL(panel.url).port) }));
  // Encerramento gracioso: Rust escreve "shutdown" no stdin (5.6).
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (String(chunk).trim() !== 'shutdown') return;
    (async () => {
      try { server.close(); } catch { /* já fechado */ }
      try { if (panel) await panel.close(); } catch { /* já fechado */ }
      process.exit(0);
    })();
  });
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
  console.log('CNA_CDP_CONECTADO');
  const { ctx, page } = await primeiroProcessoWeb(browser);
  page.on('response', async r => {
    if (!r.url().includes('/api/submit')) return;
    let corpo = '';
    try { corpo = (await r.text()).slice(0, 300); } catch { /*ignora*/ }
    log('resposta-submit', { status: r.status(), corpo });
  });

  // 1. Modo interativo: aguarda o usuario clicar em "Iniciar correção",
  //    o que navega ESTA janela ao portal CNA (so verificacao, sem login).
  log('aguardando-usuario', { acao: 'clicar em Iniciar correção' });
  await page.waitForURL('https://app.cna.com.br/**', { timeout: ESPERA_USUARIO }).catch(() => {});
  if (!page.url().startsWith('https://app.cna.com.br')) {
    log('demo-abandonada', { etapa: 'portal', url: page.url() });
    return;
  }
  await page.waitForTimeout(2500);

  // 2. Barra do app sobre o portal: usuario decide quando "voltar".
  await page.evaluate(destino => {
    const bar = document.createElement('div');
    bar.id = 'cna-poc-barra';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0F6157;color:#fff;' +
      'padding:10px 16px;font:14px/1.4 system-ui,Segoe UI,sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between';
    const texto = document.createElement('span');
    texto.textContent = 'Prova de conceito Corretor CNA — o login aqui é só para verificação. Nenhum dado é enviado.';
    const btn = document.createElement('button');
    btn.textContent = 'Voltar ao Corretor (simulado)';
    btn.type = 'button';
    btn.style.cssText = 'background:#fff;color:#0F6157;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer';
    btn.addEventListener('click', () => { window.location.href = destino; });
    bar.appendChild(texto);
    bar.appendChild(btn);
    document.documentElement.appendChild(bar);
    const st = document.createElement('style');
    st.textContent = 'body{margin-top:52px !important}';
    document.head.appendChild(st);
  }, demoBase + '/progresso');
  log('portal-aberto-mesma-janela', {
    url: page.url(),
    titulo: await page.title().catch(() => ''),
    campoSenhaPresente: Boolean(await page.locator('input[type=password]').count()),
  });
  await shot(page, '02-portal-login');

  // 3. Aguarda o usuario clicar em "Voltar ao Corretor (simulado)".
  log('aguardando-usuario', { acao: 'clicar em Voltar ao Corretor (simulado)' });
  await page.waitForURL(demoBase + '/progresso', { timeout: ESPERA_USUARIO }).catch(() => {});
  if (!page.url().startsWith(demoBase)) {
    log('demo-abandonada', { etapa: 'retorno', url: page.url() });
    return;
  }
  await shot(page, '03-progresso');

  // 4. Aguarda o usuario clicar em "Continuar para o painel".
  log('aguardando-usuario', { acao: 'clicar em Continuar para o painel' });
  await page.waitForFunction('window.__cna_prosseguir === true', { timeout: ESPERA_USUARIO }).catch(() => {});
  if (!page.evaluate(() => window.__cna_prosseguir === true)) {
    log('demo-abandonada', { etapa: 'progresso', url: page.url() });
    return;
  }
  await page.goto(panel.url, { waitUntil: 'domcontentloaded' });

  // 5. Painel REAL: instrucoes + exemplos coláveis; o usuario testa com as
  //    proprias maos (copiar, colar, validar) e o parser real decide.
  await page.locator('#answer').waitFor({ state: 'visible', timeout: 30000 });
  const valido = makeValidReturn();
  const invalido = makeValidReturn({ wrongNonce: true });
  await page.evaluate(({ invalido, valido }) => {
    const aviso = document.createElement('div');
    aviso.style.cssText = 'position:sticky;top:0;z-index:9999;background:#FFF4DE;border:1px solid #DEE5E8;border-radius:8px;' +
      'padding:12px 16px;margin:12px;font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#172B35';
    aviso.innerHTML = '<strong>Prova de conceito — dados fictícios.</strong> Experimente o ciclo real copiar → colar → validar:' +
      '<br>1. Clique nos botões de copiar do painel e cole num editor para ver o lote.' +
      '<br>2. Use um dos botões abaixo para colocar um retorno de exemplo no campo de resposta.' +
      '<br>3. Clique em <em>Validar</em> e veja o parser real aceitar ou rejeitar — erros aparecem com mensagem humana.';
    const mk = (rotulo, texto, cor) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = rotulo;
      b.style.cssText = `margin:8px 8px 0 0;padding:8px 14px;border:0;border-radius:6px;cursor:pointer;font-weight:600;background:${cor};color:#fff`;
      b.addEventListener('click', () => {
        const ta = document.getElementById('answer');
        ta.value = texto;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.scrollIntoView({ block: 'center' });
      });
      return b;
    };
    aviso.appendChild(mk('Colar exemplo com ERRO', invalido, '#B3462E'));
    aviso.appendChild(mk('Colar exemplo VÁLIDO', valido, '#0F6157'));
    document.body.prepend(aviso);
  }, { invalido, valido });
  const painelInfo = await page.evaluate(() => ({
    total: document.getElementById('total').textContent.trim(),
    botaoCopiar: Boolean(document.getElementById('copyAll')),
    textarea: Boolean(document.getElementById('answer')),
  }));
  log('painel-carregado', painelInfo);
  await shot(page, '04-painel-lote');

  // 6. Observa o usuario testar; termina quando o lote valido for aceito.
  log('aguardando-usuario', { acao: 'validar os retornos no painel' });
  const inicio = Date.now();
  let estadoFinal = null;
  while (Date.now() - inicio < ESPERA_USUARIO) {
    await sleep(2000);
    try {
      const s = await estado(panel.url + 'api/state');
      if (s.done) { estadoFinal = s; break; }
    } catch { /* servidor ocupado; tenta de novo */ }
  }
  if (!estadoFinal) {
    log('demo-abandonada', { etapa: 'painel', url: page.url() });
    return;
  }
  log('retorno-valido-aceito', {
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
