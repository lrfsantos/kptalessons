// ============================================================
// CNA Corretor — LOGIN MANUAL em toda execução.
// A autenticação é temporária e descartada ao encerrar o aplicativo.
// ============================================================
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const session = require('./lib/session');
const CFG = require('./lib/config');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  console.log('LOGIN MANUAL — CORRETOR CNA');
  console.log('Faça login na janela do Chromium. O programa detectará a autenticação automaticamente.');
  console.log('Não pressione ENTER. Fechar a janela cancela o login.\n');

  const { browser, context, page, kind } = await launch({ fresh: true, headless: false });
  try {
    console.log('Abrindo com ' + kind + '...');
    await page.goto(CFG.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
    console.log('Aguardando autenticação reconhecida pelo portal CNA...');
    let lastNotice = Date.now();
    while (!page.isClosed()) {
      let authenticated = false;
      try { authenticated = await portal.isAuthenticated(page); } catch { /* aguarda a próxima verificação */ }
      if (authenticated) {
        console.log('Login reconhecido.');
        await session.saveState(context);
        console.log('Autenticação temporária disponível nesta execução.');
        return;
      }
      if (Date.now() - lastNotice >= 60000) {
        console.log('Ainda aguardando o login manual. Conclua a autenticação na janela do Chromium.');
        lastNotice = Date.now();
      }
      await sleep(1500);
    }
    throw new Error('A janela de login foi fechada antes da confirmação de autenticação.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('Login não concluído:', error.message);
  process.exit(1);
});
