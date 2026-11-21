// Codificação UTF-8: nenhum arquivo de interface pode conter mojibake
// (texto corrompido por decodificação dupla) e as strings-chave devem
// existir em português legível.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARQUIVOS = [
  'ui/painel.html', 'ui/painel.js', 'ui/painel.css',
  'poc-ui/index.html', 'poc-ui/progresso.html', 'poc-ui/conclusao.html',
  'poc-ui/app.js', 'poc-ui/progresso.js', 'poc-ui/conclusao.js',
  'poc-ui/styles.css', 'poc-ui/fluent.css',
];

// Padrões conhecidos de mojibake (UTF-8 decodificado como cp1252/latin-1).
const MOJIBAKE = [/Ã[§£©µ³]/, /NÃ£o/, /â€"/, /â€œ/, /â€\u009d/, /â€ /, /Ã£o/, /Ã¡|Ã©|Ã­|Ã³|Ãº/, /\uFFFD/];

for (const arquivo of ARQUIVOS) {
  test(`sem mojibake: ${arquivo}`, () => {
    const texto = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    for (const padrao of MOJIBAKE) {
      assert.ok(!padrao.test(texto), `${arquivo}: texto corrompido detectado (${padrao})`);
    }
  });
}

test('strings-chave legíveis no painel', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'ui/painel.html'), 'utf8');
  const js = fs.readFileSync(path.join(RAIZ, 'ui/painel.js'), 'utf8');
  const tudo = html + js;
  for (const esperada of [
    'Correção com sua IA',
    'Não foi possível',
    'Conteúdo copiado',
    'Painel local de correção',
  ]) {
    assert.ok(tudo.includes(esperada), `string ausente: ${esperada}`);
  }
});

test('strings-chave legíveis nas telas do aplicativo', () => {
  const index = fs.readFileSync(path.join(RAIZ, 'poc-ui/index.html'), 'utf8');
  const conclusao = fs.readFileSync(path.join(RAIZ, 'poc-ui/conclusao.html'), 'utf8');
  const js = fs.readFileSync(path.join(RAIZ, 'poc-ui/conclusao.js'), 'utf8');
  assert.ok(index.includes('Correção de atividades escritas com sua IA'));
  assert.ok(conclusao.includes('Atividades finalizadas'));
  assert.ok(conclusao.includes('Para revisão manual'));
  assert.ok(js.includes('Não há atividades pendentes. Tudo em dia!'));
});

test('telas de produção não contêm avisos de demonstração', () => {
  for (const f of ['poc-ui/index.html', 'poc-ui/progresso.html', 'poc-ui/conclusao.html']) {
    const texto = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    assert.ok(!/Demonstra(ção|ç.o)|fictíc/i.test(texto), `${f}: aviso de demonstração encontrado`);
  }
});
