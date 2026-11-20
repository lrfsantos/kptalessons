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
