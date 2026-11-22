// Higiene da suíte (rodada 3 item 5; melhorada na rodada 4, item 5):
// executa NUM TEMP ISOLADO desta verificação TODOS os arquivos de teste
// IDENTIFICADOS AUTOMATICAMENTE por criarem diretórios temporários
// (mkdtemp/tmpdir/TEMP/TMP no código-fonte) e prova que NÃO sobrou nenhum
// diretório próprio da suíte lá. Nenhum teste novo que toque o TEMP escapa
// da cobertura de limpeza — a descoberta é por conteúdo, não por lista fixa.
// Lista por prefixo EXATO da suíte — nenhuma limpeza genérica, nada do
// usuário é tocado.
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
  'cna-higiene-', 'cna-integracao-',
];

// Descoberta AUTOMÁTICA (recursiva em tests/): qualquer arquivo de teste que
// referencia o TEMP no código é incluído — novos testes não entram sem
// cobertura de limpeza. O próprio higiene-temp é excluído da execução filha
// (senão se re-executaria recursivamente); a guarda abaixo impede regressão.
function descobrirTestesDeTemp(dir = __dirname, base = path.dirname(__dirname)) {
  const marcador = /mkdtemp|tmpdir|\bTEMP\b|\bTMP\b/;
  const achados = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) achados.push(...descobrirTestesDeTemp(caminho, base));
    else if (e.name.endsWith('.test.js') && marcador.test(fs.readFileSync(caminho, 'utf8'))) {
      achados.push(path.relative(base, caminho).replaceAll('\\', '/'));
    }
  }
  return achados.sort();
}

function residuosEm(dir) {
  try {
    return fs.readdirSync(dir).filter(n => PREFIXOS_PROPRIOS.some(p => n.startsWith(p)));
  } catch { return []; }
}

test('higiene: a suíte não deixa diretórios temporários próprios para trás', () => {
  const descobertos = descobrirTestesDeTemp();
  // Guarda da própria descoberta: se a varredura regredir (regex quebrada,
  // diretório vazio), o teste falha em vez de passar sem verificar nada.
  assert.ok(descobertos.length >= 10, `descoberta deve achar os testes de temp conhecidos (achou ${descobertos.length})`);
  assert.ok(descobertos.includes('tests/higiene-temp.test.js'), 'a própria higiene faz parte da descoberta');
  // Execução filha: todos os descobertos MENOS este arquivo (recursão).
  const arquivos = descobertos.filter(f => f !== 'tests/higiene-temp.test.js');
  // TEMP isolado para o processo filho: isola a verificação da suíte externa
  // (que roda em paralelo) e garante que só resíduos DA SUÍTE apareçam aqui.
  const tempIsolado = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-higiene-'));
  try {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ['--test', ...arquivos], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        timeout: 600000,
        env: { ...process.env, TEMP: tempIsolado, TMP: tempIsolado },
      }),
      'arquivos de teste devem passar antes da verificação de higiene'
    );
    assert.deepEqual(residuosEm(tempIsolado), [], 'diretórios temporários deixados pelos testes');
  } finally {
    fs.rmSync(tempIsolado, { recursive: true, force: true });
  }
});
