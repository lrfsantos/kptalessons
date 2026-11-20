// Preflight da distribuição portátil: valida Node, Playwright e Chromium
// antes de iniciar o programa. Não instala nada e não usa navegador pessoal.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const pkg = require('./package.json');

const MIN_NODE = 20;

function parseMajor(version) {
  const m = String(version || '').match(/^v?(\d+)/);
  return m ? Number(m[1]) : 0;
}

(async () => {
  const problems = [];
  const nodeMajor = parseMajor(process.version);
  if (nodeMajor < MIN_NODE)
    problems.push(`Node ${process.version} é mais antigo que o mínimo v${MIN_NODE}.`);
  else
    console.log(`Node portátil: ${process.version} (OK)`);

  const declared = (pkg.dependencies || {})['playwright-core'] || '(ausente)';
  let installed = '(indisponível)';
  try { installed = require('playwright-core/package.json').version; } catch { /* ignorado */ }
  console.log(`Playwright: ${installed} declarado como ${declared}`);
  if (installed === '(indisponível)') problems.push('playwright-core não está instalado na pasta.');

  const exe = chromium.executablePath();
  if (!exe || !fs.existsSync(exe))
    problems.push('Chromium portátil não encontrado em runtime/ms-playwright: ' + (exe || '(caminho vazio)'));
  else {
    console.log('Chromium portátil: OK');
    let browser = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent('<!doctype html><title>ok</title>');
      if (await page.title() !== 'ok') problems.push('Chromium iniciou, mas a página de teste falhou.');
    } catch (err) {
      problems.push('Falha ao iniciar o Chromium portátil: ' + err.message);
    } finally {
      if (browser) { try { await browser.close(); } catch { /* ignorado */ } }
    }
  }

  if (problems.length) {
    console.error('\nPRE-FLIGHT FALHOU:');
    for (const p of problems) console.error(' - ' + p);
    process.exit(1);
  }
  console.log('\nPre-flight concluído: componentes locais OK.');
})().catch(err => { console.error('Pre-flight falhou: ' + err.message); process.exit(1); });
