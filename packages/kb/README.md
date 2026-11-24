# @simplifica-if/kb

Núcleo da base de conhecimento ([plano de arquitetura](../../docs/plans/arquitetura-base.md)): regras que mais de um consumidor usa (servidor do app em `apps/server`, servidor MCP, pipeline em `scripts/`, skills em `.agents/skills/`, avaliação). Os consumidores importam `@simplifica-if/kb/<módulo>`; a dependência vai num sentido só.

Desde o C1 da consolidação na stack do T3, o kb é um conjunto de serviços [Effect 4](https://effect.website) sobre um `SqlClient` do `node:sqlite`. As regras puras (resolvedor, vigência, impacto, adequação, stemmer, texto, `primitivas/*`) continuam funções puras e síncronas; o Effect entra nas fontes de dados, no banco, nos erros e nas bordas (CLI). `effect` e `@effect/platform-node` são `peerDependencies`: quem consome traz a mesma versão (a do catalog).

## Serviços e layers

| Serviço (`src/`) | Métodos | Depende de |
|---|---|---|
| `BaseKb.ts` | `meta` (versão do esquema, `data_referencia`, impressão digital, contagens, `versao`/`commit`/`canal`); falha a layer com `BaseIncompativel`. `layerSqlite({ caminho })`: o `SqlClient` só leitura (`BaseAusente`) | `SqlClient` |
| `FontesNormativas.ts` | `registro`, `datas`, `relacoes`, `transicoes` (com eles, o próprio serviço é a `FonteVigencia` das regras), `dataReferencia`, `sinonimos`, `topicosSecoes`, `topicosFichas`, `conteudoRevisaoPpc()` (fichas, marcos e taxonomia de `base-conhecimento/revisao-ppc`). Uma layer, `layer`: tudo das tabelas do `kb.sqlite`, só `SqlClient` | `SqlClient` |
| `Normas.ts` | `resolver`, `buscar`, `obter`, `ficha`, `dispositivo`, `dispositivoOuAncestral`, `descendentes`, `trecho`, `vigencia`, `relacoes`, `sucessoras`, `correspondencia`, `tabelasDeCorrespondencia`, `listar`, `documento` (a norma para o leitor: dispositivos e Markdown), `dataReferencia`, `enderecosOficiais` | `SqlClient`, `FontesNormativas` |
| `Ppcs.ts` | `buscarSecoes`, `buscarSecoesPorPrefixo` (a paleta do Explorar), `secoesDoPpc`, `indiceSecoesDoPpc`, `lerSecao`, `citacoesDaNorma`, `relatorioCitacoes`, `normasCitadas`, `fatos`, `divergencias`, `tiposDeSecao`, `listar`, `documento` (o PPC para o leitor: seções e Markdown) | `SqlClient`, `FontesNormativas` |
| `Cursos.ts` | `listar`, `cnct`, `catalogoCnct`, `adequacaoArt71`, `campi`, `processos`, `niveis`, `paginasOficiais` | `SqlClient` |
| `Conselhos.ts` | `reunioes` (as do Consepe, com documentos e itens de pauta) | `SqlClient` |
| `Impacto.ts` | `daNorma(id, { data, incluirPpcs })`: normas, fichas, marcos e taxonomia da revisão de PPC e PPCs atingidos (os textos das skills de `.agents/skills` não entram) | `SqlClient`, `FontesNormativas` |
| `PacoteContexto.ts` | `montar` (PPC da base), `doMarkdown` (texto de um PPC fora da base), `abrirAvulso` (um PPC fora da base num banco em memória do escopo, com o `pacote` de cada conjunto de fichas e a `estrutura`), `fichas`, `fichasResumidas`, `nomesDeCampi` | `SqlClient`, `FontesNormativas` |
| `Compilador.ts` | `compilar`, `estado`, `garantirFresco` (política `KB_RECOMPILAR`) | `FileSystem`, `Path` |

Layers prontas (`src/layers.ts`):

- `layerSomenteLeitura({ caminho })`: o `kb.sqlite` em `caminho`, só leitura, com todos os serviços de consulta e as fontes remontadas das tabelas. **Não exige `FileSystem`**: o tipo garante que nada no caminho lê o repositório. É a do servidor MCP, do executável e do servidor do app (`apps/server`).
- `layerRepositorio({ raiz })`: o checkout. Recompila o `tmp/kb.sqlite` se preciso (`KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre`) e dá os serviços de `layerSomenteLeitura` sobre ele, com o `Compilador`. É a da CLI e dos scripts e testes do `packages/ppc`, que montam a base da revisão prévia como o app.
- `layerConsultas`: os serviços de consulta sobre o `SqlClient` e as `FontesNormativas` do ambiente (para montar outra combinação, como uma fixture: `db/conexao.ts` dá um `SqlClient` sobre um `DatabaseSync` já aberto).

Como consumir:

```ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layers from "@simplifica-if/kb/layers";
import * as Normas from "@simplifica-if/kb/Normas";

const programa = Effect.gen(function* () {
  const normas = yield* Normas.Normas;
  const { resultados } = yield* normas.buscar("Res. CNE/CP 2/2026, art. 28");
  // …
});

programa.pipe(Effect.provide(Layers.layerSomenteLeitura({ caminho: "kb.sqlite" })), NodeRuntime.runMain);
```

Erros tipados: `Sql.FalhaNaConsulta` (`db/sql.ts`: o banco não corresponde ao esquema), `BaseIncompativel`, `BaseAusente`, `FalhaNaCompilacao`, `BaseDesatualizada` e os do pacote de contexto (`PpcNaoEncontrado`, `TarefaNaoReconhecida`, em `pacote-contexto-erros.ts` e reexportados por `PacoteContexto.ts`), todos `Schema.TaggedError` com mensagem em português; quem os traduz usa `Effect.catchTags`. Mensagens de validação de schema: `esquema/mensagens.ts` (`formatarErro`, `problemas`), o formatador pt-BR único.

| Módulo | Papel |
|---|---|
| `caminhos.ts` | os caminhos, relativos à raiz do repositório, de tudo o que o kb lê (`CAMINHOS`, `noCheckout`); `raizRepositorio()`, que só os pontos de entrada e os testes chamam |
| `canal.ts` | os canais da base (`dev`, `beta`, `estavel`), sem dependência, para os contratos do app |
| `texto.ts`, `json.ts`, `schema.ts` | texto, JSON e JSON Schema comuns aos scripts e às skills (espaços, ordenação, JSON, `ajv`) |
| `primitivas/*` | regex com classes Unicode, JSON tipado (inteiro e fracionário distintos), case folding e similaridade de sequências, com saída fixa byte a byte (conversão do PPC) |
| `esquema/mensagens.ts` | formatador único das mensagens de validação do Effect Schema, em português |
| `normas/ids.ts` | IDs canônicos de norma, dispositivo e `externo:` |
| `normas/front-matter.ts` | front matter das normas (`yaml` failsafe + Effect Schema) |
| `normas/registro.ts` | universo de IDs: front matter das normas + `normas/stubs.yaml` (`montarRegistro` sobre o que foi lido; `carregarRegistro` lê os arquivos) |
| `normas/resolver.ts` | `resolverCitacao(texto)` e `extrairCitacoes(texto)`, com regras nomeadas e confiança |
| `normas/dispositivos.ts` | "art. 28, inciso XVI" → `#art28-xvi` |
| `normas/texto-dispositivos.ts` | o caminho inverso: `["#art29", "#art37-par3"]` → "arts. 29 e 37, § 3º" |
| `normas/markdown.ts` | Markdown → mdast (`remark-parse` + `remark-gfm`) com o front matter em branco (linhas do mdast = linhas do arquivo) e `palavrasMarkdown`, a régua do saneamento e da reconstituição |
| `normas/estrutura.ts` | parser de dispositivos: artigo, parágrafo, inciso, alínea, item, anexo e seção, com IDs canônicos, caput herdado, notas de redação, revogado/vetado, estrutura e linhas; segmentos que reconstituem o corpo; lint da marcação (níveis de cabeçalho, seção editorial) |
| `normas/divisoes.ts`, `normas/sumario.ts` | as divisões da norma (Livro a Subseção) e o nível de cabeçalho de cada uma; o sumário do leitor (`sumarioDaNorma`: divisões, anexos e tópicos, com a faixa de artigos) |
| `normas/pontos-chave.ts` | os artigos que um item de `pontos_chave` cita no parêntese final, para o `validar_base` conferir que a norma os tem |
| `normas/alteracoes-anotadas.ts` | as alterações que o texto consolidado anota ("Redação dada pela Lei nº ..."), agrupadas pelo ato que as fez, com os dispositivos atingidos; derivadas das notas dos dispositivos na leitura (`Normas.alteracoesAnotadas`), sem relação em `relacoes.yaml` nem efeito na vigência |
| `normas/relacoes.ts` | `base-conhecimento/relacoes.yaml` (Effect Schema), validação por evidência literal, campos de relação do front matter e propostas por regex |
| `normas/vigencia.ts` | datas das normas, a `FonteVigencia` (registro, datas, relações, transições e o piso do texto consolidado, `TextoConsolidado`: norma com nota de redação ou dispositivo revogado é `alterada` ou `parcialmente revogada` da `data_referencia` em diante, mesmo sem relação registrada; `carregarFonteVigencia(raiz)` a lê dos arquivos), status numa data (`statusEm`) e em intervalos datados (`intervalosVigencia`), `data_referencia` de `config/vigencia.yaml`, regras de transição (`transicoes.yaml`, com `datasTransicao` e `situacaoNaData`) e linhas normativas dos marcos (`derivarLinha`) |
| `normas/gerado.ts` | campos gerados do front matter (relações e status) e reescrita do front matter, usados por `scripts/gerar_base.ts` |
| `normas/correspondencia.ts` | tabelas de correspondência entre normas sucessoras (`correspondencias/*.yaml`), com herança pelo ancestral (`correspondenciaEm` sobre a `FonteCorrespondencia` que `db/consultas-normas.ts` carrega do banco) |
| `normas/fontes-db.ts` | `LinhasNormativas` pela API de `normas/`: as linhas das tabelas da fase 5 que a compilação grava |
| `normas/impacto.ts` | a regra do impacto (`impactoEm`, ferramenta `impacto_da_norma`, pura, sobre uma `FonteImpacto` que traz o `id` da norma para a qual foi carregada): fichas e textos da revisão de PPC, normas e PPCs afetados por uma norma |
| `normas/referencia-estruturada.ts` | `{ ref, dispositivo?, papel, nota? }` (Effect Schema), universo de IDs citáveis (normas, stubs, `externo:`, `cnct:`) e texto legível das referências das fichas da revisão de PPC |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma; `lerTextoSecao` (texto integral de uma seção do índice pelas linhas) |
| `ppcs/ids.ts` | ID permanente dos PPCs (`ppc:<campus>/<curso>/<versao>`), caminho do arquivo e ordem das versões |
| `ppcs/front-matter.ts` | front matter de proveniência dos PPCs (`ppc:<campus>/<curso>/<versao>`, URL, hash, data, conversor) e leitura com o front matter em branco |
| `ppcs/topicos.ts` | tópicos da revisão de PPC: tipos de seção por tópico (`dados/topicos-secoes.yaml`) e a taxonomia das fichas (`topicos-fichas.json`) |
| `ppcs/secoes.ts` | títulos, segmentação com linhas, taxonomias de seção por nível (técnico, ligada ao art. 28 da Res. CNE/CP nº 2/2026, e geral), preview e `textoDaSecao`; `secoesIndexadas` (o recorte do índice publicado, com a chave `<tipo>-<n>` do ID) e `secoesComChave` (todas as seções, as de fora do índice com `<tipo>-x<n>`) |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |
| `avaliacao/busca-secoes.ts` | recall@10 da busca de seções em `avaliacao/busca-secoes/consultas.yaml`, com e sem stemmer e sinônimos |
| `busca/stemmer.ts`, `busca/tokens.ts` | stemmer Snowball de português (porte próprio, conferido contra `snowball-stemmers`, e a variante `radicalSemAcento`, com os sufixos sem acentos) e termos da busca, iguais na indexação e na consulta e iguais com ou sem acento |
| `busca/fts.ts` | expressões do FTS5, puras: os conceitos de uma consulta, a expressão por conceitos (seções e normas) e a por prefixo (paleta do Explorar), e as linhas que casam |
| `busca/sinonimos.ts` | léxico de `dados/sinonimos.yaml`: termos por tipo de seção (expansão do documento) e grupos de equivalentes (expansão da consulta) |
| `institucional/dados.ts` | leitura frouxa de `base-conhecimento/institucional/ifpr/` e das matrizes do SUAP (`suap.matrizes.resumo`) |
| `fatos/ppc.ts`, `fatos/divergencias.ts` | fatos extraídos dos PPCs (carga total, estágio obrigatório e carga), com trecho e status `extraido`, e o cruzamento com o SUAP |
| `db/esquema.ts`, `db/compilar.ts` | esquema SQL e compilação determinística do `kb.sqlite`; `gravarSecoesECitacoes` (seções, FTS e citações de um PPC) |
| `db/ppc-avulso.ts` | `abrirPpcAvulso`: o banco em memória, no mesmo esquema, com um PPC que pode não estar na base, aberto e fechado com o escopo; devolve o `SqlClient` dele |
| `db/fontes.ts` | fontes do banco, impressão digital e estado do banco diante delas (`estadoDoBanco`) |
| `db/fontes-normativas.ts` | interface de carga da fase 5 (`LinhasNormativas`: dispositivos, relações, vigências, transições, correspondências), com o schema de cada linha, e os arquivos que ela lê |
| `db/sql.ts`, `db/nodeSqliteClient.ts`, `db/conexao.ts` | consultas pelo `SqlClient` com as linhas decodificadas por Effect Schema (`Sql.todas`, `Sql.primeira`) e o ambiente que cada serviço captura na construção e dá aos métodos (`Sql.ambienteDoServico`); o cliente do `node:sqlite` copiado do T3 (MIT); um `SqlClient` sobre um `DatabaseSync` já aberto |
| `db/consultas-normas.ts`, `db/consultas-secoes.ts`, `db/consultas-fatos.ts`, `db/consultas-cursos.ts`, `db/citacoes.ts`, `db/pacote-contexto.ts` | as consultas de cada serviço (`Normas`; `Ppcs`, seções, fatos e citações; `Cursos`; `PacoteContexto`), Effects sobre o `SqlClient` do ambiente, privadas ao serviço dono: quem está fora do `kb` chama o serviço e importa dele os tipos; `db/chaves.ts` completa os prefixos `ppc:` e `cnct:` |
| `ppcs/indice.ts` | o decodificador único de `ppcs/index.json`, da compilação e das citações dos arquivos |
| `cli/*.ts` | os comandos de curadoria da CLI `kb`, em `effect/cli`: `compilar` (`cli/compilar.ts`), `relacoes --propor`, `avaliar-resolvedor` e `avaliar-busca` (`cli/curadoria.ts`), sobre `layerRepositorio`; o ponto de entrada e as consultas estão em `packages/mcp/src/kb.ts` |
| `normas/citacoes-normas.ts` | citações resolvidas no texto das normas da base (dispositivos e preâmbulo), para o `impacto` e a tabela `normas_citacoes` |

## CLI

A CLI `kb` (`pnpm kb`, da raiz) tem o ponto de entrada em `packages/mcp/src/kb.ts`, porque as consultas dela são as ferramentas do `simplifica-mcp`, que o `kb` não importa: um comando por ferramenta (`buscar-norma`, `ler-dispositivos`, `ficha-norma`, `correspondencia`, `resolver-citacoes`, `citacoes-da-norma`, `impacto-da-norma`, `adequacao-art71`, `buscar-secoes`, `ler-secao`, `listar-cursos`, `ficha-curso`, `fatos-ppc`, `pacote-contexto`, `sobre-a-base`), com a entrada, o serviço `Leitura` e a resposta da ferramenta, sobre o `tmp/kb.sqlite` recompilado se velho (`layerRepositorio`). Os comandos, as flags e a saída estão no [`packages/mcp/README.md`](../mcp/README.md#cli-kb).

Aqui, em `cli/`, ficam os comandos de curadoria, que a mesma CLI monta:

```bash
pnpm kb:compilar                                   # compila (cerca de 12 s, 132 MB); --destino muda o arquivo
pnpm kb relacoes --propor [--json]                 # propostas do regex ainda não registradas em relacoes.yaml
pnpm kb avaliar-resolvedor [--json]                # precisão e recall do resolvedor (avaliacao/resolvedor/)
pnpm kb avaliar-busca [--json]                     # recall@10 da busca de seções (avaliacao/busca-secoes/)
```

`relacoes --propor` roda o regex sobre o parser das normas; `avaliar-busca` mede os três modos da busca (`simples`, `radicais`, `completo`), que a ferramenta `buscar_secoes` não expõe (ela usa o completo). O `impacto` percorre as fichas, os marcos e a taxonomia da revisão de PPC gravados no banco; os textos das skills de `.agents/skills` não entram.

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## API para o banco compilado (fase 6)

Carregadores síncronos sobre os arquivos do checkout, usados pela compilação e pelos scripts. Todos recebem a raiz do repositório, sem valor padrão: quem chama a obtém (`raizRepositorio()`, de `caminhos.ts`, nos pontos de entrada). As regras puras (`statusEm`, `transicoesAplicaveis`, `derivarLinha`, `correspondenciaEm`, `impactoEm`) não leem arquivo: recebem uma fonte já carregada. Nenhum lê o relógio. Os serviços não os chamam: sobre o banco, os mesmos dados vêm das tabelas (`FontesNormativas.layer`), e `db/base.test.ts` confere que eles reproduzem os carregadores.

| Função | Módulo | Devolve |
|---|---|---|
| `listarNormas(raiz)` | `normas/estrutura` | `{ id, path, arquivo }` de cada norma |
| `carregarEstruturas(raiz)` | `normas/estrutura` | por norma: `dispositivos`, `segmentos` (corpo inteiro, em ordem, com tipo e linhas) e `problemas` |
| `carregarDispositivos(raiz)` | `normas/estrutura` | `Dispositivo[]`: `id`, `dispositivo`, `norma` (arquivo), `ato`, `tipo`, `rotulo`, `pai`, `texto`, `caput[]`, `estrutura[]`, `notas[]`, `revogado`, `vetado`, `linha_inicio`, `linha_fim`, `ordem` |
| `indiceDispositivos(raiz)` / `obterDispositivo(id, raiz)` / `dispositivosDaNorma(norma, raiz)` | `normas/estrutura` | índice por `norma#dispositivo` (um arquivo por ato) |
| `carregarRelacoes(raiz)` | `normas/relacoes` | `Relacao[]`: `tipo`, `origem`, `operador`, `alvo`, `alvo_dispositivo`, `alcance`, `efeito_de`, `evidencia`, `confirmado_em`, `proposta`, `nota` |
| `carregarDatas(raiz, registro?)` | `normas/vigencia` | `assinada_em`, `publicada_em`, `vigente_de` por ato (normas e stubs) |
| `carregarFonteVigencia(raiz)` | `normas/vigencia` | a `FonteVigencia`: registro, datas, relações e transições |
| `statusEm(id, data, fonte: FonteStatus)` | `normas/vigencia` | `{ status, certo, inicio, eventos[], pendencias[] }` |
| `dataReferencia(raiz)` | `normas/vigencia` | a `data_referencia` declarada |
| `carregarTransicoes(raiz)` / `transicoesAplicaveis(id, data, fonte)` | `normas/vigencia` | regras de transição e sua situação na data |
| `derivarLinha(linha, data, fonte)` | `normas/vigencia` | vigente, substituídas, antecessoras e dispositivos revogados de um tema |
| `carregarCorrespondencias(raiz)` / `correspondenciaEm(id, fonte)` | `normas/correspondencia` | as tabelas; o item aplicável (com herança), sobre a `FonteCorrespondencia` do banco (o serviço `Normas` a carrega; `normas.correspondencia(id)` é o caminho de quem consome) |
| `impactoEm(fonte, opcoes)` | `normas/impacto` | arquivos, normas e PPCs afetados pela norma `fonte.id` (o serviço `Impacto` monta a fonte para o `id` pedido) |

Na compilação, essa API entra por `normas/fontes-db.ts`; as tabelas estão descritas em "Banco compilado".

## Manutenção

```bash
pnpm --filter @simplifica-if/kb test        # inclui a medida do resolvedor (metas: precisão ≥ 0,95, recall ≥ 0,90)
pnpm --filter @simplifica-if/kb typecheck
pnpm fmt                                    # na raiz: vp fmt no repositório inteiro
```

## Banco compilado (`kb.sqlite`)

**Fontes.** Os arquivos do git: `normas/` (Markdown e `stubs.yaml`), PPCs e índice de seções, CNCT, `base-conhecimento/institucional/ifpr/`, fichas, tópicos e marcos da revisão de PPC, `packages/kb/dados/*.yaml` e o código de `packages/kb/src/` que entra na compilação (lista em `db/fontes.ts`). O banco é derivado, nunca editado, e não vai para o git.

**Tabelas.** `normas` (front matter e stubs), `normas_metadados` (título, aliases, palavras-chave e ementa, para achar a norma pelo nome), `normas_fts`; `ppcs` (índice e proveniência), `secoes` (texto integral recortado pelas linhas com `lerTextoSecao`), `secoes_fts`; `documentos` (desde o esquema 4: o Markdown inteiro de cada norma da base e de cada PPC, como no arquivo, para o leitor do app, que gera o HTML na hora; cerca de 57 MB a mais no banco, mas pouco no pacote comprimido, porque o texto das seções já estava nele); `citacoes` (resolvedor da fase 2, com seção e papel `fundamento` ou `referencia-bibliografica`); `campi` (desde o esquema 5, com o calendário acadêmico e a página dos horários de aula), `cursos` (com `cnct_id`), `suap_matrizes`, `processos`, `editais`, `ofertas` (com turno), `ofertas_cursos`, `ofertas_processos`, `cnct`; `conselhos`, `conselhos_reunioes`, `conselhos_documentos` e `conselhos_itens` (desde o esquema 5: as reuniões do Consepe de `institucional/ifpr/conselhos/`, com os documentos publicados e os itens de pauta ligados aos cursos e campi, para o Explorar do app); `fichas`, `fichas_referencias`, `topicos`, `fichas_topicos`, `revisao_ppc_arquivos` (desde o esquema 8: `marcos-normativos.json` e `topicos-fichas.json` em JSON compacto, os textos que o `impacto` percorre além das fichas), `marcos` (com vigente, substituídas, antecessoras e dispositivos revogados derivados por `derivarLinha` na `data_referencia`); `ppc_fatos`, `ppc_suap`; da fase 5: `dispositivos` (todas as colunas de `Dispositivo`, `texto_com_caput` e arquivo e linhas), `dispositivos_fts`, `relacoes` (o `relacoes.yaml` inteiro, com o efeito resolvido), `vigencias` (intervalos `[de, ate)` com `status` e `certo`), `transicoes` (com `inicio_em`, `inicio_minimo` e `fim_em`; a situação numa data sai de `situacaoNaData`), `correspondencias_tabelas` e `correspondencias`, `normas_citacoes` (citações entre normas, para o `impacto`); `sinonimos_tipos`, `sinonimos_grupos` e `topicos_secoes` (os YAML de `dados/`); e `meta` (com a `data_referencia` e, quando o build os informa, `versao`, `commit` e `canal`).

**Vigência no banco.** O status de `statusEm` só muda nas datas que ele compara (início de vigência ou assinatura do ato, efeito, certo ou mínimo, de cada `revoga`/`altera`, e a `data_referencia`, quando o texto consolidado dá o piso); `intervalosVigencia` avalia `statusEm` nessas datas e grava os intervalos. Nada vem do relógio: a consulta escolhe a data (`buscar-norma --vigentes --em`). O `vigencia` da CLI continua em `statusEm`, que também explica eventos e pendências.

**FTS5.** `tokenize="unicode61 remove_diacritics 2"`, sem conteúdo próprio (`content=''`). Em `dispositivos_fts`: `texto` (o `texto_com_caput`, para um inciso casar com o assunto do caput) e `radicais`. `buscar-norma` por termos casa os conceitos (AND) primeiro nos metadados das normas e depois nos dispositivos, e completa com qualquer conceito (OR), dispositivos antes; por citação ou ID, devolve o dispositivo com o caput e os subordinados (ou o ancestral mais próximo, com `pedido`). `--situacao` e `--vigentes` valem também para a norma citada: se a excluem (ou excluem o dispositivo citado, revogado), a resposta fica vazia e um aviso diz por quê; ID de norma (`br/…`, `ifpr/…`) fora da base dá o aviso "ID desconhecido" e código de saída 1, sem busca textual. No `--json`, os avisos vão em `avisos`. Em `secoes_fts`: `titulo` e `texto` (tokens), `titulo_radicais` e `radicais` (radicais Snowball de `busca/tokens.ts`) e `expansao` (radicais do léxico do tipo da seção). A consulta casa primeiro todos os conceitos (AND) e completa com qualquer um (OR), por BM25 com peso maior para o título.

**Papel da citação.** `referencia-bibliografica` quando a citação está na seção `referencias` do PPC ou depois de um rótulo "Bibliografia"/"Referências" na mesma seção (o ementário traz a bibliografia de cada componente); `fundamento` no resto. É heurística.

**Determinismo.** Dois builds sobre as mesmas fontes produzem o mesmo arquivo, byte a byte (`db/base.test.ts`): leitura ordenada por code point, `rowid` na ordem das fontes, nada do relógio (`meta` guarda a versão do esquema, a data de referência e o hash das fontes; `versao`, `commit` e `canal` só com `--versao`, `--commit` e `--canal`, e vêm de quem builda), `page_size` fixo, `optimize` do FTS5 e `VACUUM` no fim.

**Compilação e recompilação.** O serviço `Compilador` grava com o `DatabaseSync` do `node:sqlite` direto, numa transação (`preencherBanco`): o `SqlClient` custaria cerca de 1,6 µs a mais por instrução (medido no C1; cerca de 2% da compilação), e a troca fica para depois. Cada comando da CLI confere, nesta ordem: banco ausente, versão do esquema, lista de fontes (arquivo novo ou removido); se nenhuma fonte tem mtime mais novo que o banco, ele está fresco; se alguma tem, compara o SHA-256 do conteúdo das fontes com o gravado em `meta` (igual: o mtime do banco avança até o das fontes; diferente: recompila). A compilação dá ao banco o mtime do instante anterior à leitura das fontes, e não o do fim: uma fonte editada durante a compilação fica mais nova que ele e é conferida na próxima abertura. `KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre` desliga ou força a recompilação.

**Fase 5.** A carga entra por `LinhasNormativas` (`db/fontes-normativas.ts`), implementada por `fontesNormativasArquivos` (`normas/fontes-db.ts`), o padrão da compilação. Nenhuma regra é reescrita no banco: a vigência sai de `statusEm`, e as consultas (`db/consultas-normas.ts`) usam `correspondenciaEm`, `descendentesEm` e `situacaoNaData`, as mesmas regras puras da compilação. Cada linha é validada pelo Effect Schema da tabela; a ordem de inserção é a dos arquivos. Arquivo novo que a carga ler entra em `ARQUIVOS_FONTES_NORMATIVAS` (hoje `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml` e `normas/stubs.yaml`). Ao mudar o esquema, suba `VERSAO_ESQUEMA` (hoje 8).

**`pacote-contexto`.** Por norma citada pelas fichas, o texto de cada dispositivo citado (`referencias_normativas[].dispositivo`): caput herdado, o próprio texto e os subordinados, arquivo e linhas; um dispositivo contido noutro citado não se repete (vai em `citados`). Também os marcos ligados (com os campos derivados) e as regras de transição das normas das fichas e das citadas como fundamento pelo PPC, com a situação na `data_referencia` e o texto do dispositivo que as estabelece. As seções do PPC são as dos tipos ligados aos tópicos das fichas (`dados/topicos-secoes.yaml`) mais a melhor seção de cada `consulta` das fichas. As partes são funções próprias (`normasDoPacote`, `marcosDoPacote`, `transicoesDoPacote`, `secoesDoPacote`), usadas pelo pacote de um PPC da base (`pacoteContexto`) e pelo de um PPC fora dela (`PacoteContexto.abrirAvulso`).

**PPC fora da base.** `PacoteContexto.abrirAvulso(markdown, opcoes)` cria, no escopo de quem chama, um banco em memória com o esquema do `kb.sqlite` (`db/ppc-avulso.ts`, com o registro, o léxico e os nomes dos campi da base) e grava o PPC por `gravarSecoesECitacoes`, o mesmo caminho da compilação: seções de `secoesIndexadas` (ou, com `todasAsSecoes`, de `secoesComChave`, que mantém a capa, `outros` e as seções curtas) e citações do resolvedor. Com `titulosNivel1`, `# Título` conta como título (o normalizador do `packages/ppc` põe o primeiro nível numerado em `#`; no índice publicado só `##` a `######` contam). Para um PPC da base, o banco em memória dá as mesmas seções e citações do `kb.sqlite` (`db/base.test.ts`). O `PpcAvulso` devolvido tem `pacote(fichas, opcoes)`, o pacote de um conjunto de fichas: normas, marcos e transições do `kb.sqlite` (o `SqlClient` do ambiente); seções e citações do banco em memória (por `db/conexao.ts`); `citacoesPpc` acrescenta todas as citações normativas do PPC. Tem também `estrutura()`, todas as seções do Markdown (`segmentarPpc`, sobre o texto que o banco recebeu: quebras de linha e `titulosNivel1`, por `textoDoPpcAvulso`) e os fatos sobre elas, que a revisão com IA do app usa. Quem chama nunca vê o `DatabaseSync`, e o banco fecha com o escopo. A CLI aceita um `.md` (`kb pacote-contexto <tarefa> --arquivo PPC.md`, do diretório atual).

**Busca de seções.** Ao mudar `dados/sinonimos.yaml`, `busca/` ou as consultas de `db/consultas-secoes.ts`, rode `pnpm kb avaliar-busca` e compare o recall@10 dos três modos com o anterior; o conjunto de `avaliacao/busca-secoes/` é rascunho, rotulado pelos títulos das seções.

## Sem o repositório

O servidor MCP, o executável e o servidor do app rodam só com o `kb.sqlite`, sem o checkout, por `layerSomenteLeitura({ caminho })`: os mesmos serviços da CLI, com as fontes normativas remontadas das tabelas (`FontesNormativas.layer`). As regras não mudam; muda a fonte. O registro sai da tabela `normas`; as datas, do `front_matter_json`; as citações, de `citacoes` e `normas_citacoes`; o léxico e os tópicos, das tabelas próprias; o tamanho do PPC, de `ppcs.caracteres`.

A garantia é de tipo: `layerSomenteLeitura` não exige `FileSystem` nem `Path`, então nada no caminho dela lê arquivo (dentro de um binário `pnpm mcp:executavel`, a leitura relativa ao código falharia). `db/base.test.ts` roda os serviços sobre uma cópia do banco num diretório vazio e confere que dão a mesma saída que sobre o banco do checkout, e confere as fontes remontadas das tabelas contra os carregadores síncronos dos arquivos.
