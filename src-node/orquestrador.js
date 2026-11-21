// ============================================================
// Orquestrador Node do Corretor CNA (app Tauri) — fluxo REAL.
//
// Uma única janela WebView2 visível, um único contexto, uma única
// conexão Playwright/CDP. Reutiliza login.js/scraper.js/executor.js
// com a página injetada (nada de launch(), nada de process.exit aqui).
//
// Fluxo: início → login manual no portal (mesma janela) → coleta
// (mesma página, barra de progresso) → painel local real → retorno
// da IA validado → aplicação com finalização automática → conclusão.
//
// Protocolo com o Rust (stdout): CNA_SIDECAR_READY, CNA_CDP_CONECTADO,
// CNA_PORTS, CNA_EVENT. Encerramento gracioso: stdin "shutdown".
// Uso: node orquestrador.js <porta-cdp>
// ============================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP_PORT = Number(process.argv[2] || process.env.CNA_POC_CDP_PORT || 0);
if (!CDP_PORT) { console.error('[orquestrador] porta CDP ausente'); process.exit(1); }

const BASE = path.resolve(__dirname, '..');
const { chromium } = require(path.join(BASE, 'node_modules', 'playwright-core'));
const { createPanel } = require(path.join(BASE, 'lib', 'panel.js'));
const CFG = require(path.join(BASE, 'lib', 'config.js'));
const { performLogin } = require(path.join(BASE, 'login.js'));
const { collectActivities } = require(path.join(BASE, 'scraper.js'));
const { applyAcceptedCorrections } = require(path.join(BASE, 'executor.js'));
const { criarGerenciador, fecharServidor, limparExecucoesAbandonadas } = require(path.join(__dirname, 'ciclovida.js'));
const { irPara } = require(path.join(__dirname, 'navegacao.js'));

// Dados da execução em %TEMP%: em produção resources/ é somente leitura.
// DIRETÓRIO SENSÍVEL: contém respostas dos alunos (answers.json), lotes,
// retornos da IA e evidências. É removido no encerramento (normal ou após
// erro) — ver gerenciador abaixo. Só sobrevive o que o professor precisa
// consultar (revisão manual), exportado para a pasta de resultados.
limparExecucoesAbandonadas('cna-corretor-run-');
const RUN_DIR = path.join(os.tmpdir(), `cna-corretor-run-${process.pid}-${Date.now()}`);
fs.mkdirSync(RUN_DIR, { recursive: true });
for (const [chave, nome] of Object.entries({
  ANSWERS_FILE: 'answers.json', REPORT_FILE: 'report.json', REVISAO_FILE: 'revisao.md',
  RELATORIO_IA_FILE: 'relatorio-ia.md', LOTES_DIR: 'lotes', RETURNS_DIR: 'lotes/retornos-da-IA',
})) CFG[chave] = path.join(RUN_DIR, nome);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- ciclo de vida: recursos ativos e encerramento idempotente ----------
const gerenciador = criarGerenciador({ runDir: RUN_DIR, exportarResultados: exportarResultadosProfessor });

// Política de retenção: o professor mantém a LISTA DE REVISÃO MANUAL
// (necessária para corrigir à mão no portal). Dados brutos (answers.json,
// lotes, retornos, relatórios com respostas) ficam só no RUN_DIR e são
// descartados. Retorna a pasta onde o arquivo foi exportado (mostrada na
// tela de conclusão) ou null se nada precisou ser exportado.
let pastaResultados = null;
function exportarResultadosProfessor() {
  if (pastaResultados) return pastaResultados;
  try {
    if (!fs.existsSync(CFG.REVISAO_FILE) || !fs.statSync(CFG.REVISAO_FILE).size) return null;
    const pasta = path.join(os.homedir(), 'Documents', 'Corretor CNA');
    fs.mkdirSync(pasta, { recursive: true });
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.copyFileSync(CFG.REVISAO_FILE, path.join(pasta, `revisao-manual-${carimbo}.md`));
    pastaResultados = pasta;
  } catch { /* melhor esforço: não impedir a limpeza por causa disto */ }
  return pastaResultados;
}

// Evidências locais (JSONL) — sem dados pessoais: só contagens e estágios.
const EVIDENCE_DIR = path.join(RUN_DIR, 'evidencias');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const LOG_FILE = path.join(EVIDENCE_DIR, 'evidencias.jsonl');
const { sanitizarEvento, sanitizarExcecao } = require(path.join(__dirname, 'eventos.js'));
function log(event, detail = {}) {
  // Esquema fechado: campos fora da allowlist nunca chegam às evidências.
  const e = sanitizarEvento(event, detail);
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), event: e.event, ...e.detail }) + '\n', 'utf8'); } catch { /* best effort */ }
}

