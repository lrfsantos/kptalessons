# Relatório para a IA auditora — testes reais de extração e rodada curta pós-uso

Data: 21/11/2026
Repositório: https://github.com/lrfsantos/kptalessons — branch `feat/tauri-webview2-real-flow-fluent`
HEAD de referência: `ff222b8`; relatório detalhado anterior: `578d6db`. PR #1: aberto, sem merge.
Correções posteriores ao uso real: `2be5261` (botões do painel) e `ff222b8` (path do Node no empacotamento).
Rodada curta desta data: `c775dce` (prompt), `aae5eb4` (README), `21eb04c` (`distribuicao/`), `7fd539f` (painel).
Evidências locais: `C:\Users\luiza\Desktop\CNA teste\teste-01` a `teste-10` + `RELATORIO_FINAL.md`.
Esses diretórios contêm dados reais e **não fazem parte do repositório**; quem orquestra deve
apagá-los após preservar este relatório sanitizado.

**Privacidade deste arquivo:** só há contagens, marcadores de integridade e desfechos. Não há
respostas, nomes, refs individuais de alunos nem qualquer outro dado identificável.

## 1. Por que este relatório existe

A auditoria de código foi encerrada com aprovação e recomendação de merge, com a ressalva de que
mudanças posteriores devem responder a **defeitos concretos encontrados no uso**, não a buscas
preventivas. Após a instalação real do produto pelo usuário final, apareceram dois defeitos que
nenhum teste unitário, de integração, CI ou auditoria de código detectou. Em seguida, executamos
10 testes completos de extração com login real no portal CNA, conforme autorização do dono do
projeto. Este documento consolida os fatos e a rodada curta e reativa aprovada pelo auditor.

## 2. Defeitos concretos encontrados no uso real

### 2.1 Instalador não era localizável a partir do repositório (P1 — UX/criência)

O usuário baixou o **código-fonte** do GitHub e executou `distribuicao\Corrigir.cmd`, o launcher
da POC antiga (CLI). Resultado:

```
ERRO: Node.js portátil ausente em runtime\node\node.exe.
A pasta de distribuicao esta incompleta. Nao tente instalar nada.
```

Causa: o repositório não dizia, de forma visível, que o produto é o **artefato NSIS do GitHub
Actions** e que `distribuicao/` é legado. O instalador não está no código-fonte — está em
Actions → execução da branch → artefato `corretor-cna-nsis`.

Ação tomada fora do código: instalei o NSIS para o usuário e apaguei do PC a pasta antiga
(858 MB), que continha o launcher enganoso.

### 2.2 Botões "Copiar lote" / "Copiar todos os lotes" sem efeito (P0 — funcional)

Com login real e 9 atividades coletadas, o painel abria normalmente, mas os botões de cópia
retornavam HTTP 404 com uma mensagem de erro sem orientação prática.

Causa raiz: `scraper.js` chamava `md.buildBatches(classes, { loteSize })` sem `outDir`. O padrão
de `buildBatches` é `CFG.ROOT/lotes`, que no app instalado é `resources/lotes`. O painel lê de
`CFG.LOTES_DIR`, que no orquestrador aponta para o `RUN_DIR` temporário. Consequências:

1. Funcional: o professor não conseguia copiar nenhum lote — o fluxo inteiro parava.
2. Privacidade: os lotes com respostas reais ficavam gravados na pasta de instalação, fora da
   limpeza do encerramento.

Correção em `2be5261`: `md.buildBatches(classes, { loteSize, outDir: CFG.LOTES_DIR })` + teste de
regressão. A instalação antiga foi desinstalada e o diretório residual removido.

## 3. Os 10 testes reais de extração (estatísticas agregadas)

Metodologia repetida 10 vezes, como usuário: fechar app → abrir pelo Menu Iniciar →
**Iniciar correção** → login manual real → coleta automática → painel → **Copiar lote** → salvar
a área de transferência → avaliar qualidade em arquivo local separado.

| Métrica agregada | Resultado |
|---|---|
| Execuções completas | 10 |
| Atividades coletadas por execução | 9 |
| Total de atividades coletadas | 90 |
| Marcadores de nonce íntegros | 10/10 |
| INJECT presente | 10/10 |
| Marcador de fim do lote presente | 10/10 |
| UTF-8 sem caracter de substituição (U+FFFD) | 10/10 |
| Falhas de formato | 0 |

Cada lote trouxe 9 referências numéricas esperadas (a 10ª ocorrência do regex é um exemplo dentro
das instruções INJECT). Não apareceu nenhum nome de aluno no material copiado: somente os códigos
numéricos necessários ao fluxo. O nonce foi renovado a cada execução.

**Nenhum retorno de IA foi validado e nenhuma atividade real foi finalizada** — intencionalmente,
para não exercitar o clique irreversível.

## 4. Limitações

1. **Variedade fraca:** as 10 execuções caíram sobre as mesmas 9 atividades da mesma turma.
   Estabilidade foi provada; variedade de formato e de contexto, não.
2. **Sem validação de retorno de IA:** como nenhuma resposta foi processada, não houve exercício
   do parser com retorno real, da aplicação nem do clique de finalização nesta rodada.
3. **Primeira milha quebrada:** encontrar o instalador foi mais difícil do que usar o produto
   (defeito 2.1).
4. **Erro não acionável:** a mensagem do lote ausente não dizia o que fazer (defeito 2.2).
5. **Fadiga de login:** 10 testes = 10 logins manuais. Sessão persistente reduziria o atrito,
   mas foi explicitamente mantida fora de escopo nesta rodada.
