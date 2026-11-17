# Avaliação da base

Conjunto de avaliação e harness da fase 1 do [plano de arquitetura](../PLANO-ARQUITETURA.md). Mede a base como ela é usada de fato: um agente real (`claude -p`) responde a perguntas de uso, e a resposta é pontuada de forma determinística contra gabaritos ancorados em ID e texto citado.

| Caminho | Conteúdo |
|---|---|
| `perguntas.yaml` | 25 perguntas (Q01–Q08 do plano + uso real), cada uma com gabarito |
| `config.yaml` | modelo, execuções por pergunta, limite de turnos, orçamento e ferramentas |
| `gabaritos/` | conjuntos esperados e universos, **gerados** (não edite à mão) |
| `resolvedor/` | citações anotadas em 20 PPCs para medir o resolvedor de citações (rascunho) |
| `ppcs-ouro/` | achados esperados por ficha da `revisar-ppc` em 3 PPCs técnicos (rascunho) |
| `skills/` | casos de avaliação das skills do app, com e sem a skill (ver [Skills do app](#skills-do-app)) |
| `resultados/` | rodadas do harness (fora do git) |

O código fica em `scripts/avaliacao/` e o entrypoint é `scripts/avaliar.ts`.

## Como rodar

```bash
node scripts/avaliar.ts --dry-run                       # perguntas, gabaritos e comando, sem custo
node scripts/avaliar.ts --pergunta Q09 --execucoes 1    # uma pergunta
node scripts/avaliar.ts                                 # rodada completa (config.yaml)
node scripts/avaliar.ts --modelo haiku                  # outro modelo
node scripts/avaliar.ts --pontuar avaliacao/resultados/<rodada>/relatorio.json   # repontua sem chamar o modelo
pnpm exec vp test run scripts/avaliacao
```

Cada rodada grava `relatorio.json`, `resumo.md` e o stream-json bruto (`brutos/`) em `resultados/<data>-<modelo>/`. O agente roda com cwd na raiz, só com Read, Grep e Glob pré-aprovados dentro do repositório (`--permission-mode dontAsk` nega o resto), sem Bash, sem MCP e sem persistir sessão. Como ele escolhe o que ler, o executor não depende do `config.yaml` para proteger segredos: o `claude` recebe um ambiente mínimo por lista explícita (`PATH`, `HOME`, locale, proxy e a credencial do próprio `claude` quando vem do shell), sem nenhuma variável definida em `.env*`, e `--disallowedTools` nega sempre Bash, escrita, web e a leitura de `.env*`, `~/.ssh`, `~/.aws`, `~/.config`, `~/.claude` e `/etc` (`REGRAS_NEGADAS` em `scripts/avaliacao/executor.ts`). O relatório registra o ID efetivo do modelo, o commit, as chamadas de ferramenta (e as negadas), os tokens e o custo.

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
5. Rode `node scripts/avaliacao/gabaritos/gerar.ts` e `pnpm exec vp test run scripts/avaliacao`. O teste confere que todo `trecho` existe no `arquivo` e que os gabaritos versionados batem com os geradores.

## Como os gabaritos são gerados

`node scripts/avaliacao/gabaritos/gerar.ts` lê os registros de `base-conhecimento/institucional/ifpr/`, `base-conhecimento/manifest.json`, o CNCT e os PPCs convertidos, e grava em `gabaritos/` os conjuntos esperados (ordenados, sem data) e `universos.json`. Rode de novo depois de mudar essas fontes e revise o diff: ele é a mudança do gabarito. `--verificar` (ou `--check`) só confere. As citações de normas nos PPCs (Q02 e Q20) vêm do resolvedor de citações de `packages/kb`, o mesmo de `pnpm kb citacoes <id>`. O curso chega ao CNCT pelo `cnct_id` cadastrado em `base-conhecimento/institucional/ifpr/cursos/` (fase 3), e o turno das ofertas é o enum `turno_padronizado` (a grafia da fonte fica em `turno`).

O resolvedor tem conjunto anotado próprio em `resolvedor/citacoes-anotadas.yaml` (rascunho, revisão humana pendente), medido por `pnpm kb avaliar-resolvedor`.

## PPCs-ouro

Os três arquivos de `ppcs-ouro/` (Enfermagem subsequente de Curitiba, Agropecuária integrado de Ivaiporã e Manutenção e Suporte em Informática PROEJA de União da Vitória) trazem, para 10 fichas objetivas cada, o estado esperado, a justificativa e o trecho do PPC como evidência. O contrato é `esquemaPpcOuro` (Effect Schema) em `scripts/avaliacao/esquema.ts`. Estão em `status: rascunho`: precisam de revisão humana antes de servir de referência. Quem revisar preenche `revisado_por` e troca o status para `revisado`.

## Skills do app

Mede se uma skill do app melhora o resultado em relação a só o MCP `ifpr` (M0.5 e M1.11 do [plano do app](../docs/plans/app-simplifica-if.md)). Cada caso fica em `skills/<skill>/caso.yaml`, com documentos sintéticos curtos em `documentos/` e, por documento, as alegações com erro plantado ou corretas: o trecho literal do documento, a fonte na base (arquivo e trecho, conferidos pelo teste), os status aceitos e as regex de conferência. O contrato e a pontuação ficam em `scripts/avaliacao/skills.ts`; o runner é `scripts/avaliar_skill.ts`.

Diferente do `avaliar.ts`, o runner usa o motor do app (`@simplifica-if/motor`), como o app usa: cada documento vai para uma pasta de trabalho temporária e vazia, com o MCP `ifpr` deste checkout por HTTP local, sem as configurações, skills e MCP do usuário, e com o mesmo pedido em cada condição:

- `sem-skill`: só o MCP (as instruções do servidor);
- `skill`: o MCP e a skill da árvore de trabalho, entregue como o app entrega (`.simplifica/skills/` e a lista nas instruções da sessão);
- `skill-antiga`: o MCP e a skill no commit `rev_skill_antiga` do caso.

```bash
pnpm avaliacao:skill --dry-run                         # sessões, pedidos e tamanho de cada skill, sem custo
pnpm avaliacao:skill                                   # Claude, as três condições, com juiz
pnpm avaliacao:skill --provider codex                  # ou antigravity (login pelo pnpm motor:poc)
pnpm avaliacao:skill --condicao skill --documento ppc-enfermagem --sem-juiz
pnpm avaliacao:skill --pontuar avaliacao/resultados/skills/<rodada>/relatorio.json
pnpm exec vp test run scripts/avaliacao/skills.test.ts
```

Precisa do `tmp/kb.sqlite` (`pnpm kb:compilar`) e do login do provider (`pnpm motor:poc --detectar`). A rodada grava `relatorio.json`, `resumo.md` e as respostas em `resultados/skills/<data>-<skill>-<provider>/`.

**Pontuação.** Automática, sem modelo: alegações tratadas e problema certo apontado (regex do gabarito sobre o relatório normalizado), links `ifpr://` distintos, rótulos da classificação da skill e seções do formato do relatório. Juiz: uma sessão do mesmo provider, sem MCP, com a rubrica de `promptJuiz` (o documento, o gabarito e o relatório); ele diz, por alegação, se ela foi tratada, que status o relatório lhe deu (um dos sete da skill, traduzindo quando o relatório usa outras palavras) e se o problema plantado foi identificado. O acerto de status é calculado pelo script (`status ∈ status_aceitos`); alegação correta com problema apontado ou status fora dos aceitos conta como falso alarme. Com uma execução por condição, a diferença de uma ou duas alegações está dentro da variância do agente.

## Custos

O smoke test de 13/11/2026 (Q18, uma execução, `haiku`, até 8 turnos) custou US$ 0,006, com 4 chamadas de ferramenta e 62 mil tokens, a maior parte em cache. Perguntas de conjunto leem muito mais arquivos. Com o padrão de `config.yaml` (3 execuções × 25 perguntas = 75 chamadas), o teto é `max_budget_usd_por_execucao` × 75 (US$ 112,50 com US$ 1,50). Antes da linha de base, rode uma pergunta de conjunto com o modelo escolhido para estimar o custo real. Modelo e número de execuções ainda estão em aberto (item 4 das decisões do plano).
