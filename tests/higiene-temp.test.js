// Higiene da suíte (rodada 3, item 5): executa os arquivos de teste que criam
// diretórios temporários próprios e prova que NÃO sobrou nenhum deles em
// os.tmpdir(). Lista por prefixo EXATO da suíte — nenhuma limpeza genérica
// por prefixo parecido, nada do usuário é tocado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PREFIXOS_PROPRIOS = [
  'cna-corretor-run-', 'cna-resultados-', 'cna-csp-', 'cna-arq-',
  'cna-test-', 'cna-lote-', 'cna-stable-', 'cna-archive-',
  'cna-fixture-', 'cna-sess-', 'cna-stale-', 'cna-panel-', 'cna-poc-test-',
];

// Arquivos de teste conhecidos por criarem diretórios em os.tmpdir().
const ARQUIVOS = [
  'tests/ciclovida.test.js', 'tests/csp.test.js', 'tests/parser.test.js',
  'tests/batches.test.js', 'tests/monitor.test.js',
  'tests/retorno-realista.test.js', 'tests/session.test.js',
  'tests/panel.test.js', 'tests/poc/painel-fixture.test.js',
];

function listarTemp() {
  try {
    return new Set(
      fs.readdirSync(os.tmpdir()).filter(n => PREFIXOS_PROPRIOS.some(p => n.startsWith(p)))
    );
  } catch { return new Set(); }
}

test('higiene: a suíte não deixa diretórios temporários próprios para trás', () => {
  const antes = listarTemp();
  const raiz = path.join(__dirname, '..');
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['--test', ...ARQUIVOS], {
      cwd: raiz, stdio: 'pipe', timeout: 180000,
    }),
    'arquivos de teste devem passar antes da verificação de higiene'
  );
  const residuos = [...listarTemp()].filter(d => !antes.has(d));
  assert.deepEqual(residuos, [], 'diretórios temporários deixados pelos testes');
});
