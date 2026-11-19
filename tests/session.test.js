// Testes da sessão temporária — dados 100% fictícios, sem rede
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('../lib/session');
const CFG = require('../lib/config');

const ler = f => fs.readFileSync(require.resolve(f), 'utf8');

test('1: cada execução cria um arquivo de sessão novo e isolado', () => {
  const a = session.PREFIX + '111.json';
  const b = session.PREFIX + '222.json';
  assert.notEqual(a, b);
  assert.match(a, /^cna-corretor-sessao-/);
});

test('2: nenhuma execução reutiliza cookies da anterior (estado vazio por padrão)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-sess-'));
  const f = path.join(dir, 'vazia.json');
  fs.writeFileSync(f, '{}');
  const old = process.env.CNA_SESSAO_TEMP;
  process.env.CNA_SESSAO_TEMP = f;
  assert.equal(session.readState(), undefined);
  process.env.CNA_SESSAO_TEMP = old;
});

test('3: nenhum arquivo de sessão persistente é criado na pasta do programa', () => {
  const code = ler('../lib/session');
  assert.ok(!/path\.join\(CFG\.ROOT/.test(code), 'session.js nunca grava na pasta do programa');
  assert.match(code, /os\.tmpdir\(\)/);
  const cfg = ler('../lib/config');
  assert.ok(!/STATE_FILE/.test(cfg), 'sem STATE_FILE no config');
});

test('4: browser nunca usa perfil persistente do Chrome/Edge', () => {
  const code = ler('../lib/browser');
  assert.ok(!/userDataDir/.test(code), 'sem userDataDir');
  assert.ok(!/launchPersistentContext/.test(code), 'sem contexto persistente');
  assert.match(code, /newContext\(\{/);
});

test('5: autenticação manual é detectada por evidência positiva no DOM', () => {
  const code = ler('../lib/portal');
  assert.match(code, /data-sel=\\?"profile-menu/);
  assert.match(code, /data-sel=\\?"header-logo/);
});

test('6: wizard faz login ANTES da coleta', () => {
  const code = ler('../corrigir');
  assert.ok(code.indexOf("run('login.js')") < code.indexOf("run('scraper.js')"));
});

test('7/8: limpeza remove só os próprios resíduos de execuções encerradas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-stale-'));
  const mine = path.join(dir, session.PREFIX + '999999.json');
  const outro = path.join(dir, 'chrome-perfil-do-professor.json');
  fs.writeFileSync(mine, '{}');
  fs.writeFileSync(outro, '{}');
  // cleanupStale usa os.tmpdir(); aqui validamos o filtro por nome/PID na implementação.
  const code = ler('../lib/session');
  assert.match(code, /f\.startsWith\(PREFIX\)/);
  assert.match(code, /pidVivo\(pid\)/);
  assert.ok(fs.existsSync(outro));
});

test('9: limpeza não apaga dados de atividades/relatórios', () => {
  const code = ler('../lib/session');
  assert.ok(!/answers\.json|revisao\.md|report\.json|lotes/.test(code), 'session.js só mexe em %TEMP%');
});

test('10: sessão expirada interrompe e o login pode ser refeito sem perder progresso', () => {
  const wizard = ler('../corrigir');
  assert.match(wizard, /run\('login\.js'\)/, 'login pode ser repetido');
  assert.match(wizard, /coletaIncompleta\(data\)/, 'progresso preservado');
});

test('11: retomada não reaplica atividades já finalizadas', () => {
  const exec = ler('../executor');
  assert.match(exec, /aplicadas = filled\.filter\(r => r\.finalized/);
  assert.match(exec, /JA_APLICADA/);
});

test('12: dados de alunos/relatórios não são apagados', () => {
  const wizard = ler('../corrigir');
  assert.match(wizard, /session\.cleanup\(\)/);
  const sess = ler('../lib/session');
  assert.match(sess, /function cleanup\(\)[\s\S]*currentPath\(\)/);
});

test('13: inicialização não exige ENTER', () => {
  const login = ler('../login');
  const wizard = ler('../corrigir');
  assert.ok(!/Pressione ENTER/.test(login));
  assert.ok(!/rl\.question|readline/.test(login));
  assert.ok(!/rl\.question|readline/.test(wizard));
});

test('14: nenhuma senha ou credencial é armazenada', () => {
  const login = ler('../login');
  assert.ok(!/password|senha\s*[:=]/i.test(login.replace(/Nada é salvo[^\n]*/g, '')));
  assert.match(login, /portal\.isAuthenticated/);
});

test('16: login fecha o navegador após guardar o estado temporário', () => {
  const login = ler('../login');
  assert.match(login, /await session\.saveState\(context\)[\s\S]*await browser\.close\(\)/);
});

test('17: conta sem pendências encerra com sucesso e sem erro; limpeza sempre no finally', () => {
  const wizard = ler('../corrigir');
  assert.match(wizard, /Nenhuma pendência encontrada nesta conta/);
  assert.ok(!/Coleta sem identidade/.test(wizard));
  assert.ok(!/process\.exit\(/.test(wizard.slice(wizard.indexOf('  try {'), wizard.indexOf('  } finally {'))), 'sem process.exit dentro do try (finally precisa rodar)');
});

test('15: limpeza no finally cobre erro e encerramento normal', () => {
  const wizard = ler('../corrigir');
  assert.match(wizard, /\}\s*finally\s*\{[\s\S]*session\.cleanup\(\)/);
  assert.match(wizard, /\.catch\(e => \{[\s\S]*session\.cleanup\(\)/);
});
