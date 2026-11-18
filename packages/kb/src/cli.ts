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
 * Erros: pelo ponto de entrada comum (`principal.ts`), longe do stdout da saída `--json`.
 * `EncerrarComCodigo` (o comando já imprimiu o resultado, como "dispositivo não encontrado") só dá o
 * código de saída; qualquer outro erro tipado vira `kb: <mensagem>` no stderr.
 */
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import { compilar } from "./cli/compilar.ts";
import { raizRepositorio } from "./caminhos.ts";
import { Checkout } from "./cli/comum.ts";
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
import { executarPrincipal } from "./principal.ts";
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

executarPrincipal(
  "kb",
  Command.run(kb, { version: "0.1.0" }).pipe(Effect.provideService(Checkout, Checkout.of({ raiz: raizRepositorio() }))),
);
