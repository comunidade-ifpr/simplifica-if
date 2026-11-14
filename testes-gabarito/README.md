# Gabarito de comportamento

Capturado em 14/11/2026, ainda com Bun (1.4.4), antes da etapa C0 da [consolidação na stack do T3](../docs/plans/consolidacao-stack-t3.md#gabarito-de-comportamento). Todas as etapas o conferem. Ele só é regerado por decisão explícita, num PR próprio.

| Peça | Conteúdo | Como conferir |
|---|---|---|
| `kb.sh` e `kb/` | stdout (`kb/<caso>.out`) e código de saída (`kb/codigos.txt`) de 84 invocações da CLI `kb`, em texto e com `--json`, inclusive casos de erro | `sh testes-gabarito/kb.sh --comparar` |
| `mcp.json` | `initialize` (servidor, capacidades, instruções), `tools/list` e 33 chamadas (`content` e `structuredContent`), pelo Client do SDK em stdio | `node packages/mcp/test/gabarito.ts --comparar` |
| `testes.txt` | casos e pulados por arquivo de teste (`arquivo⇥casos⇥pulados`), da suíte inteira | relatórios JUnit + `node testes-gabarito/contar_testes.ts` |
| `testes-smoke.txt` | o mesmo para o smoke contra a base real (`SIMPLIFICA_SMOKE=1`) | idem |
| `banco.sh` e `banco.txt` | linhas e sha256 do `.dump` de cada tabela do `tmp/kb.sqlite`, sem as tabelas do FTS5 | `sh testes-gabarito/banco.sh --comparar` |
| `base.sh` e `base.txt` | `gerar_base` e `gerar_indice_ppcs` sem diferença no git, `validar_base` sem erro e o hash do `site/` | `sh testes-gabarito/base.sh --comparar` |

Os scripts de shell são neutros de runtime: o comando vem de `KB` (CLI `kb`) ou `RODAR` (scripts), com `node` por padrão. O gabarito do C0 foi capturado com `KB="bun packages/kb/src/cli.ts"` e `RODAR=bun`.

Notas da captura:

- Na suíte com Bun, `testes.txt` soma 1015 casos: 1000 passando e 15 pulados (14 do smoke, que só roda com `SIMPLIFICA_SMOKE=1`, e 1 de `sei-cli/test/fluxo.test.ts`, que precisa de snapshots locais). Os blocos pulados pelo smoke contam 6 e 8 casos no JUnit do Bun; rodando, são 5 e 7 (`testes-smoke.txt`), porque o Bun conta de outro jeito os `describe.skipIf` pulados.
- `exportar_base_publica` fica fora de `base.sh`: lê as movimentações do Notion e grava a data do dia. Com Bun, em 14/11/2026, a única diferença no git foi `atualizado_em` de `campi/index.json` (de `2026-11-13` para `2026-11-14`).
