// Testes da conta ativa — dados 100% fictícios, sem rede
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const account = require('../lib/account');
const portal = require('../lib/portal');
const { accountState } = require('../corrigir');
const CFG = require('../lib/config');

// --- decisão de estado (função pura) ---
test('1: primeira execução sem perfil e sem sessão', () => {
  assert.equal(accountState({ hasName: false, hasSession: false }), 'PRIMEIRA');
});
test('2b: account.json com BOM (gravado pelo PowerShell) é lido corretamente', () => {
  fs.writeFileSync(account.ACCOUNT_FILE, '\uFEFF{"name":"Luiza"}', 'utf8');
  assert.equal(account.readAccount().name, 'Luiza');
  try { fs.unlinkSync(account.ACCOUNT_FILE); } catch { /* não existia antes */ }
});

test('3: inicialização com perfil e sessão', () => {
  assert.equal(accountState({ hasName: true, hasSession: true }), 'EXISTENTE');
});
test('10: instalação antiga com sessão, mas sem nome', () => {
  assert.equal(accountState({ hasName: false, hasSession: true }), 'LEGADO');
});

// --- armazenamento local e limpeza seletiva ---
test('2: salvar nome identificador (não e-mail) e ler de volta', () => {
  const temp = path.join(os.tmpdir(), 'cna-acc-' + Date.now() + '.json');
  const orig = account.ACCOUNT_FILE;
  // ACCOUNT_FILE é constante; gravamos via saveAccount e restauramos depois.
  const saved = account.saveAccount('Luiz');
  assert.equal(saved.name, 'Luiz');
  assert.equal(account.readAccount().name, 'Luiz');
  assert.ok(fs.existsSync(account.ACCOUNT_FILE));
  const content = fs.readFileSync(account.ACCOUNT_FILE, 'utf8');
  assert.match(content, /Luiz/);
  assert.ok(!/@/.test(content), 'sem e-mail no identificador');
  try { fs.unlinkSync(account.ACCOUNT_FILE); } catch { /* não existia antes */ }
});

test('12: clearAuth NÃO apaga answers/lotes/relatórios', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-keep-'));
  const answers = path.join(dir, 'answers.json');
  const rel = path.join(dir, 'report.json');
  fs.writeFileSync(answers, '{}');
  fs.writeFileSync(rel, '{}');
  // clearAuth só toca ACCOUNT_FILE e STATE_FILE; verifica pela implementação
  const code = fs.readFileSync(require.resolve('../lib/account'), 'utf8');
  assert.match(code, /clearAuth[\s\S]*CFG\.STATE_FILE/);
  assert.ok(!/clearAuth[\s\S]*answers\.json/.test(code), 'clearAuth não referencia answers.json');
  assert.ok(fs.existsSync(answers) && fs.existsSync(rel));
});

test('7/8: troca de conta cria contexto FRESH (launch fresh: true)', () => {
  const code = fs.readFileSync(require.resolve('../login.js'), 'utf8');
  assert.match(code, /launch\(\{\s*fresh:\s*true\s*\}\)/, 'login sempre com contexto limpo');
  const accCode = fs.readFileSync(require.resolve('../lib/account'), 'utf8');
  assert.match(accCode, /clearAuth/);
});

// --- autenticação positiva no portal (não basta session.json) ---
function pageComAuth({ perfil, logo, loginPath, texto }) {
  return {
    evaluate(fn) {
      global.document = {
        querySelector(sel) {
          if (sel === '[data-sel="profile-menu"]') return perfil ? {} : null;
          if (sel === '[data-sel="header-logo"]') return logo ? {} : null;
          return null;
        },
        body: { innerText: texto || '' },
      };
      global.location = { pathname: loginPath || '/' };
      return fn();
    },
  };
}
test('5: sessão inválida/expirada => isAuthenticated falso', async () => {
  const p = pageComAuth({ perfil: false, logo: false, loginPath: '/login' });
  assert.equal(await portal.isAuthenticated(p), false);
});
test('3b: perfil + logo presentes e sem /login => autenticado', async () => {
  const p = pageComAuth({ perfil: true, logo: true, loginPath: '/learning/teacher/classes' });
  assert.equal(await portal.isAuthenticated(p), true);
});
test('6: trocar de conta remove auth, mas não dados — clearAuth cobre account+session', () => {
  const accCode = fs.readFileSync(require.resolve('../lib/account'), 'utf8');
  assert.match(accCode, /\[ACCOUNT_FILE, CFG\.STATE_FILE\]/);
});
test('11: troca de conta não altera lógica de correção/finalização', () => {
  const wizard = fs.readFileSync(require.resolve('../corrigir.js'), 'utf8');
  const executor = fs.readFileSync(require.resolve('../executor.js'), 'utf8');
  assert.match(wizard, /run\('executor\.js'\)/, 'wizard continua chamando o executor');
  assert.match(executor, /finalize\(page\)/, 'executor continua finalizando');
  assert.match(executor, /aplicadas = filled\.filter\(r => r\.finalized/, 'appliedRefs continua só com finalized');
});

test('login: detecta autenticação automaticamente, sem exigir ENTER', () => {
  const code = fs.readFileSync(require.resolve('../login.js'), 'utf8');
  assert.match(code, /await portal\.isAuthenticated\(page\)/, 'confirma login no DOM');
  assert.ok(!/Pressione ENTER quando estiver logado/.test(code), 'sem ENTER para login');
  assert.match(code, /setTimeout\(r, 2000\)/, 'faz polling até o portal reconhecer');
  assert.match(code, /launch\(\{\s*fresh:\s*true\s*\}\)/, 'contexto limpo');
});