6. **Coleta sem feedback:** durante a varredura das turmas, a tela não mostra progresso
   (turmas processadas / atividades encontradas).
7. **Painel sem confirmação persistente:** o aviso de "Conteúdo copiado" aparece, mas não há um
   marcador durável por lote.
8. **Retenção local:** os 10 lotes reunidos ficaram em `Desktop\CNA teste` com dados reais e foram
   apagados após a validação final; este relatório sanitizado é a única evidência versionada.

## 5. Correções posteriores e rodada curta aprovada

**Já aplicadas antes desta rodada:**

- `2be5261` — grava os lotes gerados no `RUN_DIR` (`CFG.LOTES_DIR`); botões do painel voltaram a
  funcionar e os lotes pararam de ser escritos na pasta de instalação.
- `ff222b8` — path do Node no empacotamento passou a apontar para os resources do release.

**Rodada curta, reativa, executada agora (escopo fechado):**

| # | Item | Commit |
|---|---|---|
| 1 | README reescrito como produto oficial Tauri + WebView2: download do artefato NSIS do Actions, instalação, Menu Iniciar, login na mesma janela, transferência manual com a IA, descarte do perfil temporário ao fechar; ferramentas de dev rotuladas como tal; sugestão de GitHub Release apenas mencionada | `aae5eb4` |
| 2 | Remoção integral de `distribuicao/` (`Corrigir.cmd`, `preflight.js`, `README.md`) | `21eb04c` |
| 3 | Painel: mensagem acionável quando o lote não existe + verificação de saúde da coleta em `/api/state`, com botões desativados e instrução clara em estado inconsistente; três testes de regressão | `7fd539f` |
| 4 | Relatório sanitizado (sem dados identificáveis), com estatísticas agregadas, limitações e esta rodada | este commit |
| — | Registro do prompt aprovado | `c775dce` |

**Fora de escopo, portanto NÃO feito:** sessão persistente, mudanças em autenticação,
arquitetura Tauri, UI geral, parser, rubrica, executor ou política de finalização; nova auditoria
geral; clique em Finalizar em atividade real; uso de dados de alunos em testes automatizados;
merge ou force push. O push da rodada foi feito em seguida (ver §7).

## 6. Verificação automatizada da rodada

- `npm test`: **307 testes** (baseline 304 + 3 novos), 306 aprovados, 1 ignorado, 0 falhas.
- Novos testes em `tests/panel.test.js`:
  - `painel: lote ausente orienta a encerrar e iniciar uma nova correção` — a rota
    `/api/batch/1` responde 404 com instrução de fechar e reiniciar, sem jargão técnico;
  - `painel: estado inicial sinaliza inconsistência quando falta arquivo de lote` — `/api/state`
    devolve `consistent: false` e `done: false` com um arquivo de lote faltando, e recalcula para
    `true` quando o arquivo é gravado;
  - `painel: cliente desativa controles e avisa quando a coleta está inconsistente` — o cliente
    desativa copiar/validar/importar/limpar e exibe a instrução, e o HTML já entrega os controles
    desativados antes da primeira leitura de estado.
- Após `scripts\poc-package-resources.ps1` (recursos de 102,07 MB empacotados em
  `src-tauri/resources/`, diretório ignorado pelo Git): `cargo fmt --check` ok,
  `cargo check` ok e `cargo test` ok (12 testes Rust aprovados, 0 falhas).
- Working tree limpa ao final da rodada; o push foi realizado logo depois.

## 7. Push, CI e validação física final (concluídos)

- Push de `578d6db..795dd53` para `feat/tauri-webview2-real-flow-fluent`; PR #1 permanece aberto e sem merge.
- CI no HEAD `795dd53`: matriz Node 22/24 em Windows e Linux (4× success), `cargo fmt --check`,
  `cargo check`, `cargo test` e build NSIS — todos verdes; artefato `corretor-cna-nsis` (26,3 MB)
  publicado; sem `continue-on-error`.
- Validação física final com o instalador desse HEAD:
  1. Instalação silenciosa concluída; atalho "Corretor CNA" presente no Menu Iniciar.
  2. Abertura pelo atalho → uma janela, sem terminal; Iniciar → login manual no portal CNA na
     mesma janela → coleta automática → painel com 9 atividades.
  3. **Ambos** os botões exercitados: "Copiar lote" e "Copiar todos os lotes" confirmaram a cópia
     (23.285 caracteres, 9 referências); o erro 404 antigo não reapareceu.
  4. O arquivo do lote existe somente em `%TEMP%\cna-corretor-run-*\lotes`; **zero** arquivos
     `lote-*.md` na pasta de instalação (`resources/`).
  5. Diagnóstico de inconsistência exercitado: com o arquivo do lote temporariamente ausente, o
     painel exibiu "Os dados desta correção estão incompletos. Feche o aplicativo e inicie uma nova
     correção." e desativou os controles; com o arquivo restaurado, o painel voltou ao normal.
  6. Encerramento gracioso: nenhum perfil WebView2, nenhum diretório de execução e nenhum lote
     restante; o aplicativo permanece instalado para uso.
  7. A pasta `C:\Users\luiza\Desktop\CNA teste` (10 lotes com dados reais) foi apagada.

Limitações que permanecem como trabalho futuro, não como bloqueio: escalas de DPI, máquina sem
WebView2 pré-instalado, progresso detalhado durante a coleta e variedade de formatos nos dados reais.
