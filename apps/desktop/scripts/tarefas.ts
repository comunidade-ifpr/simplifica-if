// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- script de build, sem runtime Effect próprio: só roda a leitura das tarefas e lê o relógio para recusar a data do commit no futuro
/**
 * Os manifestos de tarefa que vão dentro do app (`<Resources>/tarefas`, o `--pasta-tarefas` do servidor
 * empacotado): os `catalogo/tarefas/*.yaml`, lidos pelo mesmo Effect Schema do servidor e do
 * `validar_base.ts` (`@simplifica-if/mcp/tarefas`).
 *
 * Diferente do servidor, que deixa de fora um manifesto inválido e segue, o build falha: uma tarefa
 * quebrada, que cita skill ou módulo que não vai no instalador, ou de `app_minimo` menor que o da skill
 * que cita (`conferirAppMinimo`, a regra do `validar_base.ts` e da fábrica), não pode sair nele.
 *
 * Junto vai o `origem.json` (`gravarOrigemCatalogo`): o commit de que o catálogo saiu e a data dele. É a
 * ordem do catálogo do instalador contra o baixado pelo canal, que traz a data do commit da fábrica
 * (`data_commit` do manifesto): vence o de commit mais recente (`OrigemCatalogo`, em
 * `@simplifica-if/atualizacao/local`). O build recusa a data que não existe ou que está no futuro
 * (`problemaDataCommit`): ela ganharia de todo catálogo publicado depois. A pasta do checkout
 * (`pnpm app:dev`) não se reconhece pela falta do `origem.json`: o desktop em desenvolvimento a declara
 * (`--tarefas-do-checkout`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { ARQUIVO_ORIGEM_CATALOGO, codificarOrigemCatalogo } from "@simplifica-if/atualizacao/local";
import { problemaDataCommit } from "@simplifica-if/atualizacao/manifesto";
import { conferirAbertura, conferirAppMinimo, lerPastaTarefas } from "@simplifica-if/mcp/tarefas";
import type { SkillCopiada } from "./skills.ts";

/** O commit de que o catálogo sai e a data dele (ISO 8601 com fuso), como o `git show --format=%cI` dá. */
export interface OrigemDoBuild {
  readonly commit: string;
  readonly dataCommit: string;
}

/**
 * O `HEAD` do checkout em `raiz`: o commit curto e a data dele. Lança sem git (o build precisa da
 * origem) e com a data do commit inválida ou no futuro (`agora`: o relógio deste computador). Avisa quando
 * `catalogo/` tem mudança fora do commit: o instalador leva o disco, mas a data é a do commit.
 */
export function origemDoCheckout(raiz: string, agora: number = Date.now()): OrigemDoBuild {
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd: raiz, encoding: "utf8" }).trim();
  const [commit = "", dataCommit = ""] = git("show", "-s", "--format=%h%n%cI", "HEAD").split("\n");
  const problema = problemaDataCommit(dataCommit, agora);
  if (problema !== undefined) throw new Error(`catálogo de tarefas do instalador: ${problema}`);
  if (git("status", "--porcelain", "--", "catalogo").length > 0) {
    process.stderr.write(
      `aviso: catalogo/ tem mudanças fora do commit ${commit}; o catálogo do instalador leva a data do commit\n`,
    );
  }
  return { commit, dataCommit };
}

/** Grava `origem.json` na pasta de tarefas do instalador. */
export function gravarOrigemCatalogo(destino: string, origem: OrigemDoBuild): void {
  NodeFS.writeFileSync(
    NodePath.join(destino, ARQUIVO_ORIGEM_CATALOGO),
    `${codificarOrigemCatalogo({ commit: origem.commit, data_commit: origem.dataCommit })}\n`,
  );
}

/**
 * Copia os manifestos de `origem` para `destino` (recriada) e devolve os ids copiados. `skills`: as
 * skills que o build copiou para o app (`copiarSkills`), com o `app_minimo` de cada uma.
 */
export async function copiarTarefas(
  origem: string,
  destino: string,
  skills: ReadonlyArray<SkillCopiada>,
): Promise<ReadonlyArray<string>> {
  const pasta = await Effect.runPromise(
    lerPastaTarefas(origem, { estrito: true }).pipe(Effect.provide(NodeServices.layer)),
  );
  const erros = pasta.invalidas.map((erro) => erro.message);
  const appMinimos = new Map(skills.map((skill) => [skill.nome, skill.appMinimo] as const));
  for (const tarefa of pasta.tarefas) {
    const { ausente } = conferirAbertura(tarefa, appMinimos);
    if (ausente !== undefined) {
      erros.push(
        ausente.tipo === "modulo"
          ? `tarefa ${tarefa.id}: o módulo "${ausente.nome}" não existe no app`
          : `tarefa ${tarefa.id}: a skill "${ausente.nome}" não é skill do app`,
      );
      continue;
    }
    const appMinimo = conferirAppMinimo(tarefa, (nome) => appMinimos.get(nome));
    if (appMinimo !== undefined) erros.push(appMinimo);
  }
  if (erros.length > 0) throw new Error(`tarefas inválidas:\n${erros.map((erro) => `  ${erro}`).join("\n")}`);
  NodeFS.rmSync(destino, { recursive: true, force: true });
  NodeFS.mkdirSync(destino, { recursive: true });
  for (const tarefa of pasta.tarefas) {
    const arquivo = `${tarefa.id}.yaml`;
    NodeFS.copyFileSync(NodePath.join(origem, arquivo), NodePath.join(destino, arquivo));
  }
  return pasta.tarefas.map((tarefa) => tarefa.id);
}
