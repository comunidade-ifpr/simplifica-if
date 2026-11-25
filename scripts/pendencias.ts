#!/usr/bin/env node
/**
 * O que está fora da base e precisa ser completado para entrar: PPCs pendentes (com o que falta) e
 * cursos com PPC publicado sem texto na base. `pnpm pendencias`; `--json` para a lista inteira.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { jsonIndentado } from "@simplifica-if/kb/json";
import { criarCaminhos } from "./base/caminhos.ts";
import { listarPendencias, type Pendencia, TIPOS_PENDENCIA } from "./base/pendencias.ts";
import { executarPrincipal } from "./principal.ts";

const TITULOS: Record<Pendencia["tipo"], string> = {
  "ppc-pendente": "PPCs fora da base, à espera do que falta (promova com node scripts/promover_ppc.ts)",
  "ppc-sem-texto":
    "Cursos com PPC publicado sem texto na base (importe com node scripts/importar_ppc_docx.ts, ou importar_ppc_pdf.ts sem o DOCX)",
};

function texto(pendencias: readonly Pendencia[]): string[] {
  if (!pendencias.length) return ["Nada pendente fora da base."];
  const linhas: string[] = [];
  for (const tipo of TIPOS_PENDENCIA) {
    const doTipo = pendencias.filter((p) => p.tipo === tipo);
    if (!doTipo.length) continue;
    linhas.push(`## ${TITULOS[tipo]}: ${doTipo.length}`, "");
    for (const p of doTipo) {
      linhas.push(`- ${p.curso}: ${p.tipo === "ppc-pendente" ? p.arquivo : p.url}`);
      for (const pendencia of p.pendencias) linhas.push(`  - ${pendencia}`);
    }
    linhas.push("");
  }
  return linhas;
}

export const comando = Command.make(
  "pendencias",
  {
    json: Flag.Boolean("json").pipe(Flag.withDescription("a lista inteira em JSON"), Flag.withDefault(false)),
  },
  Effect.fn("pendencias")(function* ({ json }) {
    const pendencias = listarPendencias(criarCaminhos());
    if (json) yield* Console.log(jsonIndentado(pendencias).trimEnd());
    else for (const linha of texto(pendencias)) yield* Console.log(linha);
  }),
).pipe(Command.withDescription("Lista o que está fora da base e precisa ser completado para entrar."));

if (import.meta.main) {
  executarPrincipal("pendencias", Command.run(comando, { version: "1.0.0" }));
}
