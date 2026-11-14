# Gabarito de comportamento

Capturado em 14/11/2026, ainda com Bun (1.4.4), antes da etapa C0 da [consolidação na stack do T3](../docs/plans/consolidacao-stack-t3.md#gabarito-de-comportamento). Todas as etapas o conferem. Ele só é regerado por decisão explícita, num PR próprio.

| Peça | Conteúdo | Como conferir |
|---|---|---|
| `kb.sh` e `kb/` | stdout (`kb/<caso>.out`) e código de saída (`kb/codigos.txt`) de 84 invocações da CLI `kb`, em texto e com `--json`, inclusive casos de erro | `sh testes-gabarito/kb.sh --comparar` |
| `mcp.json` | `initialize` (servidor, capacidades, instruções), `tools/list` e 36 chamadas (`content` e `structuredContent`), pelo Client do SDK em stdio | `node packages/mcp/test/gabarito.ts --comparar` |
| `testes.txt` | casos e pulados por arquivo de teste (`arquivo⇥casos⇥pulados`), da suíte inteira | relatórios JUnit + `node testes-gabarito/contar_testes.ts` |
| `testes-smoke.txt` | o mesmo para o smoke contra a base real (`SIMPLIFICA_SMOKE=1`) | idem |
| `banco.sh` e `banco.txt` | linhas e sha256 do `.dump` de cada tabela do `tmp/kb.sqlite`, sem as tabelas do FTS5 | `sh testes-gabarito/banco.sh --comparar` |
| `base.sh` e `base.txt` | `gerar_base` e `gerar_indice_ppcs` sem diferença no git, `validar_base` sem erro e o hash do `site/` | `sh testes-gabarito/base.sh --comparar` |

Os scripts de shell são neutros de runtime: o comando vem de `KB` (CLI `kb`) ou `RODAR` (scripts), com `node` por padrão. O gabarito do C0 foi capturado com `KB="bun packages/kb/src/cli.ts"` e `RODAR=bun`.

Notas da captura:

- Na suíte com Bun, `testes.txt` soma 1015 casos: 1000 passando e 15 pulados (14 do smoke, que só roda com `SIMPLIFICA_SMOKE=1`, e 1 de `sei-cli/test/fluxo.test.ts`, que precisa de snapshots locais). Os blocos pulados pelo smoke contam 6 e 8 casos no JUnit do Bun; rodando, são 5 e 7 (`testes-smoke.txt`), porque o Bun conta de outro jeito os `describe.skipIf` pulados.
- O hash do `site/` em `base.txt` foi recalculado no C0, com o Bun, depois da troca dos comandos em `base-conhecimento/README.md` e `base-conhecimento/docs/*.md`, que o site copia: o hash da primeira captura era `5908118c…`. Com os mesmos documentos, o Bun e o Node geram o mesmo `site/`.
- `exportar_base_publica` fica fora de `base.sh`: lê as movimentações do Notion e grava a data do dia. Com Bun, em 14/11/2026, a única diferença no git foi `atualizado_em` de `campi/index.json` (de `2026-11-13` para `2026-11-14`).
- A impressão digital das fontes do banco (`meta.fontes_sha256`, `fontes_lista_sha256` e `fontes_total`) inclui o código de `packages/kb/src` e muda com qualquer mudança de código. `banco.sh` a deixa fora do hash da `meta`, e `gabarito.ts --comparar` mascara a versão `dev-<8 hex>` do envelope e a impressão da consulta nos cursores. O `banco.txt` foi recalculado com essa regra sobre o banco que o Bun compilou; as outras 33 linhas são as da primeira captura.

Para conferir a contagem por arquivo no Node, gere o JUnit do vitest na raiz e em cada pacote e compare:

```bash
pnpm exec vp test run --reporter=junit --outputFile=/tmp/raiz.xml
for p in kb sei-cli mcp; do (cd packages/$p && pnpm exec vp test run --config ../../vite.config.ts --dir . --reporter=junit --outputFile=/tmp/$p.xml); done
node testes-gabarito/contar_testes.ts .=/tmp/raiz.xml packages/kb=/tmp/kb.xml packages/sei-cli=/tmp/sei-cli.xml packages/mcp=/tmp/mcp.xml | diff testes-gabarito/testes.txt -
```

No C0, a única diferença esperada é a do JUnit do Bun nos blocos pulados do smoke (6 e 8 casos, contra 5 e 7) e o teste novo `packages/mcp/test/instrucoes.test.ts`.

## Atualizações por decisão explícita

O `gabarito.ts --atualizar <partes>` regrava só as partes nomeadas e mantém o resto de `mcp.json` como o C0 capturou: o nome de uma ferramenta troca ou acrescenta a definição dela no `tools/list` e as chamadas dela; `instrucoes` troca as instruções do `initialize`.

| Data | Comando | O que mudou |
|---|---|---|
| 14/11/2026 | `node packages/mcp/test/gabarito.ts --atualizar pacote_contexto` | T4 do M0.1: a 16ª ferramenta, `pacote_contexto`, entra no `tools/list` entre `fatos_ppc` e `sobre_a_base`, com três chamadas: `CT-CURR-12` sobre o PPC da base, `CT-CURR-12` sobre o Markdown do mesmo PPC como `arquivo` (a pasta de trabalho é a raiz do repositório) e a entrada inválida com `ppc` e `arquivo` juntos. De 33 para 36 chamadas; as outras 15 definições e as 33 chamadas continuam byte a byte as da captura |
| 14/11/2026 | `node packages/mcp/test/gabarito.ts --atualizar instrucoes` | T5 do M0.1: as instruções revistas (`packages/mcp/instrucoes.md`), com as 16 ferramentas por intenção e o item "Revisão de PPC" |
| 14/11/2026 | `node packages/mcp/test/gabarito.ts --atualizar listar_cursos` | A descrição de `listar_cursos` ganha a frase de quando usar ("Use quando a pergunta envolver vários cursos…"). A definição regravada também traz as propriedades do schema na ordem do Effect Schema (`description` antes de `maxLength`); o veredito é o mesmo (`--schemas-equivalentes`) e as 36 chamadas não mudam |
