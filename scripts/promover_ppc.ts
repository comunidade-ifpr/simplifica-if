#!/usr/bin/env node
/**
 * Leva um PPC pendente (`curadoria/pendencias/ppcs/…`) para a base, com o ano do documento e a
 * evidência literal: ganha o ID permanente da versão do ano e, se for a versão mais recente, passa a
 * ser o vigente do curso.
 */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { criarCaminhos } from "./base/caminhos.ts";
import { ehErroVersaoPpc, promoverPpc } from "./base/versoes-ppc.ts";
import { executarPrincipal } from "./principal.ts";

const PASSOS_SEGUINTES = ["node scripts/gerar_base.ts", "node scripts/validar_base.ts"];

export const comando = Command.make(
  "promover_ppc",
  {
    arquivo: Argument.String("arquivo-pendente").pipe(
      Argument.withDescription("o PPC pendente, curadoria/pendencias/ppcs/<campus>/<curso>/<rotulo>.md"),
    ),
    ano: Flag.Int("ano").pipe(Flag.withMetavar("AAAA"), Flag.withDescription("ano do documento")),
    evidencia: Flag.String("evidencia").pipe(
      Flag.withMetavar("trecho"),
      Flag.withDescription("trecho literal que traz o ano (capa, ato de aprovação)"),
    ),
    fonteAno: Flag.String("fonte-ano").pipe(
      Flag.withMetavar("texto|url"),
      Flag.withDescription('onde está o trecho: "texto" (no PPC, o padrão) ou a URL https da fonte'),
      Flag.withDefault("texto"),
    ),
  },
  Effect.fn("promover_ppc")(function* ({ arquivo, ano, evidencia, fonteAno }) {
    const agora = DateTime.toDateUtc(yield* DateTime.now);
    const resultado = yield* Effect.suspend(() => {
      try {
        return Effect.succeed(promoverPpc(criarCaminhos(), arquivo, { ano, evidencia, fonte: fonteAno }, agora));
      } catch (erro) {
        return ehErroVersaoPpc(erro) ? Effect.fail(erro) : Effect.die(erro);
      }
    });
    yield* Console.log(`PPC na base: ${resultado.id}${resultado.vigente ? " (vigente do curso)" : ""}`);
    yield* Console.log("\nConfira e rode:");
    for (const passo of PASSOS_SEGUINTES) yield* Console.log(`  ${passo}`);
  }),
).pipe(Command.withDescription("Leva um PPC pendente para a base, com o ano do documento e a evidência."));

if (import.meta.main) {
  executarPrincipal("promover_ppc", Command.run(comando, { version: "1.0.0" }));
}
