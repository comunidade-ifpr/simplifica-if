#!/usr/bin/env node
/**
 * CLI `kb`: consultas determinísticas à base de conhecimento, em `effect/cli`.
 *
 *   pnpm kb resolver "Resolução CNE/CP nº 1/2021, art. 20" [--json]
 *   pnpm kb buscar-secoes "acompanhamento de egressos" --cnct tecnico-em-agropecuaria [--json]
 *   pnpm kb compilar [--destino tmp/kb.sqlite]
 *   pnpm kb --help
 *
 * Os comandos estão em `cli/normas.ts` (normas, vigência, relações, impacto), `cli/ppcs.ts` (PPCs,
 * cursos, pacote de contexto) e `cli/compilar.ts`. Saídas sem relógio e com ordem estável: as
 * mesmas fontes dão a mesma saída.
 *
 * Erros: o relatório padrão do `runMain` escreve no stdout e sujaria a saída `--json`, então ele fica
 * desligado e o programa trata o canal de erro aqui. `EncerrarComCodigo` (o comando já imprimiu o
 * resultado, como "dispositivo não encontrado") só dá o código de saída; erros de uso (`CliError`)
 * já saem com a ajuda pelo `Command.run`; qualquer outro erro tipado vira `kb: <mensagem>` no stderr,
 * e um defeito, o `Cause.pretty` no stderr. Todos terminam com código 1 (ou o de `EncerrarComCodigo`).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import { compilar } from "./cli/compilar.ts";
import { raizRepositorio } from "./caminhos.ts";
import { Checkout, ehEncerrarComCodigo } from "./cli/comum.ts";
import {
  avaliarResolvedorCmd,
  buscarNorma,
  correspondencia,
  dispositivo,
  impacto,
  relacoes,
  resolver,
  vigencia,
} from "./cli/normas.ts";
import {
  adequacaoArt71,
  avaliarBuscaCmd,
  buscarSecoes,
  citacoes,
  cursos,
  pacoteContexto,
  ppcFatos,
} from "./cli/ppcs.ts";

const kb = Command.make("kb").pipe(
  Command.withDescription("Consultas à base de conhecimento do IFPR (IDs canônicos de normas, citações em PPCs)."),
  Command.withSubcommands([
    resolver,
    citacoes,
    adequacaoArt71,
    avaliarResolvedorCmd,
    dispositivo,
    vigencia,
    relacoes,
    correspondencia,
    impacto,
    buscarNorma,
    buscarSecoes,
    cursos,
    ppcFatos,
    pacoteContexto,
    avaliarBuscaCmd,
    compilar,
  ]),
);

/** Escreve no stderr o que a falha tem a dizer; o código de saída fica com o `runMain`. */
const relatarFalha = (causa: Cause.Cause<unknown>): Effect.Effect<void> => {
  if (Cause.hasInterruptsOnly(causa)) return Effect.void;
  const erro = Cause.findErrorOption(causa);
  if (Option.isNone(erro)) return Console.error(Cause.pretty(causa));
  if (ehEncerrarComCodigo(erro.value) || CliError.isCliError(erro.value)) return Effect.void;
  const mensagem = erro.value instanceof Error ? erro.value.message : String(erro.value);
  return Console.error(`kb: ${mensagem}`);
};

const programa = Command.run(kb, { version: "0.1.0" }).pipe(
  Effect.provideService(Checkout, Checkout.of({ raiz: raizRepositorio() })),
  Effect.tapCause(relatarFalha),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(programa, { disableErrorReporting: true });
