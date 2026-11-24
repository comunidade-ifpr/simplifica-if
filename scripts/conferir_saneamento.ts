/**
 * Confere que a marcação Markdown das normas não alterou o texto: removida a marcação e
 * normalizados os espaços, a sequência de palavras do corpo de cada norma deve ser idêntica à do
 * commit de referência (`--ref`, padrão `HEAD`). O front matter fica fora da comparação.
 *
 * Uso sob demanda ao sanear marcação de normas:
 *   node scripts/conferir_saneamento.ts [--ref <commit>]
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { listarNormas } from "@simplifica-if/kb/normas/estrutura";
import { palavrasMarkdown, primeiraDivergencia } from "@simplifica-if/kb/normas/markdown";
import { sairCom } from "@simplifica-if/kb/principal";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const comando = Command.make(
  "conferir-saneamento",
  {
    ref: Flag.String("ref").pipe(
      Flag.withDescription("commit ou ref git contra o qual comparar o texto das normas"),
      Flag.withDefault("HEAD"),
    ),
  },
  ({ ref }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const existe = yield* Git.tentar(["cat-file", "-e", `${ref}^{commit}`], { cwd: RAIZ_PROJETO });
      if (Option.isNone(existe)) {
        yield* Console.error(`Referência git indisponível: ${ref}`);
        return yield* sairCom(1);
      }
      const normas = listarNormas(RAIZ_PROJETO);
      const divergencias: string[] = [];
      let conferidas = 0;
      for (const norma of normas) {
        const relativo = `base-conhecimento/${norma.path}`;
        const anterior = yield* Git.tentar(["show", `${ref}:${relativo}`], { cwd: RAIZ_PROJETO });
        if (Option.isNone(anterior)) continue;
        conferidas++;
        const depois = yield* fs.readFileString(path.join(RAIZ_PROJETO, relativo));
        const diff = primeiraDivergencia(palavrasMarkdown(anterior.value), palavrasMarkdown(depois));
        if (diff !== null) {
          divergencias.push(`${norma.path}: palavra #${diff.indice} ("${diff.antes}" → "${diff.depois}")`);
        }
      }
      if (divergencias.length > 0) {
        yield* Console.error(`Divergências encontradas contra ${ref}:\n${divergencias.join("\n")}`);
        return yield* sairCom(1);
      }
      yield* Console.log(`Saneamento conferido contra ${ref}: ${conferidas} normas sem alteração textual.`);
    }),
).pipe(Command.withDescription("Confere se as palavras do corpo das normas são idênticas às de uma ref git."));

if (import.meta.main) {
  executarPrincipal("conferir-saneamento", Command.run(comando, { version: "0.1.0" }));
}
