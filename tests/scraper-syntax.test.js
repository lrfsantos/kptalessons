// Regression: scraper.js must parse (no duplicate declarations).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

test('scraper.js compila sem erros de sintaxe', () => {
  const file = path.join(__dirname, '..', 'scraper.js');
  const out = execFileSync(process.execPath, ['--check', file], { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(out !== null);
  const code = fs.readFileSync(file, 'utf8');
  assert.equal((code.match(/const generatedAt/g) || []).length, 1, 'generatedAt declarado uma vez');
});

test('lotes sao gravados na pasta da execucao, nunca na raiz de recursos', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'scraper.js'), 'utf8');
  // buildBatches sem outDir grava em CFG.ROOT/lotes (read-only/fora da limpeza
  // no app instalado). O painel le de CFG.LOTES_DIR -> 404 e vaza respostas.
  assert.match(code, /buildBatches\(classes,\s*\{\s*loteSize,\s*outDir:\s*CFG\.LOTES_DIR\s*\}\)/,
    'buildBatches deve receber outDir: CFG.LOTES_DIR');
});
