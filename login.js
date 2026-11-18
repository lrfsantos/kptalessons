// ============================================================
// CNA Corretor — LOGIN MANUAL
// Abre o navegador, o PROFESSOR loga na própria conta e o
// script salva a sessão em session.json (usado pelo scraper
// e executor). NENHUMA senha fica no código ou no repositório.
// ============================================================
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STATE_FILE = path.join(__dirname, 'session.json');
const LOGIN_URL = 'https://app.cna.com.br/login';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a); }));
}

(async () => {
  console.log('🔐 CNA Corretor — Login manual');
  console.log('----------------------------------');
  console.log('1. Uma janela do navegador vai abrir.');
  console.log('2. Faça login na SUA conta do portal do professor.');
  console.log('3. Depois de logado(a), volte aqui e aperte ENTER.');
  console.log('A sua senha NÃO é salva — apenas a sessão do navegador.\n');

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: false });
    console.log('🌐 Abrindo com Microsoft Edge...');
  } catch {
    console.log('⬇️  Baixando o Chromium (primeira vez pode demorar)...');
    browser = await chromium.launch({ headless: false });
  }

  const context = await browser.newContext({
    storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('✅ Navegador aberto em:', page.url());
  console.log('\n👉 Faça o login na janela que abriu e depois digite ENTER aqui.\n');

  await ask('Pressione ENTER quando estiver logado(a)... ');

  // Salva a sessão
  await context.storageState({ path: STATE_FILE });
  console.log('\n💾 Sessão salva em session.json');
  console.log('📢 Aviso: este arquivo contém seus cookies de acesso.');
  console.log('   Ele está no .gitignore e NUNCA deve ser enviado ao GitHub.');

  await browser.close();
  console.log('✅ Pronto! Agora rode:  node scraper.js');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
