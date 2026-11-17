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
| 17/11/2026 | edição de `mcp.json` (contagens do `sobre_a_base`) e de `banco.txt` (linhas `documentos`, `meta` e `indices`) | M1.6: o esquema 4 do `kb.sqlite` traz a tabela `documentos` (o Markdown inteiro das normas e dos PPCs, para o leitor do app). Só as linhas que o esquema muda |
| 17/11/2026 | `sh testes-gabarito/kb.sh --capturar`; `node packages/mcp/test/gabarito.ts --atualizar impacto_da_norma,pacote_contexto`; linha `fichas` de `banco.txt` | O campo `execucao` das fichas da `revisar-ppc` (e a `citacao-sucessora` da CT-CURR-02), que já divergia no `main`: mudam `impacto` e `pacote-contexto` da CLI (6 arquivos de `kb/`), as chamadas de `impacto_da_norma` e `pacote_contexto` do MCP (o `--atualizar` regrava também a definição das duas no `tools/list` como o Effect a emite hoje; o veredito `--schemas-equivalentes` é o mesmo) e a tabela `fichas` do banco |
| 17/11/2026 | `sh testes-gabarito/kb.sh --capturar` (só os casos cuja saída mudou por esta reorganização) e o hash do `site/` em `base.txt` | Registros institucionais em `base-conhecimento/institucional/ifpr/` (sai `dados/`): os `path` de cursos, ofertas e fatos passam de `dados/institucional/…` a `base-conhecimento/institucional/ifpr/…`, o critério do art. 71 cita o caminho novo e o `pacote-contexto` cresce com os caminhos mais longos. Ficaram como estavam `impacto.*` e `pacote-contexto-todas.*`, que já divergiam antes por mudanças nas fichas (`execucao.modo`, `citacao-sucessora`); `pacote-contexto.json.out` leva junto uma dessas (`execucao` de uma ficha). O `site/` muda de conteúdo (registros publicados como estão, índices por coleção, conselhos, CPF/RG omitidos). `mcp.json` e `banco.txt` não foram regravados |
| 17/11/2026 | `sh testes-gabarito/kb.sh --capturar` (só `buscar-secoes.*`) e o hash do `site/` em `base.txt` | Política de dados pessoais: o texto das seções perdeu celulares, matrículas e SIAPE, e o escore BM25 de uma seção em `buscar-secoes` mudou na terceira casa; o `site/` ganha `schemas/registros/` e os PPCs limpos. `impacto.*`, `pacote-contexto-todas.*`, `mcp.json` e `banco.txt` seguem sem regravar |
| 17/11/2026 | `sh testes-gabarito/kb.sh --capturar`; `sh testes-gabarito/banco.sh --capturar`; em `mcp.json`, só as respostas de `adequacao_art71`, `buscar_secoes`, `ficha_curso`, `fatos_ppc` e `pacote_contexto` (as definições do `tools/list` ficam as capturadas) | Merge de main (esquema 4) na reorganização da base: caminhos `base-conhecimento/institucional/ifpr/…` no lugar de `dados/institucional/…`, critério do art. 71 com o caminho novo, escore de uma seção em `buscar_secoes` e tamanho do `pacote_contexto`. No banco, mudam `campi`, `cursos`, `documentos`, `editais`, `ofertas`, `ppc_fatos`, `ppc_suap`, `ppcs`, `processos`, `secoes` e `suap_matrizes` (caminhos e texto dos PPCs sem dados pessoais) |
| 17/11/2026 | edição de `mcp.json` (contagens do `sobre_a_base`) e `sh testes-gabarito/banco.sh --capturar` (linhas `campi`, `conselhos*`, `meta` e `indices`) | Explorar do app: o esquema 5 do `kb.sqlite` traz as reuniões do Consepe (`conselhos`, `conselhos_reunioes`, `conselhos_documentos`, `conselhos_itens`) e o calendário e os horários de aula de cada campus (colunas novas em `campi`). Só as linhas que o esquema muda; a CLI `kb` não muda |
| 17/11/2026 | `sh testes-gabarito/banco.sh --capturar` (só a linha `conselhos_itens`) | Revisão do Explorar: os itens de pauta do Consepe gravam a `ordem` oficial da pauta (a reunião de 28/05/2026 começa no 12), não a posição no arquivo |
| 17/11/2026 | `node packages/mcp/test/gabarito.ts --atualizar pacote_contexto` | O título da ferramenta passa a "Contexto da revisão de PPC" e a seção do pacote a "o texto do PPC sob revisão", com a troca de "Analisar" por "Revisar um PPC" no app; as três chamadas regravadas mudam só nisso e na `versao` da base de desenvolvimento. As outras 15 definições e 33 chamadas não mudam |

Conferência depois dessas atualizações: `sh testes-gabarito/kb.sh --comparar`, `node packages/mcp/test/gabarito.ts --comparar --schemas-equivalentes` (o do CI; o `--comparar` estrito continua parando no `title` do `initialize`, ver `packages/mcp/README.md`) e `sh testes-gabarito/banco.sh --comparar` (com o `tmp/kb.sqlite` recém-compilado; o CI não o roda).
