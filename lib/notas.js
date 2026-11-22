// ============================================================
// CNA Corretor — POLÍTICA CENTRAL DE NOTAS (única fonte de verdade)
//
// Limites CORRETO/PARCIAL/INCORRETO usados por lib/guard.js (coerência
// classificação x score) e refletidos no prompt da IA em
// instrucoes_correcao.md. Alterar aqui exige espelhar no prompt.
// ============================================================

// CORRETO: 75–100 · PARCIAL: 50–74 · INCORRETO: 0–49
function expectedClassification(score) {
  const sc = Number(score);
  if (Number.isNaN(sc)) return null;
  if (sc >= 75) return 'CORRETO';
  if (sc >= 50) return 'PARCIAL';
  return 'INCORRETO';
}

module.exports = { expectedClassification };
