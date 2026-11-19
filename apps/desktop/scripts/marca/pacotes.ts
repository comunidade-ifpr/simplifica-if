/**
 * Os contêineres de ícone que o electron-builder recebe prontos: `.icns` (macOS) e `.ico` (Windows), um
 * desenho por tamanho. Montados aqui, e não pelo electron-builder a partir de um PNG só, para que os
 * tamanhos pequenos levem o desenho `plano` e não o `relevo` reduzido.
 */
import { type Bitmap, png } from "./raster.ts";

/**
 * Os tipos do `.icns`, como o `iconutil` da Apple os grava: 16 e 32 px em ARGB compactado (`ic04`,
 * `ic05`; o macOS não lê PNG nesses dois) e o resto em PNG. Os @2x repetem o lado de outro tipo.
 */
export const TIPOS_ICNS: ReadonlyArray<readonly [tipo: string, lado: number, formato: "argb" | "png"]> = [
  ["ic04", 16, "argb"],
  ["ic05", 32, "argb"],
  ["ic11", 32, "png"], // 16 @2x
  ["ic12", 64, "png"], // 32 @2x
  ["ic07", 128, "png"],
  ["ic08", 256, "png"],
  ["ic13", 256, "png"], // 128 @2x
  ["ic09", 512, "png"],
  ["ic14", 512, "png"], // 256 @2x
  ["ic10", 1024, "png"], // 512 @2x
];

/** Um canal no RLE do `.icns`: byte < 0x80 copia os n + 1 seguintes; ≥ 0x80 repete o seguinte n - 0x80 + 3 vezes. */
export function rleIcns(canal: Uint8Array): Buffer {
  const saida: number[] = [];
  let i = 0;
  while (i < canal.length) {
    let repeticao = 1;
    while (i + repeticao < canal.length && repeticao < 130 && canal[i + repeticao] === canal[i]) repeticao++;
    if (repeticao >= 3) {
      saida.push(0x80 + repeticao - 3, canal[i]!);
      i += repeticao;
      continue;
    }
    // Literal até a próxima repetição de 3 ou mais (no máximo 128 bytes).
    const inicio = i;
    while (
      i < canal.length &&
      i - inicio < 128 &&
      !(i + 2 < canal.length && canal[i] === canal[i + 1] && canal[i] === canal[i + 2])
    ) {
      i++;
    }
    saida.push(i - inicio - 1, ...canal.subarray(inicio, i));
  }
  return Buffer.from(saida);
}

function argb({ largura, altura, rgba }: Bitmap): Buffer {
  const n = largura * altura;
  const canais = [3, 0, 1, 2].map((c) => {
    const canal = new Uint8Array(n);
    for (let i = 0; i < n; i++) canal[i] = rgba[i * 4 + c]!;
    return rleIcns(canal);
  });
  return Buffer.concat([Buffer.from("ARGB", "ascii"), ...canais]);
}

export function icns(bitmaps: ReadonlyArray<Bitmap>): Buffer {
  const porLado = new Map(bitmaps.map((b) => [b.largura, b]));
  const blocos = TIPOS_ICNS.map(([tipo, lado, formato]) => {
    const bitmap = porLado.get(lado);
    if (bitmap === undefined) throw new Error(`falta a imagem de ${lado} px para o tipo ${tipo} do .icns`);
    const dados = formato === "png" ? png(bitmap) : argb(bitmap);
    const cabecalho = Buffer.alloc(8);
    cabecalho.write(tipo, 0, "ascii");
    cabecalho.writeUInt32BE(8 + dados.length, 4);
    return Buffer.concat([cabecalho, dados]);
  });
  const corpo = Buffer.concat(blocos);
  const cabecalho = Buffer.alloc(8);
  cabecalho.write("icns", 0, "ascii");
  cabecalho.writeUInt32BE(8 + corpo.length, 4);
  return Buffer.concat([cabecalho, corpo]);
}

/** `.ico` com PNG dentro (aceito desde o Windows Vista), na ordem das imagens. */
export function ico(bitmaps: ReadonlyArray<Bitmap>): Buffer {
  const pngs = bitmaps.map(png);
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2); // ícone
  cabecalho.writeUInt16LE(bitmaps.length, 4);
  const entradas: Buffer[] = [];
  let posicao = 6 + 16 * bitmaps.length;
  bitmaps.forEach(({ largura }, i) => {
    if (largura > 256) throw new Error(`o .ico vai até 256 px, não ${largura}`);
    const e = Buffer.alloc(16);
    e.writeUInt8(largura === 256 ? 0 : largura, 0);
    e.writeUInt8(largura === 256 ? 0 : largura, 1);
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(pngs[i]!.length, 8);
    e.writeUInt32LE(posicao, 12);
    posicao += pngs[i]!.length;
    entradas.push(e);
  });
  return Buffer.concat([cabecalho, ...entradas, ...pngs]);
}
