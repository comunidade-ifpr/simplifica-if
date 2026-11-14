#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- utilitário de execução única, com a casca de scripts/cli.ts: clona por node:child_process, troca a pasta com node:fs e imprime no console
/**
 * Traz o código de referência do Effect para `.repos/effect`, na tag da versão de `effect` do catalog
 * (`pnpm-workspace.yaml`), como o `sync:repos` do T3 Code. Diferente do T3, a pasta fica fora do git
 * (`.gitignore`) e só com o que os agentes consultam: `packages/effect/src`, `LLMS.md`, `MIGRATION.md`
 * e `ai-docs/`.
 *
 *   pnpm sync:repos              # clona a tag e substitui .repos/effect
 *   pnpm sync:repos --dry-run    # só mostra a tag e o comando
 *
 * Clona raso, com sparse checkout, num diretório temporário ao lado do destino, e depois troca a pasta
 * inteira: nunca busca o repositório do Effect para dentro deste.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse as interpretarYaml } from "yaml";
import { lerArgumentos } from "./cli.ts";
import { RAIZ_PROJETO } from "./config.ts";

const USO = `uso: node scripts/sincronizar_repos.ts [--dry-run]

Traz .repos/effect na tag effect@<versão do catalog de pnpm-workspace.yaml>.

  --dry-run   mostra a tag e o comando, sem clonar
  -h, --help  mostra esta ajuda`;

const REPOSITORIO = "https://github.com/Effect-TS/effect.git";
const DESTINO = NodePath.join(RAIZ_PROJETO, ".repos", "effect");
/** Padrões do sparse checkout (sem cone): o código do pacote `effect` e os guias para agentes. */
export const PADROES = ["/packages/effect/src/", "/LLMS.md", "/MIGRATION.md", "/ai-docs/"];

/** Tag do Effect correspondente ao catalog do `pnpm-workspace.yaml`. */
export function tagDoCatalog(textoWorkspace: string): string {
  const workspace = interpretarYaml(textoWorkspace) as { catalog?: Record<string, unknown> } | null;
  const versao = workspace?.catalog?.effect;
  if (typeof versao !== "string" || !versao) throw new Error("pnpm-workspace.yaml sem catalog.effect");
  return `effect@${versao}`;
}

function git(args: string[], cwd: string): string {
  const resultado = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (resultado.status !== 0) {
    throw new Error(`git ${args[0]} falhou (código ${resultado.status}): ${resultado.stderr.trim()}`);
  }
  return resultado.stdout;
}

function main(): number {
  const lido = lerArgumentos(process.argv.slice(2), { "dry-run": { type: "boolean" } }, { uso: USO });
  if ("codigo" in lido) return lido.codigo;
  const tag = tagDoCatalog(NodeFS.readFileSync(NodePath.join(RAIZ_PROJETO, "pnpm-workspace.yaml"), "utf-8"));
  const clonar = [
    "clone",
    "--quiet",
    "--depth=1",
    "--no-tags",
    "--single-branch",
    "--filter=blob:none",
    "--sparse",
    `--branch=${tag}`,
    REPOSITORIO,
  ];
  if (lido.values["dry-run"]) {
    console.log(`tag: ${tag}\ngit ${clonar.join(" ")} <temporário>\nsparse checkout: ${PADROES.join(" ")}`);
    return 0;
  }

  NodeFS.mkdirSync(NodePath.dirname(DESTINO), { recursive: true });
  const temporario = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(DESTINO), ".sync-effect-"));
  try {
    const checkout = NodePath.join(temporario, "checkout");
    git([...clonar, checkout], RAIZ_PROJETO);
    git(["sparse-checkout", "set", "--no-cone", ...PADROES], checkout);
    const commit = git(["rev-parse", "HEAD"], checkout).trim();
    NodeFS.rmSync(NodePath.join(checkout, ".git"), { recursive: true, force: true });
    NodeFS.writeFileSync(NodePath.join(checkout, "VERSAO"), `${tag}\n${REPOSITORIO} ${commit}\n`);
    NodeFS.rmSync(DESTINO, { recursive: true, force: true });
    NodeFS.renameSync(checkout, DESTINO);
    console.log(`.repos/effect em ${tag} (${commit.slice(0, 12)})`);
  } finally {
    NodeFS.rmSync(temporario, { recursive: true, force: true });
  }
  return 0;
}

if (import.meta.main) process.exitCode = main();
