/**
 * `Ppcs`: os PPCs convertidos no banco — busca de seções (FTS5, radicais e léxico de sinônimos),
 * leitura de seções, citações normativas (quem cita uma norma, o que um PPC cita) e os fatos
 * extraídos com o cruzamento com o SUAP. Consultas em `db/consultas.ts` e `db/citacoes.ts`; o léxico
 * e o registro vêm de `FontesNormativas`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import * as Citacoes from "./db/citacoes.ts";
import {
  buscarSecoes,
  divergenciasPpcSuap,
  fatosDosPpcs,
  type FiltrosFatos,
  type FiltrosSecoes,
  indiceSecoesDoPpc,
  lerSecao,
  type ModoBusca,
  secoesDoPpc,
} from "./db/consultas.ts";
import type * as Sql from "./db/sql.ts";
import type { Sinonimos } from "./busca/sinonimos.ts";
import { type NormaCitadaNoPpc, type PpcCitante, type RelatorioCitacoes, relatorioCitacoes } from "./ppcs/citacoes.ts";

type Sucesso<F extends (...args: never[]) => Effect.Effect<unknown, unknown, unknown>> = Effect.Success<ReturnType<F>>;

export interface OpcoesBuscaSecoes {
  readonly limite?: number;
  readonly modo?: ModoBusca;
  /** Léxico de sinônimos (padrão: o de `FontesNormativas`); a avaliação passa um vazio. */
  readonly lexico?: Sinonimos;
  /** Inclui o texto integral de cada seção. */
  readonly integral?: boolean;
  readonly somenteTodos?: boolean;
}

export class Ppcs extends Context.Service<
  Ppcs,
  {
    readonly buscarSecoes: (
      consulta: string,
      filtros?: FiltrosSecoes,
      opcoes?: OpcoesBuscaSecoes,
    ) => Effect.Effect<Sucesso<typeof buscarSecoes>, Sql.FalhaNaConsulta>;
    readonly secoesDoPpc: (
      ppc: string,
      tipos: readonly string[],
    ) => Effect.Effect<Sucesso<typeof secoesDoPpc>, Sql.FalhaNaConsulta>;
    readonly indiceSecoesDoPpc: (ppc: string) => Effect.Effect<Sucesso<typeof indiceSecoesDoPpc>, Sql.FalhaNaConsulta>;
    readonly lerSecao: (id: string) => Effect.Effect<Sucesso<typeof lerSecao>, Sql.FalhaNaConsulta>;
    /** PPCs que citam a norma `id` (aceita `#dispositivo`), com cada ocorrência. */
    readonly citacoesDaNorma: (
      id: string,
      opcoes?: { readonly confiancaMinima?: number },
    ) => Effect.Effect<PpcCitante[], Sql.FalhaNaConsulta>;
    /** `kb citacoes`: os PPCs que citam a norma, com o título e a situação dela no registro. */
    readonly relatorioCitacoes: (
      id: string,
      opcoes?: { readonly confiancaMinima?: number },
    ) => Effect.Effect<RelatorioCitacoes, Sql.FalhaNaConsulta>;
    /** Normas citadas por um PPC; `null` se o PPC não está na base. */
    readonly normasCitadas: (ppc: string) => Effect.Effect<NormaCitadaNoPpc[] | null, Sql.FalhaNaConsulta>;
    readonly fatos: (filtros?: FiltrosFatos) => Effect.Effect<Sucesso<typeof fatosDosPpcs>, Sql.FalhaNaConsulta>;
    readonly divergencias: (
      filtros?: FiltrosFatos,
    ) => Effect.Effect<Sucesso<typeof divergenciasPpcSuap>, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Ppcs") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fontes = yield* FontesNormativas.FontesNormativas;
  const prover = <A, E>(efeito: Effect.Effect<A, E, SqlClient.SqlClient | FontesNormativas.FontesNormativas>) =>
    efeito.pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provideService(FontesNormativas.FontesNormativas, fontes),
    );

  return Ppcs.of({
    buscarSecoes: Effect.fn("Ppcs.buscarSecoes")(function* (
      consulta: string,
      filtros: FiltrosSecoes = {},
      opcoes: OpcoesBuscaSecoes = {},
    ) {
      return yield* buscarSecoes(consulta, filtros, opcoes);
    }, prover),
    secoesDoPpc: Effect.fn("Ppcs.secoesDoPpc")(function* (ppc: string, tipos: readonly string[]) {
      return yield* secoesDoPpc(ppc, tipos);
    }, prover),
    indiceSecoesDoPpc: Effect.fn("Ppcs.indiceSecoesDoPpc")(function* (ppc: string) {
      return yield* indiceSecoesDoPpc(ppc);
    }, prover),
    lerSecao: Effect.fn("Ppcs.lerSecao")(function* (id: string) {
      return yield* lerSecao(id);
    }, prover),
    citacoesDaNorma: Effect.fn("Ppcs.citacoesDaNorma")(function* (
      id: string,
      opcoes: { readonly confiancaMinima?: number } = {},
    ) {
      return yield* Citacoes.ppcsQueCitam(id, opcoes);
    }, prover),
    relatorioCitacoes: Effect.fn("Ppcs.relatorioCitacoes")(function* (
      id: string,
      opcoes: { readonly confiancaMinima?: number } = {},
    ) {
      return relatorioCitacoes(id, yield* Citacoes.ppcsQueCitam(id, opcoes), fontes.registro);
    }, prover),
    normasCitadas: Effect.fn("Ppcs.normasCitadas")(function* (ppc: string) {
      return yield* Citacoes.normasCitadasDoPpc(ppc);
    }, prover),
    fatos: Effect.fn("Ppcs.fatos")(function* (filtros: FiltrosFatos = {}) {
      return yield* fatosDosPpcs(filtros);
    }, prover),
    divergencias: Effect.fn("Ppcs.divergencias")(function* (filtros: FiltrosFatos = {}) {
      return yield* divergenciasPpcSuap(filtros);
    }, prover),
  });
});

export const layer = Layer.effect(Ppcs, make);
