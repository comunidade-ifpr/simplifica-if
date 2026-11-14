// @effect-diagnostics nodeBuiltinImport:off -- script de geração do ícone, sem runtime Effect
/**
 * Gera o ícone provisório do app (`recursos/icone.png`, 1024 × 1024), sem dependências: um quadrado
 * arredondado branco com uma grade 2 × 2 nas cores do IFPR (o círculo vermelho e três quadrados
 * verdes). O electron-builder tira dele o `.icns` do macOS e o `.ico` do Windows.
 *
 * Provisório: o ícone final, pela identidade visual do IFPR (skill `ifpr-design`), é pendência.
 *
 *   node scripts/gerar-icone.ts
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

const LADO = 1024;
const VERDE = [0x1f, 0x8a, 0x42] as const;
const VERMELHO = [0xc7, 0x2e, 0x2e] as const;
const BRANCO = [0xff, 0xff, 0xff] as const;

type Cor = readonly [number, number, number];

/** A cor do pixel (x, y), ou nada (transparente). */
function pixel(x: number, y: number): { cor: Cor; alfa: number } | undefined {
  // Fundo: quadrado arredondado com margem, como os ícones do macOS.
  const margem = 100;
  const raio = 180;
  const dentro = (px: number, py: number) => {
    const min = margem;
    const max = LADO - margem;
    if (px < min || px >= max || py < min || py >= max) return false;
    const cx = Math.min(Math.max(px, min + raio), max - raio);
    const cy = Math.min(Math.max(py, min + raio), max - raio);
    return (px - cx) ** 2 + (py - cy) ** 2 <= raio ** 2;
  };
  if (!dentro(x, y)) return undefined;
  // Grade 2 × 2 de células de 260 px com 40 px de vão, centrada.
  const celula = 260;
  const vao = 40;
  const inicio = (LADO - (2 * celula + vao)) / 2;
  for (const linha of [0, 1]) {
    for (const coluna of [0, 1]) {
      const x0 = inicio + coluna * (celula + vao);
      const y0 = inicio + linha * (celula + vao);
      if (x < x0 || x >= x0 + celula || y < y0 || y >= y0 + celula) continue;
      if (linha === 0 && coluna === 0) {
        const r = celula / 2;
        return (x - x0 - r) ** 2 + (y - y0 - r) ** 2 <= r ** 2
          ? { cor: VERMELHO, alfa: 255 }
          : { cor: BRANCO, alfa: 255 };
      }
      return { cor: VERDE, alfa: 255 };
    }
  }
  return { cor: BRANCO, alfa: 255 };
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const byte of dados) c = TABELA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

export function gerarPng(): Buffer {
  const linhas = Buffer.alloc(LADO * (1 + LADO * 4));
  for (let y = 0; y < LADO; y++) {
    const base = y * (1 + LADO * 4);
    linhas[base] = 0;
    for (let x = 0; x < LADO; x++) {
      const p = pixel(x, y);
      const i = base + 1 + x * 4;
      if (p === undefined) continue;
      linhas[i] = p.cor[0];
      linhas[i + 1] = p.cor[1];
      linhas[i + 2] = p.cor[2];
      linhas[i + 3] = p.alfa;
    }
  }
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(LADO, 0);
  cabecalho.writeUInt32BE(LADO, 4);
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", NodeZlib.deflateSync(linhas, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

if (import.meta.main) {
  const destino = NodePath.resolve(import.meta.dirname, "..", "recursos", "icone.png");
  NodeFS.writeFileSync(destino, gerarPng());
  process.stderr.write(`ícone provisório em ${destino}\n`);
}
