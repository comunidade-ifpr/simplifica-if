# @simplifica-if/kb

Núcleo da base de conhecimento ([plano de arquitetura](../../PLANO-ARQUITETURA.md)): regras que mais de um consumidor usa (servidor do app em `apps/server`, servidor MCP, pipeline em `scripts/`, skills em `.agents/skills/`, avaliação). Os consumidores importam `@simplifica-if/kb/<módulo>`; a dependência vai num sentido só.

Desde o C1 da [consolidação na stack do T3](../../docs/plans/consolidacao-stack-t3.md), o kb é um conjunto de serviços [Effect 4](https://effect.website) sobre um `SqlClient` do `node:sqlite`. As regras puras (resolvedor, vigência, impacto, adequação, stemmer, texto, `primitivas/*`) continuam funções puras e síncronas; o Effect entra nas fontes de dados, no banco, nos erros e nas bordas (CLI). `effect` e `@effect/platform-node` são `peerDependencies`: quem consome traz a mesma versão (a do catalog).

## Serviços e layers

| Serviço (`src/`) | Métodos | Depende de |
|---|---|---|
| `BaseKb.ts` | `meta` (versão do esquema, `data_referencia`, impressão digital, contagens, `versao`/`commit`/`canal`); falha a layer com `BaseIncompativel`. `layerSqlite({ caminho })`: o `SqlClient` só leitura (`BaseAusente`) | `SqlClient` |
| `FontesNormativas.ts` | `registro`, `datas`, `relacoes`, `transicoes` (com eles, o próprio serviço é a `FonteVigencia` das regras), `dataReferencia`, `sinonimos`, `topicosSecoes`, `topicosFichas`, `conteudoDasSkills({ raiz? })`. Duas layers: `layerBanco` (tabelas do `kb.sqlite`; só `SqlClient`) e `layerArquivos({ raiz })` (`FileSystem`, `Path`) | — |
| `Normas.ts` | `resolver`, `buscar`, `obter`, `ficha`, `dispositivo`, `dispositivoOuAncestral`, `descendentes`, `trecho`, `vigencia`, `relacoes`, `sucessoras`, `correspondencia`, `tabelasDeCorrespondencia`, `dataReferencia` | `SqlClient`, `FontesNormativas` |
| `Ppcs.ts` | `buscarSecoes`, `secoesDoPpc`, `indiceSecoesDoPpc`, `lerSecao`, `citacoesDaNorma`, `relatorioCitacoes`, `normasCitadas`, `fatos`, `divergencias` | `SqlClient`, `FontesNormativas` |
| `Cursos.ts` | `listar`, `cnct`, `adequacaoArt71` | `SqlClient` |
| `Impacto.ts` | `daNorma(id, { data, incluirPpcs, raizConteudo })` | `SqlClient`, `FontesNormativas` |
| `PacoteContexto.ts` | `montar` (PPC da base), `doMarkdown` (texto de um PPC fora da base), `avulso` (sobre um banco em memória de `bancoDoPpcAvulso`), `fichas`, `nomesDeCampi` | `SqlClient`, `FontesNormativas` |
| `Compilador.ts` | `compilar`, `estado`, `garantirFresco` (política `KB_RECOMPILAR`) | `FileSystem`, `Path` |

Layers prontas (`src/layers.ts`):

- `layerSomenteLeitura({ caminho })`: o `kb.sqlite` em `caminho`, só leitura, com todos os serviços de consulta e as fontes remontadas das tabelas. **Não exige `FileSystem`**: o tipo garante que nada no caminho lê o repositório. É a do servidor MCP, do executável e do servidor do app (`apps/server`).
- `layerRepositorio({ raiz })`: o checkout. Recompila o `tmp/kb.sqlite` se preciso (`KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre`) e lê as fontes normativas dos arquivos. É a da CLI.
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

Erros tipados: `Sql.FalhaNaConsulta` (`db/sql.ts`: o banco não corresponde ao esquema), `BaseIncompativel`, `BaseAusente`, `FalhaNasFontes`, `FalhaNaCompilacao`, `BaseDesatualizada` e os do pacote de contexto (`PpcNaoEncontrado`, `GrupoInexistente`, `TarefaNaoReconhecida`, em `pacote-contexto-erros.ts` e reexportados por `PacoteContexto.ts`), todos `Schema.TaggedError` com mensagem em português; quem os traduz usa `Effect.catchTags`. Mensagens de validação de schema: `esquema/mensagens.ts` (`formatarErro`, `problemas`), o formatador pt-BR único.

| Módulo | Papel |
|---|---|
| `caminhos.ts` | os caminhos, relativos à raiz do repositório, de tudo o que o kb lê (`CAMINHOS`, `noCheckout`); `raizRepositorio()`, que só os pontos de entrada e os testes chamam |
| `canal.ts` | os canais da base (`dev`, `beta`, `estavel`), sem dependência, para os contratos do app |
| `texto.ts`, `json.ts`, `schema.ts` | texto, JSON e JSON Schema comuns aos scripts e às skills (espaços, ordenação, JSON, `ajv`) |
| `primitivas/*` | regex com classes Unicode, JSON tipado (inteiro e fracionário distintos), case folding, quebra de linhas, similaridade de sequências, escape de HTML e de URL e divisão de linha de comando, com saída fixa byte a byte (rodada e relatório da `revisar-ppc`, conversão do PPC) |
| `esquema/mensagens.ts` | formatador único das mensagens de validação do Effect Schema, em português |
| `normas/ids.ts` | IDs canônicos de norma, dispositivo e `externo:` |
| `normas/front-matter.ts` | front matter das normas (`yaml` failsafe + Effect Schema) |
| `normas/registro.ts` | universo de IDs: `manifest.json` + `normas/stubs.yaml` (`montarRegistro` sobre o texto; `carregarRegistro` lê os arquivos) |
| `normas/resolver.ts` | `resolverCitacao(texto)` e `extrairCitacoes(texto)`, com regras nomeadas e confiança |
| `normas/dispositivos.ts` | "art. 28, inciso XVI" → `#art28-xvi` |
| `normas/texto-dispositivos.ts` | o caminho inverso: `["#art29", "#art37-par3"]` → "arts. 29 e 37, § 3º" |
| `normas/markdown.ts` | Markdown → mdast (`remark-parse` + `remark-gfm`) com o front matter em branco (linhas do mdast = linhas do arquivo) e `palavrasMarkdown`, a régua do saneamento e da reconstituição |
| `normas/estrutura.ts` | parser de dispositivos: artigo, parágrafo, inciso, alínea, item, anexo e seção, com IDs canônicos, caput herdado, notas de redação, revogado/vetado, estrutura e linhas; segmentos que reconstituem o corpo; dedução da compilação pelo ato |
| `normas/relacoes.ts` | `base-conhecimento/relacoes.yaml` (Effect Schema), validação por evidência literal, campos de relação do front matter e propostas por regex |
| `normas/vigencia.ts` | datas das normas, a `FonteVigencia` (registro, datas, relações e transições; `carregarFonteVigencia(raiz)` a lê dos arquivos), status numa data (`statusEm`) e em intervalos datados (`intervalosVigencia`), `data_referencia` de `config/vigencia.yaml`, regras de transição (`transicoes.yaml`, com `datasTransicao` e `situacaoNaData`) e linhas normativas dos marcos (`derivarLinha`) |
| `normas/gerado.ts` | campos gerados do front matter (relações e status) e reescrita do front matter, usados por `scripts/gerar_base.ts` |
| `normas/correspondencia.ts` | tabelas de correspondência entre normas sucessoras (`correspondencias/*.yaml`), com herança pelo ancestral (`correspondenciaEm` sobre a `FonteCorrespondencia` que `db/consultas-normas.ts` carrega do banco) |
| `normas/fontes-db.ts` | `LinhasNormativas` pela API de `normas/`: as linhas das tabelas da fase 5 que a compilação grava |
| `normas/impacto.ts` | a regra de `kb impacto` (`impactoEm`, pura, sobre uma `FonteImpacto` que traz o `id` da norma para a qual foi carregada): fichas, validações cruzadas, textos das skills, normas e PPCs afetados por uma norma |
| `normas/referencia-estruturada.ts` | `{ ref, dispositivo?, papel, nota? }` (Effect Schema), universo de IDs citáveis (normas, stubs, `externo:`, `cnct:`) e texto legível das referências das fichas da `revisar-ppc` |
| `ppcs/citacoes.ts` | citações dos PPCs convertidos; PPCs que citam uma norma; `lerTextoSecao` (texto integral de uma seção do índice pelas linhas) |
| `ppcs/front-matter.ts` | front matter de proveniência dos PPCs (`ppc:<campus>/<curso>`, URL, hash, data, conversor) e leitura com o front matter em branco |
| `ppcs/topicos.ts` | tópicos da `revisar-ppc`: tipos de seção por tópico (`dados/topicos-secoes.yaml`) e a taxonomia das fichas (`topicos-fichas.json`) |
| `ppcs/secoes.ts` | títulos, segmentação com linhas, taxonomias de seção por nível (técnico, ligada ao art. 28 da Res. CNE/CP nº 2/2026, e geral), preview e `textoDaSecao`; `secoesIndexadas` (o recorte do índice publicado, com a chave `<tipo>-<n>` do ID) e `secoesComChave` (todas as seções, as de fora do índice com `<tipo>-x<n>`) |
| `adequacao/art71.ts` | cursos técnicos sujeitos ao art. 71 da Res. CNE/CP nº 2/2026 e a DCN que cada PPC cita |
| `avaliacao/resolvedor.ts` | precisão e recall do resolvedor em `avaliacao/resolvedor/citacoes-anotadas.yaml` |
| `avaliacao/busca-secoes.ts` | recall@10 da busca de seções em `avaliacao/busca-secoes/consultas.yaml`, com e sem stemmer e sinônimos |
| `busca/stemmer.ts`, `busca/tokens.ts` | stemmer Snowball de português (porte próprio, conferido contra `snowball-stemmers`, e a variante `radicalSemAcento`, com os sufixos sem acentos) e termos da busca, iguais na indexação e na consulta e iguais com ou sem acento |
| `busca/sinonimos.ts` | léxico de `dados/sinonimos.yaml`: termos por tipo de seção (expansão do documento) e grupos de equivalentes (expansão da consulta) |
| `institucional/dados.ts` | leitura frouxa de `base-conhecimento/institucional/ifpr/` e das matrizes do SUAP (`suap.matrizes.resumo`) |
| `fatos/ppc.ts`, `fatos/divergencias.ts` | fatos extraídos dos PPCs (carga total, estágio obrigatório e carga), com trecho e status `extraido`, e o cruzamento com o SUAP |
| `db/esquema.ts`, `db/compilar.ts` | esquema SQL e compilação determinística do `kb.sqlite`; `gravarSecoesECitacoes` (seções, FTS e citações de um PPC) e `bancoDoPpcAvulso` (banco em memória, no mesmo esquema, com um PPC que pode não estar na base) |
| `db/fontes.ts` | fontes do banco, impressão digital e estado do banco diante delas (`estadoDoBanco`) |
| `db/fontes-normativas.ts` | interface de carga da fase 5 (`LinhasNormativas`: dispositivos, relações, vigências, transições, correspondências), com o schema de cada linha, e os arquivos que ela lê |
| `db/sql.ts`, `db/nodeSqliteClient.ts`, `db/conexao.ts` | consultas pelo `SqlClient` com as linhas decodificadas por Effect Schema (`Sql.todas`, `Sql.primeira`); o cliente do `node:sqlite` copiado do T3 (MIT); um `SqlClient` sobre um `DatabaseSync` já aberto |
| `db/consultas.ts`, `db/consultas-normas.ts`, `db/citacoes.ts`, `db/pacote-contexto.ts` | as consultas dos serviços, Effects sobre o `SqlClient` (as da fase 5 em `consultas-normas.ts`) |
| `cli.ts`, `cli/*.ts` | a CLI `kb`, em `effect/cli`: comandos de normas (`cli/normas.ts`), de PPCs e cursos (`cli/ppcs.ts`) e `compilar` (`cli/compilar.ts`), sobre `layerRepositorio` |
| `normas/citacoes-normas.ts` | citações resolvidas no texto das normas da base (dispositivos e preâmbulo), para o `impacto` e a tabela `normas_citacoes` |

## CLI

Da raiz do repositório:

```bash
pnpm kb resolver "Res. CNE/CP 1/2021, art. 20" [--json]
pnpm kb citacoes br/cne-cp/res/2021/1 [--json] [--confianca-min 0.8]
pnpm kb adequacao-art71 [--json] [--incluir-tecnologia]
pnpm kb avaliar-resolvedor [--json]
pnpm kb dispositivo "br/cne-cp/res/2026/2#art71-parunico" [--json] [--filhos]   # lê o banco
pnpm kb vigencia br/cne-cp/res/2021/1 [--em 2026-11-12] [--json]
pnpm kb relacoes br/lei/1996/9394 [--json]
pnpm kb relacoes --propor [--json]
pnpm kb correspondencia "br/cne-cp/res/2021/1#art20" [--json]                  # lê o banco
pnpm kb impacto br/cne-cp/res/2021/1 [--json] [--sem-ppcs] [--conteudo <dir>]
```

A CLI roda os serviços sobre `layerRepositorio`: o banco (recompilado se velho) e as fontes normativas lidas dos arquivos do checkout (registro, datas, relações, transições, léxico, tópicos). `vigencia` explica o status com os eventos e as pendências que `statusEm` monta sobre essas fontes (o banco guarda os intervalos que saem dele, conferidos contra `statusEm`); `relacoes --propor` roda o regex sobre o parser das normas; `impacto` lê os textos das skills, inclusive de outra árvore (`--conteudo`), que não estão no banco. `db/base.test.ts` confere que os serviços dão a mesma saída sobre as duas layers de fontes.

Sobre o banco compilado (`tmp/kb.sqlite`, fora do git):

```bash
pnpm kb:compilar                                   # compila (cerca de 12 s, 132 MB); --destino muda o arquivo
pnpm kb buscar-norma "Lei 11.788, art. 10" [--json] [--limite N] [--situacao base|stub|externo] [--vigentes [--em AAAA-MM-DD]]
pnpm kb buscar-secoes "estágio não obrigatório" [--json] [--tipo T]... [--nivel N] [--campus C] [--cnct X] [--forma F] [--ppc P] [--modo simples|radicais|completo] [--integral]
pnpm kb cursos [--json] [--eixo E] [--turno T] [--campus C] [--nivel N] [--forma F] [--situacao S] [--cnct X] [--processo P]
pnpm kb ppc-fatos [<campus/curso>] [--json] [--divergencias] [--nivel N]
pnpm kb pacote-contexto <CT-CURR-12 | tópico | grupo-001 | todas> <campus/curso | arquivo.md> [--json]
pnpm kb avaliar-busca [--json]
```

As saídas não dependem do relógio e têm ordem estável. As regras do resolvedor e suas confianças estão no comentário de `normas/resolver.ts`; uma citação que não identifica o ato volta com `id: null` e a regra que explica por quê.

## API para o banco compilado (fase 6)

Carregadores síncronos sobre os arquivos do checkout, usados pela compilação e pelos scripts. Todos recebem a raiz do repositório, sem valor padrão: quem chama a obtém (`raizRepositorio()`, de `caminhos.ts`, nos pontos de entrada). As regras puras (`statusEm`, `transicoesAplicaveis`, `derivarLinha`, `correspondenciaEm`, `impactoEm`) não leem arquivo: recebem uma fonte já carregada. Nenhum lê o relógio. Os serviços não os chamam: sobre o banco, os mesmos dados vêm das tabelas (`FontesNormativas.layerBanco`).

| Função | Módulo | Devolve |
|---|---|---|
| `listarNormas(raiz)` | `normas/estrutura` | `{ id, path, arquivo }` das 36 normas |
| `carregarEstruturas(raiz)` | `normas/estrutura` | por norma: `dispositivos`, `segmentos` (corpo inteiro, em ordem, com tipo e linhas) e `problemas` |
| `carregarDispositivos(raiz)` | `normas/estrutura` | `Dispositivo[]`: `id`, `dispositivo`, `norma` (arquivo), `ato`, `tipo`, `rotulo`, `pai`, `texto`, `caput[]`, `estrutura[]`, `notas[]`, `revogado`, `vetado`, `linha_inicio`, `linha_fim`, `ordem` |
| `indiceDispositivos(raiz)` / `obterDispositivo(id, raiz)` / `dispositivosDoAto(ato, raiz)` | `normas/estrutura` | índice por `ato#dispositivo`, já deduplicado com a compilação (o texto integral prevalece) |
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

Ao mudar o resolvedor, rode também `pnpm avaliacao:gabaritos` e revise o diff de `avaliacao/gabaritos/` (Q02 e Q20 vêm de `kb citacoes`).

## Banco compilado (`kb.sqlite`)

**Fontes.** Os arquivos do git: `manifest.json`, `normas/` (Markdown e `stubs.yaml`), PPCs e índice de seções, CNCT, `base-conhecimento/institucional/ifpr/`, fichas, tópicos e marcos da `revisar-ppc`, `packages/kb/dados/*.yaml` e o código de `packages/kb/src/` que entra na compilação (lista em `db/fontes.ts`). O banco é derivado, nunca editado, e não vai para o git.

**Tabelas.** `normas` (manifest e stubs), `normas_metadados` (título, aliases, palavras-chave e ementa, para achar a norma pelo nome), `normas_fts`; `ppcs` (índice e proveniência), `secoes` (texto integral recortado pelas linhas com `lerTextoSecao`), `secoes_fts`; `documentos` (desde o esquema 4: o Markdown inteiro de cada norma da base e de cada PPC, como no arquivo, para o leitor do app, que gera o HTML na hora; cerca de 57 MB a mais no banco, mas pouco no pacote comprimido, porque o texto das seções já estava nele); `citacoes` (resolvedor da fase 2, com seção e papel `fundamento` ou `referencia-bibliografica`); `campi` (desde o esquema 5, com o calendário acadêmico e a página dos horários de aula), `cursos` (com `cnct_id`), `suap_matrizes`, `processos`, `editais`, `ofertas` (com turno), `ofertas_cursos`, `ofertas_processos`, `cnct`; `conselhos`, `conselhos_reunioes`, `conselhos_documentos` e `conselhos_itens` (desde o esquema 5: as reuniões do Consepe de `institucional/ifpr/conselhos/`, com os documentos publicados e os itens de pauta ligados aos cursos e campi, para o Explorar do app); `fichas`, `fichas_referencias`, `topicos`, `fichas_topicos`, `marcos` (com vigente, substituídas, antecessoras e dispositivos revogados derivados por `derivarLinha` na `data_referencia`); `ppc_fatos`, `ppc_suap`; da fase 5: `dispositivos` (todas as colunas de `Dispositivo`, `texto_com_caput`, arquivo e linhas, e `canonico`, a deduplicação de `indiceDispositivos`: a compilação da LDB entra com o ID do arquivo), `dispositivos_fts`, `relacoes` (o `relacoes.yaml` inteiro, com o efeito resolvido), `vigencias` (intervalos `[de, ate)` com `status` e `certo`), `transicoes` (com `inicio_em`, `inicio_minimo` e `fim_em`; a situação numa data sai de `situacaoNaData`), `correspondencias_tabelas` e `correspondencias`, `normas_citacoes` (citações entre normas, para o `impacto`); `sinonimos_tipos`, `sinonimos_grupos` e `topicos_secoes` (os YAML de `dados/`); e `meta` (com a `data_referencia` e, quando o build os informa, `versao`, `commit` e `canal`).

**Vigência no banco.** O status de `statusEm` só muda nas datas que ele compara (início de vigência ou assinatura do ato e efeito, certo ou mínimo, de cada `revoga`/`altera`); `intervalosVigencia` avalia `statusEm` nessas datas e grava os intervalos. Nada vem do relógio: a consulta escolhe a data (`buscar-norma --vigentes --em`). O `vigencia` da CLI continua em `statusEm`, que também explica eventos e pendências.

**FTS5.** `tokenize="unicode61 remove_diacritics 2"`, sem conteúdo próprio (`content=''`). Em `dispositivos_fts` (só os canônicos): `texto` (o `texto_com_caput`, para um inciso casar com o assunto do caput) e `radicais`. `buscar-norma` por termos casa os conceitos (AND) primeiro nos metadados das normas e depois nos dispositivos, e completa com qualquer conceito (OR), dispositivos antes; por citação ou ID, devolve o dispositivo com o caput e os subordinados (ou o ancestral mais próximo, com `pedido`). `--situacao` e `--vigentes` valem também para a norma citada: se a excluem (ou excluem o dispositivo citado, revogado), a resposta fica vazia e um aviso diz por quê; ID de norma (`br/…`, `ifpr/…`) fora da base dá o aviso "ID desconhecido" e código de saída 1, sem busca textual. No `--json`, os avisos vão em `avisos`. Em `secoes_fts`: `titulo` e `texto` (tokens), `titulo_radicais` e `radicais` (radicais Snowball de `busca/tokens.ts`) e `expansao` (radicais do léxico do tipo da seção). A consulta casa primeiro todos os conceitos (AND) e completa com qualquer um (OR), por BM25 com peso maior para o título.

**Papel da citação.** `referencia-bibliografica` quando a citação está na seção `referencias` do PPC ou depois de um rótulo "Bibliografia"/"Referências" na mesma seção (o ementário traz a bibliografia de cada componente); `fundamento` no resto. É heurística.

**Determinismo.** Dois builds sobre as mesmas fontes produzem o mesmo arquivo, byte a byte (`db/base.test.ts`): leitura ordenada por code point, `rowid` na ordem das fontes, nada do relógio (`meta` guarda a versão do esquema, a data de referência e o hash das fontes; `versao`, `commit` e `canal` só com `--versao`, `--commit` e `--canal`, e vêm de quem builda), `page_size` fixo, `optimize` do FTS5 e `VACUUM` no fim.

**Compilação e recompilação.** O serviço `Compilador` grava com o `DatabaseSync` do `node:sqlite` direto, numa transação (`preencherBanco`): o `SqlClient` custaria cerca de 1,6 µs a mais por instrução (medido no C1; cerca de 2% da compilação), e a troca fica para depois. Cada comando da CLI confere, nesta ordem: banco ausente, versão do esquema, lista de fontes (arquivo novo ou removido); se nenhuma fonte tem mtime mais novo que o banco, ele está fresco; se alguma tem, compara o SHA-256 do conteúdo das fontes com o gravado em `meta` (igual: o mtime do banco avança até o das fontes; diferente: recompila). A compilação dá ao banco o mtime do instante anterior à leitura das fontes, e não o do fim: uma fonte editada durante a compilação fica mais nova que ele e é conferida na próxima abertura. `KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre` desliga ou força a recompilação.

**Fase 5.** A carga entra por `LinhasNormativas` (`db/fontes-normativas.ts`), implementada por `fontesNormativasArquivos` (`normas/fontes-db.ts`), o padrão da compilação. Nenhuma regra é reescrita no banco: a deduplicação vai gravada (`canonico`), a vigência sai de `statusEm`, e as consultas (`db/consultas-normas.ts`) usam `correspondenciaEm`, `descendentesEm` e `situacaoNaData`, as mesmas regras puras da compilação. Cada linha é validada pelo Effect Schema da tabela; a ordem de inserção é a dos arquivos. Arquivo novo que a carga ler entra em `ARQUIVOS_FONTES_NORMATIVAS` (hoje `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml` e `normas/stubs.yaml`). Ao mudar o esquema, suba `VERSAO_ESQUEMA` (hoje 5).

**`pacote-contexto`.** Por norma citada pelas fichas, o texto de cada dispositivo citado (`referencias_normativas[].dispositivo`): caput herdado, o próprio texto e os subordinados, arquivo e linhas; um dispositivo contido noutro citado não se repete (vai em `citados`). Também os marcos ligados (com os campos derivados) e as regras de transição das normas das fichas e das citadas como fundamento pelo PPC, com a situação na `data_referencia` e o texto do dispositivo que as estabelece. As seções do PPC são as dos tipos ligados aos tópicos das fichas (`dados/topicos-secoes.yaml`) mais a melhor seção de cada `consulta` das fichas. As partes são funções próprias (`normasDoPacote`, `marcosDoPacote`, `transicoesDoPacote`, `secoesDoPacote`), usadas pelo pacote de um PPC da base (`pacoteContexto`) e pelo de um PPC fora dela (`pacoteContextoAvulso`).

**Grupos por tópico.** `grupo-NNN` é o n-ésimo grupo de sub-agente da `revisar-ppc`, montado por `agruparPorTopico`: cada ficha vai no grupo do seu tópico principal (`topicoPrincipal`: o de menos fichas entre os seus `topicos_tematicos`, no empate o primeiro na ordem de `topicos-fichas.json`), as de `tipo_escopo: transversal` num grupo `transversal` por último, com o PPC inteiro (`escopo: "completo"`); tópico com mais de `TAMANHO_MAXIMO_GRUPO` (20) fichas vira partes equilibradas.

**PPC fora da base.** `bancoDoPpcAvulso(markdown, opcoes)` cria um banco em memória com o esquema do `kb.sqlite` e grava o PPC por `gravarSecoesECitacoes`, o mesmo caminho da compilação: seções de `secoesIndexadas` (ou, com `todasAsSecoes`, de `secoesComChave`, que mantém a capa, `outros` e as seções curtas) e citações do resolvedor. Com `titulosNivel1`, `# Título` conta como título (o normalizador da `revisar-ppc` põe o primeiro nível numerado em `#`; no índice publicado só `##` a `######` contam). Para um PPC da base, o banco em memória dá as mesmas seções e citações do `kb.sqlite` (`db/base.test.ts`). `PacoteContexto.avulso(dbPpc, fichas, opcoes)` monta o pacote de um conjunto de fichas: normas, marcos e transições do `kb.sqlite` (o `SqlClient` do ambiente); seções e citações do banco em memória (por `db/conexao.ts`); `citacoesPpc` acrescenta todas as citações normativas do PPC. A CLI aceita um `.md` no lugar de `<campus/curso>`.

**Busca de seções.** Ao mudar `dados/sinonimos.yaml`, `busca/` ou as consultas de `db/consultas.ts`, rode `pnpm kb avaliar-busca` e compare o recall@10 dos três modos com o anterior; o conjunto de `avaliacao/busca-secoes/` é rascunho, rotulado pelos títulos das seções.

## Sem o repositório

O servidor MCP, o executável e o servidor do app rodam só com o `kb.sqlite`, sem o checkout, por `layerSomenteLeitura({ caminho })`: os mesmos serviços da CLI, com as fontes normativas remontadas das tabelas (`FontesNormativas.layerBanco`). As regras não mudam; muda a fonte. O registro sai da tabela `normas`; as datas, do `front_matter_json`; as citações, de `citacoes` e `normas_citacoes`; o léxico e os tópicos, das tabelas próprias; o tamanho do PPC, de `ppcs.caracteres`.

A garantia é de tipo: `layerSomenteLeitura` não exige `FileSystem` nem `Path`, então nada no caminho dela lê arquivo (dentro de um binário `pnpm mcp:executavel`, a leitura relativa ao código falharia). `db/base.test.ts` roda os serviços sobre uma cópia do banco num diretório vazio e confere que dão a mesma saída que sobre as fontes dos arquivos.

Diferença inevitável: sobre o banco, `Impacto.daNorma` traz só as fichas da `revisar-ppc` em `arquivos`; os outros textos das skills (prompts, validações cruzadas, contratos) não estão no banco e continuam só na CLI.
