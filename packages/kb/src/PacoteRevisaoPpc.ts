/**
 * `PacoteRevisaoPpc`: o que é da tarefa "Revisar um PPC" no `kb.sqlite` (as tabelas `revisao_ppc_*`),
 * fora das consultas gerais da base. O contexto de uma tarefa da revisão (uma ficha, várias, um
 * tópico ou `todas`) para um PPC — CNCT, fichas, dispositivos citados com caput, marcos, regras de
 * transição, seções relevantes e fatos (`kb pacote-revisao-ppc`; as partes estão em
 * `db/pacote-revisao-ppc.ts`) — e os critérios (as fichas) por ID, tópico ou norma
 * (`kb criterios-revisao-ppc`, `db/criterios-revisao-ppc.ts`).
 *
 * PPC fora da base: `doMarkdown` recebe o texto do Markdown (quem chama o lê) e o segmenta num banco
 * em memória, pelo mesmo código da compilação; `abrirAvulso` abre um banco desses no escopo de quem
 * chama e devolve o `PpcAvulso`, que monta o pacote de cada conjunto de fichas sobre ele (a revisão
 * com IA do app reaproveita o mesmo banco em todos os blocos).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import { criteriosDoBanco, type FiltroCriterios, type ResultadoCriterios } from "./db/criterios-revisao-ppc.ts";
import {
  abrirPpcAvulso,
  type FichaPacote,
  fichasDoBanco,
  type FichaResumida,
  fichasResumidas,
  nomesDeCampiDoBanco,
  type OpcoesAbrirAvulso,
  type OpcoesPacote,
  type PacoteRevisaoPpc as Pacote,
  pacoteRevisaoPpc,
  type PacoteDoMarkdown,
  pacoteDoMarkdown,
  type PpcAvulso,
} from "./db/pacote-revisao-ppc.ts";
import * as Sql from "./db/sql.ts";
import { CriteriosNaoEncontrados, PpcNaoEncontrado, TarefaNaoReconhecida } from "./pacote-revisao-ppc-erros.ts";

export { CriteriosNaoEncontrados, PpcNaoEncontrado, TarefaNaoReconhecida };
export type { Criterio, FiltroCriterios, ReferenciaCriterio, ResultadoCriterios } from "./db/criterios-revisao-ppc.ts";
export type {
  EstruturaAvulsa,
  FichaResumida,
  OpcoesAbrirAvulso,
  OpcoesPacoteAvulso,
  PacoteAvulso,
  PpcAvulso,
} from "./db/pacote-revisao-ppc.ts";

export class PacoteRevisaoPpc extends Context.Service<
  PacoteRevisaoPpc,
  {
    /** Pacote de uma tarefa para um PPC da base (`campus/curso` ou `ppc:campus/curso`). */
    readonly montar: (
      tarefa: string,
      ppc: string,
      opcoes?: OpcoesPacote,
    ) => Effect.Effect<Pacote, Sql.FalhaNaConsulta | PpcNaoEncontrado | TarefaNaoReconhecida>;
    /** Pacote de uma tarefa para um PPC fora da base, dado o texto do Markdown (`arquivo` só o identifica). */
    readonly doMarkdown: (
      tarefa: string,
      arquivo: string,
      markdown: string,
      opcoes?: OpcoesPacote,
    ) => Effect.Effect<PacoteDoMarkdown, Sql.FalhaNaConsulta | TarefaNaoReconhecida>;
    /**
     * Um PPC fora da base, dado o texto do Markdown, segmentado num banco em memória que fecha com o
     * escopo de quem chama: o pacote de cada conjunto de fichas e a estrutura do PPC saem dele.
     */
    readonly abrirAvulso: (
      markdown: string,
      opcoes?: OpcoesAbrirAvulso,
    ) => Effect.Effect<PpcAvulso, Sql.FalhaNaConsulta, Scope.Scope>;
    /** fichas da revisão de PPC gravadas no banco (todas ou as de `ids`), por ID. */
    readonly fichas: (ids?: readonly string[]) => Effect.Effect<FichaPacote[], Sql.FalhaNaConsulta>;
    /** Todas as fichas pelas colunas da tabela (título, domínio, criticidade e arquivo), por ID. */
    readonly fichasResumidas: Effect.Effect<ReadonlyArray<FichaResumida>, Sql.FalhaNaConsulta>;
    /** Nomes dos campi dos PPCs da base (para a segmentação de um PPC avulso). */
    readonly nomesDeCampi: Effect.Effect<string[], Sql.FalhaNaConsulta>;
    /** Os critérios (fichas) de um ID, de um tópico ou que uma norma atinge: exatamente um dos três. */
    readonly criterios: (
      filtro: FiltroCriterios,
    ) => Effect.Effect<ResultadoCriterios, Sql.FalhaNaConsulta | CriteriosNaoEncontrados>;
  }
>()("@simplifica-if/kb/PacoteRevisaoPpc") {}

const make = Effect.gen(function* () {
  const prover = yield* Sql.ambienteDoServico(SqlClient.SqlClient, FontesNormativas.FontesNormativas);

  return PacoteRevisaoPpc.of({
    montar: Effect.fn("PacoteRevisaoPpc.montar")(function* (tarefa: string, ppc: string, opcoes: OpcoesPacote = {}) {
      return yield* pacoteRevisaoPpc(tarefa, ppc, opcoes);
    }, prover),
    doMarkdown: Effect.fn("PacoteRevisaoPpc.doMarkdown")(function* (
      tarefa: string,
      arquivo: string,
      markdown: string,
      opcoes: OpcoesPacote = {},
    ) {
      return yield* pacoteDoMarkdown(tarefa, arquivo, { ...opcoes, markdown });
    }, prover),
    abrirAvulso: Effect.fn("PacoteRevisaoPpc.abrirAvulso")(function* (
      markdown: string,
      opcoes: OpcoesAbrirAvulso = {},
    ) {
      return yield* abrirPpcAvulso(markdown, opcoes);
    }, prover),
    fichas: Effect.fn("PacoteRevisaoPpc.fichas")(function* (ids?: readonly string[]) {
      return yield* fichasDoBanco(ids);
    }, prover),
    fichasResumidas: fichasResumidas().pipe(prover),
    nomesDeCampi: prover(nomesDeCampiDoBanco()),
    criterios: Effect.fn("PacoteRevisaoPpc.criterios")(function* (filtro: FiltroCriterios) {
      return yield* criteriosDoBanco(filtro);
    }, prover),
  });
});

export const layer = Layer.effect(PacoteRevisaoPpc, make);
