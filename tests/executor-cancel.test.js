// Rodada 5, itens 2+5: cancelamento do executor por perda de conexão.
// 100% fixtures/mocks: nenhum portal real, nenhum clique em Finalizar real.
// O sinal abortado pelo monitor de saúde é o MESMO recebido pelo executor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const CFG = require('../lib/config');
const portal = require('../lib/portal');
const { applyAcceptedCorrections } = require('../executor');
const { vigiarConexao } = require('../src-node/saude');

const NONCE = 'a1b2c3';
const ENUNCIADO = 'Write 3 sentences about your weekend.';
const RESPOSTA = 'I went to the park with my friends. It was fun and we played soccer all afternoon.';
const REFS = [1, 2].map(n => `C100001 S20000${n} U300001 L400001 A50000${n}`);

function bloco(n) {
  return `#### Atividade: Unit 1 Lesson 1 - Atividade ${n} [${REFS[n - 1]}]\n\n` +
    `**Enunciado:**\n${ENUNCIADO}\n\n**Resposta do aluno:**\n` +
    `<<<RESPOSTA-INICIO-${NONCE}>>>\n${RESPOSTA}\n<<<RESPOSTA-FIM-${NONCE}>>>\n\n` +
    `**Classificação:** CORRETO\n\n**Score:** 90\n\n**Flag:** NENHUM\n\n**Revisão:** NAO\n\n` +
    `**Feedback:**\nYou did well using the past simple. Keep writing more sentences like this!\n\n---\n`;
}

function dadosFicticios() {
  return {
    collection: { nonce: NONCE, batches: [{ num: 1, name: 'lote-01.md', refs: REFS, total: 2 }] },
    classes: [{
      students: [1, 2].map(n => ({
        name: 'Aluno Ficticio',
        lessons: [{
          ids: { classId: '100001', studentId: `20000${n}`, unitId: '300001', lessonId: '400001', activityId: `50000${n}` },
          question: ENUNCIADO, answer: RESPOSTA,
        }],
      })),
    }],
    appliedRefs: [],
  };
}

