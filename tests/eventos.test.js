// Rodada 3, item 6: camada central de eventos com esquema fechado.
// Prova com strings FICTÍCIAS contendo dados sensíveis que nada disso
// chega aos eventos ou evidências.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizarEvento, sanitizarExcecao, sanitizarTexto, EVENTOS, CAMPOS,
  CODIGOS_ERRO, MENSAGENS_ERRO,
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

// ---- Rodada 4, item 4: códigos de erro FECHADOS + mensagens da interface ----

test('exceção vira código fechado + mensagem fixa da interface (texto bruto nunca sai)', () => {
  const casos = [
    new Error(`login de ${SENSIVEL.nome} (${SENSIVEL.email}) falhou com ${SENSIVEL.token}`),
    new Error(`navegação para ${SENSIVEL.urlAuth} bloqueada após timeout`),
    new Error(`CDP desconectado: ${SENSIVEL.cdp} — net::ERR_CONNECTION_RESET`),
    new Error(`resposta do aluno: "${'A laranja é uma fruta ' + SENSIVEL.email}" rejeitada`),
    new TypeError(`porta ${SENSIVEL.urlAuth} não pôde ser capturada`),
  ];
  for (const erro of casos) {
    const s = sanitizarExcecao(erro);
    assert.ok(CODIGOS_ERRO.has(s.codigo), 'código fechado: ' + s.codigo);
    assert.ok(Object.values(MENSAGENS_ERRO).includes(s.mensagem), 'mensagem vem do dicionário da interface');
    // Nada do texto bruto (nomes, e-mails, tokens, URLs, respostas) sobrevive:
    assert.ok(!contémValorProibido(s.mensagem), 'texto bruto vazado: ' + s.mensagem);
    assert.ok(!/[A-Za-z0-9]{24,}/.test(s.mensagem), 'sem fragmentos longos do texto original');
  }
  // Sem mensagem: não explode; mensagem continua definida pela interface.
  const vazio = sanitizarExcecao(null);
  assert.equal(vazio.codigo, 'ERRO_INESPERADO');
  assert.ok(vazio.mensagem.length > 0);
});

test('códigos de erro cobrem as classes esperadas', () => {
  assert.equal(sanitizarExcecao(new Error('Navigation timeout of 30000ms exceeded')).codigo, 'ERRO_TEMPO_ESGOTADO');
  assert.equal(sanitizarExcecao(new Error('net::ERR_NAME_NOT_RESOLVED')).codigo, 'ERRO_REDE');
  assert.equal(sanitizarExcecao(new Error('Target closed')).codigo, 'ERRO_CONEXAO_PERDIDA');
  assert.equal(sanitizarExcecao(new Error('qualquer coisa')).codigo, 'ERRO_INESPERADO');
});

test('sanitizarExcecao: e-mail, token, URL e resposta em exceção não aparecem no resultado', () => {
  const s = sanitizarExcecao(new Error(`falhou ${SENSIVEL.email} ${SENSIVEL.token} ${SENSIVEL.urlAuth} resposta "${'Minha resposta escrita'}"`));
  const linha = JSON.stringify(s);
  for (const v of [SENSIVEL.email, SENSIVEL.token, SENSIVEL.urlAuth, 'Minha resposta escrita']) {
    assert.ok(!linha.includes(v), `dado sensível vazado: ${v.slice(0, 16)}…`);
  }
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
