// Testes de mascaramento de nomes com acentos e limites de palavra.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskAnswer } = require('../lib/md');

test('João com acento é mascarado', () => {
  assert.equal(maskAnswer('João went to the park.', 'João'), '[NOME] went to the park.');
});
test('José com acento é mascarado', () => {
  assert.equal(maskAnswer('José studied yesterday.', 'José'), '[NOME] studied yesterday.');
});
test('André com acento é mascarado', () => {
  assert.equal(maskAnswer('André passed the exam.', 'André'), '[NOME] passed the exam.');
});
test('Luíza com acento é mascarado', () => {
  assert.equal(maskAnswer('Luíza wrote a sentence.', 'Luíza'), '[NOME] wrote a sentence.');
});
test('variação de maiúsculas/minúsculas', () => {
  assert.equal(maskAnswer('joão and JOÃO are the same person.', 'João'), '[NOME] and [NOME] are the same person.');
});
test('nome completo com sobrenome', () => {
  assert.equal(maskAnswer('Ana Silva went home.', 'Ana Silva'), '[NOME] [NOME] went home.');
});
test('nome com hífen', () => {
  assert.equal(maskAnswer('Ana-Maria helped me.', 'Ana-Maria'), '[NOME]-[NOME] helped me.');
});
test('nome com apóstrofo', () => {
  assert.equal(maskAnswer("D'Angelo helped me.", "D'Angelo"), "[NOME]'[NOME] helped me.");
});
test('Ana não altera bananas', () => {
  const r = maskAnswer('I like bananas and Ana likes apples.', 'Ana');
  assert.ok(r.includes('bananas'), 'bananas preservado');
  assert.equal(r, 'I like bananas and [NOME] likes apples.');
});
test('May não altera maybe', () => {
  const r = maskAnswer('Maybe May will come.', 'May');
  assert.ok(r.includes('Maybe'), 'maybe preservado');
  assert.equal(r, 'Maybe [NOME] will come.');
});
test('pontuação ao redor do nome', () => {
  assert.equal(maskAnswer('(João), "José"!', 'João José'), '([NOME]), "[NOME]"!');
});
test('texto fora dos trechos mascarados permanece byte a byte', () => {
  const original = 'I went to the park  \nwith João. It was fun!';
  const r = maskAnswer(original, 'João');
  assert.equal(r, original.replace('João', '[NOME]'));
});
test('e-mail, telefone, CPF e URL continuam mascarados', () => {
  const r = maskAnswer('Mail a@b.com, tel 11912345678, cpf 123.456.789-00, site https://x.com', 'Ninguém');
  assert.ok(r.includes('[EMAIL]') && r.includes('[TELEFONE]') && r.includes('[CPF]') && r.includes('[LINK]'));
});
test('nome acentuado não permanece na versão enviada', () => {
  for (const nome of ['João', 'José', 'André', 'Luíza']) {
    const r = maskAnswer(`Texto com ${nome} no meio.`, nome);
    assert.ok(!r.includes(nome), nome + ' vazou');
    assert.ok(r.includes('[NOME]'));
  }
});
