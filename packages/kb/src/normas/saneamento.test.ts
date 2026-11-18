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

/** Último commit antes do saneamento da fase 5 (merge da fase 4 em `main`). */
export const REF_ANTES_SANEAMENTO = "fcfc006";

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

/** Normas incluídas na base depois do saneamento: não têm versão anterior a comparar. */
const INCLUIDAS_DEPOIS = new Map<string, string>([
  [
    "normas/br/decretos-lei/DECRETO-LEI_BR_1044-1969_regime-domiciliar.md",
    "incluída em 18/11/2026 do texto oficial (Planalto)",
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
  const normas = listarNormas(raiz).filter((norma) => !INCLUIDAS_DEPOIS.has(norma.path));
  test("as 36 normas existiam antes do saneamento; as incluídas depois, não", () => {
    expect(normas.length).toBe(36);
    for (const path of INCLUIDAS_DEPOIS.keys()) {
      expect(versaoAnterior(NodePath.posix.join("base-conhecimento", path))).toBeNull();
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
