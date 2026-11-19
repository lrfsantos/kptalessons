// ============================================================
// CNA Corretor — CORREÇÃO COMPLETA (um clique, sem comandos)
//
// Fluxo:
//   1. Retoma coleta incompleta ou roda o scrape (coleta das pendências),
//      com login automático na primeira vez.
//   2. Mostra os lotes gerados e MONITORA a pasta lotes/ automaticamente —
//      sem ENTER: detecta arquivos salvos, espera a cópia estabilizar,
//      valida nome/nonce/lote/refs e conta os devolvidos válidos.
//   3. Quando TODOS os lotes esperados estão válidos, roda o executor,
//      que preenche e FINALIZA cada atividade PRONTA (regra absoluta).
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CFG = require('./lib/config');
const md = require('./lib/md');

const POLL_MS = 1500;          // intervalo curto de verificação
const STABLE_CHECKS = 2;       // verificações consecutivas de tamanho/mtime

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Só refs com finalização CONFIRMADA entram em appliedRefs (regra absoluta).
function refsFinalizadas(filled, jaAplicadas = []) {
  return [...new Set([...jaAplicadas, ...filled.filter(r => r.finalized && r.status === 'PRONTA').map(r => r.ref)])];
}

// Verifica estabilidade de tamanho/data entre leituras consecutivas (§4).
function snapshotArquivos(dir, names) {
  const out = new Map();
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(dir, name));
      out.set(name, `${st.size}:${st.mtimeMs}`);
    } catch { /* sumiu */ }
  }
  return out;
}

function run(script) {
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: CFG.ROOT });
  return r.status === 0;
}

function readAnswers() {
  try { return JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8')); } catch { return null; }
}

// Coleta incompleta: answers.json com nonce + lotes esperados, mas ainda com
// devolvidos faltando. Não deve ser arquivada por uma coleta nova.
function coletaIncompleta(data) {
  if (!data || !data.collection || !data.collection.batches) return false;
  const dir = CFG.LOTES_DIR;
  if (!fs.existsSync(dir)) return true;
  const faltam = data.collection.batches.some(b => {
    const dev = `lote-${String(b.num).padStart(2, '0')}.devolvido.md`;
    return !fs.existsSync(path.join(dir, dev));
  });
  return faltam && fs.readdirSync(dir).some(f => /^lote-\d+\.md$/.test(f));
}

function arquivosEstaveis() {
  // Retorna { name, size, mtime } após STABLE_CHECKS verificações iguais.
  if (!fs.existsSync(CFG.LOTES_DIR)) return [];
  const names = fs.readdirSync(CFG.LOTES_DIR).filter(f => md.RETURNED_NAME.test(f));
  return stableTracker.update(snapshotArquivos(CFG.LOTES_DIR, names));
}

const stableTracker = {
  state: new Map(),
  update(snapshot) {
    const out = [];
    for (const [name, key] of snapshot) {
      const prev = this.state.get(name);
      const count = prev && prev.key === key ? prev.count + 1 : 1;
      this.state.set(name, { key, count });
      if (count >= STABLE_CHECKS) out.push(name);
    }
    // limpa estado de arquivos que sumiram
    for (const name of [...this.state.keys()]) if (!snapshot.has(name)) this.state.delete(name);
    return out;
  },
};

function validados(collection) {
  const nomesEstaveis = arquivosEstaveis();
  const files = nomesEstaveis.map(name => ({ name, text: fs.readFileSync(path.join(CFG.LOTES_DIR, name), 'utf8') }));
  const result = md.inspectReturnedBatches(files, collection);
  const bons = result.files.filter(f => f.usable);
  return { bons, ruins: result.files.filter(f => !f.usable), estaveis: nomesEstaveis.length };
}

module.exports = { refsFinalizadas, snapshotArquivos, stableTracker, coletaIncompleta };

if (require.main === module) {
(async () => {
  console.log('CORRETOR CNA');
  console.log('============\n');

  // 1. Coleta (ou retomada) — login automático se a sessão faltar/expirar.
  let data = readAnswers();
  if (coletaIncompleta(data)) {
    console.log('Coleta anterior incompleta detectada. Retomando...\n');
    console.log('Os arquivos já recebidos foram preservados.\n');
  } else {
    console.log('Iniciando coleta de atividades...\n');
    let ok = run('scraper.js');
    if (!ok) {
      console.log('\nSessão CNA não encontrada. Abrindo navegador para login...\n');
      if (!run('login.js')) { console.error('\nNão foi possível fazer login. Tente novamente.'); process.exit(1); }
      ok = run('scraper.js');
    }
    if (!ok) { console.error('\nNão consegui coletar do portal. Verifique a conexão e tente novamente.'); process.exit(1); }
    data = readAnswers();
  }
  if (!data || !data.collection) { console.error('\nColeta sem identidade. Rode o programa novamente.'); process.exit(1); }

  const collection = data.collection;
  const total = data.classes
    ? data.classes.reduce((a, c) => a + c.students.reduce((b, s) => b + s.lessons.filter(l => l.pending).length, 0), 0)
    : 0;
  const esperados = collection.batches.length;
  console.log(`Coleta concluída!`);
  console.log(`Foram encontradas ${total} atividades.`);
  console.log(`Foram gerados ${esperados} lotes.\n`);
  console.log('Envie os arquivos Markdown para a IA de sua preferência.\n');
  console.log('Salve os retornos na pasta lotes/ usando os nomes:');
  for (const b of collection.batches)
    console.log(`- lote-${String(b.num).padStart(2, '0')}.devolvido.md`);
  console.log('\nAguardando os arquivos devolvidos...');

  // 2. Monitoramento automático (sem ENTER): espera TODOS os lotes válidos.
  const vistos = new Set();
  for (;;) {
    const { bons, ruins, estaveis } = validados(collection);
    if (estaveis === 0 && bons.length === 0 && ruins.length === 0) {
      await sleep(POLL_MS);
      continue;
    }
    for (const f of ruins) {
      if (!vistos.has(f.name)) {
        vistos.add(f.name);
        console.log(`${f.name}: PROBLEMA — ${f.issues.join('; ')}`);
        console.log('  Corrija o arquivo e salve novamente. Continuo aguardando.');
      }
    }
    for (const f of bons) {
      if (!vistos.has(f.name)) { vistos.add(f.name); console.log(`${f.name}: VALIDADO`); }
    }
    console.log(`Arquivos recebidos: ${bons.length}/${esperados}`);
    if (bons.length >= esperados) {
      const faltam = collection.batches
        .map(b => String(b.num).padStart(2, '0'))
        .filter(n => !bons.some(f => f.num === Number(n)));
      if (!faltam.length) break;
    }
    await sleep(POLL_MS);
  }

  console.log('\nTodos os lotes esperados foram recebidos e validados.');
  console.log('Iniciando aplicação automática...\n');

  // 3. Aplica no portal (preenche + FINALIZA as PRONTAS).
  if (!run('executor.js')) { console.error('\nA aplicação encontrou problemas. Reveja revisao.md.'); process.exit(1); }
  console.log('\nPROCESSAMENTO CONCLUÍDO. Confira revisao.md e report.json na pasta do programa.');
  process.exit(0);
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
}
