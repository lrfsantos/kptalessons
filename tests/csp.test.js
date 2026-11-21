// CSP das páginas locais: servidores HTTP do app (telas e painel) enviam
// política restritiva; sem scripts/estilos inline nos HTML locais.
// Copiar/colar/importar/validar do painel continuam funcionando (testes do
// painel em panel.test.js usam o mesmo servidor com fixture).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarServidorTelas, CSP } = require('../src-node/telas');
const { createPanel } = require('../lib/panel');
const { writeFixture } = require('../src-node/fixture');

const PROIBIDOS = ["'unsafe-inline'", "'unsafe-eval'", 'data:', '*'];
function politicaRestritiva(csp) {
  assert.ok(csp, 'resposta tem Content-Security-Policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  for (const p of PROIBIDOS) {
    const escapado = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(!new RegExp(`script-src[^;]*${escapado}`).test(csp), `script-src não permite ${p}`);
  }
}

test('CSP declarada é restritiva (sem unsafe-inline, sem curingas)', () => {
  politicaRestritiva(CSP);
});

test('servidor de telas: HTML e CSS com CSP; rota desconhecida 404', async () => {
  const server = criarServidorTelas();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  try {
    const html = await fetch(`http://127.0.0.1:${porta}/`);
    assert.equal(html.status, 200);
    politicaRestritiva(html.headers.get('content-security-policy'));
    assert.match(await html.text(), /Corretor CNA/);
    const js = await fetch(`http://127.0.0.1:${porta}/app.js`);
    assert.equal(js.status, 200);
    politicaRestritiva(js.headers.get('content-security-policy'));
    const css = await fetch(`http://127.0.0.1:${porta}/styles.css`);
    assert.equal(css.status, 200);
    politicaRestritiva(css.headers.get('content-security-policy'));
    const ausente = await fetch(`http://127.0.0.1:${porta}/nao-existe`);
    assert.equal(ausente.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('painel: HTML com CSP, script externo no mesmo token, sem script inline', async () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'cna-csp-'));
  const fixture = writeFixture(run);
  const panel = await createPanel({ collection: fixture.collection, lotesDir: run, returnsDir: run });
  try {
    const res = await fetch(panel.url);
    assert.equal(res.status, 200);
    politicaRestritiva(res.headers.get('content-security-policy'));
    const html = await res.text();
    assert.match(html, /<script src="painel\.js">/);
    assert.ok(!/<script(?![^>]*src=)[^>]*>/.test(html), 'nenhum script inline no painel');
    // script externo serve pelo mesmo token do painel
    const js = await fetch(panel.url.replace(/\/$/, '') + '/painel.js');
    assert.equal(js.status, 200);
    politicaRestritiva(js.headers.get('content-security-policy'));
    const css = await fetch(panel.url.replace(/\/$/, '') + '/painel.css');
    assert.equal(css.status, 200);
    // assets fora do token continuam bloqueados
    const fora = await fetch(`http://127.0.0.1:${new URL(panel.url).port}/painel.js`);
    assert.equal(fora.status, 404, 'rota fora do token é rejeitada');
  } finally {
    await panel.close();
    fs.rmSync(run, { recursive: true, force: true });
  }
});

test('telas locais: nenhum script inline e nenhum atributo style= nos HTML', () => {
  const dir = path.join(__dirname, '..', 'poc-ui');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/<script(?![^>]*src=)/.test(html), `${f}: sem script inline`);
    assert.ok(!/\bstyle="/.test(html), `${f}: sem atributo style inline`);
    assert.ok(!/<style/.test(html), `${f}: sem <style> inline`);
  }
});
