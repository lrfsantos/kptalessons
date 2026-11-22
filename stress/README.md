# Stress Test — fluxo completo com 520 atividades

Artefato de teste local. Emula o portal CNA em `127.0.0.1` (mesmos atributos
`data-sel`) e roda o fluxo **real** do programa ponta a ponta — sem Tauri,
sem portal real, sem dados reais.

## Segurança (invariantes)

- O portal falso escuta **somente em `127.0.0.1`**; nada toca no portal real.
- `lib/config.js` aceita `CNA_PORTAL_URL` via env (override de 2 linhas);
  o default permanece `https://app.cna.com.br` — os scripts sobem o mock e
  setam o env para `http://127.0.0.1:<porta>` antes de carregar os módulos.
- Dados 100% fictícios: turmas `C9000xx`, alunos `S9000xx`, atividades
  `A9000xx` — padrão que não existe no portal real.
- `Finalizar` é clicado apenas no portal falso. O executor mantém a regra do
  produto: `appliedRefs` só com confirmação positiva; o restante vai a revisão.
- O diretório de execução (`RUN_DIR` em `%TEMP%`) é removido ao final.

## Arquivos

| Arquivo | Papel |
|---|---|
| `mock-portal.js` | Portal falso (http server) com o DOM `data-sel` do portal real; N atividades fictícias com variedade de respostas (normal, em branco, português, injeção, U+200B, máscaras `[EMAIL]`, gibberish, resquício de IA). 100% texto, sem mídia. |
| `rodar-stress.js` | Runner do fluxo completo: captura (scraper real, uma turma por navegador com retry) → 52 lotes → painel local → retorno simulado da IA (5 campos por bloco, triagem fictícia alinhada às regras do guard) → aplicação com re-invocação do executor (retry por morte de navegador). |
| `smoke-mock.js` | Smoke test do portal falso (contrato DOM). |
| `repro-reaplicacao.js` | Repro determinístico (stub): a re-invocação do `applyAcceptedCorrections` reprocessa o restante — `appliedRefs` pula o confirmado. |

## Uso

```
node stress/rodar-stress.js [--turmas 4] [--alunos 13] [--ativ 10] [--porta 8899] [--headless false]
```

O navegador Edge do sistema é lançado via playwright-core. Limitação conhecida
deste harness: o msedge lançado morre estocasticamente em sessões de automação
longa nesta máquina (sem registro no Event Viewer). O runner contorna com retry
por turma (captura) e re-invocação do executor (aplicação). O produto de
produção não usa esse caminho (usa o WebView2 do Tauri).

## Resultado da rodada de 520 (20/11/2026)

- **Captura**: 520/520 em 63s — incluindo 52 em branco, português, injeção,
  U+200B, máscaras, gibberish e resquício de IA
- **Painel**: 52/52 lotes validados, 0 rejeitados
- **Aplicação**: 312/312 finalizações CONFIRMADAS (contagem do mock confere com
  a do executor), 0 falhas de finalização, 0 aplicações sem confirmação positiva
- **Revisão manual**: 156 flags (INJECAO/IA/GIBBERISH → Revisão SIM, regra T5b)
  + 52 em branco (motivo do achado abaixo)
- **Recursos**: RSS pico 276 MB; tempo total 119s

## Achado do stress (corrigido em master)

Respostas em branco nunca eram aplicadas com motivo enganoso: o lote exibe
"(vazia)" (`lib/md.js` `entryBlock`), a IA o repete fielmente, e o
`guard.validateEntry` comparava com a resposta original vazia → "resposta do
aluno alterada pela IA". Corrigido em `poc/fix-vazia-placeholder` (merge na
master, commit `fe0c2ad`): o placeholder é convenção de formato, não alteração
da IA — com testes positivo e negativo de regressão.
