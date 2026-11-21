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
  // Erros: código FECHADO + mensagem definida pela interface (nunca texto
  // bruto de exceções — ver CODIGOS_ERRO/MENSAGENS_ERRO).
  'codigo', 'mensagem', 'tipo',
]);

// ------------------------------------------------------------------
// Erros: códigos FECHADOS e mensagens definidas pela interface
// (rodada 4, item 4). Exceções NUNCA entregam seu texto bruto: são
// classificadas num código fechado e viram a mensagem fixa da UI.
// ------------------------------------------------------------------
const REGRAS_CODIGO = [
  [/timed?\s?out|timeout|excediu/i, 'ERRO_TEMPO_ESGOTADO'],
  [/net::|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION|ERR_NAME|ERR_INTERNET/i, 'ERRO_REDE'],
  [/target closed|browser closed|page closed|session closed|context closed|detached|disconnected|conexão perdida|EPIPE|EPERM/i, 'ERRO_CONEXAO_PERDIDA'],
];

const MENSAGENS_ERRO = {
  ERRO_TEMPO_ESGOTADO: 'A operação demorou mais do que o esperado e foi interrompida.',
  ERRO_REDE: 'Problema de comunicação com o portal. Verifique a conexão e tente novamente.',
  ERRO_CONEXAO_PERDIDA: 'A comunicação interna foi perdida. Reinicie o aplicativo.',
  ERRO_INESPERADO: 'Algo inesperado interrompeu a operação. Tente novamente.',
};

const CODIGOS_ERRO = new Set(Object.keys(MENSAGENS_ERRO));

/** Classifica uma exceção num código FECHADO (nada de texto livre). */
function codigoDoErro(erro) {
  const bruto = erro && erro.message ? String(erro.message) : String(erro == null ? '' : erro);
  for (const [padrao, codigo] of REGRAS_CODIGO) {
    if (padrao.test(bruto)) return codigo;
  }
  return 'ERRO_INESPERADO';
}

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

/** Sanitiza uma exceção: tipo + código FECHADO + mensagem fixa da interface.
 *  O texto bruto da exceção NUNCA é encaminhado (nem redigido): nomes,
 *  respostas, referências e texto do portal não podem vazar por mensagens. */
function sanitizarExcecao(erro) {
  const tipo = erro && erro.name ? String(erro.name) : 'Erro';
  const codigo = codigoDoErro(erro);
  return { tipo, codigo, mensagem: MENSAGENS_ERRO[codigo] };
}

module.exports = { sanitizarEvento, sanitizarExcecao, sanitizarTexto, codigoDoErro, CODIGOS_ERRO, MENSAGENS_ERRO, EVENTOS, CAMPOS };
