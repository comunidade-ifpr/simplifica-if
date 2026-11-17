/**
 * A redação não vigente (`<!-- redacao-nao-vigente -->`) e o texto fora do ato (`<!-- fora-do-ato -->`)
 * ficam fora dos dispositivos: o leitor do app monta "Copiar citação" com os dispositivos do `kb`, e a
 * citação não pode trazer a redação revogada como se fosse a vigente.
 */
import { describe, expect, test } from "vite-plus/test";
import { descendentes, dispositivosDoAto, obterDispositivo } from "./estrutura.ts";

describe("redação não vigente fora dos dispositivos", () => {
  test("Lei 11.892/2008, art. 1º: o parágrafo único e o inciso IV vigentes, não os anteriores", () => {
    const filhos = descendentes("br/lei/2008/11892#art1");
    const textos = filhos.map((d) => d.texto);
    expect(textos.filter((t) => t.startsWith("Parágrafo único."))).toEqual([
      expect.stringContaining("incisos I, II, III e V do caput"),
    ]);
    expect(textos.filter((t) => t.startsWith("IV –"))).toEqual([
      expect.stringContaining("(Redação dada pela Lei nº 12.677"),
    ]);
    expect(obterDispositivo("br/lei/2008/11892#art1-parunico")?.linha_inicio).toBe(70);
  });

  test("Res. CONSUP/IFPR 50/2017: o art. 2º fora do ato publicado não é dispositivo", () => {
    const fora = dispositivosDoAto("ifpr/consup/res/2017/50").filter(
      (d) => d.linha_inicio >= 288 && d.linha_inicio <= 294,
    );
    expect(fora).toEqual([]);
  });
});
