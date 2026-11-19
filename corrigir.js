// ============================================================
// CNA Corretor — CORREÇÃO COMPLETA (um comando só)
//
//   npm run corrigir
//
// Fluxo:
//   1. npm run scrape  — abre o portal (sessão de npm run login),
//      coleta as respostas, mascara dados e gera lotes/*.md
//   2. ESPERA O PASSO DA IA (manual, por design: sem chave de API):
//      você cola o(s) lote(s) na IA, salva o retorno como
//      lotes/lote-NN.devolvido.md e aperta ENTER aqui
//   3. npm run apply   — valida e preenche + Finaliza cada lição
//      PRONTA (nunca as de revisao.md). Decisão do professor.
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CFG = require('./lib/config');

const run = (script) => {
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: CFG.ROOT });
  return r.status === 0;
};
const findDevolvidos = () => fs.existsSync(CFG.LOTES_DIR)
  ? fs.readdirSync(CFG.LOTES_DIR).filter(f => /\.devolvido\.md$/i.test(f))
  : [];
const temLoteGerado = () => fs.existsSync(CFG.LOTES_DIR)
  && fs.readdirSync(CFG.LOTES_DIR).some(f => /^lote-\d+\.md$/i.test(f));

(async () => {
  console.log('🚀 CNA Corretor — correção completa (um comando)\n');

  // 1. Coleta no portal — se a sessão estiver ausente/expirada, abre o login
  //    automaticamente e tenta de novo. O professor nunca vê "rode npm run login".
  console.log('── 1/3  Coletando respostas no portal...\n');
  let ok = run('scraper.js');
  if (!ok) {
    console.log('\n🔑 Sessão ausente ou expirada. Abrindo o login (você digita a SUA conta)...\n');
    if (!run('login.js')) {
      console.error('\n❌ Login falhou. Rode este programa de novo e tente novamente.');
      process.exit(1);
    }
    ok = run('scraper.js');
  }
  if (!ok) {
    console.error('\n❌ Não consegui coletar do portal. Verifique sua conexão/login e rode de novo.');
    process.exit(1);
  }
  if (!temLoteGerado()) {
    console.log('\n✅ Nenhuma pendência capturada. Nada a corrigir.');
    process.exit(0);
  }

  // 2. Passo da IA (manual)
  console.log('\n── 2/3  Correção pela IA (você) ──────────────────────────\n');
  console.log(' 1. Abra os arquivos em lotes/ (lote-01.md, lote-02.md, ...)');
  console.log(' 2. Cole o conteúdo na IA que você usa (Gemini/ChatGPT/etc.)');
  console.log(' 3. Salve o RETORNO como lotes/lote-01.devolvido.md (mesmo');
  console.log('    nome, com .devolvido antes da extensão)');
  console.log('');

  for (;;) {
    await new Promise(res => {
      process.stdout.write(' Devolvido? Salve o arquivo e aperte ENTER para aplicar (Ctrl+C para sair): ');
      process.stdin.once('data', res);
    });
    const dev = findDevolvidos();
    if (dev.length) { console.log(`\n Encontrado(s): ${dev.join(', ')}\n`); break; }
    console.log('\n ⚠️  Nenhum *.devolvido.md em lotes/. Salve o retorno da IA e aperte ENTER de novo.');
  }
  process.stdin.pause();

  // 3. Aplica no portal
  console.log('── 3/3  Aplicando no portal...\n');
  if (!run('executor.js')) process.exit(1);

  console.log('\n✅ Correção completa. Reveja revisao.md: as entradas duvidosas ficam');
  console.log('   com você — as PRONTAS foram preenchidas e finalizadas sozinhas.');
  process.exit(0);
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
