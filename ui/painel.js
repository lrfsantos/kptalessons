// Painel local de correção — lógica (servido pelo servidor local do painel,
// mesmo token de execução; CSP estrita: nada de script inline).
const base = location.pathname.replace(/\/$/, '');
const $ = id => document.getElementById(id);
let lastState = null;

async function api(path, options) {
  const response = await fetch(base + path, options || {});
  const data = await response.json();
  if (!response.ok) {
    const details = (data.globalIssues || []).join('\n');
    const perBatch = (data.rejectedBatches || []).map(b => 'Lote ' + String(b.num).padStart(2,'0') + ': ' + b.reasons.join('; ')).join('\n');
    throw new Error([data.error || 'Falha na comunicação com o painel.', details, perBatch].filter(Boolean).join('\n'));
  }
  return data;
}
function notice(message, type) {
  const el = $('result');
  el.textContent = message;
  el.className = 'notice ' + (type || 'info');
  el.classList.remove('hidden');
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notice('Conteúdo copiado. Agora cole na IA de sua preferência.', 'good');
  } catch (err) {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    document.body.appendChild(fallback);
    fallback.select();
    const ok = document.execCommand('copy');
    fallback.remove();
    if (!ok) throw new Error('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
    notice('Conteúdo copiado. Agora cole na IA de sua preferência.', 'good');
  }
}
async function copyBatch(num) {
  const data = await api('/api/batch/' + num);
  await copyText(data.content);
}
function updatePhase(state) {
  const el = $('phase');
  const names = { waiting:'Aguardando retornos', applying:'Aplicando no portal', done:'Concluído', error:'Erro no processamento' };
  el.textContent = names[state.phase] || 'Aguardando retornos';
  el.className = 'phase' + (state.phase === 'done' ? ' is-good' : state.phase === 'error' ? ' is-bad' : state.phase === 'applying' ? ' is-warn' : '');
}
async function refresh() {
  try {
    const state = await api('/api/state');
    lastState = state;
    $('total').textContent = state.totalActivities;
    $('received').textContent = state.receivedActivities;
    $('batchProgress').textContent = state.receivedBatches + ' / ' + state.batchCount;
    $('progressBar').style.width = (state.batchCount ? (100 * state.receivedBatches / state.batchCount) : 0) + '%';
    updatePhase(state);
    $('batches').replaceChildren();
    state.batches.forEach(batch => {
      const card = document.createElement('article');
      card.className = 'batch';
      const top = document.createElement('div');
      top.className = 'batch-top';
      const left = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'batch-title';
      title.textContent = 'Lote ' + String(batch.num).padStart(2,'0');
      const meta = document.createElement('div');
      meta.className = 'batch-meta';
      meta.textContent = batch.total + ' atividades';
      left.append(title, meta);
      const tag = document.createElement('span');
      tag.className = 'tag' + (batch.received ? ' received' : '');
      tag.textContent = batch.received ? 'Validado' : 'Aguardando';
      top.append(left, tag);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy';
      copy.textContent = batch.received ? 'Recebido' : 'Copiar lote';
      copy.disabled = batch.received;
      copy.addEventListener('click', () => copyBatch(batch.num).catch(e => notice(e.message, 'bad')));
      card.append(top, copy);
      $('batches').append(card);
    });
    $('copyAll').disabled = state.done || state.batches.every(b => b.received);
    if (state.done) $('complete').classList.remove('hidden');
    if (state.phase === 'applying') notice('Todos os lotes validados. Aplicando as correções no portal...', 'info');
    if (state.phase === 'done') notice('Processamento concluído. Veja o resumo na tela de conclusão do aplicativo.', 'good');
    if (state.phase === 'error') notice('O processamento encontrou um problema. Veja o resumo na tela de conclusão do aplicativo.', 'bad');
  } catch (e) {
    notice(e.message, 'bad');
  }
}
$('copyAll').addEventListener('click', async () => {
  try {
    const pending = (lastState && lastState.batches ? lastState.batches : []).filter(b => !b.received);
    if (!pending.length) return;
    const docs = await Promise.all(pending.map(b => api('/api/batch/' + b.num)));
    await copyText(docs.map(d => d.content).join('\n\n---\n\n'));
  } catch (e) { notice(e.message, 'bad'); }
});
$('submit').addEventListener('click', async () => {
  const text = $('answer').value;
  if (!text.trim()) { notice('Cole primeiro a resposta da IA.', 'warn'); return; }
  $('submit').disabled = true;
  $('submit').textContent = 'Validando...';
  try {
    const data = await api('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const accepted = (data.accepted || []).map(b => 'Lote ' + String(b.num).padStart(2,'0') + ' (' + b.activities + ' atividades)');
    const rejected = (data.rejectedBatches || []).map(b => 'Lote ' + String(b.num).padStart(2,'0') + ': ' + b.reasons.join('; '));
    const parts = [];
    if (accepted.length) parts.push('Recebido: ' + accepted.join(', ') + '.');
    if (rejected.length) parts.push('Não aceito: ' + rejected.join(' | '));
    if (!accepted.length && !rejected.length) parts.push('Nenhum lote novo recebido. Verifique se este retorno já foi enviado.');
    const partial = rejected.length > 0;
    notice(parts.join(' '), partial ? 'warn' : 'good');
    await refresh();
  } catch (e) {
    notice(e.message, 'bad');
  } finally {
    $('submit').disabled = false;
    $('submit').textContent = 'Validar e receber retorno';
  }
});
$('clear').addEventListener('click', () => { $('answer').value = ''; $('charCount').textContent = '0 caracteres'; });
$('answer').addEventListener('input', () => { $('charCount').textContent = $('answer').value.length.toLocaleString('pt-BR') + ' caracteres'; });
$('fileInput').addEventListener('change', async ev => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  $('answer').value = await file.text();
  $('charCount').textContent = $('answer').value.length.toLocaleString('pt-BR') + ' caracteres';
  notice('Arquivo carregado. Clique em "Validar e receber retorno".', 'info');
  ev.target.value = '';
});
refresh();
setInterval(refresh, 2500);
