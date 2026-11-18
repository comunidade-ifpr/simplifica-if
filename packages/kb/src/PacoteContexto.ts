/**
 * `PacoteContexto`: o contexto de uma tarefa da `revisar-ppc` (uma ficha, várias, um tópico, um
 * grupo da rodada ou `todas`) para um PPC — CNCT, fichas, dispositivos citados com caput, marcos,
 * regras de transição, seções relevantes e fatos (`kb pacote-contexto`). As partes e as regras de
 * agrupamento estão em `db/pacote-contexto.ts`.
 *
 * PPC fora da base: `doMarkdown` recebe o texto do Markdown (quem chama o lê) e o segmenta num banco
 * em memória, pelo mesmo código da compilação; `avulso` monta o pacote sobre um banco desses já
 * aberto (a `revisar-ppc` reaproveita o mesmo banco em todos os grupos da rodada).
 */
import type * as NodeSqlite from "node:sqlite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import {
  type FichaPacote,
  fichasDoBanco,
  nomesDeCampiDoBanco,
  type OpcoesPacote,
  type OpcoesPacoteAvulso,
  type PacoteAvulso,
  type PacoteContexto as Pacote,
  pacoteContexto,
  type PacoteDoMarkdown,
  pacoteContextoAvulso,
  pacoteDoMarkdown,
} from "./db/pacote-contexto.ts";
import type * as Sql from "./db/sql.ts";
import { GrupoInexistente, PpcNaoEncontrado, TarefaNaoReconhecida } from "./pacote-contexto-erros.ts";

export { GrupoInexistente, PpcNaoEncontrado, TarefaNaoReconhecida };

export class PacoteContexto extends Context.Service<
  PacoteContexto,
  {
    /** Pacote de uma tarefa para um PPC da base (`campus/curso` ou `ppc:campus/curso`). */
    readonly montar: (
      tarefa: string,
      ppc: string,
      opcoes?: OpcoesPacote,
    ) => Effect.Effect<Pacote, Sql.FalhaNaConsulta | PpcNaoEncontrado | GrupoInexistente | TarefaNaoReconhecida>;
    /** Pacote de uma tarefa para um PPC fora da base, dado o texto do Markdown (`arquivo` só o identifica). */
    readonly doMarkdown: (
      tarefa: string,
      arquivo: string,
      markdown: string,
      opcoes?: OpcoesPacote,
    ) => Effect.Effect<PacoteDoMarkdown, Sql.FalhaNaConsulta | GrupoInexistente | TarefaNaoReconhecida>;
    /** Pacote de um conjunto de fichas sobre o banco em memória de um PPC fora da base (`bancoDoPpcAvulso`). */
    readonly avulso: (
      dbPpc: NodeSqlite.DatabaseSync,
      fichas: readonly FichaPacote[],
      opcoes?: OpcoesPacoteAvulso,
    ) => Effect.Effect<PacoteAvulso, Sql.FalhaNaConsulta>;
    /** Fichas da `revisar-ppc` gravadas no banco (todas ou as de `ids`), por ID. */
    readonly fichas: (ids?: readonly string[]) => Effect.Effect<FichaPacote[], Sql.FalhaNaConsulta>;
    /** Nomes dos campi dos PPCs da base (para a segmentação de um PPC avulso). */
    readonly nomesDeCampi: Effect.Effect<string[], Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/PacoteContexto") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fontes = yield* FontesNormativas.FontesNormativas;
  const prover = <A, E>(efeito: Effect.Effect<A, E, SqlClient.SqlClient | FontesNormativas.FontesNormativas>) =>
    efeito.pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provideService(FontesNormativas.FontesNormativas, fontes),
    );

  return PacoteContexto.of({
    montar: Effect.fn("PacoteContexto.montar")(function* (tarefa: string, ppc: string, opcoes: OpcoesPacote = {}) {
      return yield* pacoteContexto(tarefa, ppc, opcoes);
    }, prover),
    doMarkdown: Effect.fn("PacoteContexto.doMarkdown")(function* (
      tarefa: string,
      arquivo: string,
      markdown: string,
      opcoes: OpcoesPacote = {},
    ) {
      return yield* pacoteDoMarkdown(tarefa, arquivo, { ...opcoes, markdown });
    }, prover),
    avulso: Effect.fn("PacoteContexto.avulso")(function* (
      dbPpc: NodeSqlite.DatabaseSync,
      fichas: readonly FichaPacote[],
      opcoes: OpcoesPacoteAvulso = {},
    ) {
      return yield* pacoteContextoAvulso(dbPpc, fichas, opcoes);
    }, prover),
    fichas: Effect.fn("PacoteContexto.fichas")(function* (ids?: readonly string[]) {
      return yield* fichasDoBanco(ids);
    }, prover),
    nomesDeCampi: prover(nomesDeCampiDoBanco()),
  });
});

export const layer = Layer.effect(PacoteContexto, make);
