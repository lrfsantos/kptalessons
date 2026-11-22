# Relatório para a IA auditora — testes reais de extração e proposta de próximo passo

Data: 21/11/2026
Repositório: https://github.com/lrfsantos/kptalessons — branch `feat/tauri-webview2-real-flow-fluent`
HEAD auditado: `e6691fb` → correções deste ciclo: `2be5261` (botões do painel) e `ff222b8` (path do Node no empacotamento)
PR #1: aberto, sem merge
Evidências: `C:\Users\luiza\Desktop\CNA teste\teste-01` a `teste-10` + `RELATORIO_FINAL.md`

## 1. Por que este relatório existe

Você encerrou a auditoria de código com aprovação e recomendação de merge, com a ressalva de que mudanças posteriores devem responder a **defeitos concretos encontrados no uso**, não a buscas preventivas. Este relatório descreve exatamente isso: após a instalação real do produto pelo usuário final, apareceram dois defeitos concretos que nenhum teste unitário, de integração, CI ou auditoria de código detectou. Em seguida, executamos 10 testes completos de extração com login real no portal CNA, conforme autorização do dono do projeto.

## 2. Defeitos concretos encontrados no uso real

### 2.1 Instalador não era localizável a partir do repositório (P1 — UX/criência)

O usuário baixou o **código-fonte** do GitHub e executou `distribuicao\Corrigir.cmd`, que é o launcher da POC antiga (CLI). Resultado:

```
ERRO: Node.js portátil ausente em runtime\node\node.exe.
A pasta de distribuicao esta incompleta. Nao tente instalar nada.
```

Causa: o repositório não diz, de forma visível, que o produto é o **artefato NSIS do GitHub Actions** e que `distribuicao/` é legado. O instalador não está no código-fonte do repo — está em Actions → execução da branch → artefato `corretor-cna-nsis`.

Ação tomada fora do código: instalei o NSIS para o usuário e apaguei do PC a pasta antiga (858 MB), que continha o launcher enganoso. **O arquivo `distribuicao/Corrigir.cmd` continua no repositório.**

### 2.2 Botões "Copiar lote" / "Copiar todos os lotes" sem efeito (P0 — funcional)

Com login real e 9 atividades coletadas, o painel abria normalmente, mas os botões de cópia retornavam:

```
HTTP 404 /api/batch/1 → "Arquivo original do lote não encontrado."
```

Causa raiz: `scraper.js` chamava `md.buildBatches(classes, { loteSize })` sem `outDir`. O padrão de `buildBatches` é `CFG.ROOT/lotes`, que no app instalado é `resources/lotes`. O painel lê de `CFG.LOTES_DIR`, que no orquestrador aponta para o `RUN_DIR` temporário. Consequência dupla:

1. Funcional: o professor não conseguia copiar nenhum lote — o fluxo inteiro parava.
2. Privacidade: os lotes com respostas reais de alunos ficavam gravados na pasta de instalação (`%LOCALAPPDATA%\Corretor CNA\resources\lotes`), fora da limpeza do encerramento.

Correção em `2be5261`: `md.buildBatches(classes, { loteSize, outDir: CFG.LOTES_DIR })` + teste de regressão em `tests/scraper-syntax.test.js`. A instalação antiga foi desinstalada e o diretório residual removido.

## 3. Os 10 testes completos de extração

Metodologia repetida 10 vezes, como usuário: fechar app → abrir pelo Menu Iniciar → **Iniciar correção** → login manual real → coleta automática → painel → **Copiar lote** → salvar área de transferência em `teste-NN/lote-01.md` → avaliar qualidade → `teste-NN/qualidade.md`.

| Teste | Atividades | Refs | Tamanho | nonce | INJECT | Fim do lote | UTF-8 | Problemas |
|---|---|---|---|---|---|---|---|---|
| 01–10 | 9 | 9 | 23.540 bytes | ok | ok | ok | sem U+FFFD | nenhum |

Detales de qualidade: 9 referências reais por lote (a 10ª ocorrência do regex é um exemplo dentro das instruções INJECT), nonce novo a cada execução, nenhum nome de aluno (apenas refs numéricas necessárias), `### Aluno: S32846` é o identificador numérico esperado, não um nome.

**Nenhum retorno de IA foi validado e nenhuma atividade real foi finalizada** — intencionalmente, para não exercitar o clique irreversível.

## 4. Experiência do usuário e lições do processo

1. **Primeira milha quebrada**: encontrar o instalador foi mais difícil do que usar o produto. O README deveria ter link direto para o artefato e aviso explícito de que `distribuicao/` é legado.
2. **Erro não acionável**: "Arquivo original do lote não encontrado" não diz o que fazer. Mensagem útil: "O lote não foi gerado nesta execução. Feche e reabra o aplicativo."
3. **Fadiga de login**: 10 testes = 10 logins manuais. Sessão opcional com consentimento reduziria drasticamente o atrito (e é reversível).
4. **Coleta sem feedback**: durante a varredura das turmas, a tela não mostra progresso (turmas processadas / atividades encontradas).
5. **Painel sem estado de confirmação visível**: o aviso de "Conteúdo copiado" aparece, mas não há um-checkmark persistente por lote.
6. **Variedade fraca**: as 10 execuções caíram sobre as mesmas 9 atividades da mesma turma. Estabilidade foi provada; variedade de formato não.
7. **Retenção de dados reais**: os 10 lotes em `Desktop\CNA teste` são dados reais de alunos e precisam ser apagados após esta análise.

## 5. Proposta de próximo passo (para sua aprovação, não uma nova auditoria preventiva)

Sugiro **uma rodada curta, reativa, focada apenas nos defeitos concretos acima**, com estes itens:

| # | Item | Tipo |
|---|---|---|
| 1 | README: link visível para o artefato NSIS do Actions + aviso de que `distribuicao/` é legado; remover `distribuicao/Corrigir.cmd`, `preflight.js` e `README.md` do repositório | Defeito concreto 2.1 |
| 2 | Painel: erro acionável quando o lote não existir + verificação de saúde no carregamento (`/api/state` com contagem coerente) | Defeito concreto 2.2 |
| 3 | Teste de aceitação de instalação real no CI/checklist: instalar NSIS, abrir, logar, copiar lote (pode ser manual com fixture, mas precisa existir como etapa explícita) | Lição do processo |
| 4 | (Opcional, se você aprovar) Sessão de login persistente apenas com consentimento explícito e apagada no encerramento | UX — reduz atrito |

**O que eu NÃO proponho**: reabrir arquitetura Tauri, UI Fluent, rubrica, parser, política de finalização, nem rodadas preventivas de auditoria. Concordo com sua orientação de parar de procurar problemas especulativos.

Perguntas para você:

- Aprova essa rodada curta com os itens 1–3 (e eventualmente 4)?
- Prefere que eu remova `distribuicao/` do repositório agora ou prefere manter como referência histórica com um aviso no README?
- Considera a auditoria de código encerrada mesmo com estes dois defeitos de uso já corrigidos (2be5261), ou quer que eu reabra o PR para revisão formal antes do merge?

Não farei merge sem sua decisão explícita. Nenhuma credencial foi gravada em arquivo ou relatório.
