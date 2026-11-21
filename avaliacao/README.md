# Avaliação da base

Conjuntos de avaliação. Os da base (resolvedor e busca de seções) são lidos pelo `kb`; os das skills rodam pelo motor do app, com o MCP `ifpr`.

| Caminho | Conteúdo |
|---|---|
| `resolvedor/` | citações anotadas em 20 PPCs para medir o resolvedor de citações (rascunho), por `pnpm kb avaliar-resolvedor` |
| `busca-secoes/` | consultas rotuladas para o recall@10 da busca de seções (rascunho), por `pnpm kb avaliar-busca` |
| `ppcs-ouro/` | achados esperados por ficha da `revisar-ppc` em 3 PPCs técnicos (rascunho) |
| `skills/` | casos de avaliação das skills do app, com e sem a skill (ver [Skills do app](#skills-do-app)) |
| `resultados/` | rodadas do `avaliar_skill.ts` (fora do git) |

O código fica em `scripts/avaliacao/` e o entrypoint é `scripts/avaliar_skill.ts`.

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
