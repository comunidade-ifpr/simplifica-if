/**
 * Skills do app entregues pelo motor. O isolamento (`settingSources: []` no Claude, as skills do
 * usuário desligadas no Codex, o perfil próprio do Antigravity) deixa de fora as skills do usuário;
 * as do app chegam igual aos três providers:
 *
 * - **arquivos na pasta de trabalho:** `<pasta>/.simplifica/skills/<nome>/SKILL.md` (front matter
 *   com nome e descrição, e as instruções) e os `arquivos` da skill ao lado;
 * - **instruções da sessão:** uma lista com o nome, a descrição e o caminho do `SKILL.md` de cada
 *   skill, que o driver soma ao system prompt (Claude), ao `developerInstructions` (Codex) ou ao
 *   `systemPrompt.append` do `_meta.antigravity` (ACP).
 *
 * O provider lê o `SKILL.md` quando o pedido combina com a descrição, como nas skills nativas dos
 * três; a leitura dentro da pasta de trabalho passa pela política sem perguntar.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { type ConfigSessao, FalhaProvider, type Skill } from "./Driver.ts";

/** Onde as skills ficam, relativo à pasta de trabalho. */
export const PASTA_SKILLS = ".simplifica/skills";

const NOME_VALIDO = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** O `SKILL.md` da skill, no formato das skills do Claude e do Codex. */
export function skillMd(skill: Skill): string {
  const descricao = skill.descricao.replace(/\s+/g, " ").trim();
  return `---\nname: ${skill.nome}\ndescription: ${JSON.stringify(descricao)}\n---\n\n${skill.instrucoes.trim()}\n`;
}

/** O trecho das instruções da sessão que apresenta as skills, com o caminho absoluto de cada uma. */
export function instrucoesDasSkills(skills: ReadonlyArray<Skill>, pastaSkills: string, separador = "/"): string {
  const linhas = skills.map(
    (skill) =>
      `- \`${skill.nome}\`: ${skill.descricao.replace(/\s+/g, " ").trim()} Instruções: \`${pastaSkills}${separador}${skill.nome}${separador}SKILL.md\``,
  );
  return [
    "## Skills do Simplifica IF",
    "",
    "Estas são as skills disponíveis nesta sessão. Quando o pedido do usuário combinar com a descrição de uma delas, " +
      "leia o SKILL.md indicado antes de responder e siga as instruções dele. Os arquivos que o SKILL.md cita ficam na pasta da skill.",
    "",
    ...linhas,
  ].join("\n");
}

/** As instruções da sessão: as da configuração e, depois, as das skills. */
export function instrucoesSessao(config: ConfigSessao, pastaSkills: string, separador = "/"): string | undefined {
  const partes = [
    config.instrucoes?.trim(),
    config.skills !== undefined && config.skills.length > 0
      ? instrucoesDasSkills(config.skills, pastaSkills, separador)
      : undefined,
  ].filter((parte): parte is string => parte !== undefined && parte !== "");
  return partes.length === 0 ? undefined : partes.join("\n\n");
}

const falha = (provider: string, detalhe: string, cause?: unknown) =>
  new FalhaProvider({ provider, operacao: "skills", detalhe, ...(cause === undefined ? {} : { cause }) });

/**
 * Grava as skills da sessão em `<pasta>/.simplifica/skills` e devolve essa pasta. Recusa nome
 * inválido e arquivo que sairia da pasta da skill. Regrava a cada sessão: a versão do app vale.
 */
export const gravarSkills = Effect.fn("skills.gravar")(function* (config: ConfigSessao) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raiz = path.join(config.pastaTrabalho, ...PASTA_SKILLS.split("/"));
  for (const skill of config.skills ?? []) {
    if (!NOME_VALIDO.test(skill.nome)) {
      return yield* falha(config.provider, `nome de skill inválido: "${skill.nome}"`);
    }
    const pastaSkill = path.join(raiz, skill.nome);
    const arquivos = [{ caminho: "SKILL.md", conteudo: skillMd(skill) }, ...(skill.arquivos ?? [])];
    for (const arquivo of arquivos) {
      const destino = path.resolve(pastaSkill, arquivo.caminho);
      const relativo = path.relative(pastaSkill, destino);
      if (path.isAbsolute(arquivo.caminho) || relativo === "" || relativo.startsWith("..")) {
        return yield* falha(config.provider, `arquivo fora da skill ${skill.nome}: ${arquivo.caminho}`);
      }
      yield* fs.makeDirectory(path.dirname(destino), { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(destino, arquivo.conteudo)),
        Effect.mapError((erro) => falha(config.provider, `não foi possível gravar ${arquivo.caminho}`, erro)),
      );
    }
  }
  return raiz;
});
