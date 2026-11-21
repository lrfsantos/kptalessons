// Tela de conclusão: métricas reais da execução (atividades, não lotes).
// Parâmetros enviados pelo orquestrador:
//   finalizadas, jaCorrigidas, revisao, falhas — contagens de atividades
//   pasta  — pasta de resultados (quando houve revisão manual exportada)
//   modo=vazio — não havia atividades pendentes
//   modo=demonstracao — execução de demonstração (aviso da demo, via chamador)
//   erro   — mensagem de falha (a tela NÃO é totalmente positiva neste caso)
const q = new URLSearchParams(location.search);
const resumo = document.getElementById('resumo');
const aviso = document.getElementById('avisoFinal');
const avisoTitulo = document.getElementById('avisoFinalTitulo');
const avisoTexto = document.getElementById('avisoFinalTexto');

function metricasVisiveis(visiveis) {
  for (const id of ['finalizadas', 'jaCorrigidas', 'revisao', 'falhas']) {
    document.getElementById(id).parentElement.classList.toggle('hidden', !visiveis);
  }
}

if (q.get('modo') === 'vazio') {
  metricasVisiveis(false);
  resumo.textContent = 'Não há atividades pendentes. Tudo em dia!';
} else if (q.get('modo') === 'demonstracao') {
  metricasVisiveis(false);
  resumo.textContent = 'Demonstração concluída: nenhuma atividade real foi alterada.';
} else if (q.get('erro')) {
  metricasVisiveis(false);
  resumo.textContent = 'A execução não foi concluída.';
  aviso.hidden = false;
  avisoTitulo.textContent = 'Falha na execução. ';
  avisoTexto.textContent = q.get('erro');
} else {
  const atualizar = (id, param) => {
    const valor = q.get(param);
    if (valor != null) document.getElementById(id).textContent = valor;
  };
  atualizar('finalizadas', 'finalizadas');
  atualizar('jaCorrigidas', 'jaCorrigidas');
  atualizar('revisao', 'revisao');
  atualizar('falhas', 'falhas');

  const falhas = Number(q.get('falhas') || 0);
  const revisao = Number(q.get('revisao') || 0);
  if (falhas > 0) {
    aviso.hidden = false;
    avisoTitulo.textContent = 'Algumas atividades não puderam ser finalizadas. ';
    avisoTexto.textContent = 'Verifique o portal e tente novamente mais tarde.';
    resumo.textContent = 'Execução concluída com ressalvas.';
  } else if (revisao > 0) {
    aviso.hidden = false;
    avisoTitulo.textContent = 'Atividades para revisão manual. ';
    avisoTexto.textContent = 'Elas NÃO foram alteradas: corrija-as manualmente no portal.';
    resumo.textContent = 'Execução concluída.';
  } else {
    resumo.textContent = 'Execução concluída.';
  }

  const pasta = q.get('pasta');
  if (pasta) {
    const el = document.getElementById('pastaResultados');
    el.hidden = false;
    el.textContent = 'Lista das atividades para revisão salva em: ' + pasta;
  }
}
