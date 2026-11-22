// ============================================================
// Servidor HTTP local das telas do aplicativo (início/progresso/conclusão).
// Escuta SOMENTE em 127.0.0.1, porta efêmera. Todas as respostas enviam
// CSP restritiva (as páginas são servidas por HTTP local — a CSP da
// origem Tauri não se transfere automaticamente).
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');

const PAGES = {
  '/': path.join(BASE, 'poc-ui', 'index.html'),
  '/progresso': path.join(BASE, 'poc-ui', 'progresso.html'),
  '/conclusao': path.join(BASE, 'poc-ui', 'conclusao.html'),
  '/styles.css': path.join(BASE, 'poc-ui', 'styles.css'),
  '/fluent.css': path.join(BASE, 'poc-ui', 'fluent.css'),
  '/app.js': path.join(BASE, 'poc-ui', 'app.js'),
  '/progresso.js': path.join(BASE, 'poc-ui', 'progresso.js'),
  '/conclusao.js': path.join(BASE, 'poc-ui', 'conclusao.js'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

// CSP restritiva, compatível com os recursos realmente usados pelas telas:
// scripts e estilos apenas locais (nada inline), fetch só para o próprio
// servidor. Sem permissões genéricas, sem unsafe-inline.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function criarServidorTelas() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = PAGES[url.pathname];
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Security-Policy': CSP });
      res.end('não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(file).pipe(res);
  });
}

module.exports = { criarServidorTelas, CSP, PAGES };
