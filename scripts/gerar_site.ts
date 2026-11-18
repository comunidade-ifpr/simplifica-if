#!/usr/bin/env node
/** Gera a saída publicável em site/ a partir de base-conhecimento/. */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { criarCaminhos } from "./base/caminhos.ts";
import { compararDiretorios, renderizarSite } from "./base/site.ts";
import { executarPrincipal, sairCom } from "./principal.ts";

/** Diferenças entre site/ e o que a base gera, renderizada numa pasta temporária. */
const verificarSite = Effect.fn("gerar_site.verificar")(function* (raizBase: string, site: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(site))) return ["site/ não existe; gere com node scripts/gerar_site.ts"];
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const esperado = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "gerar-site-" }), "site");
      return yield* Effect.sync(() => {
        renderizarSite(raizBase, esperado);
        return compararDiretorios(esperado, site);
      });
    }),
  );
});

export const comando = Command.make(
  "gerar_site",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("verifica se site/ está atualizado, sem gravar"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("gerar_site")(function* ({ check }) {
    const path = yield* Path.Path;
    const caminhos = criarCaminhos();
    const nomeBase = path.basename(caminhos.raiz);
    if (check) {
      const erros = yield* verificarSite(caminhos.raiz, caminhos.site);
      if (erros.length) {
        for (const erro of erros) yield* Console.error(`ERRO: ${erro}`);
        return yield* sairCom(1);
      }
      yield* Console.log(`site/ atualizado a partir de ${nomeBase}/.`);
      return;
    }
    yield* Effect.sync(() => renderizarSite(caminhos.raiz, caminhos.site));
    yield* Console.log(`site/ gerado a partir de ${nomeBase}/.`);
  }),
).pipe(Command.withDescription("Gera a saída publicável em site/ a partir de base-conhecimento/."));

if (import.meta.main) {
  executarPrincipal("gerar_site", Command.run(comando, { version: "1.0.0" }));
}
