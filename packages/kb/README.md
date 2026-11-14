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
| `normas/markdown.ts` | Markdown → mdast (`remark-parse` + `remark-gfm`) com o front matter em branco (linhas do mdast = linhas do arquivo) e `palavrasMarkdown`, a régua do saneamento e da reconstituição |
| `normas/estrutura.ts` | parser de dispositivos: artigo, parágrafo, inciso, alínea, item, anexo e seção, com IDs canônicos, caput herdado, notas de redação, revogado/vetado, estrutura e linhas; segmentos que reconstituem o corpo; dedução da compilação pelo ato |
| `normas/relacoes.ts` | `base-conhecimento/relacoes.yaml` (zod), validação por evidência literal, campos de relação do front matter e propostas por regex |
| `normas/vigencia.ts` | datas das normas, status numa data (`statusEm`) e em intervalos datados (`intervalosVigencia`), `data_referencia` de `config/vigencia.yaml`, regras de transição (`transicoes.yaml`, com `datasTransicao` e `situacaoNaData`) e linhas normativas dos marcos (`derivarLinha`) |
| `normas/gerado.ts` | campos gerados do front matter (relações e status) e reescrita do front matter, usados por `scripts/gerar_base.ts` |
| `normas/correspondencia.ts` | tabelas de correspondência entre normas sucessoras (`correspondencias/*.yaml`), com herança pelo ancestral (`correspondenciaEm` sobre uma fonte: arquivos ou banco) |
| `normas/fontes-db.ts` | `FontesNormativas` pela API de `normas/`: as linhas das tabelas da fase 5 no `kb.sqlite` |
| `normas/impacto.ts` | `kb impacto`: fichas, validações cruzadas, textos das skills, normas e PPCs afetados por uma norma |
| `normas/comandos.ts` | comandos da CLI da fase 5, registrados em `cli.ts` |
| `normas/referencia-estruturada.ts` | `{ ref, dispositivo?, papel, nota? }` (zod), universo de IDs citáveis (normas, stubs, `externo:`, `cnct:`) e texto legível das referências das fichas da `revisar-ppc` |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma; `lerTextoSecao` (texto integral de uma seção do índice pelas linhas) |
| `ppcs/front-matter.ts` | front matter de proveniência dos PPCs (`ppc:<campus>/<curso>`, URL, hash, data, conversor) e leitura com o front matter em branco |
| `ppcs/secoes.ts` | títulos, segmentação com linhas, taxonomias de seção por nível (técnico, ligada ao art. 28 da Res. CNE/CP nº 2/2026, e geral), preview e `textoDaSecao`; `secoesIndexadas` (o recorte do índice publicado, com a chave `<tipo>-<n>` do ID) e `secoesComChave` (todas as seções, as de fora do índice com `<tipo>-x<n>`) |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |
| `avaliacao/busca-secoes.ts` | recall@10 da busca de seções em `avaliacao/busca-secoes/consultas.yaml`, com e sem stemmer e sinônimos |
| `busca/stemmer.ts`, `busca/tokens.ts` | stemmer Snowball de português (porte próprio, conferido contra `snowball-stemmers`, e a variante `radicalSemAcento`, com os sufixos sem acentos) e termos da busca, iguais na indexação e na consulta e iguais com ou sem acento |
| `busca/sinonimos.ts` | léxico de `dados/sinonimos.yaml`: termos por tipo de seção (expansão do documento) e grupos de equivalentes (expansão da consulta) |
| `institucional/dados.ts` | leitura frouxa de `dados/institucional/` e das matrizes do SUAP (`suap.matrizes.resumo`) |
| `fatos/ppc.ts`, `fatos/divergencias.ts` | fatos extraídos dos PPCs (carga total, estágio obrigatório e carga), com trecho e status `extraido`, e o cruzamento com o SUAP |
| `db/esquema.ts`, `db/compilar.ts` | esquema SQL e compilação determinística do `kb.sqlite`; `gravarSecoesECitacoes` (seções, FTS e citações de um PPC) e `bancoDoPpcAvulso` (banco em memória, no mesmo esquema, com um PPC que pode não estar na base) |
| `db/fontes.ts`, `db/banco.ts` | fontes do banco, impressão digital e recompilação automática |
| `db/fontes-normativas.ts` | interface de carga da fase 5 (dispositivos, relações, vigências, transições, correspondências), com o zod de cada linha, e os arquivos que ela lê |
| `db/consultas.ts`, `db/consultas-normas.ts`, `db/pacote-contexto.ts`, `db/comandos.ts` | consultas SQL com zod na fronteira (as da fase 5 em `consultas-normas.ts`) e os comandos da CLI sobre o banco |
| `db/fontes-banco.ts`, `db/modo-banco.ts` | modo banco: registro, datas, relações, transições e léxico remontados das tabelas, e uma função por consulta que responde só com o `kb.sqlite` (entrada do `packages/mcp`) |
| `normas/citacoes-normas.ts` | citações resolvidas no texto das normas da base (dispositivos e preâmbulo), para o `impacto` e a tabela `normas_citacoes` |

