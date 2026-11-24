/**
 * A redação não vigente (`<!-- redacao-nao-vigente -->`) fica fora dos dispositivos: o leitor do app monta "Copiar citação" com os dispositivos do `kb`, e a
 * citação não pode trazer a redação revogada como se fosse a vigente.
 */
import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import { descendentes, obterDispositivo } from "./estrutura.ts";

const raiz = raizRepositorio();

describe("redação não vigente fora dos dispositivos", () => {
  test("Lei 11.892/2008, art. 1º: o parágrafo único e o inciso IV vigentes, não os anteriores", () => {
    const filhos = descendentes("br/lei/2008/11892#art1", raiz);
    const textos = filhos.map((d) => d.texto);
    expect(textos.filter((t) => t.startsWith("Parágrafo único."))).toEqual([
      expect.stringContaining("incisos I, II e V do caput"),
    ]);
    expect(textos.filter((t) => t.startsWith("IV –"))).toEqual([
      expect.stringContaining("(Redação dada pela Lei nº 12.677"),
    ]);
    expect(obterDispositivo("br/lei/2008/11892#art1-parunico", raiz)?.linha_inicio).toBe(76);
  });
});
