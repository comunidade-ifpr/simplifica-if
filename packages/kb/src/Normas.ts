/**
 * `Normas`: legislação e normas da base — resolução de citações, busca (citação, ID ou termos),
 * metadados, dispositivos com caput herdado, vigência numa data, relações, sucessoras e
 * correspondência entre normas sucessoras.
 *
 * As regras são as funções puras de `normas/` (resolvedor, `statusEm`, `transicoesAplicaveis`,
 * `correspondenciaEm`, `relacoesDeEm`), sobre os dados de `FontesNormativas`; os dispositivos e a
 * busca textual vêm do banco (`db/consultas-normas.ts`, privado a este serviço).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import { UrlOficial } from "./normas/fonte.ts";
import { type AlteracaoAnotada, alteracoesAnotadas } from "./normas/alteracoes-anotadas.ts";
import { TIPOS_NOTA } from "./normas/estrutura.ts";
import { listaDeTextos } from "./normas/front-matter.ts";
import {
  buscarNormaDetalhada,
  carregarFonteCorrespondencia,
  descendentes,
  type DispositivoDoBanco,
  dispositivoOuAncestral,
  documentoDaNorma,
  type DocumentoNorma,
  listarNormas,
  type NormaListada,
  type NormaResumo,
  obterDispositivo,
  obterNorma,
  type OpcoesBuscaNorma,
  type ResultadoBuscaNorma,
  type TrechoDispositivo,
  trechoDoDispositivo,
} from "./db/consultas-normas.ts";
import * as Sql from "./db/sql.ts";
import {
  correspondenciaEm,
  type ResultadoCorrespondencia,
  type TabelaCorrespondencia,
} from "./normas/correspondencia.ts";
import { type Relacao, relacoesDeEm, sucessorasDe } from "./normas/relacoes.ts";
import { type ResolucaoComEntrada, resolucaoComEntrada } from "./normas/resolver.ts";
import { type ResultadoVigencia, type SituacaoTransicao, statusEm, transicoesAplicaveis } from "./normas/vigencia.ts";

export type {
  DatasDoAto,
  DispositivoDoBanco,
  DispositivoDoDocumento,
  DocumentoNorma,
  NormaListada,
  NormaResumo,
  OpcoesBuscaNorma,
  ResultadoBuscaNorma,
  ResultadoNorma,
  TrechoDispositivo,
} from "./db/consultas-normas.ts";

/** Metadados de uma norma da base, stub ou referência externa, como o front matter e o `stubs.yaml` os publicam. */
export interface FichaNorma {
  readonly id: string;
  readonly situacao: "base" | "stub" | "externo";
  readonly titulo: string;
  readonly tipo_documento: string | null;
  readonly numero: string | null;
  readonly ano: number | null;
  readonly orgao: string | null;
  readonly jurisdicao: string | null;
  readonly data_publicacao: string | null;
  /** Status publicado, calculado na `data_referencia`. */
  readonly status_vigencia: string | null;
  readonly ementa: string | null;
  /** URL https do texto oficial, do front matter ou do stub; `null` quando a fonte oficial está pendente. */
  readonly fonte_url: UrlOficial | null;
  /** Referência da fonte sem link (número do SEI, Boletim de Serviço, PDF assinado). */
  readonly fonte_referencia: string | null;
  /** Markdown, relativo à raiz do repositório; `null` em stub e externo. */
  readonly path: string | null;
  /** Explicação gerada (`vigencia_a_confirmar` do front matter) quando o status depende de data a confirmar. */
  readonly pendencia_vigencia: string | null;
  /** O status publicado está "a confirmar": há pendência registrada ou o status é `a confirmar` (stubs). */
  readonly vigencia_a_confirmar: boolean;
  /** Metadados editoriais do front matter (vazios em stub e externo): indicação, não fundamento. */
  readonly pontos_chave: ReadonlyArray<string>;
  readonly notas_da_fonte: ReadonlyArray<string>;
}

const LinhaFicha = Schema.Struct({
  id: Schema.String,
  situacao: Schema.Literals(["base", "stub", "externo"]),
  titulo: Schema.String,
  tipo_documento: Schema.NullOr(Schema.String),
  numero: Schema.NullOr(Schema.String),
  ano: Schema.NullOr(Schema.Int),
  orgao: Schema.NullOr(Schema.String),
  jurisdicao: Schema.NullOr(Schema.String),
  data_publicacao: Schema.NullOr(Schema.String),
  status_vigencia: Schema.NullOr(Schema.String),
  ementa: Schema.NullOr(Schema.String),
  fonte_url: Schema.NullOr(UrlOficial),
  fonte_referencia: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  front_matter_json: Schema.NullOr(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))),
});
const primeiraFicha = Sql.primeira(LinhaFicha);
const linhasNotas = Sql.todas(
  Schema.Struct({
    dispositivo: Schema.String,
    notas: Schema.fromJsonString(
      Schema.Array(Schema.Struct({ tipo: Schema.Literals(TIPOS_NOTA), texto: Schema.String })),
    ),
  }),
);
const linhasFontes = Sql.todas(Schema.Struct({ id: Schema.String, fonte_url: UrlOficial }));

