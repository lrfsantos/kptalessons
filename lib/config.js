// ============================================================
// CNA Corretor — configurações centrais
// Caminhos de arquivos e URLs usados por todos os scripts.
// ============================================================
const path = require('path');

const DIR = __dirname; // .../lib
const ROOT = path.join(DIR, '..');

module.exports = {
  ROOT,
  // Sessão salva pelo login.js
  STATE_FILE: path.join(ROOT, 'session.json'),

  // Portal do professor
  PORTAL_URL: 'https://app.cna.com.br',
  LOGIN_URL: 'https://app.cna.com.br/login',

  // Saída
  OUTPUT_DIR: path.join(ROOT, 'saida'),

  // Arquivos gerados
  ANSWERS_FILE: path.join(ROOT, 'answers.json'),
  REPORT_FILE: path.join(ROOT, 'report.json'),
  REVISAO_FILE: path.join(ROOT, 'revisao.md'),
  RESUMO_FILE: path.join(ROOT, 'respostas.md'),
  ALL_ANSWERS_FILE: path.join(ROOT, 'all_answers.txt'),
  DISCOVERY_DIR: path.join(ROOT, 'discovery'),

  // Browser
  CHANNEL: 'msedge', // tenta Edge primeiro (já vem instalado no Windows)
  VIEWPORT: { width: 1440, height: 900 },
  NAV_TIMEOUT: parseInt(process.env.NAV_TIMEOUT || '60000', 10),
  HEADLESS: String(process.env.HEADLESS || 'false').toLowerCase() === 'true',
  LOTE_SIZE: parseInt(process.env.LOTE_SIZE || '8', 10),
  LOTES_DIR: path.join(ROOT, 'lotes'),
};
