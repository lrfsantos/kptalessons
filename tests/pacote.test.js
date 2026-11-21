// Regressão do teste NSIS físico: o orquestrador exige módulos na raiz de
// resources/ (CFG.ROOT). Esquecê-los faz o sidecar morrer no startup do
// aplicativo instalado, com overlay de "não conseguiu iniciar o serviço".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const obrigatorios = ['login.js', 'scraper.js', 'executor.js', 'corrigir.js', 'instrucoes_correcao.md'];

test('tauri.conf empacota os módulos da raiz exigidos pelo orquestrador', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(raiz, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const recursos = conf.bundle.resources;
  for (const arquivo of obrigatorios) {
    assert.ok(recursos.includes('resources/' + arquivo), `resource ausente no bundle: ${arquivo}`);
  }
});

test('script de empacotamento copia os módulos da raiz', () => {
  const script = fs.readFileSync(path.join(raiz, 'scripts', 'poc-package-resources.ps1'), 'utf8');
  for (const arquivo of obrigatorios) {
    assert.ok(script.includes(arquivo), `cópia ausente no script: ${arquivo}`);
  }
});

test('módulos exigidos existem no repositório', () => {
  for (const arquivo of obrigatorios) {
    assert.ok(fs.existsSync(path.join(raiz, arquivo)), `arquivo ausente: ${arquivo}`);
  }
});
