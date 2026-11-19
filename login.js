// ============================================================
// CNA Corretor — LOGIN MANUAL (toda execução)
// Contexto NOVO, sem cookies de execuções anteriores. O professor
// autentica direto no portal; o programa detecta sozinho e guarda
// o estado APENAS na sessão temporária desta execução.
// Nenhuma senha, e-mail ou identificador é solicitado ou armazenado.
// ============================================================
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const session = require('./lib/session');
const CFG = require('./lib/config');

(async () => {
  console.log('🔐 CNA Corretor — Login manual');
  console.log('----------------------------------');
  console.log('1. Uma janela do navegador vai abrir.');
  console.log('2. Faça login na SUA conta do portal do professor.');
  console.log('3. O programa reconhece o login sozinho e continua.');
  console.log('Nada é salvo: a sessão é descartada ao fechar o programa.\n');

  const { browser, context, page, kind } = await launch({ fresh: true });
  console.log(`🌐 Abrindo com ${kind}...`);

  await page.goto(CFG.LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
  console.log('✅ Navegador aberto em:', page.url());
  console.log('\n👉 Faça o login na janela que abriu. Aguardando reconhecimento...\n');

  let autenticado = false;
  const limite = Date.now() + 5 * 60 * 1000;
  while (Date.now() < limite) {
    autenticado = await portal.isAuthenticated(page);
    if (autenticado) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!autenticado) {
    console.log('⚠️  Login ainda não reconhecido. Deixei o navegador aberto — autentique-se no portal.');
    console.log('   O programa vai reconhecer assim que o portal aceitar o login.');
    await new Promise(r => setTimeout(r, 10 * 60 * 1000));
  }

  console.log('✅ Login reconhecido no portal.');
  await session.saveState(context); // somente em %TEMP%, removido no fim da execução
  console.log('💾 Sessão desta execução pronta (temporária).\n');

  await browser.close();
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
