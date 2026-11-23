// @effect-diagnostics nodeBuiltinImport:off -- lê as normas e o commit de referência (git) com node:fs e node:child_process síncronos
/**
 * Prova de que mexer na marcação das normas não muda o texto: removida a marcação Markdown e
 * normalizados os espaços, a sequência de palavras do corpo de cada norma é idêntica à do commit de
 * referência (`REF_DO_TEXTO`). O front matter fica fora da comparação: ele muda de propósito (datas,
 * relações geradas, status calculado, metadados editoriais).
 *
 * Não há norma isenta. Quem corrige o texto de uma norma pela fonte oficial sobe `REF_DO_TEXTO` para
 * o commit da correção; norma nova entra em `INCLUIDAS_DEPOIS` e passa a ser comparada quando a
 * referência subir.
 *
 * Roda num checkout git que tenha o commit de referência. Num clone raso (o CI) é pulado; com o
 * histórico inteiro e sem o commit, falha: a referência ficou velha (`situacaoDaReferencia`).
 */
import * as NodeChildProcess from "node:child_process";
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { listarNormas } from "./estrutura.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { raizRepositorio } from "../caminhos.ts";
import { INCLUIDAS_DEPOIS, REF_DO_TEXTO, situacaoDaReferencia } from "./referencia-saneamento.ts";

const raiz = raizRepositorio();

function versaoAnterior(relativo: string): string | null {
  const resultado = NodeChildProcess.spawnSync("git", ["show", `${REF_DO_TEXTO}:${relativo}`], {
    cwd: raiz,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return resultado.status === 0 ? resultado.stdout : null;
}

const referencia = situacaoDaReferencia(raiz, REF_DO_TEXTO);
const refDisponivel = referencia === "disponivel";

test(`o commit de referência (${REF_DO_TEXTO}) existe quando o histórico está inteiro`, () => {
  expect(referencia, "atualize REF_DO_TEXTO para o commit equivalente").not.toBe("ausente");
});

describe.skipIf(!refDisponivel)(`saneamento: palavras iguais às de ${REF_DO_TEXTO}`, () => {
  const normas = listarNormas(raiz).map((norma) => {
    const relativo = NodePath.posix.join("base-conhecimento", norma.path);
    return { path: norma.path, relativo, antes: versaoAnterior(relativo) };
  });
  test("a norma que não existia na referência está registrada como incluída depois", () => {
    const semRegistro = normas.filter((n) => n.antes === null && !INCLUIDAS_DEPOIS.has(n.path)).map((n) => n.path);
    expect(semRegistro, "registre a norma nova em INCLUIDAS_DEPOIS").toEqual([]);
  });
  test.each(normas.filter((n) => n.antes !== null))("$path", ({ relativo, antes }) => {
    const depois = NodeFS.readFileSync(NodePath.join(raiz, relativo), "utf-8");
    expect(primeiraDivergencia(palavrasMarkdown(antes!), palavrasMarkdown(depois))).toBeNull();
  });
});
