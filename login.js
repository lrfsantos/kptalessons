// ============================================================
// CNA Corretor — LOGIN MANUAL
// Abre o navegador, o PROFESSOR loga na própria conta e o
// script salva a sessão em session.json. Confirma a autenticação
// no DOM real ANTES de salvar. Se um nome for passado (--nome),
// associa a conta. NENHUMA senha fica no código ou repositório.
// ============================================================
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { launch } = require('./lib/browser');
const portal = require('./lib/portal');
const account = require('./lib/account');
const CFG = require('./lib/config');

const LOGIN_URL = CFG.LOGIN_URL;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a); }));
}

(async () => {
  console.log('🔐 CNA Corretor — Login manual');
  console.log('----------------------------------');
  console.log('1. Uma janela do navegador vai abrir.');
  console.log('2. Faça login na SUA conta do portal do professor.');
  console.log('3. O programa reconhece o login sozinho e continua.');
  console.log('A sua senha NÃO é salva — apenas a sessão do navegador.\n');

  // Contexto FRESH: nunca reaproveita cookies de outra conta.
  const { browser, context, page, kind } = await launch({ fresh: true });
  console.log(`🌐 Abrindo com ${kind}...`);

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('✅ Navegador aberto em:', page.url());
  console.log('\n👉 Faça o login na janela que abriu. Aguardando reconhecimento...\n');

  // Detecta a autenticação no DOM real (perfil + logo, sem /login).
  // Não pede senha, não pede ENTER: o portal é a única tela de login.
  let autenticado = false;
  const limite = Date.now() + 5 * 60 * 1000;
  while (Date.now() < limite) {
    autenticado = await portal.isAuthenticated(page);
    if (autenticado) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!autenticado) {
    await browser.close();
    throw new Error('login não reconhecido no portal (tempo esgotado)');
  }
  console.log('✅ Login reconhecido no portal.');

  // Só salva a sessão DEPOIS da autenticação confirmada no DOM.
  await context.storageState({ path: CFG.STATE_FILE });
  console.log('\n💾 Sessão salva em session.json');

  let nome = (process.env.CNA_NOME || '').trim();
  if (!nome) {
    nome = (await ask('Como você quer ser identificado(a) nesta instalação? Ex.: Luiz\nNome: ')).trim();
  }
  account.saveAccount(nome);
  console.log(`👤 Conta identificada como: ${nome}`);
  console.log('📢 A sessão contém cookies de acesso. Está no .gitignore e nunca vai ao GitHub.');

  await browser.close();
  console.log('✅ Login concluído.');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