// Protocolo estruturado com o Rust (nunca dados pessoais; esquema fechado).
function evento(event, detail = {}) {
  const e = sanitizarEvento(event, detail);
  console.log('CNA_EVENT ' + JSON.stringify(e));
  log(e.event, e.detail);
}

// --- telas locais (início/progresso/conclusão) -------------------------
const { criarServidorTelas } = require(path.join(__dirname, 'telas.js'));
const server = criarServidorTelas();

// --- CDP ---------------------------------------------------------------
async function conectar(cdpPort) {
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  const deadline = Date.now() + 90000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      gerenciador.aoEncerrar(async () => {
        // Desconecta o Playwright SEM encerrar o próprio WebView2 (a janela
        // continua visível para o usuário até o app fechar).
        try { await browser.close(); } catch { /* já desconectado */ }
      });
      return browser;
    }
    catch (e) { lastErr = e.message; await sleep(700); }
  }
  throw new Error('não foi possível conectar ao WebView2 por CDP: ' + lastErr);
}

async function primeiroProcessoWeb(browser) {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('WebView2 sem contexto disponível');
  let pages = ctx.pages();
  if (!pages.length) pages = await ctx.waitForEvent('page', { timeout: 15000 }).then(p => [p]);
  return { ctx, page: pages[0] };
}

// Barra de estado sobre as páginas do portal durante coleta/aplicação.
// sessionStorage persiste entre navegações da MESMA aba: a barra volta
// automaticamente em cada página (addInitScript) e some quando vazia.
async function barraEstado(page, texto) {
  try {
    await page.evaluate(t => sessionStorage.setItem('__cnaBar', t || ''), texto);
    await page.evaluate(t => {
      let bar = document.getElementById('cna-barra-fluxo');
      if (!t) { if (bar) bar.remove(); return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'cna-barra-fluxo';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0F6157;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,Segoe UI,sans-serif;text-align:center';
        (document.body || document.documentElement).appendChild(bar);
      }
      bar.textContent = t;
    }, texto);
  } catch { /* página em navegação: addInitScript cuida da próxima */ }
}

// Registra a barra uma vez; ela reaparece automaticamente em cada navegação.
function registrarBarra(page) {
  return page.addInitScript(() => {
    const t = sessionStorage.getItem('__cnaBar');
    if (!t) return;
    const bar = document.createElement('div');
    bar.id = 'cna-barra-fluxo';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0F6157;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,Segoe UI,sans-serif;text-align:center';
    bar.textContent = t;
    (document.body || document.documentElement).appendChild(bar);
  });
}

