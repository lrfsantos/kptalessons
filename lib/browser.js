// ============================================================
// CNA Corretor — inicialização do navegador
//
// Na DISTRIBUIÇÃO, o navegador é o Chromium portátil empacotado em
// runtime/ms-playwright (PLAYWRIGHT_BROWSERS_PATH configurado pelo
// inicializador). BROWSER=chromium força seu uso: NUNCA usamos o
// Edge/Chrome pessoal do professor nem instalado no sistema.
// ============================================================
const { chromium, firefox, webkit } = require('playwright-core');
const CFG = require('./config');
const session = require('./session');

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

// Lança o navegador com um contexto NOVO. Nenhuma sessão persistente é
// reaproveitada: o único estado possível vem do arquivo temporário criado
// nesta execução (login -> coleta -> aplicação no mesmo contexto lógico).
// fresh: true ignor até esse estado (usado pelo próprio login.js).
// Retorna { browser, context, page, usedSavedSession, kind }.
async function launch(options = {}) {
  const { headless = false, fresh = false } = options;
  // `viewport: null` desativa o viewport fixo e faz a janela usar o tamanho
  // real. Só é passado explicitamente pelo Painel Local; todas as outras
  // chamadas continuam com CFG.VIEWPORT.
  const viewport = Object.prototype.hasOwnProperty.call(options, 'viewport')
    ? options.viewport
    : CFG.VIEWPORT;
  headless = headless || CFG.HEADLESS === true;
  // remove resíduos de execuções anteriores encerradas
  session.cleanupStale();
  const state = fresh ? undefined : session.readState();
  const hasState = Boolean(state);

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
    storageState: state,       // undefined => contexto totalmente novo (sem cookies)
    viewport,                  // null => usa o tamanho real da janela
  });
  const page = await context.newPage();
  page.setDefaultTimeout(CFG.NAV_TIMEOUT);

  return { browser, context, page, usedSavedSession: hasState, kind };
}

module.exports = { launch };
