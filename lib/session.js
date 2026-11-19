// ============================================================
// CNA Corretor — SESSÃO TEMPORÁRIA POR EXECUÇÃO
//
// Não existe sessão persistente. O contexto do navegador é novo em
// cada execução. Para que login -> scrape -> apply usem o MESMO
// contexto sem gravar nada na pasta do programa, o estado é passado
// por um arquivo ÚNICO em %TEMP%, criado no início da execução e
// REMOVIDO no encerramento (normal ou com erro).
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'cna-corretor-sessao-';

const currentPath = () => process.env.CNA_SESSAO_TEMP || null;

function newSessionFile() {
  const p = path.join(os.tmpdir(), `${PREFIX}${process.pid}.json`);
  try { fs.writeFileSync(p, '{}', 'utf8'); } catch { /* segue sem arquivo */ }
  process.env.CNA_SESSAO_TEMP = p;
  return p;
}

function readState() {
  const p = currentPath();
  if (!p || !fs.existsSync(p)) return undefined;
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return s && Array.isArray(s.cookies) && s.cookies.length ? s : undefined;
  } catch { return undefined; }
}

async function saveState(context) {
  const p = currentPath();
  if (!p) throw new Error('sessão temporária não inicializada');
  await context.storageState({ path: p });
  return p;
}

function cleanup() {
  const p = currentPath();
  if (p) { try { fs.unlinkSync(p); } catch { /* já removido */ } }
}

function pidVivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Remove somente arquivos que o próprio programa criou e cuja execução
// já terminou. Nunca toca em perfis de Chrome/Edge ou pastas genéricas.
function cleanupStale() {
  let dir = [];
  try { dir = fs.readdirSync(os.tmpdir()); } catch { return 0; }
  let n = 0;
  for (const f of dir) {
    if (!f.startsWith(PREFIX) || !f.endsWith('.json')) continue;
    const pid = Number(f.slice(PREFIX.length, -5));
    if (pid === process.pid) continue;
    if (!Number.isFinite(pid) || !pidVivo(pid)) {
      try { fs.unlinkSync(path.join(os.tmpdir(), f)); n++; } catch { /* em uso */ }
    }
  }
  return n;
}

module.exports = { PREFIX, currentPath, newSessionFile, readState, saveState, cleanup, cleanupStale, pidVivo };
