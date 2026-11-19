// ============================================================
// CNA Corretor — CONTA ATIVA (uma por instalação)
//
// Identificação é um nome escolhido pelo professor (não e-mail, não
// iniciais do avatar). Dados ficam em account.json, local e gitignored.
// Nunca misturamos cookies/sessão entre contas: trocar de conta apaga
// account.json + session.json e cria um contexto de navegador FRESH.
// ============================================================
const fs = require('fs');
const path = require('path');
const CFG = require('./config');

const ACCOUNT_FILE = path.join(CFG.ROOT, 'account.json');

function readAccount() {
  try {
    const a = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));
    return a && typeof a.name === 'string' && a.name.trim() ? { name: a.name.trim() } : null;
  } catch { return null; }
}

function saveAccount(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('nome da conta não pode ficar vazio');
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({ name: clean }, null, 2), 'utf8');
  return { name: clean };
}

// Limpa SOMENTE autenticação/identificação. Nunca toca em answers.json,
// lotes, relatórios, revisões ou qualquer dado de aluno.
function clearAuth() {
  for (const f of [ACCOUNT_FILE, CFG.STATE_FILE]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* já removido */ }
  }
}

function hasSessionFile() {
  return fs.existsSync(CFG.STATE_FILE);
}

// Instalação antiga: há sessão, mas ainda não há nome associado.
function legacySessionWithoutAccount() {
  return hasSessionFile() && !readAccount();
}

module.exports = { ACCOUNT_FILE, readAccount, saveAccount, clearAuth, hasSessionFile, legacySessionWithoutAccount };
