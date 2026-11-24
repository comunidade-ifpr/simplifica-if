// @effect-diagnostics nodeBuiltinImport:off -- lê as normas e o commit de referência (git) com node:fs e node:child_process síncronos
/**
 * Prova de que mexer na marcação das normas não muda o texto: removida a marcação Markdown e
 * normalizados os espaços, a sequência de palavras do corpo de cada norma é idêntica à do commit de
 * referência (`REF_DO_TEXTO`). O front matter fica fora da comparação: ele muda de propósito (datas,
 * relações geradas, status calculado, metadados editoriais).
 *
 * Não há norma isenta. Quem corrige o texto de uma norma pela fonte oficial sobe `REF_DO_TEXTO` para
 * o commit da correção; norma que não existia na referência passa a ser comparada quando ela subir.
 *
 * Roda num checkout git que tenha o commit de referência. Num clone raso (o CI) é pulado; com o
 * histórico inteiro e sem o commit, falha: a referência ficou velha (uma reescrita do histórico troca
 * os SHAs) e precisa apontar para o commit equivalente.
 */
import * as NodeChildProcess from "node:child_process";
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { listarNormas } from "./estrutura.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { raizRepositorio } from "../caminhos.ts";

/** O commit em que o corpo de cada norma foi conferido com a fonte oficial pela última vez. */
const REF_DO_TEXTO = "f6ecfaec";

const raiz = raizRepositorio();

const git = (argumentos: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync("git", argumentos, {
    cwd: raiz,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

function situacaoDaReferencia(): "disponivel" | "clone-raso" | "ausente" {
  if (git(["cat-file", "-e", `${REF_DO_TEXTO}^{commit}`]).status === 0) return "disponivel";
  const raso = git(["rev-parse", "--is-shallow-repository"]);
  return raso.status === 0 && raso.stdout.trim() === "false" ? "ausente" : "clone-raso";
}

const referencia = situacaoDaReferencia();

test(`o commit de referência (${REF_DO_TEXTO}) existe quando o histórico está inteiro`, () => {
  expect(referencia, "atualize REF_DO_TEXTO para o commit equivalente").not.toBe("ausente");
});

describe.skipIf(referencia !== "disponivel")(`saneamento: palavras iguais às de ${REF_DO_TEXTO}`, () => {
  const normas = listarNormas(raiz).flatMap((norma) => {
    const relativo = NodePath.posix.join("base-conhecimento", norma.path);
    const anterior = git(["show", `${REF_DO_TEXTO}:${relativo}`]);
    return anterior.status === 0 ? [{ path: norma.path, relativo, antes: anterior.stdout }] : [];
  });
  test.each(normas)("$path", ({ relativo, antes }) => {
    const depois = NodeFS.readFileSync(NodePath.join(raiz, relativo), "utf-8");
    expect(primeiraDivergencia(palavrasMarkdown(antes), palavrasMarkdown(depois))).toBeNull();
  });
});