## CLI

Da raiz do repositório:

```bash
bun run kb resolver "Res. CNE/CP 1/2021, art. 20" [--json]
bun run kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
bun run kb adequacao-art71 [--json] [--incluir-tecnologia]
bun run kb avaliar-resolvedor [--json]
bun run kb dispositivo "br/cne-cp/res/2026/2#art71-parunico" [--json] [--filhos]   # lê o banco
bun run kb vigencia br/cne-cp/res/2021/1 [--em 2026-11-12] [--json]
bun run kb relacoes br/lei/1996/9394 [--json]
bun run kb relacoes --propor [--json]
bun run kb correspondencia "br/cne-cp/res/2021/1#art20" [--json]                  # lê o banco
bun run kb impacto br/cne-cp/res/2021/1 [--json] [--sem-ppcs] [--conteudo <dir>]
```

`dispositivo` e `correspondencia` leem o `kb.sqlite` com as mesmas regras da API de arquivos (`db/base.test.ts` confere a igualdade em todos os dispositivos e em toda a tabela 1/2021 → 2/2026). `vigencia`, `relacoes` e `impacto` leem os arquivos: `vigencia` explica o status com os eventos e as pendências que `statusEm` monta (o banco guarda os intervalos que saem dele, conferidos contra `statusEm`); `relacoes --propor` roda o regex sobre o parser; `impacto` lê os textos das skills, inclusive de outra árvore (`--conteudo`), que não estão no banco.

Sobre o banco compilado (`tmp/kb.sqlite`, fora do git):

```bash
bun run kb:compilar                                   # compila (cerca de 8 s, 132 MB); --destino muda o arquivo
bun run kb buscar-norma "Lei 11.788, art. 10" [--json] [--limite N] [--situacao base|stub|externo] [--vigentes [--em AAAA-MM-DD]]
bun run kb buscar-secoes "estágio não obrigatório" [--json] [--tipo T]... [--nivel N] [--campus C] [--cnct X] [--forma F] [--ppc P] [--modo simples|radicais|completo] [--integral]
bun run kb cursos [--json] [--eixo E] [--turno T] [--campus C] [--nivel N] [--forma F] [--situacao S] [--cnct X] [--processo P]
bun run kb ppc-fatos [<campus/curso>] [--json] [--divergencias] [--nivel N]
bun run kb pacote-contexto <CT-CURR-12 | tópico | grupo-001 | todas> <campus/curso | arquivo.md> [--json]
bun run kb avaliar-busca [--json]
```

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## API para o banco compilado (fase 6)

Funções puras sobre os arquivos do checkout (todas aceitam a raiz do repositório como último argumento; o padrão é o próprio checkout). Nenhuma lê o relógio.

| Função | Módulo | Devolve |
|---|---|---|
| `listarNormas(raiz)` | `normas/estrutura` | `{ id, path, arquivo }` das 36 normas |
| `carregarEstruturas(raiz)` | `normas/estrutura` | por norma: `dispositivos`, `segmentos` (corpo inteiro, em ordem, com tipo e linhas) e `problemas` |
| `carregarDispositivos(raiz)` | `normas/estrutura` | `Dispositivo[]`: `id`, `dispositivo`, `norma` (arquivo), `ato`, `tipo`, `rotulo`, `pai`, `texto`, `caput[]`, `estrutura[]`, `notas[]`, `revogado`, `vetado`, `linha_inicio`, `linha_fim`, `ordem` |
| `indiceDispositivos(raiz)` / `obterDispositivo(id)` / `dispositivosDoAto(ato)` | `normas/estrutura` | índice por `ato#dispositivo`, já deduplicado com a compilação (o texto integral prevalece) |
| `carregarRelacoes(raiz)` | `normas/relacoes` | `Relacao[]`: `tipo`, `origem`, `operador`, `alvo`, `alvo_dispositivo`, `alcance`, `efeito_de`, `evidencia`, `confirmado_em`, `proposta`, `nota` |
| `carregarDatas(raiz)` | `normas/vigencia` | `assinada_em`, `publicada_em`, `vigente_de` por ato (normas e stubs) |
| `statusEm(id, data, raiz)` | `normas/vigencia` | `{ status, certo, inicio, eventos[], pendencias[] }` |
| `dataReferencia(raiz)` | `normas/vigencia` | a `data_referencia` declarada |
| `carregarTransicoes(raiz)` / `transicoesAplicaveis(id, data)` | `normas/vigencia` | regras de transição e sua situação na data |
| `derivarLinha(linha, data, raiz)` | `normas/vigencia` | vigente, substituídas, antecessoras e dispositivos revogados de um tema |
| `carregarCorrespondencias(raiz)` / `correspondencia(id)` | `normas/correspondencia` | tabelas e o item aplicável (com herança) |
| `impacto(id, opcoes)` | `normas/impacto` | arquivos, normas e PPCs afetados |

