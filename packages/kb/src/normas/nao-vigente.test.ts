// @effect-diagnostics nodeBuiltinImport:off -- lê o arquivo da norma com node:fs síncrono, para achar as linhas dos marcadores
/**
 * A redação não vigente (`<!-- redacao-nao-vigente -->`) e o texto fora do ato (`<!-- fora-do-ato -->`)
 * ficam fora dos dispositivos: o leitor do app monta "Copiar citação" com os dispositivos do `kb`, e a
 * citação não pode trazer a redação revogada como se fosse a vigente.
 */
import * as NodeFS from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import { descendentes, dispositivosDoAto, listarNormas, obterDispositivo } from "./estrutura.ts";

const raiz = raizRepositorio();

describe("redação não vigente fora dos dispositivos", () => {
  test("Lei 11.892/2008, art. 1º: o parágrafo único e o inciso IV vigentes, não os anteriores", () => {
    const filhos = descendentes("br/lei/2008/11892#art1", raiz);
    const textos = filhos.map((d) => d.texto);
    expect(textos.filter((t) => t.startsWith("Parágrafo único."))).toEqual([
      expect.stringContaining("incisos I, II, III e V do caput"),
    ]);
    expect(textos.filter((t) => t.startsWith("IV –"))).toEqual([
      expect.stringContaining("(Redação dada pela Lei nº 12.677"),
    ]);
    expect(obterDispositivo("br/lei/2008/11892#art1-parunico", raiz)?.linha_inicio).toBe(70);
  });

  test("Res. CONSUP/IFPR 50/2017: o art. 2º fora do ato publicado não é dispositivo", () => {
    // as linhas do bloco vêm dos marcadores: a marcação do resto do arquivo pode mudar sem quebrar o teste
    const norma = listarNormas(raiz).find((n) => n.id === "ifpr/consup/res/2017/50")!;
    const linhas = NodeFS.readFileSync(norma.arquivo, "utf-8").split("\n");
    const abre = linhas.findIndex((linha) => linha.startsWith("<!-- fora-do-ato")) + 1;
    const fecha = linhas.findIndex((linha) => linha.startsWith("<!-- /fora-do-ato")) + 1;
    expect(abre).toBeGreaterThan(0);
    expect(fecha).toBeGreaterThan(abre);
    expect(linhas.slice(abre, fecha - 1).join("\n")).toContain("#### Art. 2º");
    const fora = dispositivosDoAto("ifpr/consup/res/2017/50", raiz).filter(
      (d) => d.linha_inicio >= abre && d.linha_inicio <= fecha,
    );
    expect(fora).toEqual([]);
  });
});
