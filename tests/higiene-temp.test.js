// Higiene da suíte (rodada 3, item 5): executa os arquivos de teste que criam
// diretórios temporários próprios NUM TEMP ISOLADO desta verificação e prova
// que NÃO sobrou nenhum diretório próprio da suíte lá. Lista por prefixo
// EXATO da suíte — nenhuma limpeza genérica, nada do usuário é tocado.
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

function residuosEm(dir) {
  try {
    return fs.readdirSync(dir).filter(n => PREFIXOS_PROPRIOS.some(p => n.startsWith(p)));
  } catch { return []; }
}

test('higiene: a suíte não deixa diretórios temporários próprios para trás', () => {
  // TEMP isolado para o processo filho: isola a verificação da suíte externa
  // (que roda em paralelo) e garante que só resíduos DA SUÍTE apareçam aqui.
  const tempIsolado = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-higiene-'));
  try {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ['--test', ...ARQUIVOS], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        timeout: 180000,
        env: { ...process.env, TEMP: tempIsolado, TMP: tempIsolado },
      }),
      'arquivos de teste devem passar antes da verificação de higiene'
    );
    assert.deepEqual(residuosEm(tempIsolado), [], 'diretórios temporários deixados pelos testes');
  } finally {
    fs.rmSync(tempIsolado, { recursive: true, force: true });
  }
});