No banco (fase 6), essa API entra por `normas/fontes-db.ts`; as tabelas estão descritas em "Banco compilado".

## Manutenção

```bash
bun run --cwd packages/kb test        # inclui a medida do resolvedor (metas: precisão ≥ 0,95, recall ≥ 0,90)
bun run --cwd packages/kb typecheck
bun run --cwd packages/kb format
```

Ao mudar o resolvedor, rode também `bun run avaliacao:gabaritos` e revise o diff de `avaliacao/gabaritos/` (Q02 e Q20 vêm de `kb citacoes`).

## Banco compilado (`kb.sqlite`)

**Fontes.** Os arquivos do git: `manifest.json`, `normas/` (Markdown e `stubs.yaml`), PPCs e índice de seções, CNCT, `dados/institucional/`, fichas, tópicos e marcos da `revisar-ppc`, `packages/kb/dados/*.yaml` e o código de `packages/kb/src/` que entra na compilação (lista em `db/fontes.ts`). O banco é derivado, nunca editado, e não vai para o git.

**Tabelas.** `normas` (manifest e stubs), `normas_metadados` (título, aliases, palavras-chave e ementa, para achar a norma pelo nome), `normas_fts`; `ppcs` (índice e proveniência), `secoes` (texto integral recortado pelas linhas com `lerTextoSecao`), `secoes_fts`; `citacoes` (resolvedor da fase 2, com seção e papel `fundamento` ou `referencia-bibliografica`); `campi`, `cursos` (com `cnct_id`), `suap_matrizes`, `processos`, `editais`, `ofertas` (com turno), `ofertas_cursos`, `ofertas_processos`, `cnct`; `fichas`, `fichas_referencias`, `topicos`, `fichas_topicos`, `marcos` (com vigente, substituídas, antecessoras e dispositivos revogados derivados por `derivarLinha` na `data_referencia`); `ppc_fatos`, `ppc_suap`; da fase 5: `dispositivos` (todas as colunas de `Dispositivo`, `texto_com_caput`, arquivo e linhas, e `canonico`, a deduplicação de `indiceDispositivos`: a compilação da LDB entra com o ID do arquivo), `dispositivos_fts`, `relacoes` (o `relacoes.yaml` inteiro, com o efeito resolvido), `vigencias` (intervalos `[de, ate)` com `status` e `certo`), `transicoes` (com `inicio_em`, `inicio_minimo` e `fim_em`; a situação numa data sai de `situacaoNaData`), `correspondencias_tabelas` e `correspondencias`, `normas_citacoes` (citações entre normas, para o `impacto`); `sinonimos_tipos`, `sinonimos_grupos` e `topicos_secoes` (os YAML de `dados/`); e `meta` (com a `data_referencia` e, quando o build os informa, `versao`, `commit` e `canal`).

**Vigência no banco.** O status de `statusEm` só muda nas datas que ele compara (início de vigência ou assinatura do ato e efeito, certo ou mínimo, de cada `revoga`/`altera`); `intervalosVigencia` avalia `statusEm` nessas datas e grava os intervalos. Nada vem do relógio: a consulta escolhe a data (`buscar-norma --vigentes --em`). O `vigencia` da CLI continua em `statusEm`, que também explica eventos e pendências.

