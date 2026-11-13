# @simplifica-if/kb

Núcleo da base de conhecimento ([plano de arquitetura](../../PLANO-ARQUITETURA.md)): regras que mais de um consumidor usa (pipeline em `scripts/`, skills em `.agents/skills/`, avaliação). Os scripts importam `@simplifica-if/kb/<módulo>`; a dependência vai num sentido só.

| Módulo | Papel |
|---|---|
| `texto.ts`, `json.ts`, `schema.ts` | kit de paridade com o pipeline Python antigo (espaços, ordenação, JSON, `ajv`) |
| `normas/ids.ts` | IDs canônicos de norma, dispositivo e `externo:` |
| `normas/front-matter.ts` | front matter das normas (`yaml` failsafe + zod) |
| `normas/registro.ts` | universo de IDs: `manifest.json` + `normas/stubs.yaml` |
| `normas/resolver.ts` | `resolverCitacao(texto)` e `extrairCitacoes(texto)`, com regras nomeadas e confiança |
| `normas/dispositivos.ts` | "art. 28, inciso XVI" → `#art28-xvi` |
| `normas/texto-dispositivos.ts` | o caminho inverso: `["#art29", "#art37-par3"]` → "arts. 29 e 37, § 3º" |
| `normas/referencia-estruturada.ts` | `{ ref, dispositivo?, papel, nota? }` (zod), universo de IDs citáveis (normas, stubs, `externo:`, `cnct:`) e texto legível das referências das fichas da `analise-ppc` |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma; `lerTextoSecao` (texto integral de uma seção do índice pelas linhas) |
| `ppcs/front-matter.ts` | front matter de proveniência dos PPCs (`ppc:<campus>/<curso>`, URL, hash, data, conversor) e leitura com o front matter em branco |
| `ppcs/secoes.ts` | títulos, segmentação com linhas, taxonomias de seção por nível (técnico, ligada ao art. 28 da Res. CNE/CP nº 2/2026, e geral), preview e `textoDaSecao` |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |
| `avaliacao/busca-secoes.ts` | recall@10 da busca de seções em `avaliacao/busca-secoes/consultas.yaml`, com e sem stemmer e sinônimos |
| `busca/stemmer.ts`, `busca/tokens.ts` | stemmer Snowball de português (porte próprio, conferido contra `snowball-stemmers`) e termos da busca, iguais na indexação e na consulta |
| `busca/sinonimos.ts` | léxico de `dados/sinonimos.yaml`: termos por tipo de seção (expansão do documento) e grupos de equivalentes (expansão da consulta) |
| `institucional/dados.ts` | leitura frouxa de `dados/institucional/` e das matrizes do SUAP (`suap.matrizes.resumo`) |
| `fatos/ppc.ts`, `fatos/divergencias.ts` | fatos extraídos dos PPCs (carga total, estágio obrigatório e carga), com trecho e status `extraido`, e o cruzamento com o SUAP |
| `db/esquema.ts`, `db/compilar.ts` | esquema SQL e compilação determinística do `kb.sqlite` |
| `db/fontes.ts`, `db/banco.ts` | fontes do banco, impressão digital e recompilação automática |
| `db/fontes-normativas.ts` | interface de carga da fase 5 (dispositivos, relações, vigências, transições, correspondências) |
| `db/normas-blocos.ts` | texto das normas por bloco de título e trecho de um artigo |
| `db/consultas.ts`, `db/pacote-contexto.ts`, `db/comandos.ts` | consultas SQL com zod na fronteira e os comandos da CLI sobre o banco |

## CLI

Da raiz do repositório:

```bash
bun run kb resolver "Res. CNE/CP 1/2021, art. 20" [--json]
bun run kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
bun run kb adequacao-art71 [--json] [--incluir-tecnologia]
bun run kb avaliar-resolvedor [--json]
```

Sobre o banco compilado (`tmp/kb.sqlite`, fora do git):

```bash
bun run kb:compilar                                   # compila (cerca de 6 s, 127 MB); --destino muda o arquivo
bun run kb buscar-norma "Lei 11.788, art. 10" [--json] [--limite N] [--situacao base|stub|externo] [--vigentes]
bun run kb buscar-secoes "estágio não obrigatório" [--json] [--tipo T]... [--nivel N] [--campus C] [--cnct X] [--forma F] [--ppc P] [--modo simples|radicais|completo] [--integral]
bun run kb cursos [--json] [--eixo E] [--turno T] [--campus C] [--nivel N] [--forma F] [--situacao S] [--cnct X] [--processo P]
bun run kb ppc-fatos [<campus/curso>] [--json] [--divergencias] [--nivel N]
bun run kb pacote-contexto <CT-CURR-12 | tópico | grupo-001 | todas> <campus/curso> [--json]
bun run kb avaliar-busca [--json]
```

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## Manutenção

