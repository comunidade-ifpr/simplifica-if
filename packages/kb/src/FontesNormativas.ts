/**
 * `FontesNormativas`: os dados que as regras puras do kb recebem prontos — registro de normas,
 * datas dos atos, relações, regras de transição, data de referência, léxico da busca de seções e
 * tópicos da revisão de PPC — e o conteúdo da revisão de PPC que o `impacto` percorre.
 *
 * Remonta tudo das tabelas do `kb.sqlite` (`normas`, `relacoes`, `transicoes`, `meta`,
 * `sinonimos_*`, `topicos`, `topicos_secoes`, `fichas`, `revisao_ppc_arquivos`). Exige só o
 * `SqlClient`: o tipo garante que ela não lê arquivo, e é o que deixa o servidor MCP e o app rodarem
 * sem o repositório. A CLI do checkout usa a mesma, depois de recompilar o banco velho; que o banco
 * reproduz os arquivos, conferem os testes de `db/base.test.ts` contra os carregadores síncronos.
 *
 * Os valores são montados uma vez, na construção da layer. `conteudoRevisaoPpc` é um método porque
 * só o `impacto` e a `ler_ficha` o usam.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { type Sinonimos, sinonimosDeObjeto } from "./busca/sinonimos.ts";
import * as Sql from "./db/sql.ts";
import { type EntradaRegistro, Registro } from "./normas/registro.ts";
import type { Relacao } from "./normas/relacoes.ts";
import {
  type DatasNorma,
  esquemaTransicao,
  montarConsolidado,
  montarDatas,
  type StatusDoTexto,
  type TextoConsolidado,
  type Transicao,
} from "./normas/vigencia.ts";
import {
  type TopicoFichas,
  type TopicosSecoes,
  topicosFichasDeObjetos,
  topicosSecoesDeObjeto,
} from "./ppcs/topicos.ts";

/** Um arquivo de conteúdo da revisão de PPC: caminho relativo à raiz do repositório e texto (JSON). */
export interface ArquivoConteudo {
  readonly arquivo: string;
  readonly texto: string;
}

/** O que o `impacto` lê da revisão de PPC: a taxonomia de tópicos e os arquivos de conteúdo, em ordem. */
export interface ConteudoRevisaoPpc {
  readonly topicos: ReadonlyArray<TopicoFichas>;
  readonly arquivos: ReadonlyArray<ArquivoConteudo>;
}

/**
 * Em que dia as consultas sem data calculam a vigência. `referencia`, o padrão, é a `data_referencia`
 * gravada no banco: o mesmo banco dá sempre a mesma resposta (testes, scripts, a pré-conferência). O
 * app, o simplifica-mcp e a CLI `kb` ligam `hoje` (`layerVigenciaHoje`): o dia local da consulta.
 */
export const VigenciaNoDia = Context.Reference<"referencia" | "hoje">("@simplifica-if/kb/VigenciaNoDia", {
  defaultValue: () => "referencia",
});

/** As consultas sem data calculam a vigência no dia local em que são feitas. */
export const layerVigenciaHoje = Layer.succeed(VigenciaNoDia, "hoje");

/** O dia local de agora (AAAA-MM-DD), pelo `Clock`. */
const hojeLocal = Effect.map(DateTime.now, (agora) =>
  DateTime.formatIsoDate(DateTime.setZone(agora, DateTime.zoneMakeLocal())),
);

