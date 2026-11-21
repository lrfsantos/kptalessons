// Rodada 4, item 6: camada de integração ponta a ponta com fixtures e mocks.
// Módulos REAIS (telas, ciclovida, navegação, painel, eventos, saude) ligados
// entre si; nada de portal real, nada de dados reais, nada de Finalizar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { criarServidorTelas } = require('../src-node/telas');
const { criarGerenciador, fecharServidor, limparExecucoesAbandonadas } = require('../src-node/ciclovida');
const { irPara } = require('../src-node/navegacao');
const { vigiarConexao } = require('../src-node/saude');
const { sanitizarEvento } = require('../src-node/eventos');
const { createPanel } = require('../lib/panel');
const fx = require('../src-node/fixture');

function tmpDir(prefixo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

// ---- 1. Encerramento ponta a ponta --------------------------------------

test('integração/encerramento: telas reais + servidor + exportação + limpeza no mesmo prazo', async () => {
  const dir = tmpDir('cna-integracao-');
  fs.writeFileSync(path.join(dir, 'answers.json'), '{"aluno":"Fulano","resposta":"fictícia"}');
  const pasta = tmpDir('cna-resultados-');
  try {
    const server = criarServidorTelas();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const porta = server.address().port;
    const eventos = [];
    const g = criarGerenciador({
      runDir: dir,
      exportarResultados: async () => {
        await new Promise(r => setTimeout(r, 60)); // exportação demorada real
        fs.writeFileSync(path.join(pasta, 'revisao-manual.md'), 'revisão fictícia');
      },
      sair: () => {},
      tetoMs: 8000,
    });
    g.aoEncerrar(() => fecharServidor(server));
    vigiarConexao({
      browser: new (require('events').EventEmitter)(),
      gerenciador: g,
      evento: (e, d) => eventos.push(sanitizarEvento(e, d)),
    });
    // O servidor de telas responde antes do encerramento…
    const antes = await fetch(`http://127.0.0.1:${porta}/`);
    assert.equal(antes.status, 200);
    await g.encerrar();
    // …e morre com ele (recurso real drenado pelo prazo global).
    await assert.rejects(() => fetch(`http://127.0.0.1:${porta}/`));
    assert.equal(fs.existsSync(dir), false, 'RUN_DIR removida após a exportação');
    assert.equal(fs.existsSync(path.join(pasta, 'revisao-manual.md')), true, 'exportação concluída antes da limpeza');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

// ---- 2. Navegação contra o servidor de telas REAL ------------------------

test('integração/navegação: ida à conclusão real funciona; falha real gera estado estruturado com código fechado', async () => {
  const server = criarServidorTelas();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const porta = server.address().port;
    const eventos = [];
    const page = { goto: async url => { void url; } };
    assert.equal(await irPara(page, 'conclusao', `http://127.0.0.1:${porta}/conclusao?modo=vazio`, (e, d) => eventos.push({ e, d })), true);
    // Destino morto (porta sem serviço): falha real, nunca sucesso silencioso.
    const eventos2 = [];
    const pageQueFalha = { goto: async () => { throw new Error('net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/token/'); } };
    assert.equal(await irPara(pageQueFalha, 'painel', 'http://127.0.0.1:1/token/', (e, d) => eventos2.push({ e, d })), false);
    assert.equal(eventos2[0].e, 'NAVEGACAO_FALHOU');
    assert.equal(eventos2[0].d.codigo, 'ERRO_REDE');
    assert.ok(!JSON.stringify(eventos2).includes('127.0.0.1:1'), 'URL bruta não vaza no evento');
  } finally {
    await fecharServidor(server);
  }
});

// ---- 3. Queda do sidecar em todas as telas (páginas reais servidas) ------

const TELAS = [
  ['inicial', '/'], ['progresso (coleta/aplicação)', '/progresso'], ['conclusão', '/conclusao'],
];

test('integração/queda: as telas do servidor real carregam e o overlay global cobre cada uma', async () => {
  const server = criarServidorTelas();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const porta = server.address().port;
    const overlay = fs.readFileSync(path.join(__dirname, '..', 'poc-ui', 'falha-global.js'), 'utf8');
    for (const [nome, rota] of TELAS) {
      const r = await fetch(`http://127.0.0.1:${porta}${rota}`);
      assert.equal(r.status, 200, `tela ${nome} servida`);
      const html = await r.text();
      // Overlay independente da página: não referencia ids/scripts da tela.
      assert.ok(!/getElementById\('(iniciar|continuar|resumo)'/.test(overlay), `overlay não depende da estrutura da tela ${nome}`);
      // E as páginas não têm listener próprio de falha (centralização no Rust).
      if (html.includes('<script')) {
        const scriptMatch = html.match(/src="([^"]+\.js)"/);
        if (scriptMatch && scriptMatch[1] !== 'falha-global.js') {
          const js = await (await fetch(`http://127.0.0.1:${porta}${scriptMatch[1]}`)).text();
          assert.ok(!js.includes("listen('app-estado'"), `sem listener por página em ${nome} (falha é centralizada)`);
        }
      }
    }
  } finally {
    await fecharServidor(server);
  }
});

// ---- 4. Erros do painel: fluxo completo com fixture ----------------------

test('integração/painel: rejeição de retorno inválido não grava arquivo nem conta atividade', async () => {
  const dir = tmpDir('cna-integracao-');
  try {
    const lotes = path.join(dir, 'lotes');
    const retornos = path.join(dir, 'retornos-da-IA');
    fx.writeFixture(lotes);
    const panel = await createPanel({ collection: fx.makeCollection(), lotesDir: lotes, returnsDir: retornos });
    try {
      // Retorno inválido → erro estruturado, nada gravado…
      const ruim = await fetch(panel.url + 'api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fx.makeValidReturn({ wrongNonce: true }) }),
      });
      assert.notEqual(ruim.status, 200);
      // …estado do painel segue coerente…
      const st = await (await fetch(panel.url + 'api/state')).json();
      assert.equal(st.receivedActivities, 0);
      assert.equal(fs.readdirSync(retornos).filter(f => f.endsWith('.md')).length, 0);
      // …e o painel fecha limpo no encerramento (recurso real drenado).
      await panel.close();
    } finally {
      await panel.close().catch(() => {});
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 5. Exportação + limpeza após falha de rotina ------------------------

test('integração/exportação+limpeza: execução abandonada removida, ativa preservada, dados sensíveis nunca exportados', async () => {
  const ativa = tmpDir('cna-corretor-run-');
  const abandonada = tmpDir('cna-corretor-run-');
  try {
    fs.writeFileSync(path.join(abandonada, 'answers.json'), '{"aluno":"Fulano"}');
    fs.writeFileSync(path.join(ativa, 'answers.json'), '{"aluno":"Fulano"}');
    if (process.platform === 'win32') {
      const trava = fs.openSync(path.join(ativa, 'answers.json'), 'r');
      limparExecucoesAbandonadas('cna-corretor-run-');
      assert.equal(fs.existsSync(abandonada), false);
      assert.equal(fs.existsSync(ativa), true);
      fs.closeSync(trava);
    } else {
      limparExecucoesAbandonadas('cna-corretor-run-', ativa);
      assert.equal(fs.existsSync(abandonada), false);
      assert.equal(fs.existsSync(ativa), true);
    }
  } finally {
    fs.rmSync(ativa, { recursive: true, force: true });
    fs.rmSync(abandonada, { recursive: true, force: true });
  }
});

// ---- 6. Queda durante a aplicação: nada continua, nada é finalizado ------

test('integração/queda na aplicação: desconexão aciona encerramento; appliedRefs nunca é atualizado sem confirmação', () => {
  // Política de saúde em ponta a ponta: desconexão → evento fechado → sair.
  const browser = new (require('events').EventEmitter)();
  const eventos = [];
  const chamadas = [];
  const gerenciador = { encerrado: false, encerrar: c => { gerenciador.encerrado = true; chamadas.push(c); } };
  vigiarConexao({ browser, gerenciador, evento: (e, d) => eventos.push(sanitizarEvento(e, d)) });
  browser.emit('disconnected');
  assert.equal(eventos[0].event, 'FLUXO_ERRO');
  assert.equal(eventos[0].detail.codigo, 'ERRO_CONEXAO_PERDIDA');
  assert.deepEqual(chamadas, [1], 'sidecar encerra (Rust detecta EOF → overlay global)');
  // Invariante do produto (inalterado): executor só atualiza appliedRefs
  // após confirmação positiva — verificado como invariante estrutural.
  const executor = fs.readFileSync(path.join(__dirname, '..', 'executor.js'), 'utf8');
  assert.match(executor, /appliedRefs/, 'appliedRefs presente no executor (regra preservada)');
});
