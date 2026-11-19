// @effect-diagnostics nodeBuiltinImport:off -- teste de script sem runtime Effect: lê os arquivos gerados
/**
 * A marca (`scripts/gerar-marca.ts`): os arquivos gravados estão em dia com as cenas, os SVGs não
 * dependem de fonte e os contêineres de ícone têm a estrutura que o macOS e o Windows leem.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { arquivosDaMarca } from "../scripts/gerar-marca.ts";
import { cenaLogo, lerComandos, paraSvg } from "../scripts/marca/cena.ts";
import { icns, ico, rleIcns, TIPOS_ICNS } from "../scripts/marca/pacotes.ts";
import { cobertura, type Bitmap } from "../scripts/marca/raster.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "..", "..", "..");

/** O inverso do RLE do `.icns`, só para o teste. */
function desfazerRle(dados: Buffer, tamanho: number): Uint8Array {
  const saida: number[] = [];
  let i = 0;
  while (saida.length < tamanho) {
    const b = dados[i++]!;
    if (b < 0x80) {
      for (let k = 0; k <= b; k++) saida.push(dados[i++]!);
    } else {
      const v = dados[i++]!;
      for (let k = 0; k < b - 0x80 + 3; k++) saida.push(v);
    }
  }
  return Uint8Array.from(saida);
}

const bitmap = (lado: number): Bitmap => ({ largura: lado, altura: lado, rgba: new Uint8Array(lado * lado * 4) });

describe("marca", () => {
  test("os arquivos gravados são os que as cenas geram (node scripts/gerar-marca.ts)", () => {
    for (const [relativo, gerar] of arquivosDaMarca()) {
      const conteudo = gerar();
      const esperado = typeof conteudo === "string" ? Buffer.from(conteudo, "utf-8") : conteudo;
      expect(NodeFS.readFileSync(NodePath.join(RAIZ, relativo)).equals(esperado), relativo).toBe(true);
    }
  });

  test("os SVGs só têm contornos, sem <text> nem fonte", () => {
    const svg = paraSvg(cenaLogo("claro"));
    expect(svg).not.toMatch(/<text|font-family/);
    expect(svg).toContain("<title>Simplifica IF</title>");
  });

  test("o leitor de caminho desfaz os comandos implícitos depois do M", () => {
    expect(lerComandos("M0 0 10 0V10H0Z")).toEqual([
      { letra: "M", valores: [0, 0] },
      { letra: "L", valores: [10, 0] },
      { letra: "V", valores: [10] },
      { letra: "H", valores: [0] },
      { letra: "Z", valores: [] },
    ]);
  });

  test("a cobertura de um quadrado é exata nas bordas fracionárias", () => {
    const cob = cobertura(
      [
        [
          [0.5, 0],
          [2, 0],
          [2, 2],
          [0.5, 2],
        ],
      ],
      2,
      2,
    );
    expect([...cob].map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 1, 0.5, 1]);
  });

  test("o RLE do .icns volta ao original", () => {
    const canal = Uint8Array.from([1, 2, 3, ...Array(200).fill(7), 4, 4, 5, ...Array(300).fill(0)]);
    expect(desfazerRle(rleIcns(canal), canal.length)).toEqual(canal);
  });

  test(".icns e .ico com as entradas no lugar", () => {
    const lados = [...new Set(TIPOS_ICNS.map(([, lado]) => lado))];
    const mac = icns(lados.map(bitmap));
    expect(mac.toString("ascii", 0, 4)).toBe("icns");
    expect(mac.readUInt32BE(4)).toBe(mac.length);
    const tipos: string[] = [];
    for (let o = 8; o < mac.length; o += mac.readUInt32BE(o + 4)) tipos.push(mac.toString("ascii", o, o + 4));
    expect(tipos).toEqual(TIPOS_ICNS.map(([tipo]) => tipo));

    const win = ico([16, 256].map(bitmap));
    expect(win.readUInt16LE(2)).toBe(1);
    expect(win.readUInt16LE(4)).toBe(2);
    expect([win[6], win[22]]).toEqual([16, 0]); // 256 px é gravado como 0
    const posicao = win.readUInt32LE(6 + 12);
    expect(win.subarray(posicao, posicao + 4).toString("hex")).toBe("89504e47");
  });
});