**FTS5.** `tokenize="unicode61 remove_diacritics 2"`, sem conteúdo próprio (`content=''`). Em `dispositivos_fts` (só os canônicos): `texto` (o `texto_com_caput`, para um inciso casar com o assunto do caput) e `radicais`. `buscar-norma` por termos casa os conceitos (AND) primeiro nos metadados das normas e depois nos dispositivos, e completa com qualquer conceito (OR), dispositivos antes; por citação ou ID, devolve o dispositivo com o caput e os subordinados (ou o ancestral mais próximo, com `pedido`). `--situacao` e `--vigentes` valem também para a norma citada: se a excluem (ou excluem o dispositivo citado, revogado), a resposta fica vazia e um aviso diz por quê; ID de norma (`br/…`, `ifpr/…`) fora da base dá o aviso "ID desconhecido" e código de saída 1, sem busca textual. No `--json`, os avisos vão em `avisos`. Em `secoes_fts`: `titulo` e `texto` (tokens), `titulo_radicais` e `radicais` (radicais Snowball de `busca/tokens.ts`) e `expansao` (radicais do léxico do tipo da seção). A consulta casa primeiro todos os conceitos (AND) e completa com qualquer um (OR), por BM25 com peso maior para o título.

**Papel da citação.** `referencia-bibliografica` quando a citação está na seção `referencias` do PPC ou depois de um rótulo "Bibliografia"/"Referências" na mesma seção (o ementário traz a bibliografia de cada componente); `fundamento` no resto. É heurística.

**Determinismo.** Dois builds sobre as mesmas fontes produzem o mesmo arquivo, byte a byte (`db/base.test.ts`): leitura ordenada por code point, `rowid` na ordem das fontes, nada do relógio (`meta` guarda a versão do esquema, a data de referência e o hash das fontes; `versao`, `commit` e `canal` só com `--versao`, `--commit` e `--canal`, e vêm de quem builda), `page_size` fixo, `optimize` do FTS5 e `VACUUM` no fim.

**Recompilação.** Cada comando sobre o banco confere, nesta ordem: banco ausente, versão do esquema, lista de fontes (arquivo novo ou removido); se nenhuma fonte tem mtime mais novo que o banco, ele está fresco; se alguma tem, compara o SHA-256 do conteúdo das fontes com o gravado em `meta` (igual: o mtime do banco avança até o das fontes; diferente: recompila). A compilação dá ao banco o mtime do instante anterior à leitura das fontes, e não o do fim: uma fonte editada durante a compilação fica mais nova que ele e é conferida na próxima abertura. `KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre` desliga ou força a recompilação.

**Fase 5.** A carga entra por `FontesNormativas` (`db/fontes-normativas.ts`), implementada por `fontesNormativasArquivos` (`normas/fontes-db.ts`), o padrão de `compilarBanco`. Nenhuma regra é reescrita no banco: a deduplicação vai gravada (`canonico`), a vigência sai de `statusEm`, e as consultas (`db/consultas-normas.ts`) usam `correspondenciaEm`, `descendentesEm` e `situacaoNaData`, as mesmas funções da API de arquivos. Cada linha é validada pelo zod da tabela; a ordem de inserção é a dos arquivos. Arquivo novo que a carga ler entra em `ARQUIVOS_FONTES_NORMATIVAS` (hoje `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml` e `normas/stubs.yaml`). Ao mudar o esquema, suba `VERSAO_ESQUEMA` (hoje 3).

**`pacote-contexto`.** Por norma citada pelas fichas, o texto de cada dispositivo citado (`referencias_normativas[].dispositivo`): caput herdado, o próprio texto e os subordinados, arquivo e linhas; um dispositivo contido noutro citado não se repete (vai em `citados`). Também os marcos ligados (com os campos derivados) e as regras de transição das normas das fichas e das citadas como fundamento pelo PPC, com a situação na `data_referencia` e o texto do dispositivo que as estabelece. As seções do PPC são as dos tipos ligados aos tópicos das fichas (`dados/topicos-secoes.yaml`) mais a melhor seção de cada `consulta` das fichas. As partes são funções próprias (`normasDoPacote`, `marcosDoPacote`, `transicoesDoPacote`, `secoesDoPacote`), usadas pelo pacote de um PPC da base (`pacoteContexto`) e pelo de um PPC fora dela (`pacoteContextoAvulso`).

**Grupos por tópico.** `grupo-NNN` é o n-ésimo grupo de sub-agente da `revisar-ppc`, montado por `agruparPorTopico`: cada ficha vai no grupo do seu tópico principal (`topicoPrincipal`: o de menos fichas entre os seus `topicos_tematicos`, no empate o primeiro na ordem de `topicos-fichas.json`), as de `tipo_escopo: transversal` num grupo `transversal` por último, com o PPC inteiro (`escopo: "completo"`); tópico com mais de `TAMANHO_MAXIMO_GRUPO` (20) fichas vira partes equilibradas.

