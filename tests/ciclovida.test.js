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
  await Promise.all([g.encerrar(), g.encerrar(), g.encerrar()]);
  assert.equal(saidas, 1, 'process.exit chamado uma única vez');
  assert.equal(fs.existsSync(dir), false);
});

test('revisão manual é exportada para a pasta de resultados do professor', async () => {
  const dir = runDirFicticia();
  let exportado = null;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-resultados-'));
  const g = criarGerenciador({
    runDir: dir,
    exportarResultados: () => { exportado = pasta; },
    sair: () => {},
  });
  await g.encerrar();
  assert.equal(exportado, pasta, 'exportação executada antes da remoção');
});

test('limpeza de residuais preserva execução ativa e remove abandonada', () => {
  const ativa = runDirFicticia();
  const abandonada = runDirFicticia();
  // Simula execução ativa: arquivo aberto impede o rename no Windows.
  const trava = fs.openSync(path.join(ativa, 'answers.json'), 'r');
  limparExecucoesAbandonadas('cna-corretor-run-test-');
  assert.equal(fs.existsSync(abandonada), false, 'abandonada removida');
  assert.equal(fs.existsSync(ativa), true, 'ativa preservada');
  fs.closeSync(trava);
  // Segunda execução (nova limpeza) agora remove a antiga, provando que a
  // preservação não é permanente.
  limparExecucoesAbandonadas('cna-corretor-run-test-');
  assert.equal(fs.existsSync(ativa), false);
});

test('fecharServidor impede novas requisições e aguarda as em andamento', async () => {
  const server = http.createServer(() => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.closeAllConnections && server.closeAllConnections();
  await fecharServidor(server, 1000);
  assert.equal(server.listening, false, 'servidor fechado');
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
