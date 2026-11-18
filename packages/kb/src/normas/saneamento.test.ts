// @effect-diagnostics nodeBuiltinImport:off -- lê as normas e o commit de referência (git) com node:fs e node:child_process síncronos
/**
 * Prova do saneamento das normas (fase 5): removida a marcação Markdown e normalizados os espaços,
 * a sequência de palavras de cada norma é idêntica à do commit anterior ao saneamento
 * (`REF_ANTES_SANEAMENTO`). O front matter fica fora da comparação: ele muda de propósito (datas,
 * relações geradas de `relacoes.yaml`, status calculado).
 *
 * Roda só num checkout git que tenha o commit de referência; noutro caso, é pulado.
 */
import * as NodeChildProcess from "node:child_process";
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { listarNormas } from "./estrutura.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { raizRepositorio } from "../caminhos.ts";
import { INCLUIDAS_DEPOIS, REF_ANTES_SANEAMENTO } from "./referencia-saneamento.ts";

/**
 * Normas cujo texto foi substituído de propósito depois do saneamento (não é mudança de marcação).
 * A comparação de palavras não se aplica a elas.
 */
const TEXTO_SUBSTITUIDO = new Map<string, string>([
  [
    "normas/br/leis/LEI_BR_14945-2024_ensino-medio.md",
    "paráfrase trocada pela transcrição do texto oficial (Planalto) em 13/11/2026",
  ],
]);

const raiz = raizRepositorio();

function versaoAnterior(relativo: string): string | null {
  const resultado = NodeChildProcess.spawnSync("git", ["show", `${REF_ANTES_SANEAMENTO}:${relativo}`], {
    cwd: raiz,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return resultado.status === 0 ? resultado.stdout : null;
}

const refDisponivel =
  NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${REF_ANTES_SANEAMENTO}^{commit}`], {
    cwd: raiz,
    stdio: "ignore",
  }).status === 0;

describe.skipIf(!refDisponivel)(`saneamento: palavras iguais às de ${REF_ANTES_SANEAMENTO}`, () => {
  const todas = listarNormas(raiz);
  const normas = todas.filter((norma) => !INCLUIDAS_DEPOIS.has(norma.path));
  test("as 36 normas existiam antes do saneamento; as incluídas depois existem hoje e não existiam", () => {
    expect(normas.length).toBe(36);
    const caminhos = new Set(todas.map((norma) => norma.path));
    for (const path of INCLUIDAS_DEPOIS.keys()) {
      expect(caminhos.has(path), path).toBe(true);
      expect(versaoAnterior(NodePath.posix.join("base-conhecimento", path)), path).toBeNull();
    }
  });
  test.each(normas.filter((norma) => !TEXTO_SUBSTITUIDO.has(norma.path)))("$path", (norma) => {
    const relativo = NodePath.posix.join("base-conhecimento", norma.path);
    const antes = versaoAnterior(relativo);
    expect(antes).not.toBeNull();
    const depois = NodeFS.readFileSync(NodePath.join(raiz, relativo), "utf-8");
    expect(primeiraDivergencia(palavrasMarkdown(antes!), palavrasMarkdown(depois))).toBeNull();
  });
});
