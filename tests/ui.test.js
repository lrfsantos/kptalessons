// Verifica integridade estrutural do painel e ausência de padrões de overflow.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'painel.html'), 'utf8');

test('painel mantém todos os elementos usados pelo script', () => {
  for (const id of ['phase','total','received','batchProgress','progressBar','copyAll','batches','answer','fileInput','clear','charCount','submit','result','complete']) {
    assert.ok(html.includes('id="' + id + '"'), 'id ausente: ' + id);
  }
});

test('painel usa layout responsivo moderno e sem fontes externas', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'ui', 'painel.css'), 'utf8');
  const estilos = html + css;
  assert.match(estilos, /max-width:\s*min\(/);
  assert.match(estilos, /repeat\(auto-fill,\s*minmax\(/);
  assert.match(estilos, /clamp\(/);
  assert.match(estilos, /overflow-wrap:\s*anywhere/);
  assert.match(estilos, /white-space:\s*pre-wrap/);
  assert.match(estilos, /@media \(max-width:\s*620px\)/);
  assert.ok(!/https?:\/\//.test(html + css), 'sem recursos externos');
  assert.ok(!/grid-template-columns:\s*repeat\(3/.test(estilos), 'sem grade fixa de 3 colunas');
});

test('painel mantém bind local, token e serviço sem telemetria', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'lib', 'panel.js'), 'utf8');
  assert.match(panel, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(panel, /crypto\.randomBytes\(18\)/);
  assert.match(panel, /'Cache-Control': 'no-store'/);
  const cliente = html + fs.readFileSync(path.join(__dirname, '..', 'ui', 'painel.js'), 'utf8');
  assert.ok(!/telemetr|analytics|google-analytics|gtag/i.test(cliente), 'sem telemetria no cliente');
  assert.match(cliente, /fetch\(base \+ path/, 'fetch apenas para a API local do painel');
});

test('mensagens de resultado distinguem aceite parcial', () => {
  const cliente = html + fs.readFileSync(path.join(__dirname, '..', 'ui', 'painel.js'), 'utf8');
  assert.match(cliente, /const partial = rejected\.length > 0/);
  assert.match(cliente, /partial \? 'warn' : 'good'/);
});
