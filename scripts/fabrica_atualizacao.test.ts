// @effect-diagnostics nodeBuiltinImport:off -- teste: um repositório git temporário (local, sem rede)
/**
 * A fábrica compila a partir do commit, não do disco: arquivo não rastreado, ignorado ou modificado
 * fica de fora da árvore extraída (`arvoreDoCommit`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { arvoreDoCommit } from "./fabrica_atualizacao.ts";

const temporarios: string[] = [];
afterEach(() => {
  for (const pasta of temporarios.splice(0)) NodeFS.rmSync(pasta, { recursive: true, force: true });
});

describe("fábrica da atualização", () => {
  it("a árvore sai do commit: sem não rastreados, ignorados e mudanças fora do commit", () => {
    const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-fabrica-"));
    temporarios.push(repo);
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    git("init", "-q");
    for (const pasta of ["base-conhecimento", "dados/institucional", "packages/kb", ".agents/skills"]) {
      NodeFS.mkdirSync(NodePath.join(repo, pasta), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(repo, pasta, "LEIAME"), "x\n");
    }
    NodeFS.writeFileSync(NodePath.join(repo, "base-conhecimento", "norma.md"), "texto do commit\n");
    NodeFS.writeFileSync(NodePath.join(repo, ".gitignore"), "base-conhecimento/ignorado.md\n");
    git("add", ".");
    git("commit", "-q", "-m", "x");
    NodeFS.writeFileSync(NodePath.join(repo, "base-conhecimento", "norma.md"), "editado no disco\n");
    NodeFS.writeFileSync(NodePath.join(repo, "base-conhecimento", "novo.md"), "não rastreado\n");
    NodeFS.writeFileSync(NodePath.join(repo, "base-conhecimento", "ignorado.md"), "ignorado\n");
    const arvore = arvoreDoCommit("HEAD", NodePath.join(repo, "..", `${NodePath.basename(repo)}-arvore`), repo);
    temporarios.push(arvore);
    expect(NodeFS.readdirSync(NodePath.join(arvore, "base-conhecimento"))).toEqual(["LEIAME", "norma.md"]);
    expect(NodeFS.readFileSync(NodePath.join(arvore, "base-conhecimento", "norma.md"), "utf8")).toBe(
      "texto do commit\n",
    );
  });
});
