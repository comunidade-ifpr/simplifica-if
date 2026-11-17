#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- utilitário de execução única, com a casca de scripts/cli.ts: clona por node:child_process, troca a pasta com node:fs e imprime no console
/**
 * Traz o código de referência do Effect para `.repos/effect`, na tag da versão de `effect` do catalog
 * (`pnpm-workspace.yaml`), como o `sync:repos` do T3 Code (`scripts/sync-reference-repos.ts`), só para o
 * Effect. A pasta é versionada neste repositório e somente leitura: o repositório do Effect inteiro na
 * tag, sem o `.git` dele, com o `LICENSE` (MIT) do Effect. Nunca a edite nem importe dela; rode este
 * script ao subir o `effect` do catalog.
 *
 *   pnpm sync:repos              # clona a tag, substitui .repos/effect e faz o commit só dessa pasta
 *   pnpm sync:repos --dry-run    # só mostra a tag e o comando
 *
 * Clona raso num diretório temporário ao lado do destino e depois troca a pasta inteira: nunca busca o
 * repositório do Effect para dentro deste (as tags e a fronteira rasa dele quebrariam o `git fetch`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse as interpretarYaml } from "yaml";
import { lerArgumentos } from "./cli.ts";
import { RAIZ_PROJETO } from "./config.ts";

const USO = `uso: node scripts/sincronizar_repos.ts [--dry-run]

Traz .repos/effect na tag effect@<versão do catalog de pnpm-workspace.yaml> e faz o commit da pasta.

  --dry-run   mostra a tag e o comando, sem clonar nem fazer commit
  -h, --help  mostra esta ajuda`;

const REPOSITORIO = "https://github.com/Effect-TS/effect.git";
const PREFIXO = ".repos/effect";
const DESTINO = NodePath.join(RAIZ_PROJETO, PREFIXO);

/** Tag do Effect correspondente ao catalog do `pnpm-workspace.yaml`. */
export function tagDoCatalog(textoWorkspace: string): string {
  const workspace = interpretarYaml(textoWorkspace) as { catalog?: Record<string, unknown> } | null;
  const versao = workspace?.catalog?.effect;
  if (typeof versao !== "string" || !versao) throw new Error("pnpm-workspace.yaml sem catalog.effect");
  return `effect@${versao}`;
}

function git(args: string[], cwd: string): string {
  const resultado = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (resultado.status !== 0) {
    throw new Error(`git ${args[0]} falhou (código ${resultado.status}): ${resultado.stderr.trim()}`);
  }
  return resultado.stdout;
}

function main(): number {
  const lido = lerArgumentos(process.argv.slice(2), { "dry-run": { type: "boolean" } }, { uso: USO });
  if ("codigo" in lido) return lido.codigo;
  const tag = tagDoCatalog(NodeFS.readFileSync(NodePath.join(RAIZ_PROJETO, "pnpm-workspace.yaml"), "utf-8"));
  const clonar = ["clone", "--quiet", "--depth=1", "--no-tags", "--single-branch", `--branch=${tag}`, REPOSITORIO];
  if (lido.values["dry-run"]) {
    console.log(`tag: ${tag}\ngit ${clonar.join(" ")} <temporário>\ndestino: ${PREFIXO} (commit só dessa pasta)`);
    return 0;
  }

  // Clona ao lado do destino para a troca ser um rename: mesmo sistema de arquivos, e os symlinks
  // relativos do Effect continuam relativos.
  NodeFS.mkdirSync(NodePath.dirname(DESTINO), { recursive: true });
  const temporario = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(DESTINO), ".sync-effect-"));
  let commit: string;
  try {
    const checkout = NodePath.join(temporario, "checkout");
    git([...clonar, checkout], RAIZ_PROJETO);
    commit = git(["rev-parse", "HEAD"], checkout).trim();
    NodeFS.rmSync(NodePath.join(checkout, ".git"), { recursive: true, force: true });
    if (!NodeFS.existsSync(NodePath.join(checkout, "LICENSE"))) throw new Error(`${tag} sem LICENSE na raiz`);
    NodeFS.rmSync(DESTINO, { recursive: true, force: true });
    NodeFS.renameSync(checkout, DESTINO);
  } finally {
    NodeFS.rmSync(temporario, { recursive: true, force: true });
  }

  // --force: o clone só tem arquivos rastreados na tag, e alguns (o `scratchpad/` do Effect) caem no `.gitignore` dele.
  git(["add", "--all", "--force", "--", PREFIXO], RAIZ_PROJETO);
  if (git(["status", "--porcelain", "--", PREFIXO], RAIZ_PROJETO).trim() === "") {
    console.log(`${PREFIXO} já está em ${tag}.`);
    return 0;
  }
  git(
    [
      "commit",
      "--quiet",
      "--message",
      `repos: ${PREFIXO} em ${tag}\n\nOrigem: ${REPOSITORIO} ${commit}`,
      "--",
      PREFIXO,
    ],
    RAIZ_PROJETO,
  );
  console.log(`commit de ${PREFIXO} em ${tag} (${commit.slice(0, 12)})`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
