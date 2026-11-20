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
const { createStartupServer } = require('./lib/startup');

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

// Executa um script filho e espelha sua saída no console E na interface web.
// `stdio: pipe` (em vez de inherit) é o que permite enviar o progresso à página.
function run(script, ui) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: CFG.ROOT,
      env: process.env,
    });
    const forward = chunk => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        process.stdout.write(line + '\n');
        if (ui) ui.log(line);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.once('error', error => {
      const msg = 'Não foi possível iniciar ' + script + ': ' + error.message;
      console.error(msg);
      if (ui) ui.log(msg);
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

async function runPanel(collection, uiPage, uiBrowser, ui) {
  const panel = await createPanel({
    collection,
    lotesDir: CFG.LOTES_DIR,
    returnsDir: collectionReturnsDir(),
  });
  const onDisconnected = () => {
    if (!panel.getState().done) panel.abort('A janela do Painel Local foi fechada antes de todos os retornos serem recebidos.');
  };
  uiBrowser.on('disconnected', onDisconnected);
  try {
    ui.setStep('panel');
    ui.readyForPanel(panel.url);
    // Breve pausa para a interface mostrar "Tudo pronto" antes de trocar de página.
    await sleep(900);
    await uiPage.goto(panel.url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
    await uiPage.close(); // a aba da interface não é mais necessária
    console.log('\nPainel local aberto no Chromium.');
    console.log('Copie um lote ou todos, envie à IA e cole a resposta no painel.');
    console.log('O retorno pode conter um ou vários lotes. Não é necessário salvar ou renomear arquivos.\n');

    await panel.waitForComplete();
    panel.setPhase('applying');
    ui.setStep('apply');
    console.log('\nTodos os retornos foram recebidos e validados estruturalmente.');
    console.log('Iniciando aplicação no portal CNA...\n');

    const ok = await run('executor.js', ui);
    panel.setPhase(ok ? 'done' : 'error');
    ui.setStep(ok ? 'done' : 'panel');
    if (!ok) { ui.fail('A aplicação encontrou problemas. Reveja revisao.md.'); process.exitCode = 1; }
    await sleep(4500);
    return ok;
  } finally {
    uiBrowser.off('disconnected', onDisconnected);
    await panel.close();
  }
}

module.exports = {
  refsFinalizadas,
  snapshotArquivos,
  stableTracker,
};

if (require.main === module) {
  (async () => {
    session.cleanupStale();
    session.newSessionFile();

    // Interface web de progresso: sobe ANTES de qualquer etapa e abre no Chromium.
    const ui = await createStartupServer();
    let uiBrowser = null;
    ui.log('CORRETOR CNA — iniciando.');
    ui.setStep('preflight');

    try {
      const opened = await launch({ fresh: true, headless: false, viewport: null });
      uiBrowser = opened.browser;
      const uiPage = opened.page;
      await uiPage.goto(ui.url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
      console.log('Interface aberta: ' + ui.url);
      console.log('Abrindo um navegador novo. Faça login manualmente no CNA.\n');

      ui.setStep('login');
      if (!await run('login.js', ui)) {
        ui.fail('Login não concluído. Nada foi coletado.');
        console.error('\nLogin não concluído. Nada foi coletado.');
        process.exitCode = 1;
        return;
      }

      ui.setStep('collect');
      console.log('Iniciando uma coleta nova para a conta autenticada nesta execução...');
      if (!await run('scraper.js', ui)) {
        ui.fail('Não foi possível coletar as atividades.');
        console.error('\nNão foi possível coletar as atividades.');
        process.exitCode = 1;
        return;
      }
      const data = readAnswers();

      if (!data || !data.collection) {
        ui.fail('Nenhuma pendência encontrada. Nada a corrigir.');
        console.log('\nNenhuma pendência encontrada. Nada a corrigir.');
        return;
      }

      const total = (data.collection.batches || []).reduce(
        (sum, batch) => sum + Number(batch.total || (batch.refs || []).length), 0
      );
      ui.log('Coleta pronta: ' + total + ' atividades em ' + data.collection.batches.length + ' lotes.');
      console.log('Coleta pronta: ' + total + ' atividades em ' + data.collection.batches.length + ' lotes.');
      await runPanel(data.collection, uiPage, uiBrowser, ui);
      console.log('\nProcessamento encerrado. Consulte report.json e revisao.md.');
    } finally {
      session.cleanup();
      if (uiBrowser) { try { await uiBrowser.close(); } catch { /* já encerrado */ } }
      await ui.close();
    }
  })().catch(error => {
    try { session.cleanup(); } catch { /* best effort */ }
    console.error('Erro:', error.message);
    process.exit(1);
  });
}
