// ============================================================
// CNA Corretor — EXECUTOR (avaliador)
// Lê answers.json (as respostas escritas baixadas pelo scraper)
// e corrige cada texto pela CORREÇÃO GRAMATICAL (sem gabarito).
// Gera:
//   report.json   -> dados estruturados por aluno/atividade
//   respostas.md  -> relatório legível com notas e observações
//   all_answers.txt -> texto puro de todas as respostas
// ============================================================
const fs = require('fs');
const CFG = require('./lib/config');
const grammar = require('./lib/grammar');

// Normaliza o formato de entrada aceito. answers.json pode ser:
//  - array de { aluno, atividade, texto }
//  - objeto com { atividades:[...] } ou { alunos:[...] }
function normalizeAnswers(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.answers)) return raw.answers;
  if (raw && Array.isArray(raw.atividades)) return raw.atividades;
  if (raw && Array.isArray(raw.alunos)) {
    // cada aluno pode ter {nome, respostas:[{atividade, texto}]}
    const out = [];
    for (const a of raw.alunos) {
      for (const r of (a.respostas || a.answers || [])) {
        out.push({
          aluno: a.nome || a.aluno || a.name,
          atividade: r.atividade || r.activity || '',
          texto: r.texto || r.answer || r.text || '',
        });
      }
    }
    return out;
  }
  return [];
}

function pick(answers, i, keys, fallback) {
  for (const k of keys) if (answers[i] && answers[i][k] != null) return answers[i][k];
  return fallback;
}

// Mapa de nota -> comentário geral
function resumo(percent) {
  if (percent >= 85) return 'Excelente — texto gramaticalmente muito sólido.';
  if (percent >= 70) return 'Bom — poucos ajustes de gramática.';
  if (percent >= 50) return 'Regular — precisa de atenção em ortografia/estrutura.';
  return 'Fraco — revisar estrutura, pontuação e ortografia.';
}

function buildReport(results) {
  const rows = results.map((r, i) => {
    const aluno = pick(results, i, ['aluno', 'aluno_nome', 'name'], '(desconhecido)');
    const atividade = pick(results, i, ['atividade', 'activity', 'question'], '');
    const texto = String(pick(results, i, ['texto', 'answer', 'text'], '') || '');
    const g = grammar.grade(texto);
    return {
      aluno,
      atividade,
      nota: g.percent,
      resumo: resumo(g.percent),
      observacoes: g.criteria.filter(c => !c.ok).map(c => c.note),
      criterios: g.criteria.map((c, idx) => ({ criterio: idx, nota: c.points, max: c.max, ok: c.ok, nota_criterio: c.note })),
      texto,
    };
  });

  // Ordena por nota
  rows.sort((a, b) => b.nota - a.nota);
  return rows;
}

function writeReport(rows) {
  fs.writeFileSync(CFG.REPORT_FILE, JSON.stringify(rows, null, 2));
  console.log('💾 report.json gerado (' + rows.length + ' respostas).');
}

function writeMarkdown(rows) {
  let md = '# CNA Corretor — Relatório de Correção Gramatical\n\n';
  md += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n\n`;

  let all = '';
  rows.forEach((r, idx) => {
    md += `## ${idx + 1}. ${r.aluno}` + (r.atividade ? ` — ${r.atividade}` : '') + `\n`;
    md += `**Nota:** ${r.nota}/100 — ${r.resumo}\n\n`;
    md += `> ${r.texto.replace(/\n/g, '\n> ')}\n\n`;
    if (r.observacoes.length) {
      md += `**Observações:**\n`;
      r.observacoes.forEach(o => { md += `- ${o}\n`; });
    }
    md += `\n---\n\n`;
    all += `${r.aluno}${r.atividade ? ' (' + r.atividade + ')' : ''}: ${r.nota}/100\n${r.texto}\n\n---\n\n`;
  });

  fs.writeFileSync(CFG.RESUMO_FILE, md);
  fs.writeFileSync(CFG.ALL_ANSWERS_FILE, all);
  console.log('💾 respostas.md gerado.');
  console.log('💾 all_answers.txt gerado.');
}

(async () => {
  console.log('🚀 CNA Corretor — executor (avaliador gramatical)');

  if (!fs.existsSync(CFG.ANSWERS_FILE)) {
    console.error('❌ answers.json não existe. Rode primeiro:  node scraper.js');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(CFG.ANSWERS_FILE, 'utf8'));
  const answers = normalizeAnswers(raw);
  if (!answers.length) {
    console.error('⚠️  answers.json está vazio ou em formato não reconhecido.');
    process.exit(1);
  }
  console.log('📄 ' + answers.length + ' respostas carregadas.');

  const rows = buildReport(answers);
  writeReport(rows);
  writeMarkdown(rows);

  // Resumo rápido no terminal
  console.log('\n📊 Resumo:');
  rows.forEach((r, i) => {
    console.log(`   ${(i + 1) + '.'}`.padEnd(5) + ` ${String(r.nota).padStart(3)}/100 ${r.aluno}${r.atividade ? ' — ' + r.atividade : ''}`);
  });
  console.log('\n✅ Pronto! Veja respostas.md e report.json.');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
