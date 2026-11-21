const q = new URLSearchParams(location.search);
if (q.get('aceitos') != null) document.getElementById('aceitos').textContent = q.get('aceitos');
if (q.get('rejeitados') != null) document.getElementById('rejeitados').textContent = q.get('rejeitados');
if (q.get('erro')) {
  document.getElementById('resumo').textContent = 'A resposta não passou na validação. Veja os campos destacados.';
  document.getElementById('resumo').style.color = 'var(--erro-texto)';
}
