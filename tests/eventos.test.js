// Rodada 3, item 6: camada central de eventos com esquema fechado.
// Prova com strings FICTÍCIAS contendo dados sensíveis que nada disso
// chega aos eventos ou evidências.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizarEvento, sanitizarExcecao, sanitizarTexto, EVENTOS, CAMPOS,
} = require('../src-node/eventos');

const SENSIVEL = {
  nome: 'Ana Silva',
  email: 'ana.silva@exemplo.com',
  telefone: '11 98765-4321',
  cpf: '123.456.789-00',
  cookie: 'sessionid=abcdef0123456789abcdef0123456789',
  token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  senha: 'SenhaForte#2026',
  urlAuth: 'https://app.cna.com.br/login?token=segredo123',
  cdp: 'ws://127.0.0.1:1234/devtools/browser/abc',
};

function contémValorProibido(texto) {
  return Object.values(SENSIVEL).some(v => texto.includes(v));
}

test('evento fora do esquema fechado vira EVENTO_DESCONHECIDO', () => {
  const e = sanitizarEvento('EVENTO_FORJADO', { x: 1 });
  assert.equal(e.event, 'EVENTO_DESCONHECIDO');
  assert.deepEqual(e.detail, {}, 'nenhum campo de evento desconhecido passa');
});

test('campos fora da allowlist são descartados (encaminhamento indiscriminado é impossível)', () => {
  const e = sanitizarEvento('COLLECTION_STARTED', {
    turmas: 3,                // permitido (número)
    aluno: SENSIVEL.nome,     // proibido
    resposta: 'texto do aluno', // proibido
    cookie: SENSIVEL.cookie,  // proibido (nem o NOME do campo existe na allowlist)
    token: SENSIVEL.token,    // proibido
  });
  assert.deepEqual(e.detail, { turmas: 3 });
  assert.ok(!JSON.stringify(e).includes('Ana Silva'));
  assert.ok(!JSON.stringify(e).includes('sessionid'));
});

test('valores de texto permitidos têm dados sensíveis redigidos (nomes são bloqueados na allowlist de campos — teste acima)', () => {
  const e = sanitizarEvento('FLUXO_ERRO', {
    mensagem: `Falhou com ${SENSIVEL.email} em ${SENSIVEL.urlAuth} via ${SENSIVEL.cdp} cookie ${SENSIVEL.cookie}`,
  });
  const linha = JSON.stringify(e);
  for (const v of [SENSIVEL.email, SENSIVEL.urlAuth, SENSIVEL.cdp, SENSIVEL.cookie]) {
    assert.ok(!linha.includes(v), `dado sensível vazado: ${v.slice(0, 12)}…`);
  }
  assert.ok(linha.includes('[EMAIL]') && linha.includes('[URL]'), 'redação aplicada');
});

test('números passam; objetos não são encaminhados de forma alguma', () => {
  const e = sanitizarEvento('APPLICATION_COMPLETED', {
    finalizadas: 7,
    revisao: 2,
    aninhado: { nome: SENSIVEL.nome }, // objeto: nem entra na allowlist de tipo
  });
  assert.deepEqual(e.detail, { finalizadas: 7, revisao: 2 });
});

test('sanitizarExcecao redige e-mails, tokens, URLs e endpoints CDP', () => {
  const casos = [
    new Error(`login de ${SENSIVEL.email} falhou com ${SENSIVEL.token}`),
    new Error(`navegação para ${SENSIVEL.urlAuth} bloqueada`),
    new Error(`CDP desconectado: ${SENSIVEL.cdp}`),
    new Error(`aluno com cpf ${SENSIVEL.cpf}`),
  ];
  for (const erro of casos) {
    const s = sanitizarExcecao(erro);
    assert.ok(!contémValorProibido(JSON.stringify(s)), 'exceção com dado sensível redigido: ' + s.mensagem);
    assert.equal(s.tipo, 'Error');
  }
  // Sem mensagem: não explode.
  assert.equal(sanitizarExcecao(null).mensagem, '');
});

test('esquema fechado não contém campos de dados pessoais por construção', () => {
  const proibidos = ['nome', 'aluno', 'resposta', 'email', 'telefone', 'cpf',
    'cookie', 'token', 'senha', 'password', 'ref', 'feedback', 'url'];
  for (const p of proibidos) {
    assert.ok(!CAMPOS.has(p), `campo "${p}" não pode estar na allowlist`);
  }
  assert.ok(EVENTOS.has('APPLICATION_COMPLETED'));
});

test('sanitizarTexto: CPF, telefone e cartão fictícios são redigidos', () => {
  const t = sanitizarTexto(`cpf ${SENSIVEL.cpf} tel ${SENSIVEL.telefone} cartao 4111 1111 1111 1111`);
  assert.ok(!t.includes(SENSIVEL.cpf));
  assert.ok(!t.includes(SENSIVEL.telefone));
  assert.ok(!t.includes('4111 1111 1111 1111'));
});
