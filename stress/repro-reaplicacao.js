// Repro determinístico: navegador morre na 2ª aplicação; re-invocação do
// executor deve reprocessar a entrada restante (appliedRefs pula a 1ª).
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CFG = require('../lib/config');
const portal = require('../lib/portal');
const { applyAcceptedCorrections } = require('../executor');

const NONCE = 'a1b2c3';
const ENUNCIADO = 'Write 3 sentences about your weekend.';
const RESPOSTA = 'I went to the park with my friends. It was fun and we played soccer all afternoon.';
const REFS = [1, 2, 3].map(n => `C100001 S20000${n} U300001 L400001 A50000${n}`);

function bloco(n) {
  return `#### Atividade: Unit 1 Lesson 1 - Atividade ${n} [${REFS[n - 1]}]\n\n` +
    `**Enunciado:**\n${ENUNCIADO}\n\n**Resposta do aluno:**\n` +
    `<<<RESPOSTA-INICIO-${NONCE}>>>\n${RESPOSTA}\n<<<RESPOSTA-FIM-${NONCE}>>>\n\n` +
    `**Classificação:** CORRETO\n\n**Score:** 90\n\n**Flag:** NENHUM\n\n**Revisão:** NAO\n\n` +
    `**Feedback:**\nYou did well using the past simple. Keep writing more sentences like this!\n\n---\n`;
}

function dadosFicticios() {
  return {
    collection: { nonce: NONCE, batches: [{ num: 1, name: 'lote-01.md', refs: REFS, total: 3 }] },
    classes: [{
      students: [1, 2, 3].map(n => ({
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

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-repro-'));
  const arquivo = path.join(dir, 'lote-01.md');
  fs.writeFileSync(arquivo, `<!-- CNA CORRETOR - lote 1/1 - nonce ${NONCE} -->\n\n${bloco(1)}${bloco(2)}${bloco(3)}_Fim do lote 1._\n`);
  for (const k of ['ANSWERS_FILE', 'REPORT_FILE', 'REVISAO_FILE', 'RELATORIO_IA_FILE']) CFG[k] = path.join(dir, k.toLowerCase() + '.json');
  const portalSalvo = Object.fromEntries(
    ['activityUrl', 'readBreadcrumb', 'readActivity', 'isCorrected', 'fillCorrection', 'finalize'].map(k => [k, portal[k]])
  );
  portal.activityUrl = () => 'https://app.cna.com.br/fake';
  portal.readBreadcrumb = async () => ({ ok: true, title: '' });
  portal.readActivity = async () => ({ captured: true, question: ENUNCIADO, answer: RESPOSTA });
  portal.isCorrected = async () => false;
  portal.fillCorrection = async () => ({ ok: true, readyToFinish: true });
  portal.finalize = async () => ({ ok: true });

  const dados = dadosFicticios();
  try {
    // Tentativa 1: navegador morre na 2ª navegação (erro real do Playwright).
    let gotos = 0;
    const pageMorta = { goto: async () => { gotos++; if (gotos >= 2) throw new Error('page.goto: Target page, context or browser has been closed'); } };
    const r1 = await applyAcceptedCorrections({ page: pageMorta, files: [arquivo], data: dados, onProgress: () => {} });
    console.log('tentativa 1: finalizadas =', r1.stats.finalizadasNestaExecucao, '| appliedRefs =', dados.appliedRefs.length);
    console.log('  resultados:', r1.results.map(r => `${r.ref.slice(-6)}:${r.status}`).join(' '));

    // Tentativa 2: navegador novo (stub funciona). appliedRefs deve pular a 1ª.
    const pageBoa = { goto: async () => {} };
    const r2 = await applyAcceptedCorrections({ page: pageBoa, files: [arquivo], data: dados, onProgress: () => {} });
    console.log('tentativa 2: finalizadas =', r2.stats.finalizadasNestaExecucao, '| appliedRefs =', dados.appliedRefs.length);
    console.log('  resultados:', r2.results.map(r => `${r.ref.slice(-6)}:${r.status}${r.reasons && r.reasons.length ? '(' + r.reasons.join(';').slice(0, 80) + ')' : ''}`).join(' '));
    assert.equal(dados.appliedRefs.length, 3, 're-invocação deve aplicar o restante');
    console.log('REPRO OK: re-invocação reprocessou o restante');
  } finally {
    Object.entries(portalSalvo).forEach(([k, v]) => { portal[k] = v; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error('REPRO FALHOU:', e.message); process.exit(1); });
