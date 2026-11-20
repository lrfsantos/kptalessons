// Testes do viewport dinâmico do Painel Local.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CFG = require('../lib/config');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('CFG.VIEWPORT permanece o padrão do portal', () => {
  assert.deepEqual(CFG.VIEWPORT, { width: 1440, height: 900 });
});

test('launch aceita viewport explícito, inclusive null', () => {
  const code = read('lib/browser.js');
  assert.match(code, /Object\.prototype\.hasOwnProperty\.call\(options, 'viewport'\)/);
  assert.match(code, /const viewport =[\s\S]*options\.viewport[\s\S]*CFG\.VIEWPORT/);
  assert.match(code, /viewport,\s*\/\/ null => usa o tamanho real/);
});

test('launch usa let para headless (sem reatribuir constante)', () => {
  const code = fs.readFileSync(require.resolve('../lib/browser'), 'utf8');
  assert.match(code, /let \{ headless = false, fresh = false \} = options/);
  assert.ok(!/const \{ headless = false/.test(code), 'headless precisa ser reatribuível');
});

test('somente o Painel Local usa viewport: null', () => {
  const wizard = read('corrigir.js');
  assert.match(wizard, /launch\(\{\s*fresh:\s*true,\s*headless:\s*false,\s*viewport:\s*null\s*\}\)/);
  const login = read('login.js');
  const scraper = read('scraper.js');
  assert.ok(!/viewport:\s*null/.test(login), 'login mantém viewport padrão');
  assert.ok(!/viewport:\s*null/.test(scraper), 'scraper mantém viewport padrão');
  assert.ok(/launch\(\{ headless: CFG\.HEADLESS === true \}\)/.test(scraper) ||
    /launch\(\{/.test(scraper), 'scraper continua chamando launch normalmente');
});
