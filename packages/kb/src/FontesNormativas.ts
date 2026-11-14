/**
 * `FontesNormativas`: os dados que as regras puras do kb recebem prontos — registro de normas,
 * datas dos atos, relações, regras de transição, data de referência, léxico da busca de seções e
 * tópicos da `revisar-ppc` — e o conteúdo das skills que o `impacto` percorre.
 *
 * Duas layers, com o mesmo resultado (`db/base.test.ts` confere):
 *
 * - `layerBanco`: remonta tudo das tabelas do `kb.sqlite` (`normas`, `relacoes`, `transicoes`,
 *   `meta`, `sinonimos_*`, `topicos`, `topicos_secoes`, `fichas`). Exige só o `SqlClient`: o tipo
 *   garante que ela não lê arquivo, e é o que deixa o servidor MCP e o fork rodarem sem o
 *   repositório.
 * - `layerArquivos({ raiz })`: lê os arquivos do checkout por `FileSystem` e `Path` e os interpreta
 *   com as mesmas funções puras dos carregadores síncronos (`montarRegistro`, `relacoesDoYaml`…).
 *
 * Os valores são montados uma vez, na construção da layer (a memoização por banco aberto de antes).
 * `conteudoDasSkills` é um método porque só o `impacto` o usa e porque a CLI pode apontá-lo para
 * outra árvore (`kb impacto --conteudo`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { type Sinonimos, sinonimosDeObjeto, sinonimosDoYaml } from "./busca/sinonimos.ts";
import * as Sql from "./db/sql.ts";
import { analisarFrontMatter } from "./normas/front-matter.ts";
import { type EntradaRegistro, montarRegistro, Registro } from "./normas/registro.ts";
import { type Relacao, relacoesDoYaml } from "./normas/relacoes.ts";
import {
  dataReferenciaDoYaml,
  type DatasNorma,
  esquemaTransicao,
  type FonteVigencia,
  montarDatas,
  type Transicao,
  transicoesDoYaml,
} from "./normas/vigencia.ts";
import {
  TOPICOS_FICHAS,
  TOPICOS_SECOES,
  type TopicoFichas,
  type TopicosSecoes,
  topicosFichasDeObjetos,
  topicosFichasDoJson,
  topicosSecoesDeObjeto,
  topicosSecoesDoYaml,
} from "./ppcs/topicos.ts";
import { compararTexto } from "./texto.ts";

/** Um arquivo de conteúdo das skills: caminho relativo à raiz do conteúdo e texto. */
export interface ArquivoConteudo {
  readonly arquivo: string;
  readonly texto: string;
}

/** O que o `impacto` lê das skills: a taxonomia de tópicos e os arquivos de conteúdo, em ordem. */
export interface ConteudoDasSkills {
  readonly topicos: ReadonlyArray<TopicoFichas>;
  readonly arquivos: ReadonlyArray<ArquivoConteudo>;
}