// Prepara temp dir, rotas de saída e stubs do portal. Devolve restauradores.
function cenário({ aoPreencher = null, aoFinalizar = null, browser = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-cancel-test-'));
  const arquivo = path.join(dir, 'lote-01.md');
  fs.writeFileSync(arquivo, `<!-- CNA CORRETOR - lote 1/1 - nonce ${NONCE} -->\n\n${bloco(1)}${bloco(2)}_Fim do lote 1._\n`);
  const chaves = ['ANSWERS_FILE', 'REPORT_FILE', 'REVISAO_FILE', 'RELATORIO_IA_FILE'];
  const salvos = Object.fromEntries(chaves.map(k => [k, CFG[k]]));
  chaves.forEach(k => { CFG[k] = path.join(dir, k.toLowerCase() + '.json'); });
  const portalSalvo = Object.fromEntries(
    ['activityUrl', 'readBreadcrumb', 'readActivity', 'isCorrected', 'fillCorrection', 'finalize']
      .map(k => [k, portal[k]])
  );
  const chamadas = { goto: [], fill: [], finalize: [] };
  const eventos = [];
  portal.activityUrl = () => 'https://app.cna.com.br/fake';
  portal.readBreadcrumb = async () => ({ ok: true, title: '' });
  portal.readActivity = async () => ({ captured: true, question: ENUNCIADO, answer: RESPOSTA });
  portal.isCorrected = async () => false;
  portal.fillCorrection = async () => {
    chamadas.fill.push('fill');
    if (aoPreencher) aoPreencher();
    return { ok: true, readyToFinish: true };
  };
  portal.finalize = async () => {
    chamadas.finalize.push('finalize');
    if (aoFinalizar) aoFinalizar();
    return { ok: true };
  };
  const page = { goto: async () => { chamadas.goto.push('goto'); } };
  return {
    dir, arquivo, chamadas, eventos, page,
    restore() {
      chaves.forEach(k => { CFG[k] = salvos[k]; });
      Object.entries(portalSalvo).forEach(([k, v]) => { portal[k] = v; });
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('cancelamento no meio do loop: atividade corrente confirmada, restante não iniciada, appliedRefs intacto', async () => {
  const controlador = new AbortController();
  // A conexão cai DEPOIS da finalização confirmada da 1ª atividade.
  const c = cenário({ aoFinalizar: () => controlador.abort(new Error('conexão perdida')) });
  const dados = dadosFicticios();
  try {
    const { stats, results, aplicadas } = await applyAcceptedCorrections({
      page: c.page, files: [c.arquivo], data: dados, signal: controlador.signal,
      onProgress: (ev, d) => c.eventos.push({ ev, d }),
    });
    assert.deepEqual(c.chamadas.goto, ['goto'], 'nenhuma navegação para a 2ª atividade');
    assert.deepEqual(c.chamadas.fill, ['fill']);
    assert.deepEqual(c.chamadas.finalize, ['finalize']);
    assert.equal(stats.finalizadasNestaExecucao, 1, 'só a confirmação positiva conta');
    assert.deepEqual(aplicadas, [REFS[0]]);
    assert.deepEqual(dados.appliedRefs, [REFS[0]], 'appliedRefs só com confirmação');
    assert.equal(results[1].status, 'REVISAO');
    assert.match(results[1].reasons.join(' '), /não iniciada/);
    assert.ok(c.eventos.some(e => e.ev === 'FLUXO_ERRO' && e.d.codigo === 'ERRO_CONEXAO_PERDIDA'));
    assert.ok(!c.eventos.some(e => e.ev === 'APPLICATION_COMPLETED'), 'cancelamento não vira sucesso');
  } finally { c.restore(); }
});

test('cancelamento após preencher e antes da finalização: NÃO finaliza nem registra', async () => {
  const controlador = new AbortController();
  const c = cenário({ aoPreencher: () => controlador.abort(new Error('conexão perdida')) });
  const dados = dadosFicticios();
  try {
    const { stats, results } = await applyAcceptedCorrections({
      page: c.page, files: [c.arquivo], data: dados, signal: controlador.signal,
    });
    assert.deepEqual(c.chamadas.fill, ['fill']);
    assert.deepEqual(c.chamadas.finalize, [], 'Finalizar NUNCA foi solicitado');
    assert.equal(stats.finalizadasNestaExecucao, 0);
    assert.deepEqual(dados.appliedRefs, [], 'nenhum ref registrado sem confirmação');
    assert.match(results[0].reasons.join(' '), /não finalizada/);
  } finally { c.restore(); }
});

test('integração: disconnected → sinal abortado → nenhuma finalização nova (apenas mocks)', async () => {
  const browser = new EventEmitter();
  const controlador = new AbortController();
  const codigos = [];
  const eventosSaude = [];
  vigiarConexao({
    browser,
    gerenciador: { encerrado: false, encerrar: c => codigos.push(c) },
    evento: (e, d) => eventosSaude.push({ e, d }),
    controlador,
  });
  // A perda de conexão acontece no meio do preenchimento da 1ª atividade.
  const c = cenário({ aoPreencher: () => browser.emit('disconnected') });
  const dados = dadosFicticios();
  try {
    const { stats } = await applyAcceptedCorrections({
      page: c.page, files: [c.arquivo], data: dados, signal: controlador.signal,
    });
    assert.equal(controlador.signal.aborted, true, 'monitor abortou o sinal compartilhado');
    assert.deepEqual(codigos, [1], 'encerramento seguro acionado');
    assert.deepEqual(eventosSaude, [{ e: 'FLUXO_ERRO', d: { codigo: 'ERRO_CONEXAO_PERDIDA' } }]);
    assert.deepEqual(c.chamadas.finalize, [], 'nenhuma finalização após a queda');
    assert.equal(stats.finalizadasNestaExecucao, 0);
    assert.deepEqual(dados.appliedRefs, []);
  } finally { c.restore(); }
});

test('sem sinal de cancelamento, as duas PRONTAS são finalizadas (regra de negócio inalterada)', async () => {
  const c = cenário();
  const dados = dadosFicticios();
  try {
    const { stats } = await applyAcceptedCorrections({ page: c.page, files: [c.arquivo], data: dados });
    assert.equal(stats.finalizadasNestaExecucao, 2, 'finalização automática segue ativa quando saudável');
    assert.deepEqual(dados.appliedRefs, REFS);
  } finally { c.restore(); }
});
