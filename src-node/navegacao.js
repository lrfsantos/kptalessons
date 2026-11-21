// ============================================================
// Navegação do orquestrador — SEM ignorância silenciosa (rodada 3, item 7).
// Falha de navegação NUNCA vira sucesso: retorna false e emite estado
// estruturado (evento com destino e mensagem sanitizada).
// ============================================================
'use strict';
const { sanitizarExcecao } = require('./eventos');

/**
 * @param {object} page      Página Playwright.
 * @param {string} destino   Nome do estágio ('portal'|'painel'|'conclusao'...).
 * @param {string} url       URL de destino.
 * @param {function} [reportar]  Emite o evento estruturado (padrão: no-op, injetável p/ testes).
 * @returns {boolean} true somente se a página carregou (domcontentloaded).
 */
async function irPara(page, destino, url, reportar = () => {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return true;
  } catch (e) {
    const exc = sanitizarExcecao(e);
    reportar('NAVEGACAO_FALHOU', { destino, mensagem: exc.mensagem });
    return false;
  }
}

module.exports = { irPara };
