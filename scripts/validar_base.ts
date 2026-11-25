#!/usr/bin/env node
/**
 * Valida a base pública de conhecimento, os registros institucionais, a base da revisão de PPC
 * (`revisao-ppc/`: fichas, tópicos e marcos) e o bloco `simplifica:` das skills do app: o Effect Schema `ManifestoSkill` de
 * `@simplifica-if/mcp/skills`, com as ferramentas conferidas contra o Toolkit do `simplifica-mcp`, e os
 * arquivos de `simplifica.arquivos`. Skill sem o bloco não é do app e não é conferida.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";
import { criarCaminhos } from "./base/caminhos.ts";
import { validarBase } from "./base/validacao.ts";
import { validarDadosInstitucionais } from "./dados/validacao.ts";
import { validarRevisaoPpc } from "./base/revisao-ppc/validacao.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

/** As skills do app válidas e os erros das inválidas, em `<raiz>/.agents/skills`. */
const validarSkillsDoApp = Effect.fn("validar_base.skills")(function* (raizProjeto: string) {
  const path = yield* Path.Path;
  return yield* lerPastaSkills(path.join(raizProjeto, ".agents", "skills")).pipe(
    Effect.map((pasta) => ({
      erros: pasta.invalidas.map((erro) => erro.message),
      doApp: pasta.skills.map((skill) => skill.nome),
    })),
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed({ erros: [`skills: não foi possível ler .agents/skills (${erro.message})`], doApp: [] }),
    }),
  );
});

export const comando = Command.make(
  "validar_base",
  {},
  Effect.fn("validar_base")(function* () {
    const caminhos = criarCaminhos();
    const { erros, totalNormas, dadosInstitucionais } = yield* Effect.sync(() => validarBase(caminhos));
    const dados = yield* Effect.sync(() =>
      validarDadosInstitucionais(undefined, undefined, { carregados: dadosInstitucionais }),
    );
    erros.push(...dados.erros);
    erros.push(...(yield* Effect.sync(() => validarRevisaoPpc())).map((erro) => `revisão de PPC: ${erro}`));
    const skills = yield* validarSkillsDoApp(caminhos.raizProjeto);
    erros.push(...skills.erros);
    if (erros.length) {
      for (const erro of erros) yield* Console.error(`ERRO: ${erro}`);
      return yield* sairCom(1);
    }
    yield* Console.log(
      `Base válida: ${totalNormas} normas publicadas, metadados institucionais e catálogos conferidos; ` +
        `${dados.total} registros institucionais; base da revisão de PPC conferida; ` +
        `${skills.doApp.length} skills do app (${skills.doApp.join(", ")}).`,
    );
  }),
).pipe(
  Command.withDescription(
    "Valida a base pública de conhecimento, os registros institucionais (institucional/ifpr/: campi, cursos, " +
      "ingresso, processos SEI), a base da revisão de PPC (revisao-ppc/: fichas, tópicos e marcos) " +
      "e o bloco simplifica: das skills do app (.agents/skills/*/SKILL.md).",
  ),
);

if (import.meta.main) {
  executarPrincipal("validar_base", Command.run(comando, { version: "1.0.0" }));
}
