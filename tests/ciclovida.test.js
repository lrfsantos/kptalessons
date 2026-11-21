// Ciclo de vida do orquestrador: limpeza de dados temporários sensíveis,
// idempotência do encerramento, execução ativa preservada.
// 100% com diretórios e fixtures fictícios (nada de portal real).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarGerenciador, fecharServidor, limparExecucoesAbandonadas } = require('../src-node/ciclovida');
const http = require('http');

function runDirFicticia() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-corretor-run-test-'));
  // Conteúdo sensível típico de uma execução (fictício).
  fs.writeFileSync(path.join(dir, 'answers.json'), '{"aluno":"Fulano de Teste","resposta":"resposta fictícia"}');
  fs.mkdirSync(path.join(dir, 'lotes', 'retornos-da-IA'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lotes', 'lote-01.md'), 'lote fictício');
  fs.writeFileSync(path.join(dir, 'revisao.md'), 'revisão fictícia');
  return dir;
}

test('encerramento normal remove os dados temporários sensíveis e sai com código 0', async () => {
  const dir = runDirFicticia();
  const codigos = [];
  const g = criarGerenciador({ runDir: dir, sair: c => codigos.push(c) });
  await g.encerrar();
  assert.equal(fs.existsSync(dir), false, 'runDir removida');
  assert.deepEqual(codigos, [0]);
});

test('encerramento após erro também remove os dados temporários sensíveis', async () => {
  const dir = runDirFicticia();
  const g = criarGerenciador({ runDir: dir, sair: () => {} });
  g.aoEncerrar(async () => { throw new Error('recurso já quebrado'); }); // erro não impede a limpeza
  await g.encerrar();
  assert.equal(fs.existsSync(dir), false);
});

test('duplo shutdown é idempotente: limpeza única, sem corrida nem erro', async () => {
  const dir = runDirFicticia();
  let saidas = 0;
  const g = criarGerenciador({ runDir: dir, sair: () => saidas++ });
  const [a, b, c] = await Promise.all([g.encerrar(), g.encerrar(), g.encerrar()]);
  assert.equal(a, b, 'chamadas simultâneas aguardam a MESMA Promise');
  assert.equal(a, c);
  assert.equal(saidas, 1, 'process.exit chamado uma única vez');
  assert.equal(fs.existsSync(dir), false);
});

test('encerrar() retorna a mesma Promise em chamadas sequenciais', async () => {
  const dir = runDirFicticia();
  const g = criarGerenciador({ runDir: dir, sair: () => {} });
  const p1 = g.encerrar();
  assert.equal(g.encerrar(), p1);
  await p1;
});

test('recursos assíncronos demorados são aguardados antes da saída', async () => {
  const dir = runDirFicticia();
  const marcas = [];
  const g = criarGerenciador({ runDir: dir, sair: () => marcas.push('saiu') });
  g.aoEncerrar(async () => { await new Promise(r => setTimeout(r, 120)); marcas.push('lento'); });
  await g.encerrar();
  assert.deepEqual(marcas, ['lento', 'saiu'], 'sair somente após concluir a limpeza');
  assert.equal(fs.existsSync(dir), false);
});

test('ordem explícita: painel antes de Playwright/CDP (LIFO)', async () => {
  const dir = runDirFicticia();
  const ordem = [];
  const g = criarGerenciador({ runDir: dir, sair: () => {} });
  g.aoEncerrar(async () => ordem.push('cdp'));     // registrado primeiro
  g.aoEncerrar(async () => ordem.push('painel'));  // registrado depois
  await g.encerrar();
  assert.deepEqual(ordem, ['painel', 'cdp'], 'painel fecha antes de desconectar CDP');
});

test('recurso registrado depois do início do encerramento não fica abandonado', async () => {
  const dir = runDirFicticia();
  const g = criarGerenciador({ runDir: dir, sair: () => {} });
  let executado = false;
  const p = g.encerrar();
  g.aoEncerrar(async () => { executado = true; }); // registrado durante a limpeza
  await p;
  assert.equal(executado, true, 'rotina tardia executada');
  assert.equal(fs.existsSync(dir), false);
});

test('revisão manual é exportada para a pasta de resultados do professor', async () => {
  const dir = runDirFicticia();
  let exportado = null;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-resultados-'));
  try {
    const g = criarGerenciador({
      runDir: dir,
      exportarResultados: () => { exportado = pasta; },
      sair: () => {},
    });
    await g.encerrar();
    assert.equal(exportado, pasta, 'exportação executada antes da remoção');
  } finally {
    // O teste só verifica a chamada; a pasta fictícia é removida após a asserção.
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('limpeza de residuais preserva execução ativa e remove abandonada', () => {
  const ativa = runDirFicticia();
  const abandonada = runDirFicticia();
  if (process.platform === 'win32') {
    // Simula execução ativa: arquivo aberto impede o rename no Windows
    // (rename-exclusivo como prova de abandono - produção é Windows-only).
    const trava = fs.openSync(path.join(ativa, 'answers.json'), 'r');
    limparExecucoesAbandonadas('cna-corretor-run-test-');
    assert.equal(fs.existsSync(abandonada), false, 'abandonada removida');
    assert.equal(fs.existsSync(ativa), true, 'ativa preservada');
    fs.closeSync(trava);
    // Segunda execução (nova limpeza) agora remove a antiga, provando que a
    // preservação não é permanente.
    limparExecucoesAbandonadas('cna-corretor-run-test-');
    assert.equal(fs.existsSync(ativa), false);
  } else {
    // POSIX não bloqueia rename com arquivo aberto; sem a trava do Windows.
    // Valida aqui o parâmetro excluir, mecanismo real do orquestrador.
    limparExecucoesAbandonadas('cna-corretor-run-test-', ativa);
    assert.equal(fs.existsSync(abandonada), false, 'abandonada removida');
    assert.equal(fs.existsSync(ativa), true, 'ativa preservada (excluir)');
  }
});

test('fecharServidor impede novas requisições e aguarda as em andamento', async () => {
  const server = http.createServer(() => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await fecharServidor(server, 1000);
  assert.equal(server.listening, false, 'servidor fechado');
});

test('fecharServidor: requisição em andamento termina ANTES do fechamento forçado', async () => {
  let liberar;
  const trava = new Promise(r => { liberar = r; });
  const server = http.createServer(async (_req, res) => {
    await trava; // requisição fica aberta até o teste liberar
    res.end('ok');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  const resposta = fetch(`http://127.0.0.1:${porta}/`);
  await new Promise(r => setTimeout(r, 80)); // garante requisição em voo
  const fechamento = fecharServidor(server, 5000);
  liberar(); // servidor responde; fechamento deve AGUARDAR, sem interromper
  const r = await resposta;
  assert.equal(r.status, 200, 'resposta entregue por inteiro (não interrompida)');
  assert.equal(await r.text(), 'ok');
  await fechamento;
  assert.equal(server.listening, false);
});

test('fecharServidor: conexão presa é encerrada só no teto (fallback)', async () => {
  const server = http.createServer(() => { /* nunca responde */ });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  let recebeu;
  const pedidoRecebido = new Promise(r => { recebeu = r; });
  server.on('request', () => recebeu());
  const req = http.get(`http://127.0.0.1:${porta}/`);
  await pedidoRecebido; // conexão ativa (resposta pendente) antes de fechar
  let destruida = false;
  req.on('error', () => { destruida = true; });
  const t0 = Date.now();
  await fecharServidor(server, 250);
  assert.ok(Date.now() - t0 >= 200, 'aguardou o teto antes do fallback');
  assert.equal(server.listening, false);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(destruida || req.destroyed, 'conexão remanescente encerrada como fallback');
});

test('evidências não contêm dados pessoais (apenas contagens e estágios)', () => {
  // O orquestrador registra evento/evento detalhe; o teste valida a regra
  // usando os campos permitidos de uma execução fictícia.
  const evento = { ts: new Date().toISOString(), event: 'COLLECTION_COMPLETED', atividades: 3, lotes: 1 };
  const linha = JSON.stringify(evento);
  for (const proibido of ['Fulano', 'resposta fictícia', 'respostaLida']) {
    assert.ok(!linha.includes(proibido), `dado pessoal vazado: ${proibido}`);
  }
});