const ato = (id: string) => id.split("#")[0]!;

export class Normas extends Context.Service<
  Normas,
  {
    /** Resolve uma citação para o ID canônico (e o dispositivo), com título e arquivo da norma. */
    readonly resolver: (texto: string) => Effect.Effect<ResolucaoComEntrada>;
    /** `kb buscar-norma`: citação ou ID vão ao dispositivo; termos fazem busca textual. */
    readonly buscar: (
      consulta: string,
      opcoes?: OpcoesBuscaNorma,
    ) => Effect.Effect<ResultadoBuscaNorma, Sql.FalhaNaConsulta>;
    /** Resumo da norma pela tabela `normas` (`null` se não registrada). */
    readonly obter: (id: string) => Effect.Effect<NormaResumo | null, Sql.FalhaNaConsulta>;
    /** Metadados completos da norma (pelo ID, com ou sem `#dispositivo`); `null` se não registrada. */
    readonly ficha: (id: string) => Effect.Effect<FichaNorma | null, Sql.FalhaNaConsulta>;
    readonly dispositivo: (id: string) => Effect.Effect<DispositivoDoBanco | undefined, Sql.FalhaNaConsulta>;
    /** O dispositivo pedido ou, se ele não está no texto, o ancestral mais próximo que está. */
    readonly dispositivoOuAncestral: (id: string) => Effect.Effect<DispositivoDoBanco | undefined, Sql.FalhaNaConsulta>;
    readonly descendentes: (id: string) => Effect.Effect<DispositivoDoBanco[], Sql.FalhaNaConsulta>;
    /** O texto do dispositivo (ou do ancestral mais próximo) com caput, notas e, se pedidos, os subordinados. */
    readonly trecho: (
      id: string,
      opcoes?: { readonly subordinados?: boolean },
    ) => Effect.Effect<TrechoDispositivo | null, Sql.FalhaNaConsulta>;
    /** Status na data (padrão: `data_referencia`), eventos, pendências e transições. */
    readonly vigencia: (
      id: string,
      opcoes?: { readonly em?: string },
    ) => Effect.Effect<ResultadoVigencia & { transicoes: SituacaoTransicao[] }>;
    /** Relações em que a norma é origem (`saida`) ou alvo (`entrada`). */
    /**
     * As alterações que o texto da norma anota ("Redação dada pela Lei nº ..."), por ato, do mais
     * recente ao mais antigo; vazio em stub e externo. Não são relações: ver `alteracoes-anotadas.ts`.
     */
    readonly alteracoesAnotadas: (id: string) => Effect.Effect<AlteracaoAnotada[], Sql.FalhaNaConsulta>;
    readonly relacoes: (id: string) => Effect.Effect<{ id: string; saida: Relacao[]; entrada: Relacao[] }>;
    /** Atos que revogam a norma no todo. */
    readonly sucessoras: (id: string) => Effect.Effect<string[]>;
    /** Dispositivos da norma sucessora que correspondem ao dispositivo (tabela de correspondência). */
    readonly correspondencia: (id: string) => Effect.Effect<ResultadoCorrespondencia[], Sql.FalhaNaConsulta>;
    /** Tabelas de correspondência que têm o ato como origem. */
    readonly tabelasDeCorrespondencia: (
      ato: string,
    ) => Effect.Effect<ReadonlyArray<TabelaCorrespondencia>, Sql.FalhaNaConsulta>;
    /** Todas as normas, stubs e referências externas, por ID, com os apelidos e as palavras-chave. */
    readonly listar: Effect.Effect<ReadonlyArray<NormaListada>, Sql.FalhaNaConsulta>;
    /**
     * A norma (pelo ID do arquivo) como documento, para o leitor: metadados, datas do ato e, se ela tem
     * o texto na base, os dispositivos e o Markdown; `null` se não registrada.
     */
    readonly documento: (id: string) => Effect.Effect<DocumentoNorma | null, Sql.FalhaNaConsulta>;
    /** A `data_referencia` da base. */
    readonly dataReferencia: Effect.Effect<string>;
    /** O endereço oficial (`fonte_url`) de cada norma, stub ou referência externa que o registra, por ID. */
    readonly enderecosOficiais: Effect.Effect<Record<string, UrlOficial>, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Normas") {}

const make = Effect.gen(function* () {
  const fontes = yield* FontesNormativas.FontesNormativas;
  // as tabelas de correspondência e os dispositivos que elas citam não mudam com o banco aberto:
  // carregados uma vez, na construção da layer
  const fonteCorrespondencia = yield* carregarFonteCorrespondencia;
  const prover = yield* Sql.ambienteDoServico(SqlClient.SqlClient, FontesNormativas.FontesNormativas);

  const ficha = Effect.fn("Normas.ficha")(function* (id: string) {
    const consultar = (chave: string) =>
      primeiraFicha(
        `SELECT id, situacao, titulo, tipo_documento, numero, ano, orgao, jurisdicao, data_publicacao, status_vigencia,
                ementa, fonte_url, fonte_referencia, path, front_matter_json FROM normas WHERE id = ?`,
        [chave],
      );
    const norma = id.split("#")[0]!;
    const linha = yield* consultar(norma);
    if (!linha) return null;
    const { front_matter_json, ...n } = linha;
    const pendenciaBruta = front_matter_json?.["vigencia_a_confirmar"];
    const pendencia = typeof pendenciaBruta === "string" ? pendenciaBruta : null;
    const resultado: FichaNorma = {
      ...n,
      pendencia_vigencia: pendencia,
      vigencia_a_confirmar: pendencia !== null || n.status_vigencia === "a confirmar",
      pontos_chave: listaDeTextos(front_matter_json, "pontos_chave"),
      notas_da_fonte: listaDeTextos(front_matter_json, "notas_da_fonte"),
    };
    return resultado;
  }, prover);

  return Normas.of({
    alteracoesAnotadas: Effect.fn("Normas.alteracoesAnotadas")(function* (id: string) {
      const linhas = yield* linhasNotas(
        "SELECT dispositivo, notas_json AS notas FROM dispositivos WHERE norma_id = ? AND notas_json <> '[]' ORDER BY ordem",
        [ato(id)],
      );
      return alteracoesAnotadas(linhas, fontes.registro);
    }, prover),
    resolver: Effect.fn("Normas.resolver")((texto: string) =>
      Effect.succeed(resolucaoComEntrada(texto, fontes.registro)),
    ),
    buscar: Effect.fn("Normas.buscar")(function* (consulta: string, opcoes: OpcoesBuscaNorma = {}) {
      return yield* buscarNormaDetalhada(consulta, opcoes);
    }, prover),
    obter: Effect.fn("Normas.obter")(function* (id: string) {
      return yield* obterNorma(id);
    }, prover),
    ficha,
    dispositivo: Effect.fn("Normas.dispositivo")(function* (id: string) {
      return yield* obterDispositivo(id);
    }, prover),
    dispositivoOuAncestral: Effect.fn("Normas.dispositivoOuAncestral")(function* (id: string) {
      return yield* dispositivoOuAncestral(id);
    }, prover),
    descendentes: Effect.fn("Normas.descendentes")(function* (id: string) {
      return yield* descendentes(id);
    }, prover),
    vigencia: Effect.fn("Normas.vigencia")((id: string, opcoes: { readonly em?: string } = {}) =>
      Effect.sync(() => {
        const quando = opcoes.em ?? fontes.dataReferencia;
        return {
          ...statusEm(ato(id), quando, fontes),
          transicoes: transicoesAplicaveis(ato(id), quando, fontes),
        };
      }),
    ),
    relacoes: Effect.fn("Normas.relacoes")((id: string) =>
      Effect.sync(() => ({ id: ato(id), ...relacoesDeEm(ato(id), fontes.relacoes) })),
    ),
    sucessoras: Effect.fn("Normas.sucessoras")((id: string) =>
      Effect.sync(() => sucessorasDe(ato(id), fontes.relacoes)),
    ),
    trecho: Effect.fn("Normas.trecho")(function* (id: string, opcoes: { readonly subordinados?: boolean } = {}) {
      return (yield* trechoDoDispositivo(id, opcoes)) ?? null;
    }, prover),
    tabelasDeCorrespondencia: Effect.fn("Normas.tabelasDeCorrespondencia")((ato: string) =>
      Effect.sync(() => fonteCorrespondencia.tabelas.get(ato) ?? []),
    ),
    correspondencia: Effect.fn("Normas.correspondencia")((id: string) =>
      Effect.sync(() => correspondenciaEm(id, fonteCorrespondencia)),
    ),
    listar: listarNormas().pipe(prover),
    documento: Effect.fn("Normas.documento")(function* (id: string) {
      return yield* documentoDaNorma(id);
    }, prover),
    dataReferencia: Effect.succeed(fontes.dataReferencia),
    enderecosOficiais: Effect.gen(function* () {
      const urls: Record<string, UrlOficial> = {};
      for (const linha of yield* linhasFontes("SELECT id, fonte_url FROM normas WHERE fonte_url IS NOT NULL"))
        urls[linha.id] = linha.fonte_url;
      return urls;
    }).pipe(Effect.withSpan("Normas.enderecosOficiais"), prover),
  });
});

export const layer = Layer.effect(Normas, make);
