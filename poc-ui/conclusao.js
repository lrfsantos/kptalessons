const q = new URLSearchParams(location.search);
const resumo = document.getElementById('resumo');

if (q.get('modo') === 'vazio') {
  resumo.textContent = 'Não há atividades pendentes. Tudo em dia!';
} else if (q.get('erro')) {
  resumo.textContent = q.get('erro');
  resumo.style.color = 'var(--erro-texto)';
} else {
  const atualizar = (id, param) => {
    if (q.get(param) != null) document.getElementById(id).textContent = q.get(param);
  };
  atualizar('aceitos', 'finalizadas');
  atualizar('rejeitados', 'revisao');
  if (q.get('revisao') != null) {
    const rotulo = document.querySelector('#rejeitados + span, .metrica:nth-child(2) span');
    if (rotulo) rotulo.textContent = 'Para revisão manual';
  }
}