export class FalhaNasFontes extends Schema.TaggedError<FalhaNasFontes>()("FalhaNasFontes", {
  /** Arquivo (relativo à raiz do repositório) que não pôde ser lido ou interpretado. */
  arquivo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler a fonte ${this.arquivo}`;
  }
}

export const ehFalhaNasFontes = Schema.is(FalhaNasFontes);

export class FontesNormativas extends Context.Service<
  FontesNormativas,
  {
    readonly registro: Registro;
    readonly datas: ReadonlyMap<string, DatasNorma>;
    readonly relacoes: ReadonlyArray<Relacao>;
    readonly transicoes: ReadonlyArray<Transicao>;
    /** `data_referencia` de `base-conhecimento/config/vigencia.yaml` (no banco, a gravada em `meta`). */
    readonly dataReferencia: string;
    /** A vigência (`statusEm`, `transicoesAplicaveis`, `derivarLinha`…) sobre os valores acima. */
    readonly vigencia: FonteVigencia;
    readonly sinonimos: Sinonimos;
    readonly topicosSecoes: TopicosSecoes;
    readonly topicosFichas: ReadonlyArray<TopicoFichas>;
    /**
     * Taxonomia e arquivos de conteúdo das skills. Arquivos: todos os textos de `.agents/skills`
     * (fichas, prompts, contratos…) em `layerArquivos`, opcionalmente de outra árvore (`raiz`); só
     * as fichas da `revisar-ppc` em `layerBanco`, que ignora `raiz`.
     */
    readonly conteudoDasSkills: (opcoes?: {
      readonly raiz?: string;
    }) => Effect.Effect<ConteudoDasSkills, FalhaNasFontes | Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/FontesNormativas") {}

/** Monta a `FonteVigencia` das regras puras sobre valores já carregados. */
function fonteVigencia(
  registro: Registro,
  datas: Map<string, DatasNorma>,
  relacoes: readonly Relacao[],
  transicoes: readonly Transicao[],
): FonteVigencia {
  return { registro: () => registro, datas: () => datas, relacoes: () => relacoes, transicoes: () => transicoes };
}

/* ===================================================================== banco */

const TextoNulo = Schema.NullOr(Schema.String);

const LinhaNorma = Schema.Struct({
  id: Schema.String,
  situacao: Schema.Literals(["base", "stub", "externo"]),
  titulo: Schema.String,
  data_publicacao: TextoNulo,
  status_vigencia: TextoNulo,
  status_fonte: TextoNulo,
  path: TextoNulo,
  aliases_json: Schema.fromJsonString(Schema.Array(Schema.String)),
  front_matter_json: Schema.NullOr(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))),
});
const linhasNormas = Sql.todas(LinhaNorma);

const LinhaRelacao = Schema.Struct({
  tipo: Schema.Literals(["revoga", "altera", "regulamenta", "fundamenta-se-em"]),
  origem: Schema.String,
  operador: TextoNulo,
  alvo: Schema.String,
  alvo_dispositivo: TextoNulo,
  alcance: TextoNulo,
  efeito_de: Schema.String,
  evidencia_em: Schema.String,
  evidencia_trecho: Schema.String,
  confirmado_em: Schema.String,
  proposta: Schema.Literals(["front-matter", "regex", "manual"]),
  nota: TextoNulo,
});
const linhasRelacoes = Sql.todas(LinhaRelacao);

const LinhaTransicao = Schema.Struct({
  id: Schema.String,
  norma_id: Schema.String,
  dispositivo: Schema.String,
  tipo: Schema.String,
  norma_anterior: TextoNulo,
  aplica_a: Schema.String,
  regra: Schema.String,
  inicio: Schema.String,
  fim: Schema.String,
  evidencia: Schema.String,
});
const linhasTransicoes = Sql.todas(LinhaTransicao);
const decodificarTransicoes = Schema.decodeUnknownEffect(Schema.Array(esquemaTransicao), {
  onExcessProperty: "error",
});

const LinhaValor = Schema.Struct({ valor: Schema.String });
const valorMeta = Sql.primeira(LinhaValor);

const ListaTextos = Schema.Array(Schema.String);
const linhasSinonimosTipos = Sql.todas(
  Schema.Struct({ tipo: Schema.String, termos_json: Schema.fromJsonString(ListaTextos) }),
);
const linhasSinonimosGrupos = Sql.todas(Schema.Struct({ termos_json: Schema.fromJsonString(ListaTextos) }));
const linhasTopicos = Sql.todas(Schema.Struct({ dados_json: Schema.fromJsonString(Schema.Unknown) }));
const linhasTopicosSecoes = Sql.todas(
  Schema.Struct({ topico: Schema.String, tipos_json: Schema.fromJsonString(Schema.Unknown) }),
);
const linhasFichas = Sql.todas(Schema.Struct({ path: Schema.String, arquivo_json: Schema.String }));

/** `assinada_em` do registro: a do front matter (norma da base) ou a `data_publicacao` (stub). */
function assinadaEm(n: typeof LinhaNorma.Type): string | undefined {
  if (n.situacao === "stub") return n.data_publicacao ?? undefined;
  if (n.situacao !== "base" || n.front_matter_json === null) return undefined;
  const valor = n.front_matter_json["assinada_em"];
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
}

/** Erro de interpretação de uma tabela: o banco não corresponde às regras do kb. */
const falhaDaTabela = (tabela: string) => (cause: unknown) =>
  new Sql.FalhaNaConsulta({ consulta: `interpretação da tabela ${tabela}`, cause });

const makeBanco = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const normas = yield* linhasNormas(
    "SELECT id, situacao, titulo, data_publicacao, status_vigencia, status_fonte, path, aliases_json, front_matter_json " +
      "FROM normas ORDER BY id",
  );
  const registro = new Registro(
    // chaves na ordem de carregarRegistro; no registro, o path é relativo a base-conhecimento/
    normas.map((n): EntradaRegistro => {
      const assinada = assinadaEm(n);
      return {
        id: n.id,
        title: n.titulo,
        situacao: n.situacao,
        ...(assinada !== undefined ? { assinada_em: assinada } : {}),
        ...(n.data_publicacao !== null ? { data_publicacao: n.data_publicacao } : {}),
        ...(n.status_vigencia !== null ? { status_vigencia: n.status_vigencia } : {}),
        ...(n.status_fonte !== null ? { status_fonte: n.status_fonte } : {}),
        aliases: [...n.aliases_json],
        ...(n.path !== null ? { path: n.path.replace(/^base-conhecimento\//, "") } : {}),
      };
    }),
  );
  const datas = montarDatas(
    normas.flatMap((n) =>
      n.situacao === "base" && n.front_matter_json !== null ? [{ id: n.id, meta: n.front_matter_json }] : [],
    ),
    registro,
  );

  const relacoes: Relacao[] = (yield* linhasRelacoes(
    "SELECT tipo, origem, operador, alvo, alvo_dispositivo, alcance, efeito_de, evidencia_em, evidencia_trecho, " +
      "confirmado_em, proposta, nota FROM relacoes ORDER BY ordem",
  )).map((r) => ({
    tipo: r.tipo,
    origem: r.origem,
    ...(r.operador !== null ? { operador: r.operador } : {}),
    alvo: r.alvo,
    ...(r.alvo_dispositivo !== null ? { alvo_dispositivo: r.alvo_dispositivo } : {}),
    ...(r.alcance !== null ? { alcance: r.alcance } : {}),
    efeito_de: r.efeito_de,
    evidencia: { em: r.evidencia_em, trecho: r.evidencia_trecho },
    confirmado_em: r.confirmado_em,
    proposta: r.proposta,
    ...(r.nota !== null ? { nota: r.nota } : {}),
  }));

  const linhasT = yield* linhasTransicoes(
    "SELECT id, norma_id, dispositivo, tipo, norma_anterior, aplica_a, regra, inicio, fim, evidencia FROM transicoes ORDER BY rowid",
  );
  const transicoes = yield* decodificarTransicoes(
    linhasT.map((t) => ({
      id: t.id,
      norma: t.norma_id,
      dispositivo: t.dispositivo,
      tipo: t.tipo,
      ...(t.norma_anterior !== null ? { norma_anterior: t.norma_anterior } : {}),
      aplica_a: t.aplica_a,
      regra: t.regra,
      inicio: t.inicio,
      fim: t.fim,
      evidencia: t.evidencia,
    })),
  ).pipe(Effect.mapError(falhaDaTabela("transicoes")));

  const referencia = yield* valorMeta("SELECT valor FROM meta WHERE chave = 'data_referencia'");
  if (referencia === undefined) {
    return yield* new Sql.FalhaNaConsulta({ consulta: "meta.data_referencia", cause: "ausente" });
  }

  const tipos = yield* linhasSinonimosTipos("SELECT tipo, termos_json FROM sinonimos_tipos ORDER BY ordem");
  const grupos = yield* linhasSinonimosGrupos("SELECT termos_json FROM sinonimos_grupos ORDER BY ordem");
  const sinonimos = yield* Effect.try({
    try: () =>
      sinonimosDeObjeto({
        tipos: Object.fromEntries(tipos.map((t) => [t.tipo, t.termos_json])),
        grupos: grupos.map((g) => g.termos_json),
      }),
    catch: falhaDaTabela("sinonimos_tipos e sinonimos_grupos"),
  });

  const linhasTop = yield* linhasTopicos("SELECT dados_json FROM topicos ORDER BY ordem");
  const topicosFichas = yield* Effect.try({
    try: () => topicosFichasDeObjetos(linhasTop.map((l) => l.dados_json)),
    catch: falhaDaTabela("topicos"),
  });
  const linhasTS = yield* linhasTopicosSecoes("SELECT topico, tipos_json FROM topicos_secoes ORDER BY ordem");
  const topicosSecoes = yield* Effect.try({
    try: () => topicosSecoesDeObjeto(Object.fromEntries(linhasTS.map((l) => [l.topico, l.tipos_json]))),
    catch: falhaDaTabela("topicos_secoes"),
  });

  const conteudoDasSkills = Effect.fn("FontesNormativas.conteudoDasSkills")(function* (_opcoes?: {
    readonly raiz?: string;
  }) {
    const fichas = yield* linhasFichas("SELECT path, arquivo_json FROM fichas ORDER BY path").pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
    );
    return { topicos: topicosFichas, arquivos: fichas.map((f) => ({ arquivo: f.path, texto: f.arquivo_json })) };
  });

  return FontesNormativas.of({
    registro,
    datas,
    relacoes,
    transicoes,
    dataReferencia: referencia.valor,
    vigencia: fonteVigencia(registro, datas, relacoes, transicoes),
    sinonimos,
    topicosSecoes,
    topicosFichas,
    conteudoDasSkills,
  });
});

/** Fontes remontadas das tabelas do `kb.sqlite`. Exige só o `SqlClient`: não lê arquivo. */
export const layerBanco = Layer.effect(FontesNormativas, makeBanco);

/* ================================================================== arquivos */

/** Diretórios de `.agents/skills` que não são conteúdo (código, testes, schemas, referências). */
const IGNORAR_SKILLS = new Set(["scripts", "tests", "schemas", "node_modules", "__pycache__", "referencias"]);
/** Arquivos gerados a partir das fichas (o impacto vê as fichas, não o índice). */
const GERADOS_SKILLS = new Set(["indice.json", "mapa-fichas.md"]);

const makeArquivos = Effect.fn("FontesNormativas.layerArquivos")(function* (raiz: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const ler = (relativo: string) =>
    fs
      .readFileString(path.join(raiz, relativo))
      .pipe(Effect.mapError((cause) => new FalhaNasFontes({ arquivo: relativo, cause })));
  const lerSeExistir = Effect.fnUntraced(function* (relativo: string) {
    const existe = yield* fs
      .exists(path.join(raiz, relativo))
      .pipe(Effect.mapError((cause) => new FalhaNasFontes({ arquivo: relativo, cause })));
    return existe ? yield* ler(relativo) : null;
  });
  const interpretar = <A>(relativo: string, f: () => A) =>
    Effect.try({ try: f, catch: (cause) => new FalhaNasFontes({ arquivo: relativo, cause }) });

  /** Arquivos `.md` de `relativo`, recursivo, em caminhos relativos à raiz do repositório. */
  const listarMd = (relativo: string): Effect.Effect<string[], FalhaNasFontes> =>
    fs.readDirectory(path.join(raiz, relativo), { recursive: true }).pipe(
      Effect.map((nomes) =>
        nomes.filter((n) => n.endsWith(".md")).map((n) => `${relativo}/${n.split(path.sep).join("/")}`),
      ),
      Effect.mapError((cause) => new FalhaNasFontes({ arquivo: relativo, cause })),
    );

  const manifest = yield* ler("base-conhecimento/manifest.json");
  const stubs = yield* lerSeExistir("base-conhecimento/normas/stubs.yaml");
  const registro = yield* interpretar("base-conhecimento/manifest.json", () => montarRegistro(manifest, stubs));

  // datas dos atos: front matter de cada norma da base, na ordem de `listarNormas`
  const normas: Array<{ id: string; meta: Readonly<Record<string, unknown>>; path: string }> = [];
  for (const arquivo of yield* listarMd("base-conhecimento/normas")) {
    const relativo = arquivo.slice("base-conhecimento/".length);
    const texto = yield* ler(arquivo);
    const { meta } = yield* interpretar(arquivo, () => analisarFrontMatter(texto, relativo));
    normas.push({ id: String(meta["id"]), meta, path: relativo });
  }
  normas.sort((a, b) => compararTexto(a.path, b.path));
  const datas = montarDatas(normas, registro);

  const relacoes = yield* ler("base-conhecimento/relacoes.yaml").pipe(
    Effect.flatMap((texto) => interpretar("base-conhecimento/relacoes.yaml", () => relacoesDoYaml(texto))),
  );
  const textoTransicoes = yield* lerSeExistir("base-conhecimento/transicoes.yaml");
  const transicoes =
    textoTransicoes === null
      ? []
      : yield* interpretar("base-conhecimento/transicoes.yaml", () => transicoesDoYaml(textoTransicoes));
  const dataReferencia = yield* ler("base-conhecimento/config/vigencia.yaml").pipe(
    Effect.flatMap((texto) => interpretar("base-conhecimento/config/vigencia.yaml", () => dataReferenciaDoYaml(texto))),
  );
  const sinonimos = yield* ler("packages/kb/dados/sinonimos.yaml").pipe(
    Effect.flatMap((texto) => interpretar("packages/kb/dados/sinonimos.yaml", () => sinonimosDoYaml(texto))),
  );
  const topicosSecoes = yield* ler(TOPICOS_SECOES).pipe(
    Effect.flatMap((texto) => interpretar(TOPICOS_SECOES, () => topicosSecoesDoYaml(texto))),
  );
  const topicosFichas = yield* ler(TOPICOS_FICHAS).pipe(
    Effect.flatMap((texto) => interpretar(TOPICOS_FICHAS, () => topicosFichasDoJson(texto))),
  );

  /** Arquivos de conteúdo de `.agents/skills` (Markdown, JSON e YAML, sem README nem gerados), em ordem. */
  const arquivosDasSkills = Effect.fnUntraced(function* (raizConteudo: string) {
    const base = path.join(raizConteudo, ".agents", "skills");
    const naoLe = (cause: unknown) => new FalhaNasFontes({ arquivo: ".agents/skills", cause });
    if (!(yield* fs.exists(base).pipe(Effect.mapError(naoLe)))) return [];
    const saida: string[] = [];
    // percorre em ordem de nome, como `arquivosConteudoSkills` (recursão manual para pular diretórios)
    // recursão por diretório, dentro da mesma operação (sem span próprio por diretório)
    const visitar: (dir: string) => Effect.Effect<void, FalhaNasFontes> = Effect.fnUntraced(function* (dir: string) {
      const nomes = [...(yield* fs.readDirectory(dir).pipe(Effect.mapError(naoLe)))].sort();
      for (const nome of nomes) {
        const caminho = path.join(dir, nome);
        const info = yield* fs.stat(caminho).pipe(Effect.mapError(naoLe));
        if (info.type === "Directory") {
          if (!IGNORAR_SKILLS.has(nome)) yield* visitar(caminho);
          continue;
        }
        if (!/\.(json|md|yaml|yml)$/.test(nome) || /^README/i.test(nome) || GERADOS_SKILLS.has(nome)) continue;
        saida.push(path.relative(raizConteudo, caminho).split(path.sep).join("/"));
      }
    });
    yield* visitar(base);
    return saida;
  });

  const conteudoDasSkills = Effect.fn("FontesNormativas.conteudoDasSkills")(function* (opcoes?: {
    readonly raiz?: string;
  }) {
    const raizConteudo = opcoes?.raiz ?? raiz;
    const lerDe = (relativo: string) =>
      fs
        .readFileString(path.join(raizConteudo, relativo))
        .pipe(Effect.mapError((cause) => new FalhaNasFontes({ arquivo: relativo, cause })));
    const temTopicos = yield* fs
      .exists(path.join(raizConteudo, TOPICOS_FICHAS))
      .pipe(Effect.mapError((cause) => new FalhaNasFontes({ arquivo: TOPICOS_FICHAS, cause })));
    const topicos = temTopicos
      ? yield* lerDe(TOPICOS_FICHAS).pipe(
          Effect.flatMap((texto) => interpretar(TOPICOS_FICHAS, () => topicosFichasDoJson(texto))),
        )
      : [];
    const arquivos: ArquivoConteudo[] = [];
    for (const arquivo of yield* arquivosDasSkills(raizConteudo)) {
      arquivos.push({ arquivo, texto: yield* lerDe(arquivo) });
    }
    return { topicos, arquivos };
  });

  return FontesNormativas.of({
    registro,
    datas,
    relacoes,
    transicoes,
    dataReferencia,
    vigencia: fonteVigencia(registro, datas, relacoes, transicoes),
    sinonimos,
    topicosSecoes,
    topicosFichas,
    conteudoDasSkills,
  });
});

/** Fontes lidas dos arquivos do checkout em `raiz`, por `FileSystem` e `Path`. */
export const layerArquivos = (opcoes: {
  readonly raiz: string;
}): Layer.Layer<FontesNormativas, FalhaNasFontes, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(FontesNormativas, makeArquivos(opcoes.raiz));