// --- fluxo completo -----------------------------------------------------
async function rodarFluxo(demoPort) {
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const browser = await conectar(CDP_PORT);
  console.log('CNA_CDP_CONECTADO');
  const { ctx, page } = await primeiroProcessoWeb(browser);
  registrarBarra(page);
  evento('APP_PRONTO', {});

  // 1. Usuário clica "Iniciar correção" → portal CNA na MESMA janela.
  evento('INICIO_AGUARDANDO', {});
  await page.waitForURL('https://app.cna.com.br/**', { timeout: 0 });

  // 2. Login manual no portal (reutiliza performLogin; NÃO salva cookies:
  //    a sessão vive apenas no perfil temporário do WebView2).
  evento('LOGIN_REQUIRED', {});
  await performLogin({ page, onStatus: ev => evento(ev) });

  // 3. Coleta de atividades pendentes na MESMA página (mesma sessão).
  await barraEstado(page, 'Coletando atividades pendentes…');
  evento('COLLECTION_STARTED', {});
  const coleta = await collectActivities({ page, onProgress: (ev, d) => evento(ev, d) });
  log('coleta-status', { status: coleta.status, pendentes: coleta.pendentes });

  if (coleta.status === 'EMPTY') {
    await barraEstado(page, '');
    // Falha de navegação não vira sucesso: sem conclusão carregada, não emite COMPLETED.
    if (!await irPara(page, 'conclusao', demoBase + '/conclusao?modo=vazio', evento)) return;
    evento('COLLECTION_COMPLETED', { atividades: 0, lotes: 0 });
    return;
  }
  if (coleta.status === 'CAPTURE_FAILED') {
    await barraEstado(page, '');
    if (!await irPara(page, 'conclusao', demoBase + '/conclusao?erro=' + encodeURIComponent(
      'Havia atividades pendentes, mas nenhuma pôde ser capturada. Feche o aplicativo e tente novamente.'), evento)) return;
    evento('APPLICATION_FAILED', { etapa: 'coleta' });
    return;
  }

  // 4. Painel local REAL com os lotes da coleta (porta anunciada à allowlist).
  const panel = await createPanel({
    collection: coleta.collection,
    lotesDir: CFG.LOTES_DIR,
    returnsDir: CFG.RETURNS_DIR,
  });
  gerenciador.aoEncerrar(async () => {
    try { await panel.close(); } catch { /* já fechado */ }
  });
  const panelPort = Number(new URL(panel.url).port);
  const painelPath = new URL(panel.url).pathname;
  console.log('CNA_PORTS ' + JSON.stringify({ telasPort: demoPort, painelPort, painelPath }));
  evento('PANEL_READY', { lotes: coleta.collection.batches.length, atividades: coleta.collection.batches.reduce((n, b) => n + b.total, 0) });
  await barraEstado(page, '');
  // Painel não carregou: estado estruturado + fluxo termina com falha
  // (a aplicação NUNCA fica esperando indefinidamente por página ausente).
  if (!await irPara(page, 'painel', panel.url, evento)) {
    evento('APPLICATION_FAILED', { etapa: 'painel' });
    return;
  }

  // 5. Professor copia lotes → IA (fora do app) → cola retorno → valida.
  //    O painel aceita/rejeita com o parser real e grava retornos-da-IA.
  const estado = await panel.waitForComplete(); // aguarda todos os lotes
  evento('RETURN_ACCEPTED', { lotes: estado.receivedBatches, atividades: estado.receivedActivities });

  // 6. Aplicação: preenche e FINALIZA as PRONTAS (regra absoluta do produto);
  //    revisões nunca são tocadas; appliedRefs só com confirmação positiva.
  panel.setPhase('applying');
  evento('APPLICATION_STARTED', {});
  await barraEstado(page, 'Aplicando as correções no portal…');
  const files = fs.readdirSync(CFG.RETURNS_DIR)
    .filter(f => /^lote-\d{2,}\.md$/i.test(f))
    .map(f => path.join(CFG.RETURNS_DIR, f));
  const data = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
  const { stats } = await applyAcceptedCorrections({ page, files, data, onProgress: (ev, d) => evento(ev, d) });
  panel.setPhase('done');

  // 7. Conclusão com resumo honesto (só contagens confirmadas) + pasta de
  //    resultados quando houve revisão manual para o professor consultar.
  await barraEstado(page, '');
  const pasta = exportarResultadosProfessor();
  const params = new URLSearchParams({
    finalizadas: String(stats.finalizadasNestaExecucao),
    jaCorrigidas: String(stats.jaCorrigidasNoPortal),
    revisao: String(stats.revisaoManual),
    falhas: String(stats.falhasFinalizacao),
  });
  if (pasta) params.set('pasta', pasta);
  // Falha ao mostrar a conclusão não vira sucesso: sem APPLICATION_COMPLETED.
  if (!await irPara(page, 'conclusao', demoBase + '/conclusao?' + params.toString(), evento)) {
    evento('APPLICATION_FAILED', { etapa: 'conclusao' });
    return;
  }
  log('fluxo-concluido', { finalizadas: stats.finalizadasNestaExecucao, revisao: stats.revisaoManual });
  evento('APPLICATION_COMPLETED', {
    finalizadas: stats.finalizadasNestaExecucao,
    jaCorrigidas: stats.jaCorrigidasNoPortal,
    revisao: stats.revisaoManual,
  });
}

server.listen(0, '127.0.0.1', async () => {
  const demoPort = server.address().port;
  log('servidor-local-pronto', { port: demoPort });
  console.log('CNA_SIDECAR_READY ' + JSON.stringify({ demoPort }));
  // Encerramento gracioso: Rust escreve "shutdown" no stdin. A limpeza é
  // idempotente, remove os dados temporários sensíveis e SÓ então encerra
  // o processo (nunca process.exit imediato após server.close()).
  gerenciador.aoEncerrar(() => fecharServidor(server));
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (String(chunk).trim() !== 'shutdown') return;
    gerenciador.encerrar(0);
  });
  try {
    await rodarFluxo(demoPort);
  } catch (e) {
    // Mensagem humana sanitizada; detalhes técnicos ficam só nas evidências locais.
    log('fluxo-erro', sanitizarExcecao(e));
    evento('APPLICATION_FAILED', { etapa: 'fluxo' });
    try {
      const { page } = await primeiroProcessoWeb(await conectar(CDP_PORT));
      if (!await irPara(page, 'conclusao', `http://127.0.0.1:${demoPort}/conclusao?erro=` + encodeURIComponent(
        'Algo inesperado interrompeu o fluxo. Feche o aplicativo e tente novamente.'), evento)) return;
    } catch { /* janela já fechada */ }
  }
});
