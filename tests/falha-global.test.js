// Rodada 4, itens 2+3: queda do sidecar em QUALQUER tela + nenhuma aplicação
// após perda de conexão. 100% com mocks e fixtures — nada de portal real.
//
// O overlay global (poc-ui/falha-global.js) é a MESMA fonte embutida no Rust
// (include_str!): aqui ele é executado contra um DOM falso, simulando a queda
// com a página atual em cada tela do fluxo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { vigiarConexao } = require('../src-node/saude');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'poc-ui', 'falha-global.js'), 'utf8');
const MENSAGEM = 'O serviço interno foi encerrado inesperadamente. Tente reiniciar; se persistir, feche e abra o aplicativo novamente.';

// --- DOM falso mínimo, suficiente para o overlay --------------------------
function criarElemento(tag) {
  const el = {
    tag, children: [], attrs: {}, listeners: {}, style: {},
    textContent: '', disabled: false, type: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.pai = this; return c; },
    remove() {
      const pai = this.pai;
      if (pai) pai.children = pai.children.filter(x => x !== this);
    },
    contains(e) {
      if (e === this) return true;
      return this.children.some(c => c.contains(e));
    },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      this.listeners[ev] = (this.listeners[ev] || []).filter(f => f !== fn);
    },
    clicar(target) {
      const eventoFake = { target: target || this, preventDefault: () => { eventoFake.previsto = true; }, stopPropagation: () => { eventoFake.parado = true; } };
      for (const fn of this.listeners.click || []) fn(eventoFake);
      return eventoFake;
    },
  };
  // el.id = ... define o atributo id (igual ao DOM real).
  Object.defineProperty(el, 'id', {
    get() { return this.attrs.id; },
    set(v) { this.attrs.id = v; },
  });
  return el;
}

