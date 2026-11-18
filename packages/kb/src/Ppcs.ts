/**
 * `Ppcs`: os PPCs convertidos no banco — busca de seções (FTS5, radicais e léxico de sinônimos),
 * leitura de seções, citações normativas (quem cita uma norma, o que um PPC cita) e os fatos
 * extraídos com o cruzamento com o SUAP. As consultas, privadas a este serviço, ficam em
 * `db/consultas-secoes.ts`, `db/consultas-fatos.ts` e `db/citacoes.ts`; o léxico e o registro vêm de
 * `FontesNormativas`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import * as Citacoes from "./db/citacoes.ts";
import {
  type DivergenciasPpcSuap,
  divergenciasPpcSuap,
  type FatosDoPpc,
  fatosDosPpcs,
  type FiltrosFatos,
} from "./db/consultas-fatos.ts";
import {
  buscarSecoes,
  type EntradaIndiceSecoes,
  type FiltrosSecoes,
  indiceSecoesDoPpc,
  lerSecao,
  type OpcoesBuscaSecoes,
  type ResultadoSecao,
  type SecaoDoPpc,
  type SecaoLida,
  secoesDoPpc,
} from "./db/consultas-secoes.ts";
import * as Sql from "./db/sql.ts";
import { type NormaCitadaNoPpc, type PpcCitante, type RelatorioCitacoes, relatorioCitacoes } from "./ppcs/citacoes.ts";

export type { DivergenciasPpcSuap, FatosDoPpc, FiltrosFatos } from "./db/consultas-fatos.ts";
export type {
  EntradaIndiceSecoes,
  FiltrosSecoes,
  OpcoesBuscaSecoes,
  ResultadoSecao,
  SecaoDoPpc,
  SecaoLida,
} from "./db/consultas-secoes.ts";
export type { ModoBusca } from "./busca/fts.ts";

export class Ppcs extends Context.Service<
  Ppcs,
  {
    readonly buscarSecoes: (
      consulta: string,
      filtros?: FiltrosSecoes,
      opcoes?: OpcoesBuscaSecoes,
    ) => Effect.Effect<ResultadoSecao[], Sql.FalhaNaConsulta>;
    readonly secoesDoPpc: (ppc: string, tipos: readonly string[]) => Effect.Effect<SecaoDoPpc[], Sql.FalhaNaConsulta>;
    readonly indiceSecoesDoPpc: (ppc: string) => Effect.Effect<EntradaIndiceSecoes[], Sql.FalhaNaConsulta>;
    readonly lerSecao: (id: string) => Effect.Effect<SecaoLida | null, Sql.FalhaNaConsulta>;
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
    readonly fatos: (filtros?: FiltrosFatos) => Effect.Effect<FatosDoPpc[], Sql.FalhaNaConsulta>;
    readonly divergencias: (filtros?: FiltrosFatos) => Effect.Effect<DivergenciasPpcSuap, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Ppcs") {}

const make = Effect.gen(function* () {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const prover = yield* Sql.ambienteDoServico<SqlClient.SqlClient | FontesNormativas.FontesNormativas>();

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
