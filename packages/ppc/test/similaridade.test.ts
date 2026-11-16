// @effect-diagnostics nodeBuiltinImport:off -- o teste lê o gabarito de escores de um arquivo
/**
 * `partialRatio` contra o `rapidfuzz`: os escores de `fixtures/partial-ratio-rapidfuzz.json` foram
 * gerados por ele (`scripts/dev/diferencial-docx.ts --gravar-gabaritos`) e têm de ser reproduzidos
 * bit a bit, porque o ementário compara o escore com um limiar.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { partialRatio } from "../src/conversao-docx/similaridade.ts";

const GABARITO = JSON.parse(
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "fixtures", "partial-ratio-rapidfuzz.json"), "utf-8"),
) as Array<[string, string, number]>;

describe("partialRatio", () => {
  test("reproduz os escores do rapidfuzz", () => {
    expect(GABARITO.length).toBeGreaterThan(500);
    const divergentes = GABARITO.filter(([a, b, esperado]) => partialRatio(a, b) !== esperado).map(
      ([a, b, esperado]) => ({ a, b, esperado, obtido: partialRatio(a, b) }),
    );
    expect(divergentes).toEqual([]);
  });

  test("é simétrico e compara por code point", () => {
    expect(partialRatio("são paulo", "em sao paulo: atlas")).toBe(partialRatio("em sao paulo: atlas", "são paulo"));
    // Um emoji é um caractere só: a agulha inteira está no texto.
    expect(partialRatio("a😀b", "xxa😀bxx")).toBe(100);
  });

  test("textos vazios", () => {
    expect(partialRatio("", "")).toBe(100);
    expect(partialRatio("", "abc")).toBe(0);
  });

  test("agulha com mais de 32 caracteres usa o cálculo clássico, com o mesmo resultado", () => {
    const agulha = "componente curricular de matemática aplicada";
    expect(partialRatio(agulha, `xx ${agulha} yy`)).toBe(100);
    expect(partialRatio(agulha, agulha.replace("matemática", "matematica"))).toBeCloseTo(97.72727272727273, 12);
  });
});
