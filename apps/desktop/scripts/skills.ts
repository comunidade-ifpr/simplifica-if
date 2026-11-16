// @effect-diagnostics nodeBuiltinImport:off -- script de build, sem runtime Effect próprio: só roda a leitura das skills
/**
 * As skills que vão dentro do app (`<Resources>/skills`, o `--pasta-skills` do servidor empacotado):
 * só as do `.agents/skills` com bloco `simplifica:` válido (`@simplifica-if/mcp/skills`, o mesmo
 * Effect Schema do servidor e do `validar_base.ts`) e, de cada uma, só o `SKILL.md` e os arquivos
 * listados em `simplifica.arquivos`. Nada de `scripts/`, `tests/`, `agents/` ou `README.md`.
 *
 * Diferente do servidor, que deixa de fora uma skill inválida e segue, o build falha: uma skill do app
 * quebrada não pode sair num instalador.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";

/** Copia as skills do app de `origem` para `destino` (recriada) e devolve os nomes copiados. */
export async function copiarSkills(origem: string, destino: string): Promise<ReadonlyArray<string>> {
  const pasta = await Effect.runPromise(lerPastaSkills(origem).pipe(Effect.provide(NodeServices.layer)));
  if (pasta.invalidas.length > 0) {
    throw new Error(`skills do app inválidas:\n${pasta.invalidas.map((erro) => `  ${erro.message}`).join("\n")}`);
  }
  NodeFS.rmSync(destino, { recursive: true, force: true });
  NodeFS.mkdirSync(destino, { recursive: true });
  for (const skill of pasta.skills) {
    const pastaSkill = NodePath.join(destino, skill.nome);
    for (const caminho of ["SKILL.md", ...skill.manifesto.arquivos]) {
      const alvo = NodePath.join(pastaSkill, ...caminho.split("/"));
      NodeFS.mkdirSync(NodePath.dirname(alvo), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(skill.pasta, ...caminho.split("/")), alvo);
    }
  }
  return pasta.skills.map((skill) => skill.nome);
}
