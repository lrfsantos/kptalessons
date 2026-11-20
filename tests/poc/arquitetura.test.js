// Teste de arquitetura da prova de conceito (requer o app Tauri aberto).
// Execute com o aplicativo rodando e a porta CDP informada:
//   $env:CNA_POC_CDP_PORT='<porta>'; node --test tests/poc/arquitetura.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const port = Number(process.env.CNA_POC_CDP_PORT || 0);
const chromium = require('../../node_modules/playwright-core').chromium;

test('arquitetura: Playwright controla o WebView2 da janela visivel', { skip: !port && 'rode com CNA_POC_CDP_PORT' }, async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const ctx = browser.contexts()[0];
    assert.ok(ctx, 'contexto do WebView2 disponivel');
    const pages = ctx.pages();
    assert.equal(pages.length, 1, 'uma unica pagina/janela no contexto');
    const page = pages[0];
    const url = page.url();
    assert.ok(
      /^https?:\/\/(127\.0\.0\.1|localhost|tauri\.localhost)\b/.test(url) || url.startsWith('tauri://'),
      'pagina atual e local (app ou servidor local): ' + url
    );
    const titulo = await page.title();
    assert.ok(titulo && titulo.trim().length > 0, 'titulo legivel');

    // Navegacao externa na mesma janela: nao pode criar nova janela/contexto.
    await page.goto('https://app.cna.com.br/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
    assert.match(page.url(), /app\.cna\.com\.br/, 'portal abriu na mesma janela');
    assert.equal(ctx.pages().length, 1, 'continua existindo uma unica pagina/janela');
  } finally {
    await browser.close().catch(() => {});
  }
});
