// Rodada 3, item 7: navegação sem falha silenciosa.
// Falha simulada em cada transição (portal/painel/conclusão) gera estado
// estruturado e NUNCA vira sucesso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { irPara } = require('../src-node/navegacao');

function pageQueFalha(erro) {
  return { goto: async () => { throw erro; } };
}
function pageOk() {
  return { goto: async () => {} };
}

test('sucesso de navegação retorna true', async () => {
  assert.equal(await irPara(pageOk(), 'painel', 'http://127.0.0.1:1/x/'), true);
});

test('falha ao navegar para o painel: estado estruturado, sem conversão em sucesso', async () => {
  const eventos = [];
  const ok = await irPara(
    pageQueFalha(new Error('net::ERR_CONNECTION_REFUSED')),
    'painel', 'http://127.0.0.1:2/token/',
    (event, detail) => eventos.push({ event, detail })
  );
  assert.equal(ok, false, 'falha não vira sucesso');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].event, 'NAVEGACAO_FALHOU');
  assert.equal(eventos[0].detail.destino, 'painel');
  assert.ok(eventos[0].detail.mensagem.includes('CONNECTION_REFUSED'));
});

test('falha ao navegar para conclusão: destino estruturado com mensagem sanitizada', async () => {
  const eventos = [];
  const ok = await irPara(
    pageQueFalha(new Error('Timeout 30000ms excedido para ana@exemplo.com')),
    'conclusao', 'http://127.0.0.1:3/conclusao',
    (event, detail) => eventos.push({ event, detail })
  );
  assert.equal(ok, false);
  assert.equal(eventos[0].detail.destino, 'conclusao');
  assert.ok(!eventos[0].detail.mensagem.includes('ana@exemplo.com'), 'e-mail redigido');
  assert.ok(eventos[0].detail.mensagem.includes('[EMAIL]'));
});

test('falha ao navegar para o portal: mesmo contrato estruturado', async () => {
  const eventos = [];
  const ok = await irPara(
    pageQueFalha(new Error('net::ERR_NAME_NOT_RESOLVED')),
    'portal', 'https://app.cna.com.br/login',
    (event, detail) => eventos.push({ event, detail })
  );
  assert.equal(ok, false);
  assert.equal(eventos[0].event, 'NAVEGACAO_FALHOU');
  assert.equal(eventos[0].detail.destino, 'portal');
});

test('sem reportar injetado: falha não explode e segue retornando false', async () => {
  assert.equal(await irPara(pageQueFalha(new Error('x')), 'painel', 'http://x/'), false);
});
