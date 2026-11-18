/**
 * `PacoteContexto`: o contexto de uma tarefa da `revisar-ppc` (uma ficha, várias, um tópico, um
 * grupo da rodada ou `todas`) para um PPC — CNCT, fichas, dispositivos citados com caput, marcos,
 * regras de transição, seções relevantes e fatos (`kb pacote-contexto`). As partes e as regras de
 * agrupamento estão em `db/pacote-contexto.ts`.
 *
 * PPC fora da base: `doMarkdown` recebe o texto do Markdown (quem chama o lê) e o segmenta num banco
 * em memória, pelo mesmo código da compilação; `abrirAvulso` abre um banco desses no escopo de quem
 * chama e devolve o `PpcAvulso`, que monta o pacote de cada conjunto de fichas sobre ele (a
 * `revisar-ppc` reaproveita o mesmo banco em todos os grupos da rodada, e a revisão com IA do app em
 * todos os blocos).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as FontesNormativas from "./FontesNormativas.ts";
import {
  abrirPpcAvulso,
  type FichaPacote,
  fichasDoBanco,
  type FichaResumida,
  fichasResumidas,
  nomesDeCampiDoBanco,
  type OpcoesAbrirAvulso,
  type OpcoesPacote,
  type PacoteContexto as Pacote,
  pacoteContexto,
  type PacoteDoMarkdown,
  pacoteDoMarkdown,
  type PpcAvulso,
} from "./db/pacote-contexto.ts";
import * as Sql from "./db/sql.ts";
import { GrupoInexistente, PpcNaoEncontrado, TarefaNaoReconhecida } from "./pacote-contexto-erros.ts";

export { GrupoInexistente, PpcNaoEncontrado, TarefaNaoReconhecida };
export type {
  EstruturaAvulsa,
  FichaResumida,
  OpcoesAbrirAvulso,
  OpcoesPacoteAvulso,
  PacoteAvulso,
  PpcAvulso,
} from "./db/pacote-contexto.ts";

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
    /**
     * Um PPC fora da base, dado o texto do Markdown, segmentado num banco em memória que fecha com o
     * escopo de quem chama: o pacote de cada conjunto de fichas e a estrutura do PPC saem dele.
     */
    readonly abrirAvulso: (
      markdown: string,
      opcoes?: OpcoesAbrirAvulso,
    ) => Effect.Effect<PpcAvulso, Sql.FalhaNaConsulta, Scope.Scope>;
    /** Fichas da `revisar-ppc` gravadas no banco (todas ou as de `ids`), por ID. */
    readonly fichas: (ids?: readonly string[]) => Effect.Effect<FichaPacote[], Sql.FalhaNaConsulta>;
    /** Todas as fichas pelas colunas da tabela (título, domínio, criticidade e arquivo), por ID. */
    readonly fichasResumidas: Effect.Effect<ReadonlyArray<FichaResumida>, Sql.FalhaNaConsulta>;
    /** Nomes dos campi dos PPCs da base (para a segmentação de um PPC avulso). */
    readonly nomesDeCampi: Effect.Effect<string[], Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/PacoteContexto") {}

const make = Effect.gen(function* () {
  const prover = yield* Sql.ambienteDoServico<SqlClient.SqlClient | FontesNormativas.FontesNormativas>();

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
    abrirAvulso: Effect.fn("PacoteContexto.abrirAvulso")(function* (markdown: string, opcoes: OpcoesAbrirAvulso = {}) {
      return yield* abrirPpcAvulso(markdown, opcoes);
    }, prover),
    fichas: Effect.fn("PacoteContexto.fichas")(function* (ids?: readonly string[]) {
      return yield* fichasDoBanco(ids);
    }, prover),
    fichasResumidas: fichasResumidas().pipe(prover),
    nomesDeCampi: prover(nomesDeCampiDoBanco()),
  });
});

export const layer = Layer.effect(PacoteContexto, make);
