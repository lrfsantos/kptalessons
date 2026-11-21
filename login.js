// ============================================================
// CNA Corretor — LOGIN MANUAL em toda execução.
// A autenticação é temporária e descartada ao encerrar o aplicativo.
//
// Reutilizável: performLogin({ page, context }) opera na página e no
// contexto JÁ EXISTENTES (no app Tauri, o WebView2 visível da janela
// única). Não cria navegador, não fecha navegador e não chama
// process.exit — devolve resultado estruturado ao orquestrador.
// O wrapper CLI mantém o fluxo antigo (npm run login) em paralelo.
// ============================================================
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const session = require('./lib/session');
const CFG = require('./lib/config');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function performLogin({ page, context, onStatus = () => {} } = {}) {
  await page.goto(CFG.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
  onStatus('LOGIN_REQUIRED', {});
  let lastNotice = Date.now();
  while (!page.isClosed()) {
    let authenticated = false;
    try { authenticated = await portal.isAuthenticated(page); } catch { /* aguarda a próxima verificação */ }
    if (authenticated) {
      onStatus('LOGIN_CONFIRMED', {});
      if (context) await session.saveState(context); // CLI: sessão temporária em %TEMP%
      return { ok: true };
    }
    if (Date.now() - lastNotice >= 60000) {
      onStatus('LOGIN_WAITING', {});
      lastNotice = Date.now();
    }
    await sleep(1500);
  }
  throw new Error('A janela de login foi fechada antes da confirmação de autenticação.');
}

if (require.main === module) {
  (async () => {
    console.log('LOGIN MANUAL — CORRETOR CNA');
    console.log('Faça login na janela do Chromium. O programa detectará a autenticação automaticamente.');
    console.log('Não pressione ENTER. Fechar a janela cancela o login.\n');

    const { browser, context, page, kind } = await launch({ fresh: true, headless: false });
    try {
      console.log('Abrindo com ' + kind + '...');
      await performLogin({ page, context, onStatus: (ev, d) => console.log('[' + ev + ']', d || '') });
      console.log('Login reconhecido. Autenticação temporária disponível nesta execução.');
    } finally {
      await browser.close();
    }
  })().catch(error => {
    console.error('Login não concluído:', error.message);
    process.exit(1);
  });
}

module.exports = { performLogin };