```bash
bun run --cwd packages/kb test        # inclui a medida do resolvedor (metas: precisão ≥ 0,95, recall ≥ 0,90)
bun run --cwd packages/kb typecheck
bun run --cwd packages/kb format
```

Ao mudar o resolvedor, rode também `bun run avaliacao:gabaritos` e revise o diff de `avaliacao/gabaritos/` (Q02 e Q20 vêm de `kb citacoes`).

## Banco compilado (`kb.sqlite`)

**Fontes.** Os arquivos do git: `manifest.json`, `normas/` (Markdown e `stubs.yaml`), PPCs e índice de seções, CNCT, `dados/institucional/`, fichas, tópicos e marcos da `analise-ppc`, `packages/kb/dados/*.yaml` e o código de `packages/kb/src/` que entra na compilação (lista em `db/fontes.ts`). O banco é derivado, nunca editado, e não vai para o git.

**Tabelas.** `normas` (manifest e stubs), `normas_blocos` (texto por título, com `artigo` e linhas; mais um bloco de metadados por norma), `normas_fts`; `ppcs` (índice e proveniência), `secoes` (texto integral recortado pelas linhas com `lerTextoSecao`), `secoes_fts`; `citacoes` (resolvedor da fase 2, com seção e papel `fundamento` ou `referencia-bibliografica`); `campi`, `cursos` (com `cnct_id`), `suap_matrizes`, `processos`, `editais`, `ofertas` (com turno), `ofertas_cursos`, `ofertas_processos`, `cnct`; `fichas`, `fichas_referencias`, `topicos`, `fichas_topicos`, `marcos`; `ppc_fatos`, `ppc_suap`; da fase 5, vazias por ora: `dispositivos`, `relacoes`, `vigencias`, `transicoes`, `correspondencias`; e `meta`.

**FTS5.** `tokenize="unicode61 remove_diacritics 2"`, sem conteúdo próprio (`content=''`). Em `secoes_fts`: `titulo` e `texto` (tokens), `titulo_radicais` e `radicais` (radicais Snowball de `busca/tokens.ts`) e `expansao` (radicais do léxico do tipo da seção). A consulta casa primeiro todos os conceitos (AND) e completa com qualquer um (OR), por BM25 com peso maior para o título.

**Papel da citação.** `referencia-bibliografica` quando a citação está na seção `referencias` do PPC ou depois de um rótulo "Bibliografia"/"Referências" na mesma seção (o ementário traz a bibliografia de cada componente); `fundamento` no resto. É heurística.

**Determinismo.** Dois builds sobre as mesmas fontes produzem o mesmo arquivo, byte a byte (`db/base.test.ts`): leitura ordenada por code point, `rowid` na ordem das fontes, nada do relógio (`meta` guarda só a versão do esquema e o hash das fontes), `page_size` fixo, `optimize` do FTS5 e `VACUUM` no fim.

**Recompilação.** Cada comando sobre o banco confere, nesta ordem: banco ausente, versão do esquema, lista de fontes (arquivo novo ou removido); se nenhuma fonte tem mtime mais novo que o banco, ele está fresco; se alguma tem, compara o SHA-256 do conteúdo das fontes com o gravado em `meta` (igual: só atualiza o mtime do banco; diferente: recompila). `KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre` desliga ou força a recompilação.

**Fase 5.** A carga de dispositivos, relações, vigências, transições e correspondências entra por `FontesNormativas` (`db/fontes-normativas.ts`): uma implementação com os módulos de `normas/` passa a `compilarBanco({ fontesNormativas })` ou substitui `fontesNormativasPadrao` em `db/compilar.ts`. Cada linha é validada pelo zod da tabela; a ordem de inserção tem de ser estável; arquivos novos que a carga ler (como `relacoes.yaml`) entram em `ARQUIVOS_FONTES_NORMATIVAS`. Até lá, `blocoDoArtigo` dá o texto do artigo pelo bloco do Markdown.

**Busca de seções.** Ao mudar `dados/sinonimos.yaml`, `busca/` ou as consultas de `db/consultas.ts`, rode `bun run kb avaliar-busca` e compare o recall@10 dos três modos com o anterior; o conjunto de `avaliacao/busca-secoes/` é rascunho, rotulado pelos títulos das seções.
