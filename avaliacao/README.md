# Avaliação da base

Conjunto de avaliação e harness da fase 1 do [plano de arquitetura](../PLANO-ARQUITETURA.md). Mede a base como ela é usada de fato: um agente real (`claude -p`) responde a perguntas de uso, e a resposta é pontuada de forma determinística contra gabaritos ancorados em ID e texto citado.

| Caminho | Conteúdo |
|---|---|
| `perguntas.yaml` | 25 perguntas (Q01–Q08 do plano + uso real), cada uma com gabarito |
| `config.yaml` | modelo, execuções por pergunta, limite de turnos, orçamento e ferramentas |
| `gabaritos/` | conjuntos esperados e universos, **gerados** (não edite à mão) |
| `resolvedor/` | citações anotadas em 20 PPCs para medir o resolvedor de citações (rascunho) |
| `ppcs-ouro/` | achados esperados por ficha da `revisar-ppc` em 3 PPCs técnicos (rascunho) |
| `resultados/` | rodadas do harness (fora do git) |

O código fica em `scripts/avaliacao/` e o entrypoint é `scripts/avaliar.ts`.

## Como rodar

```bash
bun run scripts/avaliar.ts --dry-run                       # perguntas, gabaritos e comando, sem custo
bun run scripts/avaliar.ts --pergunta Q09 --execucoes 1    # uma pergunta
bun run scripts/avaliar.ts                                 # rodada completa (config.yaml)
bun run scripts/avaliar.ts --modelo haiku                  # outro modelo
bun run scripts/avaliar.ts --pontuar avaliacao/resultados/<rodada>/relatorio.json   # repontua sem chamar o modelo
bun test scripts/avaliacao
```

Cada rodada grava `relatorio.json`, `resumo.md` e o stream-json bruto (`brutos/`) em `resultados/<data>-<modelo>/`. O agente roda com cwd na raiz, só com ferramentas de leitura pré-aprovadas (`--permission-mode dontAsk` nega o resto), sem MCP e sem persistir sessão. O relatório registra o ID efetivo do modelo, o commit, as chamadas de ferramenta (e as negadas), os tokens e o custo.

**Pontuação** (`scripts/avaliacao/pontuacao.ts`), sobre a resposta normalizada (sem acentos, minúscula, `nº` → `no`):

- `deve_conter`: fração dos critérios em que algum padrão casa;
- `nao_deve_conter`: −0,25 na nota por critério encontrado (ex.: tratar a Res. CNE/CP nº 1/2021 como vigente);
- `conjunto`: precisão e recall sobre os itens do universo (campi, cursos/PPCs, normas) reconhecidos na resposta, por caminho, por nome do curso na linha do campus ou por número e ano da norma;
- nota = média entre a cobertura de `deve_conter` e o F1 do conjunto, menos as penalidades.

## Como adicionar uma pergunta

1. Acrescente a entrada em `perguntas.yaml` com `id` (Q26…), `texto`, `categoria`, `tipo` (`pontual` ou `conjunto`), `origem` e `gabarito`.
2. Para cada critério de `deve_conter`, dê a `ancora` no formato de ID do plano (`br/cne-cp/res/2026/2#art37-par6`, `cnct:...`, `curso:...`), o `arquivo` e um `trecho` literal curto da fonte, e os `padroes` (regex sobre o texto normalizado). Nunca use número de linha.
3. Marque `status: curado` só depois de conferir o gabarito na base local; use `provisorio`, com `observacoes`, quando depender de curadoria humana ou de fase futura.
4. Para pergunta de conjunto, escreva o gerador em `scripts/avaliacao/gabaritos/conjuntos.ts`, registre-o em `GERADORES` e aponte `gabarito.conjunto.arquivo` para o JSON.
5. Rode `bun run scripts/avaliacao/gabaritos/gerar.ts` e `bun test scripts/avaliacao`. O teste confere que todo `trecho` existe no `arquivo` e que os gabaritos versionados batem com os geradores.

## Como os gabaritos são gerados

`bun run scripts/avaliacao/gabaritos/gerar.ts` lê `dados/institucional/`, `base-conhecimento/manifest.json`, o CNCT e os PPCs convertidos, e grava em `gabaritos/` os conjuntos esperados (ordenados, sem data) e `universos.json`. Rode de novo depois de mudar essas fontes e revise o diff: ele é a mudança do gabarito. `--verificar` (ou `--check`) só confere. As citações de normas nos PPCs (Q02 e Q20) vêm do resolvedor de citações de `packages/kb`, o mesmo de `bun run kb citacoes <id>`. O curso chega ao CNCT pelo `cnct_id` cadastrado em `dados/institucional/cursos/` (fase 3), e o turno das ofertas é o enum padronizado.

O resolvedor tem conjunto anotado próprio em `resolvedor/citacoes-anotadas.yaml` (rascunho, revisão humana pendente), medido por `bun run kb avaliar-resolvedor`.

## PPCs-ouro

Os três arquivos de `ppcs-ouro/` (Enfermagem subsequente de Curitiba, Agropecuária integrado de Ivaiporã e Manutenção e Suporte em Informática PROEJA de União da Vitória) trazem, para 10 fichas objetivas cada, o estado esperado, a justificativa e o trecho do PPC como evidência. O contrato é `esquemaPpcOuro` (zod) em `scripts/avaliacao/esquema.ts`. Estão em `status: rascunho`: precisam de revisão humana antes de servir de referência. Quem revisar preenche `revisado_por` e troca o status para `revisado`.

## Custos

O smoke test de 13/11/2026 (Q18, uma execução, `haiku`, até 8 turnos) custou US$ 0,006, com 4 chamadas de ferramenta e 62 mil tokens, a maior parte em cache. Perguntas de conjunto leem muito mais arquivos. Com o padrão de `config.yaml` (3 execuções × 25 perguntas = 75 chamadas), o teto é `max_budget_usd_por_execucao` × 75 (US$ 112,50 com US$ 1,50). Antes da linha de base, rode uma pergunta de conjunto com o modelo escolhido para estimar o custo real. Modelo e número de execuções ainda estão em aberto (item 4 das decisões do plano).
