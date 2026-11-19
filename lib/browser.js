// ============================================================
// CNA Corretor — inicialização do navegador
//
// Na DISTRIBUIÇÃO, o navegador é o Chromium portátil empacotado em
// runtime/ms-playwright (PLAYWRIGHT_BROWSERS_PATH configurado pelo
// inicializador). BROWSER=chromium força seu uso: NUNCA usamos o
// Edge/Chrome pessoal do professor nem instalado no sistema.
// ============================================================
const { chromium, firefox, webkit } = require('playwright-core');
const fs = require('fs');
const CFG = require('./config');

function browserTypeFor(kind) {
  if (kind === 'firefox') return firefox;
  if (kind === 'webkit') return webkit;
  return chromium;
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

  // Ordem: o Chromium portátil/gerenciado pelo Playwright é SEMPRE o preferido.
  const forced = String(process.env.BROWSER || '').trim().toLowerCase();
  const order = forced ? [forced] : ['chromium', 'msedge', 'chrome'];

  let browser = null;
  let kind = null;
  for (const k of order) {
    if (!['msedge', 'chrome', 'chromium', 'firefox', 'webkit'].includes(k)) continue;
    browser = await tryLaunch(k, headless);
    if (browser) { kind = k; break; }
  }
  if (!browser) {
    throw new Error(
      'Navegador Chromium portátil não encontrado. Verifique a pasta runtime/ms-playwright.'
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
