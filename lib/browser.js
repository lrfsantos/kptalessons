// ============================================================
// CNA Corretor — inicialização do navegador
//
// Professores usam navegadores diferentes. O DOM do portal é o
// mesmo em todos — o que muda é apenas COMO ABRIR o navegador:
//
//   1. BROWSER no .env força um específico (msedge|chrome|chromium|firefox|webkit)
//   2. Sem BROWSER, tenta navegadores do sistema: Edge -> Chrome
//   3. Último recurso: build do Chromium baixado pelo Playwright
//      (dica automática de instalação se faltar)
//
// Firefox/WebKit usam builds do Playwright (o Firefox do sistema
// não é suportado pelo Playwright); são baixados na primeira vez.
// ============================================================
const { chromium, firefox, webkit } = require('playwright-core');
const fs = require('fs');
const CFG = require('./config');

// Canais de navegador do sistema, na ordem de preferência.
const SYSTEM_CHANNELS = ['msedge', 'chrome'];

function browserTypeFor(kind) {
  if (kind === 'firefox') return firefox;
  if (kind === 'webkit') return webkit;
  return chromium; // msedge, chrome, chromium
}

// Tenta lançar; devolve null se o navegador não existir no sistema.
async function tryLaunch(kind, headless) {
  const type = browserTypeFor(kind);
  const opts = { headless };
  if (kind === 'msedge' || kind === 'chrome') opts.channel = kind;
  try {
    const browser = await type.launch(opts);
    return browser;
  } catch (e) {
    // Executável ausente / canal não instalado -> tenta o próximo
    return null;
  }
}

// Lança o navegador reutilizando a sessão salva (se existir).
// fresh: true ignora a sessão (usado pelo login.js).
// Retorna { browser, context, page, usedSavedSession, kind }.
async function launch({ headless = false, fresh = false } = {}) {
  headless = headless || CFG.HEADLESS === true;
  const hasState = !fresh && fs.existsSync(CFG.STATE_FILE);

  // Ordem de tentativa
  const forced = String(process.env.BROWSER || '').trim().toLowerCase();
  const order = forced ? [forced] : [...SYSTEM_CHANNELS, 'chromium'];

  let browser = null;
  let kind = null;
  for (const k of order) {
    if (!['msedge', 'chrome', 'chromium', 'firefox', 'webkit'].includes(k)) continue;
    browser = await tryLaunch(k, headless);
    if (browser) { kind = k; break; }
  }
  if (!browser) {
    throw new Error(
      'Nenhum navegador encontrado. Instale o Microsoft Edge ou Google Chrome, ' +
      'ou baixe o Chromium com:  npx playwright-core install chromium'
    );
  }

  const context = await browser.newContext({
    storageState: hasState ? CFG.STATE_FILE : undefined,
    viewport: CFG.VIEWPORT,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(CFG.NAV_TIMEOUT);

  return { browser, context, page, usedSavedSession: hasState, kind };
}

module.exports = { launch };