**PPC fora da base.** `bancoDoPpcAvulso(markdown, opcoes)` cria um banco em memória com o esquema do `kb.sqlite` e grava o PPC por `gravarSecoesECitacoes`, o mesmo caminho da compilação: seções de `secoesIndexadas` (ou, com `todasAsSecoes`, de `secoesComChave`, que mantém a capa, `outros` e as seções curtas) e citações do resolvedor. Com `titulosNivel1`, `# Título` conta como título (o normalizador da `revisar-ppc` põe o primeiro nível numerado em `#`; no índice publicado só `##` a `######` contam). Para um PPC da base, o banco em memória dá as mesmas seções e citações do `kb.sqlite` (`db/base.test.ts`). `pacoteContextoAvulso(db, dbPpc, fichas, opcoes)` monta o pacote de um conjunto de fichas: normas, marcos e transições do `kb.sqlite`; seções e citações do banco em memória; `citacoesPpc` acrescenta todas as citações normativas do PPC. A CLI aceita um `.md` no lugar de `<campus/curso>`.

**Busca de seções.** Ao mudar `dados/sinonimos.yaml`, `busca/` ou as consultas de `db/consultas.ts`, rode `bun run kb avaliar-busca` e compare o recall@10 dos três modos com o anterior; o conjunto de `avaliacao/busca-secoes/` é rascunho, rotulado pelos títulos das seções.

## Modo banco (sem o repositório)

O servidor MCP roda só com o `kb.sqlite`, sem o checkout. `db/modo-banco.ts` (`@simplifica-if/kb/db/modo-banco`) tem uma função por consulta, com a mesma saída da CLI sobre os arquivos (`db/base.test.ts` confere byte a byte, em JSON):

| CLI | Modo banco |
|---|---|
| `resolver` | `resolverBanco(db, texto)` |
| `buscar-norma` | `buscarNormaBanco(db, consulta, opcoes)` |
| `dispositivo`, `correspondencia` | `obterDispositivoBanco`, `descendentesBanco`, `correspondenciaBanco(db, id)` |
| `citacoes` | `citacoesBanco(db, id, { confiancaMinima })`, `ppcsQueCitamBanco` |
| `vigencia` | `vigenciaBanco(db, id, { em })` |
| `relacoes` | `relacoesDaNormaBanco(db, id)` |
| `impacto` | `impactoBanco(db, id, { data, incluirPpcs })` |
| `adequacao-art71` | `adequacaoArt71Banco(db, { incluirTecnologia })` |
| `buscar-secoes` | `buscarSecoesBanco(db, consulta, filtros, opcoes)` |
| `cursos`, `ppc-fatos` | `listarCursos`, `fatosDosPpcs`, `divergenciasPpcSuap` |
| `pacote-contexto` | `pacoteContextoBanco(db, tarefa, ppc)`, `pacoteDoMarkdownBanco(db, tarefa, arquivo, { markdown })` |

Abertura: `abrirBancoSomenteLeitura(caminho)`, igual a `abrirBanco({ caminho, somenteLeitura: true, recompilar: false })`: não procura o repositório nem compila. `metaBanco(db)` traz a versão do esquema, a `data_referencia` e a identificação do build.

As regras não mudam; muda a fonte. A vigência (`statusEm`, `transicoesAplicaveis`, `derivarLinha`), o impacto (`impactoEm`) e a adequação ao art. 71 (`adequacaoArt71Em`) recebem uma fonte (`FonteVigencia`, `FonteImpacto`, `FonteAdequacao`), com implementação de arquivos e de banco, como a `FonteCorrespondencia`. O registro sai da tabela `normas`; as citações, de `citacoes` e `normas_citacoes`; o léxico e os tópicos, das tabelas próprias; o tamanho do PPC, de `ppcs.caracteres`. Nada no caminho dessas funções lê arquivo: dentro de um binário `bun build --compile`, a leitura relativa ao código falharia. O teste roda todas a partir de uma cópia do banco num diretório vazio, com qualquer leitura de arquivo fora dele falhando, e num binário compilado.

Diferença inevitável: o `impactoBanco` traz só as fichas da `revisar-ppc` em `arquivos`; os outros textos das skills (prompts, validações cruzadas, contratos) não estão no banco e continuam só na CLI.
