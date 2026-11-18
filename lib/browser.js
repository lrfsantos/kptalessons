// ============================================================
// CNA Corretor — inicialização do navegador
// Usa a sessão salva (session.json) e abre um navegador pronto
// para navegar pelo portal já logado.
// ============================================================
const { chromium } = require('playwright-core');
const fs = require('fs');
const CFG = require('./config');

// Lança o navegador reutilizando a sessão salva (se existir).
// Retorna { browser, context, page, usedSavedSession }.
async function launch({ headless = false } = {}) {
  const hasState = fs.existsSync(CFG.STATE_FILE);

  let browser;
  try {
    browser = await chromium.launch({ channel: CFG.CHANNEL, headless });
  } catch {
    browser = await chromium.launch({ headless });
  }

  const context = await browser.newContext({
    storageState: hasState ? CFG.STATE_FILE : undefined,
    viewport: CFG.VIEWPORT,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(CFG.NAV_TIMEOUT);

  return { browser, context, page, usedSavedSession: hasState };
}

module.exports = { launch };