export class FontesNormativas extends Context.Service<
  FontesNormativas,
  {
    // registro, datas, relações e transições: o serviço é a `FonteVigencia` das regras (`statusEm`…)
    readonly registro: Registro;
    readonly datas: ReadonlyMap<string, DatasNorma>;
    readonly relacoes: ReadonlyArray<Relacao>;
    readonly transicoes: ReadonlyArray<Transicao>;
    /** O que os textos consolidados mostram na `data_referencia` (piso do status). */
    readonly consolidado: TextoConsolidado;
    /**
     * `data_referencia` de `base-conhecimento/config/vigencia.yaml` (no banco, a gravada em `meta`): o
     * dia do retrato da vigência no front matter, e o piso do texto consolidado vale dela em diante.
     */
    readonly dataReferencia: string;
    /** O dia em que a consulta sem data calcula a vigência: hoje ou a `data_referencia` (`VigenciaNoDia`). */
    readonly diaDaVigencia: Effect.Effect<string>;
    readonly sinonimos: Sinonimos;
    readonly topicosSecoes: TopicosSecoes;
    readonly topicosFichas: ReadonlyArray<TopicoFichas>;
    /**
     * Taxonomia e arquivos de conteúdo de `base-conhecimento/revisao-ppc`, em ordem de caminho: as
     * fichas, os marcos normativos e a taxonomia, cada um em JSON compacto.
     */
    readonly conteudoRevisaoPpc: () => Effect.Effect<ConteudoRevisaoPpc, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/FontesNormativas") {}

const TextoNulo = Schema.NullOr(Schema.String);

const LinhaNorma = Schema.Struct({
  id: Schema.String,
  situacao: Schema.Literals(["base", "stub", "externo"]),
  titulo: Schema.String,
  assinada_em: TextoNulo,
  publicada_em: TextoNulo,
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
/** Por norma: há dispositivo revogado; há nota de redação, inclusão ou renumeração (a regra de `statusDoTexto`). */
const linhasStatusDoTexto = Sql.todas(Schema.Struct({ id: Schema.String, revogado: Schema.Int, alterado: Schema.Int }));

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
const linhasArquivos = Sql.todas(Schema.Struct({ path: Schema.String, arquivo_json: Schema.String }));

/** Uma data `AAAA-MM-DD` da linha; `undefined` sem ela ("a confirmar", "aguardando publicação"). */
const dataOuNada = (valor: string | null): string | undefined =>
  valor !== null && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;

/** Erro de interpretação de uma tabela: o banco não corresponde às regras do kb. */
const falhaDaTabela = (tabela: string) => (cause: unknown) =>
  new Sql.FalhaNaConsulta({ consulta: `interpretação da tabela ${tabela}`, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const normas = yield* linhasNormas(
    "SELECT id, situacao, titulo, assinada_em, publicada_em, status_vigencia, status_fonte, path, aliases_json, front_matter_json " +
      "FROM normas ORDER BY id",
  );
  const registro = new Registro(
    // chaves na ordem de carregarRegistro; no registro, o path é relativo a base-conhecimento/
    normas.map((n): EntradaRegistro => {
      const assinada = dataOuNada(n.assinada_em);
      const publicada = dataOuNada(n.publicada_em);
      return {
        id: n.id,
        title: n.titulo,
        situacao: n.situacao,
        ...(assinada !== undefined ? { assinada_em: assinada } : {}),
        ...(publicada !== undefined ? { publicada_em: publicada } : {}),
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
  const consolidado = montarConsolidado(
    referencia.valor,
    (yield* linhasStatusDoTexto(
      `SELECT norma_id AS id, MAX(revogado) AS revogado,
              MAX(EXISTS (SELECT 1 FROM json_each(notas_json) AS nota
                          WHERE json_extract(nota.value, '$.tipo') IN ('redacao', 'inclusao', 'renumeracao'))) AS alterado
         FROM dispositivos GROUP BY norma_id ORDER BY norma_id`,
    )).map((l): readonly [string, StatusDoTexto | null] => [
      l.id,
      l.revogado ? "parcialmente revogada" : l.alterado ? "alterada" : null,
    ]),
  );

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

  const conteudoRevisaoPpc = Effect.fn("FontesNormativas.conteudoRevisaoPpc")(function* () {
    const arquivos = yield* linhasArquivos(
      "SELECT path, arquivo_json FROM fichas UNION ALL SELECT path, arquivo_json FROM revisao_ppc_arquivos ORDER BY path",
    ).pipe(Effect.provideService(SqlClient.SqlClient, sql));
    return { topicos: topicosFichas, arquivos: arquivos.map((f) => ({ arquivo: f.path, texto: f.arquivo_json })) };
  });

  return FontesNormativas.of({
    registro,
    datas,
    relacoes,
    transicoes,
    consolidado,
    dataReferencia: referencia.valor,
    diaDaVigencia: (yield* VigenciaNoDia) === "hoje" ? hojeLocal : Effect.succeed(referencia.valor),
    sinonimos,
    topicosSecoes,
    topicosFichas,
    conteudoRevisaoPpc,
  });
});

/** Fontes remontadas das tabelas do `kb.sqlite`. Exige só o `SqlClient`: não lê arquivo. */
export const layer = Layer.effect(FontesNormativas, make);