function executarOverlay({ tela, mensagem = MENSAGEM, tauri = null } = {}) {
  const body = criarElemento('body');
  const pagina = criarElemento('main'); // conteúdo "por baixo" (a tela atual)
  pagina.marker = tela;
  body.appendChild(pagina);
  const documento = {
    body,
    documentElement: body,
    getElementById: id => {
      const busca = el => {
        if (el.attrs.id === id) return el;
        for (const c of el.children) { const r = busca(c); if (r) return r; }
        return null;
      };
      return busca(body);
    },
    createElement: criarElemento,
    addEventListener(ev, fn) { (documento.listeners[ev] = documento.listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { documento.listeners[ev] = (documento.listeners[ev] || []).filter(f => f !== fn); },
    listeners: {},
  };
  const janela = tauri ? { __TAURI__: tauri } : {};
  // Mesma substituição que o Rust faz (todas as ocorrências; string JSON
  // sempre válida). Fonte única: include_str! no Rust usa .replace (todos).
  const pronto = SCRIPT.split('__CNA_MENSAGEM__').join(JSON.stringify(mensagem));
  new Function('document', 'window', pronto)(documento, janela);
  return { documento, body, pagina };
}

// Disparo comportamental: captura no document roda ANTES dos handlers do alvo;
// stopPropagation impede que o handler da página por baixo seja chamado.
function disparar(documento, tipo, alvo) {
  const ev = {
    type: tipo, target: alvo, previsto: false, parado: false,
    preventDefault() { this.previsto = true; },
    stopPropagation() { this.parado = true; },
  };
  for (const fn of documento.listeners[tipo] || []) fn(ev);
  if (!ev.parado) for (const fn of (alvo.listeners && alvo.listeners[tipo]) || []) fn(ev);
  return ev;
}

// As 6 telas do fluxo: a queda pode acontecer em qualquer uma.
const TELAS = ['inicial', 'portal', 'coleta', 'painel', 'aplicacao', 'conclusao'];

for (const tela of TELAS) {
  test(`queda do sidecar na tela "${tela}": overlay global apresentado e página bloqueada`, () => {
    const { documento, body, pagina } = executarOverlay({ tela });
    const overlay = documento.getElementById('cna-falha-global');
    assert.ok(overlay, 'overlay injetado na tela ' + tela);
    assert.equal(overlay.attrs.role, 'alert');
    assert.ok(overlay.children.length > 0);
    // Mensagem humana (a mesma emitida pelo Rust no EOF) está no overlay.
    let textos = '';
    const coleta = el => { textos += ' ' + el.textContent; el.children.forEach(coleta); };
    coleta(overlay);
    assert.ok(textos.includes('Serviço interno interrompido.'));
    assert.ok(textos.includes('Tente reiniciar'), 'mensagem do Rust presente');
    // Página por baixo não responde a cliques (bloqueio em captura).
    assert.ok((documento.listeners.click || []).length === 1, 'bloqueio registrado');
    const cliqueFora = documento.listeners.click[0]({ target: pagina, preventDefault() {}, stopPropagation() {} });
    // A função de bloqueio não lança e recebe o evento da página (fora do overlay).
    assert.ok(cliqueFora === undefined, 'bloqueio executado sem erro');
  });
}

test('overlay é idempotente: segunda injeção não duplica o aviso', () => {
  const { documento } = executarOverlay({ tela: 'painel' });
  // Simula nova chamada do Rust (ex.: nova falha) na MESMA página.
  const body = documento.body;
  const SCRIPT2 = SCRIPT.split('__CNA_MENSAGEM__').join(JSON.stringify(MENSAGEM));
  new Function('document', 'window', SCRIPT2)(documento, {});
  let overlays = 0;
  const conta = el => { if (el.attrs.id === 'cna-falha-global') overlays++; el.children.forEach(conta); };
  conta(body);
  assert.equal(overlays, 1, 'apenas um overlay');
});

test('recuperação segura COM IPC: invoca reiniciar_sidecar e remove o overlay', async () => {
  let invocacoes = [];
  const tauri = { core: { invoke: cmd => { invocacoes.push(cmd); return Promise.resolve(); } } };
  const { documento } = executarOverlay({ tela: 'inicial', tauri });
  const overlay = documento.getElementById('cna-falha-global');
  // Acha o botão e clica.
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  await botao.clicar();
  assert.deepEqual(invocacoes, ['reiniciar_sidecar']);
  assert.equal(documento.getElementById('cna-falha-global'), null, 'overlay removido após reinício');
});

test('recuperação só libera a página quando o invoke resolve (handshake real confirmado no Rust)', async () => {
  let liberar;
  const pendente = new Promise(r => { liberar = r; });
  const tauri = { core: { invoke: () => pendente } };
  const { documento } = executarOverlay({ tela: 'aplicacao', tauri });
  const overlay = documento.getElementById('cna-falha-global');
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  botao.clicar(); // invoke ainda pendente: o Rust ainda não confirmou o handshake
  await new Promise(r => setImmediate(r));
  assert.ok(documento.getElementById('cna-falha-global'), 'overlay permanece até o handshake real');
  assert.equal(botao.disabled, true, 'recuperação em curso: botão desabilitado');
  liberar(); // Rust confirmou CNA_SIDECAR_READY + CDP -> invoke resolve
  await new Promise(r => setImmediate(r));
  assert.equal(documento.getElementById('cna-falha-global'), null, 'overlay removido só após a confirmação');
});

test('recuperação com falha no invoke mantém overlay e mensagem de falha', async () => {
  const tauri = { core: { invoke: () => Promise.reject(new Error('handshake falhou')) } };
  const { documento } = executarOverlay({ tela: 'inicial', tauri });
  const overlay = documento.getElementById('cna-falha-global');
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  botao.clicar();
  await new Promise(r => setImmediate(r));
  assert.ok(documento.getElementById('cna-falha-global'), 'overlay NÃO é removido quando a recuperação falha');
  assert.equal(botao.disabled, false, 'botão reabilitado para nova tentativa');
  assert.match(botao.textContent, /Não foi possível reiniciar/, 'mensagem de falha de recuperação mantida');
});

test('recuperação SEM IPC (portal remoto): orientação segura, sem segundo sidecar', async () => {
  const { documento } = executarOverlay({ tela: 'portal', tauri: null });
  const overlay = documento.getElementById('cna-falha-global');
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  const ev = botao.clicar();
  assert.ok(botao.textContent.includes('Feche e reabra'), 'orienta reiniciar o aplicativo (sem IPC não há como reiniciar só o serviço)');
  assert.ok(documento.getElementById('cna-falha-global'), 'overlay segue apresentado (sem falsa recuperação)');
});

test('cliques dentro do overlay funcionam; fora são bloqueados', () => {
  const { documento, pagina } = executarOverlay({ tela: 'painel' });
  const overlay = documento.getElementById('cna-falha-global');
  const fora = { prev: false };
  documento.listeners.click[0]({ target: pagina, preventDefault() { fora.prev = true; }, stopPropagation() {} });
  assert.ok(fora.prev, 'clique fora do overlay bloqueado');
  const dentro = { prev: false };
  documento.listeners.click[0]({ target: overlay, preventDefault() { dentro.prev = true; }, stopPropagation() {} });
  assert.ok(!dentro.prev, 'clique no próprio overlay não é bloqueado');
});

// ---- Rodada 5, item 1: bloqueio por COMPORTAÇÃO (não só presença no DOM) --

test('teclado em elemento focado por baixo do overlay não dispara ação', () => {
  const { documento, pagina } = executarOverlay({ tela: 'portal' });
  let acao = 0;
  let tecla = 0;
  const botaoFocado = criarElemento('button'); // ex.: "Finalizar" já focado
  botaoFocado.addEventListener('click', () => { acao++; });
  botaoFocado.addEventListener('keydown', () => { tecla++; });
  pagina.appendChild(botaoFocado);

  const ev = disparar(documento, 'keydown', botaoFocado); // Enter/Espaço
  assert.ok(ev.previsto && ev.parado, 'keydown bloqueado em fase de captura');
  assert.equal(tecla, 0, 'handler de teclado do elemento focado NÃO rodou');
  const clique = disparar(documento, 'click', botaoFocado); // ativação por teclado
  assert.equal(acao, 0, 'ação do botão focado NÃO disparou');
  assert.ok(clique.previsto);
});

test('submit de formulário por baixo do overlay não chega ao handler', () => {
  const { documento, pagina } = executarOverlay({ tela: 'painel' });
  let enviou = false;
  const form = criarElemento('form');
  form.addEventListener('submit', () => { enviou = true; });
  pagina.appendChild(form);
  const ev = disparar(documento, 'submit', form);
  assert.ok(ev.previsto && ev.parado, 'submit bloqueado em captura');
  assert.equal(enviou, false, 'handler de submit da página NÃO foi chamado');
});

test('eventos por teclado nos controles do próprio overlay seguem funcionando', () => {
  const { documento } = executarOverlay({ tela: 'inicial' });
  const overlay = documento.getElementById('cna-falha-global');
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  const ev = disparar(documento, 'keydown', botao); // Enter no botão de recuperação
  assert.equal(ev.previsto, false, 'teclado no botão de recuperação não é bloqueado');
});

test('inert por baixo é aplicado e RESTAURADO só após recuperação bem-sucedida', async () => {
  const tauri = { core: { invoke: () => Promise.resolve() } };
  const { documento, pagina } = executarOverlay({ tela: 'conclusao', tauri });
  assert.equal(pagina.inert, true, 'página por baixo ficou inert');
  const overlay = documento.getElementById('cna-falha-global');
  let botao = null;
  const acha = el => { if (el.tag === 'button') botao = el; el.children.forEach(acha); };
  acha(overlay);
  await botao.clicar();
  assert.equal(pagina.inert, false, 'interação restaurada após reinício confirmado');
  assert.equal((documento.listeners.keydown || []).length, 0, 'bloqueios removidos');
  assert.equal((documento.listeners.submit || []).length, 0);
  // Com a página desbloqueada, o evento chega ao handler.
  let acao = 0;
  const alvo = criarElemento('button');
  alvo.addEventListener('click', () => { acao++; });
  pagina.appendChild(alvo);
  disparar(documento, 'click', alvo);
  assert.equal(acao, 1, 'clique volta a funcionar após recuperação');
});

// ---- Item 3: nenhuma aplicação continua após perda de conexão ------------

function gerenciadorFalso(encerrado = false) {
  const chamadas = [];
  return { chamadas, encerrado, encerrar: codigo => chamadas.push(codigo) };
}

test('desconexão inesperada: evento estruturado + encerramento imediato', () => {
  const browser = new EventEmitter();
  const gerenciador = gerenciadorFalso(false);
  const eventos = [];
  vigiarConexao({ browser, gerenciador, evento: (e, d) => eventos.push({ e, d }) });
  browser.emit('disconnected');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].e, 'FLUXO_ERRO');
  assert.equal(eventos[0].d.codigo, 'ERRO_CONEXAO_PERDIDA', 'código FECHADO');
  assert.deepEqual(gerenciador.chamadas, [1], 'encerramento seguro acionado');
});

test('desconexão durante o PRÓPRIO encerramento: nada é reemitido', () => {
  const browser = new EventEmitter();
  const gerenciador = gerenciadorFalso(true); // já encerrando
  const eventos = [];
  vigiarConexao({ browser, gerenciador, evento: (e, d) => eventos.push({ e, d }) });
  browser.emit('disconnected');
  assert.equal(eventos.length, 0, 'sem evento duplicado');
  assert.deepEqual(gerenciador.chamadas, [], 'sem re-encerramento');
});

test('guarda de aplicação: isConnected() verificado ANTES de aplicar (appliedRefs intocado sem confirmação)', () => {
  // Invariante estrutural: o fluxo não inicia a aplicação sem conexão viva.
  const fluxo = fs.readFileSync(path.join(__dirname, '..', 'src-node', 'orquestrador.js'), 'utf8');
  const guarda = fluxo.indexOf('browser.isConnected()');
  const aplica = fluxo.indexOf('applyAcceptedCorrections({ page');
  assert.ok(guarda >= 0, 'guarda de conexão presente no orquestrador');
  assert.ok(aplica >= 0);
  assert.ok(guarda < aplica, 'guarda vem ANTES da aplicação');
});
