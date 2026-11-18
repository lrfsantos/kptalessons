// ============================================================
// CNA Corretor — SCRAPER
// Baixa as atividades escritas dos alunos do portal do professor
// (app.cna.com.br) usando a sessão salva no login.js.
//
// Modos:
//   node scraper.js            -> baixa recursos e salva em answers.json
//   node scraper.js --discover -> abre o portal e salva a estrutura da
//                                 página em discovery/ para você me
//                                 guiar na configuração dos seletores.
// ============================================================
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib/browser');
const CFG = require('./lib/config');

// ---------------------------------------------------------------
// SELETORES DO PORTAL
// Preenchidos conforme a navegação real (me guie pelo --discover).
// ---------------------------------------------------------------
const SELECTORS = {
  // Página que lista as atividades / correções (ex.: "Correções")
  activitiesPage: '',          // ex.: '/correcoes' ou seletor de link
  activityLink: '',            // seletor para abrir uma atividade
  studentItem: '',             // seletor do cartão/linha de cada aluno
  studentName: '',             // seletor do nome do aluno
  answerText: '',              // seletor do texto da resposta escrita
};

// ---------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------
function pa(mode, extra = []) {
  return [
    'Uso: node scraper.js [--discover]',
    '',
    'Modos:',
    '   (sem flags)   baixa as atividades e salva em answers.json',
    '   --discover    abre o portal e grava a estrutura em discovery/',
    ...extra,
  ].join('\n') + (mode === 'ok' ? '' : '\n\nPor enquanto preencha os SELETORES no topo do arquivo.');
}

function escId(name) {
  return String(name || 'sem-nome').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

// ---------------------------------------------------------------
// Modo DISCOVERY — te ajuda a me mostrar a estrutura do portal
// ---------------------------------------------------------------
async function discover(page) {
  fs.mkdirSync(CFG.DISCOVERY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(CFG.DISCOVERY_DIR, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log('🔎 Modo discovery. O navegador abriu logado.');
  console.log('   Navegue até a página das atividades escritas que você corrige.');
  console.log('   A cada tela, pressione ENTER no terminal para salvar a estrutura.');
  console.log('   Digite "sair" e ENTER para encerrar.\n');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));

  let i = 0;
  for (;;) {
    const cmd = await ask(`[tela ${++i}] Buscar em: (URL | obter | tudo | sair) `);
    const c = cmd.trim().toLowerCase();
    if (c === 'sair') break;

    if (c && c !== 'obter' && c !== 'tudo' && c.startsWith('http')) {
      await page.goto(c, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
    }

    // HTML cru
    const html = await page.content();
    fs.writeFileSync(path.join(outDir, `tela_${i}.html`), html);

    // Lista de candidatos a seletor (elementos com texto relevante)
    const candidates = await page.evaluate(() => {
      const out = [];
      const sel = 'a, button, [role=button], input[type=text], textarea, .card, li, .list-item, table tr, [class*=answer], [class*=aluno], [class*=student]';
      document.querySelectorAll(sel).forEach((el, idx) => {
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        const cls = el.className && typeof el.className === 'string' ? el.className : '';
        if (text && !out.some(o => o.text === text && o.cls === cls)) {
          out.push({ idx, tag: el.tagName.toLowerCase(), cls, text });
        }
      });
      return out.slice(0, 400);
    });
    fs.writeFileSync(path.join(outDir, `candidatos_${i}.json`), JSON.stringify(candidates, null, 2));

    console.log(`   💾 Salvo tela ${i}: html + ${candidates.length} candidatos a seletor.`);
    console.log('   Resumo dos candidatos (tag | classe | texto):');
    for (let j = 0; j < Math.min(15, candidates.length); j++) {
      const f = candidates[j];
      console.log(`     ${f.idx} <${f.tag}> .${f.cls.slice(0, 40)} | ${f.text.slice(0, 60)}`);
    }
  }
  rl.close();
  console.log('\n✅ Discovery salvo em:', outDir);
  console.log('   Copie o caminho acima para mim e eu monto os seletores.');
}

// ---------------------------------------------------------------
// Modo principal — baixar atividades
// ---------------------------------------------------------------
async function scrape(page) {
  if (!SELECTORS.activitiesPage) {
    console.error(pa('err'));
    process.exit(1);
  }

  // 1. Vai para a página de atividades
  const url = SELECTORS.activitiesPage.startsWith('http')
    ? SELECTORS.activitiesPage
    : CFG.PORTAL_URL + SELECTORS.activitiesPage;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.NAV_TIMEOUT });
  console.log('🌐 Abri:', page.url());

  // 2. Coleta as atividades/alunos
  const results = [];
  // (Preenchido depois de mapear a estrutura real — ver --discover)

  // Grava qualquer dado parcial até aqui
  fs.writeFileSync(CFG.ANSWERS_FILE, JSON.stringify(results, null, 2));
  console.log('💾 Parcial salvo em answers.json (' + results.length + ' itens).');
}

// ---------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------
(async () => {
  const flag = process.argv.includes('--discover');
  const mode = flag ? 'discovery' : 'scrape';
  console.log(`🚀 CNA Corretor — scraper (modo: ${mode})`);

  if (!fs.existsSync(CFG.STATE_FILE)) {
    console.error('❌ Nenhuma sessão. Rode primeiro:  npm run login');
    process.exit(1);
  }

  const { browser, page, usedSavedSession } = await launch();
  if (!usedSavedSession) console.log('⚠️  Sessão usada, mas confira se ainda está logado.');

  try {
    if (mode === 'discovery') await discover(page);
    else await scrape(page);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
