// ============================================================
// Camada central de eventos — esquema FECHADO (rodada 3, item 6).
//
// Somente eventos e campos explicitamente permitidos podem chegar
// ao Rust e à interface. Objetos recebidos de callbacks NUNCA são
// encaminhados indiscriminadamente: cada campo é verificado contra
// a allowlist e valores de texto são redigidos.
//
// Nunca registrar: nomes; respostas; e-mails; telefones; CPFs;
// referências completas; cookies; tokens; senhas; URLs com
// parâmetros de autenticação; endpoints CDP.
// ============================================================
'use strict';

// Eventos conhecidos do fluxo (esquema fechado).
const EVENTOS = new Set([
  'APP_PRONTO', 'INICIO_AGUARDANDO',
  'LOGIN_REQUIRED', 'LOGIN_WAITING', 'LOGIN_CONFIRMED',
  'COLLECTION_STARTED', 'COLLECTION_COMPLETED', 'COLLECTION_FAILED',
  'PANEL_READY', 'RETURN_ACCEPTED', 'RETURN_VALIDATED',
  'APPLICATION_STARTED', 'ACTIVITY_FINALIZED', 'REVIEW_REQUIRED',
  'APPLICATION_COMPLETED', 'APPLICATION_FAILED',
  'NAVEGACAO_FALHOU', 'FLUXO_ERRO',
  'coleta-status', 'servidor-local-pronto', 'fluxo-concluido',
  'fluxo-erro', 'navegacao-falhou',
]);

// Campos fechados: apenas contagens e estágios/bandeiras do fluxo.
const CAMPOS = new Set([
  'atividades', 'lotes', 'turmas', 'comPendencias', 'capturasFalhas',
  'pendentes', 'prontas', 'revisao', 'finalizadas', 'jaCorrigidas',
  'falhas', 'recebidos', 'etapa', 'destino', 'status', 'port',
  // Exceções sanitizadas (texto redigido por sanitizarTexto):
  'mensagem', 'tipo',
]);

// Redação de padrões sensíveis em textos livres (defesa em profundidade).
const REDACOES = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\b\d{2}\s?\d{4,5}-?\d{4}\b/g, '[TELEFONE]'],
  [/\b(?:\d{4}[ -]){3}\d{4}\b/g, '[CARTAO]'],
  [/devtools?:\/\/\S+|ws:\/\/\S+/gi, '[CDP]'],
  [/https?:\/\/\S+/gi, '[URL]'],
  [/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/g, '[TOKEN]'],
];

function sanitizarTexto(texto) {
  let s = String(texto == null ? '' : texto);
  for (const [padrao, mascara] of REDACOES) s = s.replace(padrao, mascara);
  return s;
}

/** Filtra {event, detail} contra o esquema fechado. Campos fora da allowlist
 *  são descartados; textos permitidos são redigidos; números passam. */
function sanitizarEvento(event, detail = {}) {
  const ev = EVENTOS.has(event) ? event : 'EVENTO_DESCONHECIDO';
  const limpo = {};
  for (const [chave, valor] of Object.entries(detail || {})) {
    if (!CAMPOS.has(chave)) continue;
    if (typeof valor === 'number' && Number.isFinite(valor)) limpo[chave] = valor;
    else if (typeof valor === 'string' && valor.length <= 300) limpo[chave] = sanitizarTexto(valor);
  }
  return { event: ev, detail: limpo };
}

/** Sanitiza uma exceção antes de gravar evidências: tipo + mensagem redigida. */
function sanitizarExcecao(erro) {
  const tipo = erro && erro.name ? String(erro.name) : 'Erro';
  const bruto = erro && erro.message ? String(erro.message) : String(erro == null ? '' : erro);
  return { tipo, mensagem: sanitizarTexto(bruto).slice(0, 300) };
}

module.exports = { sanitizarEvento, sanitizarExcecao, sanitizarTexto, EVENTOS, CAMPOS };
