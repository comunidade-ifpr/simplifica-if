/**
 * Prova do saneamento das normas (fase 5): removida a marcação Markdown e normalizados os espaços,
 * a sequência de palavras de cada norma é idêntica à do commit anterior ao saneamento
 * (`REF_ANTES_SANEAMENTO`). O front matter fica fora da comparação: ele muda de propósito (datas,
 * relações geradas de `relacoes.yaml`, status calculado).
 *
 * Roda só num checkout git que tenha o commit de referência; noutro caso, é pulado.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { listarNormas } from "./estrutura.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { raizRepositorio } from "./registro.ts";

/** Último commit antes do saneamento da fase 5 (merge da fase 4 em `main`). */
export const REF_ANTES_SANEAMENTO = "fcfc006";

const raiz = raizRepositorio();

function versaoAnterior(relativo: string): string | null {
  const resultado = Bun.spawnSync(["git", "show", `${REF_ANTES_SANEAMENTO}:${relativo}`], {
    cwd: raiz,
    stdout: "pipe",
    stderr: "pipe",
  });
  return resultado.exitCode === 0 ? resultado.stdout.toString() : null;
}

const refDisponivel =
  Bun.spawnSync(["git", "cat-file", "-e", `${REF_ANTES_SANEAMENTO}^{commit}`], { cwd: raiz, stderr: "pipe" })
    .exitCode === 0;

describe.skipIf(!refDisponivel)(`saneamento: palavras iguais às de ${REF_ANTES_SANEAMENTO}`, () => {
  const normas = listarNormas(raiz);
  test("as 36 normas existiam antes do saneamento", () => {
    expect(normas.length).toBe(36);
  });
  for (const norma of normas) {
    test(norma.path, () => {
      const relativo = path.posix.join("base-conhecimento", norma.path);
      const antes = versaoAnterior(relativo);
      expect(antes).not.toBeNull();
      const depois = readFileSync(path.join(raiz, relativo), "utf-8");
      expect(primeiraDivergencia(palavrasMarkdown(antes!), palavrasMarkdown(depois))).toBeNull();
    });
  }
});
