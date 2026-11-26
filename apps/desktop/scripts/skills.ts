// @effect-diagnostics nodeBuiltinImport:off -- script de build, sem runtime Effect próprio: só roda a leitura das skills
/**
 * As skills que vão dentro do app (`<Resources>/skills`, o `--pasta-skills` do servidor empacotado):
 * as de `catalogo/skills`, todas com o bloco `simplifica:` válido (`@simplifica-if/mcp/skills`, o mesmo
 * Effect Schema do servidor e do `validar_base.ts`) e, de cada uma, só o `SKILL.md` e os arquivos
 * listados em `simplifica.arquivos`. Nada de `scripts/`, `tests/` ou `README.md`. Vai junto a
 * lista de skills retiradas (`retiradas.yaml`), que o servidor lê da mesma pasta.
 *
 * Diferente do servidor, que deixa de fora uma skill inválida e segue, o build falha: uma skill do app
 * quebrada, sem o bloco `simplifica:` ou com campo desconhecido nele (leitura estrita), não pode sair num
 * instalador; nem uma skill que a lista de retiradas tira.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { ARQUIVO_RETIRADAS, lerRetiradas, retiradasAindaNoCatalogo } from "@simplifica-if/atualizacao/retiradas";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";

/** Uma skill que o build copiou: o nome e o `app_minimo` dela (`undefined`: o padrão). */
export interface SkillCopiada {
  readonly nome: string;
  readonly appMinimo: string | undefined;
}

/** Copia as skills do app de `origem` para `destino` (recriada) e devolve as copiadas. */
export async function copiarSkills(origem: string, destino: string): Promise<ReadonlyArray<SkillCopiada>> {
  const pasta = await Effect.runPromise(
    lerPastaSkills(origem, { estrito: true }).pipe(Effect.provide(NodeServices.layer)),
  );
  const erros = [
    ...pasta.invalidas.map((erro) => erro.message),
    ...pasta.foraDoApp.map((nome) => `skill ${nome}: sem o bloco simplifica: no SKILL.md`),
  ];
  const retiradas = NodePath.join(origem, ARQUIVO_RETIRADAS);
  if (NodeFS.existsSync(retiradas)) {
    // `lerRetiradas` lança, com o motivo, no arquivo fora do formato: o build para aqui.
    const aindaNoCatalogo = retiradasAindaNoCatalogo(
      lerRetiradas(NodeFS.readFileSync(retiradas, "utf8")),
      pasta.skills.map((skill) => skill.nome),
    );
    erros.push(...aindaNoCatalogo.map((nome) => `skill ${nome}: está em ${ARQUIVO_RETIRADAS} e continua no catálogo`));
  }
  if (erros.length > 0) {
    throw new Error(`skills do app inválidas:\n${erros.map((erro) => `  ${erro}`).join("\n")}`);
  }
  NodeFS.rmSync(destino, { recursive: true, force: true });
  NodeFS.mkdirSync(destino, { recursive: true });
  if (NodeFS.existsSync(retiradas)) NodeFS.copyFileSync(retiradas, NodePath.join(destino, ARQUIVO_RETIRADAS));
  for (const skill of pasta.skills) {
    const pastaSkill = NodePath.join(destino, skill.nome);
    for (const caminho of ["SKILL.md", ...skill.manifesto.arquivos]) {
      const alvo = NodePath.join(pastaSkill, ...caminho.split("/"));
      NodeFS.mkdirSync(NodePath.dirname(alvo), { recursive: true });
      NodeFS.copyFileSync(NodePath.join(skill.pasta, ...caminho.split("/")), alvo);
    }
  }
  return pasta.skills.map((skill) => ({ nome: skill.nome, appMinimo: skill.manifesto.app_minimo }));
}
