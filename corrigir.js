// ============================================================
// CNA Corretor — fluxo completo com Painel Local de Correção.
// Login novo -> coleta -> copiar/colar com a IA -> aplicar e finalizar.
// Nenhuma sessão persiste entre execuções.
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CFG = require('./lib/config');
const session = require('./lib/session');
const { createPanel } = require('./lib/panel');
const { launch } = require('./lib/browser');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function refsFinalizadas(filled, jaAplicadas = []) {
  return [...new Set([...jaAplicadas, ...filled.filter(r => r.finalized && r.status === 'PRONTA').map(r => r.ref)])];
}

function snapshotArquivos(dir, names) {
  const out = new Map();
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(dir, name));
      out.set(name, st.size + ':' + st.mtimeMs);
    } catch { /* arquivo ausente */ }
  }
  return out;
}

function run(script) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      cwd: CFG.ROOT,
      env: process.env,
    });
    child.once('error', error => {
      console.error('Não foi possível iniciar ' + script + ': ' + error.message);
      resolve(false);
    });
    child.once('close', code => resolve(code === 0));
  });
}

function readAnswers() {
  try { return JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8')); }
  catch { return null; }
}

function collectionReturnsDir() {
  return CFG.RETURNS_DIR || path.join(CFG.LOTES_DIR, 'retornos-da-IA');
}

function coletaIncompleta(data) {
  if (!data || !data.collection || !Array.isArray(data.collection.batches)) return false;
  const returnsDir = collectionReturnsDir();
  const missing = data.collection.batches.some(batch => {
    const num = String(batch.num).padStart(2, '0');
    return !fs.existsSync(path.join(returnsDir, 'lote-' + num + '.md')) &&
      !fs.existsSync(path.join(CFG.LOTES_DIR, 'lote-' + num + '.devolvido.md'));
  });
  const hasOriginals = fs.existsSync(CFG.LOTES_DIR) &&
    fs.readdirSync(CFG.LOTES_DIR).some(name => /^lote-\d{2,}\.md$/i.test(name));
  return missing && hasOriginals;
}

function migrateLegacyReturns(collection) {
  const returnsDir = collectionReturnsDir();
  fs.mkdirSync(returnsDir, { recursive: true });
  let moved = 0;
  for (const batch of collection.batches || []) {
    const num = String(batch.num).padStart(2, '0');
    const oldFile = path.join(CFG.LOTES_DIR, 'lote-' + num + '.devolvido.md');
    const newFile = path.join(returnsDir, 'lote-' + num + '.md');
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
      fs.renameSync(oldFile, newFile);
      moved++;
    }
  }
  return moved;
}

const stableTracker = {
  state: new Map(),
  update(snapshot) {
    const out = [];
    for (const [name, key] of snapshot) {
      const prev = this.state.get(name);
      const count = prev && prev.key === key ? prev.count + 1 : 1;
      this.state.set(name, { key, count });
      if (count >= 2) out.push(name);
    }
    for (const name of [...this.state.keys()]) if (!snapshot.has(name)) this.state.delete(name);
    return out;
  },
};

async function runPanel(collection) {
  const panel = await createPanel({
    collection,
    lotesDir: CFG.LOTES_DIR,
    returnsDir: collectionReturnsDir(),
  });
  let panelBrowser = null;
  try {
    const opened = await launch({ fresh: true, headless: false });
    panelBrowser = opened.browser;
    panelBrowser.on('disconnected', () => {
      if (!panel.getState().done) panel.abort('A janela do Painel Local foi fechada antes de todos os retornos serem recebidos.');
    });
    await opened.page.goto(panel.url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
    console.log('\nPainel local aberto no Chromium.');
    console.log('Copie um lote ou todos, envie à IA e cole a resposta no painel.');
    console.log('O retorno pode conter um ou vários lotes. Não é necessário salvar ou renomear arquivos.\n');

    await panel.waitForComplete();
    panel.setPhase('applying');
    console.log('\nTodos os retornos foram recebidos e validados estruturalmente.');
    console.log('Iniciando aplicação no portal CNA...\n');

    const ok = await run('executor.js');
    panel.setPhase(ok ? 'done' : 'error');
    if (!ok) process.exitCode = 1;
    await sleep(4500);
    return ok;
  } finally {
    if (panelBrowser) {
      try { await panelBrowser.close(); } catch { /* navegador já encerrado */ }
    }
    await panel.close();
  }
}

module.exports = {
  refsFinalizadas,
  snapshotArquivos,
  stableTracker,
  coletaIncompleta,
  migrateLegacyReturns,
};

if (require.main === module) {
  (async () => {
    console.log('CORRETOR CNA');
    console.log('============\n');
    session.cleanupStale();
    session.newSessionFile();

    try {
      console.log('Abrindo um navegador novo. Faça login manualmente no CNA.\n');
      if (!await run('login.js')) {
        console.error('\nLogin não concluído. Nada foi coletado.');
        process.exitCode = 1;
        return;
      }

      console.log('\nIniciando uma coleta nova para a conta autenticada nesta execução...');
      if (!await run('scraper.js')) {
        console.error('\nNão foi possível coletar as atividades.');
        process.exitCode = 1;
        return;
      }
      const data = readAnswers();

      if (!data || !data.collection) {
        console.log('\nNenhuma pendência encontrada. Nada a corrigir.');
        return;
      }

      const total = (data.collection.batches || []).reduce(
        (sum, batch) => sum + Number(batch.total || (batch.refs || []).length), 0
      );
      console.log('Coleta pronta: ' + total + ' atividades em ' + data.collection.batches.length + ' lotes.');
      await runPanel(data.collection);
      console.log('\nProcessamento encerrado. Consulte report.json e revisao.md.');
    } finally {
      session.cleanup();
    }
  })().catch(error => {
    try { session.cleanup(); } catch { /* best effort */ }
    console.error('Erro:', error.message);
    process.exit(1);
  });
}
