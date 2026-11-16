/**
 * Validação das skills do app: o bloco `simplifica:` do front matter de cada `.agents/skills/*\/SKILL.md`
 * (o Effect Schema `ManifestoSkill` de `@simplifica-if/mcp/skills`, com as ferramentas conferidas contra
 * o Toolkit do `simplifica-mcp`) e os arquivos listados em `simplifica.arquivos`, que precisam existir.
 * Skill sem o bloco não é do app e não é conferida aqui.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";
import { RAIZ_PROJETO } from "../config.ts";

export interface ResultadoSkills {
  readonly erros: Array<string>;
  /** As skills do app válidas. */
  readonly doApp: ReadonlyArray<string>;
}

const validar = Effect.fn("skills.validarSkillsDoApp")(function* (raizProjeto: string) {
  const path = yield* Path.Path;
  const pasta = yield* lerPastaSkills(path.join(raizProjeto, ".agents", "skills"));
  return {
    erros: pasta.invalidas.map((erro) => erro.message),
    doApp: pasta.skills.map((skill) => skill.nome),
  };
});

/** Confere as skills de `<raiz>/.agents/skills`. */
export function validarSkillsDoApp(raizProjeto: string = RAIZ_PROJETO): Promise<ResultadoSkills> {
  return validar(raizProjeto).pipe(
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed({ erros: [`skills: não foi possível ler .agents/skills (${erro.message})`], doApp: [] }),
    }),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );
}
