/**
 * Rasterização das cenas da marca (`cena.ts`) em PNG, sem dependências: as formas viram polígonos
 * (curvas achatadas a 0,05 px), a cobertura sai por linha de varredura com regra de enrolamento não nulo
 * (cobertura exata na horizontal, 5 amostras por pixel na vertical), as sombras levam um desfoque
 * gaussiano (três caixas) e as camadas se compõem por "source-over" em alfa pré-multiplicado.
 */
import * as NodeZlib from "node:zlib";
import { type Cena, type Forma, lerComandos, type Ponto, type Preenchimento, pontosSuperelipse } from "./cena.ts";

type Contorno = Ponto[];

const TOLERANCIA = 0.05;

function segmentos(desvio: number): number {
  return Math.max(1, Math.min(256, Math.ceil(Math.sqrt(desvio / TOLERANCIA))));
}

/** Os contornos de um `d` absoluto já em pixels (`t` leva da cena ao pixel), com as curvas achatadas. */
function contornosDoCaminho(d: string, t: (p: Ponto) => Ponto): Contorno[] {
  const contornos: Contorno[] = [];
  let atual: Contorno = [];
  let caneta: Ponto = [0, 0];
  let inicio: Ponto = [0, 0];
  const fechar = () => {
    if (atual.length > 2) contornos.push(atual);
    atual = [];
  };
  for (const { letra, valores: v } of lerComandos(d)) {
    switch (letra) {
      case "M":
        fechar();
        caneta = inicio = [v[0]!, v[1]!];
        atual.push(t(caneta));
        break;
      case "L":
        caneta = [v[0]!, v[1]!];
        atual.push(t(caneta));
        break;
      case "H":
        caneta = [v[0]!, caneta[1]];
        atual.push(t(caneta));
        break;
      case "V":
        caneta = [caneta[0], v[0]!];
        atual.push(t(caneta));
        break;
      case "Q": {
        const p0 = t(caneta);
        const p1 = t([v[0]!, v[1]!]);
        const p2 = t([v[2]!, v[3]!]);
        const n = segmentos(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]) / 8);
        for (let k = 1; k <= n; k++) {
          const s = k / n;
          const a = (1 - s) ** 2;
          const b = 2 * (1 - s) * s;
          const c = s * s;
          atual.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
        }
        caneta = [v[2]!, v[3]!];
        break;
      }
      case "C": {
        const p0 = t(caneta);
        const p1 = t([v[0]!, v[1]!]);
        const p2 = t([v[2]!, v[3]!]);
        const p3 = t([v[4]!, v[5]!]);
        const desvio = Math.max(
          Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
          Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
        );
        const n = segmentos((desvio * 3) / 4);
        for (let k = 1; k <= n; k++) {
          const s = k / n;
          const r = 1 - s;
          const a = r ** 3;
          const b = 3 * r * r * s;
          const c = 3 * r * s * s;
          const e = s ** 3;
          atual.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
        }
        caneta = [v[4]!, v[5]!];
        break;
      }
      case "Z":
        fechar();
        caneta = inicio;
        break;
    }
  }
  fechar();
  return contornos;
}

function contornosDaForma(forma: Forma, k: number, desloc: Ponto): Contorno[] {
  const px = (p: Ponto): Ponto => [(p[0] + desloc[0]) * k, (p[1] + desloc[1]) * k];
  switch (forma.tipo) {
    case "caminho": {
      const { escala, origem } = forma;
      return contornosDoCaminho(forma.d, (p) => px([origem[0] + p[0] * escala, origem[1] + p[1] * escala]));
    }
    case "circulo": {
      const r = forma.raio * k;
      const n = Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - TOLERANCIA / Math.max(r, TOLERANCIA)))));
      const contorno: Contorno = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        contorno.push(px([forma.centro[0] + forma.raio * Math.cos(a), forma.centro[1] + forma.raio * Math.sin(a)]));
      }
      return [contorno];
    }
    case "superelipse":
      return [pontosSuperelipse(forma.centro, forma.semilado, forma.expoente, 1440, forma.furo).map(px)];
  }
}

const LINHAS_POR_PIXEL = 5;

/** A fração de cada pixel coberta pelos contornos (enrolamento não nulo). */
export function cobertura(contornos: ReadonlyArray<Contorno>, largura: number, altura: number): Float32Array {
  const cob = new Float32Array(largura * altura);
  // Arestas não horizontais: [y0, y1, x0, inclinação dx/dy, sentido], com y0 < y1.
  const arestas: Array<readonly [number, number, number, number, number]> = [];
  for (const c of contornos) {
    for (let i = 0; i < c.length; i++) {
      const p = c[i]!;
      const q = c[(i + 1) % c.length]!;
      if (p[1] === q[1]) continue;
      const [a, b, sentido] = p[1] < q[1] ? [p, q, 1] : [q, p, -1];
      arestas.push([a[1], b[1], a[0], (b[0] - a[0]) / (b[1] - a[1]), sentido]);
    }
  }
  arestas.sort((m, n) => m[0] - n[0]);
  const peso = 1 / LINHAS_POR_PIXEL;
  const cruzamentos: Array<[number, number]> = [];
  for (let py = 0; py < altura; py++) {
    const linha = py * largura;
    for (let s = 0; s < LINHAS_POR_PIXEL; s++) {
      const y = py + (s + 0.5) * peso;
      cruzamentos.length = 0;
      for (const [y0, y1, x0, inclinacao, sentido] of arestas) {
        if (y0 > y) break;
        if (y < y1) cruzamentos.push([x0 + (y - y0) * inclinacao, sentido]);
      }
      cruzamentos.sort((m, n) => m[0] - n[0]);
      let enrolamento = 0;
      for (let i = 0; i < cruzamentos.length - 1; i++) {
        enrolamento += cruzamentos[i]![1];
        if (enrolamento === 0) continue;
        const xa = Math.max(0, cruzamentos[i]![0]);
        const xb = Math.min(largura, cruzamentos[i + 1]![0]);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          cob[linha + ia]! += (xb - xa) * peso;
          continue;
        }
        cob[linha + ia]! += (ia + 1 - xa) * peso;
        for (let x = ia + 1; x < ib; x++) cob[linha + x]! += peso;
        if (ib < largura) cob[linha + ib]! += (xb - ib) * peso;
      }
    }
  }
  for (let i = 0; i < cob.length; i++) cob[i] = Math.min(1, cob[i]!);
  return cob;
}

/** Desfoque gaussiano aproximado por três caixas (fora da imagem conta como zero). */
export function desfocar(canal: Float32Array, largura: number, altura: number, sigma: number): Float32Array {
  if (sigma < 0.3) return canal;
  // Larguras das caixas para três passadas (Kovesi, "Fast almost-Gaussian filtering").
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let menor = Math.floor(ideal);
  if (menor % 2 === 0) menor--;
  const m = Math.round((12 * sigma * sigma - 3 * menor * menor - 12 * menor - 9) / (-4 * menor - 4));
  let atual = canal;
  for (let passada = 0; passada < 3; passada++) {
    const raio = ((passada < m ? menor : menor + 2) - 1) / 2;
    atual = caixa(caixa(atual, largura, altura, raio, true), largura, altura, raio, false);
  }
  return atual;
}

function caixa(canal: Float32Array, largura: number, altura: number, raio: number, horizontal: boolean): Float32Array {
  const saida = new Float32Array(canal.length);
  const [linhas, comprimento] = horizontal ? [altura, largura] : [largura, altura];
  const indice = (l: number, i: number) => (horizontal ? l * largura + i : i * largura + l);
  const janela = 2 * raio + 1;
  for (let l = 0; l < linhas; l++) {
    let soma = 0;
    for (let i = -raio; i <= raio; i++) if (i >= 0 && i < comprimento) soma += canal[indice(l, i)]!;
    for (let i = 0; i < comprimento; i++) {
      saida[indice(l, i)] = soma / janela;
      const sai = i - raio;
      const entra = i + raio + 1;
      if (sai >= 0) soma -= canal[indice(l, sai)]!;
      if (entra < comprimento) soma += canal[indice(l, entra)]!;
    }
  }
  return saida;
}

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function corNoPonto(p: Preenchimento): (x: number, y: number) => Rgb {
  if (p.tipo === "cor") {
    const c = rgb(p.cor);
    return () => c;
  }
  const [a, b] = [rgb(p.paradas[0]), rgb(p.paradas[1])];
  const mistura = (t: number): Rgb => {
    const s = Math.min(1, Math.max(0, t));
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  };
  if (p.tipo === "linear") {
    const dx = p.ate[0] - p.de[0];
    const dy = p.ate[1] - p.de[1];
    const q = dx * dx + dy * dy;
    return (x, y) => mistura(((x - p.de[0]) * dx + (y - p.de[1]) * dy) / q);
  }
  return (x, y) => mistura(Math.hypot(x - p.centro[0], y - p.centro[1]) / p.raio);
}

/** Pixels RGBA de 8 bits, sem pré-multiplicação, linha a linha. */
export interface Bitmap {
  readonly largura: number;
  readonly altura: number;
  readonly rgba: Uint8Array;
}

/** A cena num quadro de `largura` px de largura (a altura segue a proporção). */
export function rasterizar(cena: Cena, largura: number): Bitmap {
  const k = largura / cena.largura;
  const altura = Math.round(cena.altura * k);
  // RGBA pré-multiplicado.
  const tela = new Float32Array(largura * altura * 4);
  for (const camada of cena.camadas) {
    const desloc = camada.deslocamento ?? [0, 0];
    let cob = cobertura(
      camada.formas.flatMap((f) => contornosDaForma(f, k, desloc)),
      largura,
      altura,
    );
    if (camada.desfoque !== undefined) cob = desfocar(cob, largura, altura, camada.desfoque * k);
    const cor = corNoPonto(camada.preenchimento);
    const opacidade = camada.opacidade ?? 1;
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        const a = cob[y * largura + x]! * opacidade;
        if (a <= 0) continue;
        const [r, g, b] = cor((x + 0.5) / k - desloc[0], (y + 0.5) / k - desloc[1]);
        const i = (y * largura + x) * 4;
        const resto = 1 - a;
        tela[i] = r * a + tela[i]! * resto;
        tela[i + 1] = g * a + tela[i + 1]! * resto;
        tela[i + 2] = b * a + tela[i + 2]! * resto;
        tela[i + 3] = a + tela[i + 3]! * resto;
      }
    }
  }
  const rgba = new Uint8Array(largura * altura * 4);
  for (let i = 0; i < largura * altura; i++) {
    const a = tela[i * 4 + 3]!;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.min(1, tela[i * 4 + c]! / a) * 255);
    rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { largura, altura, rgba };
}

// ---------------------------------------------------------------------------------------------------
// PNG

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

export function png({ largura, altura, rgba }: Bitmap): Buffer {
  const linhas = Buffer.alloc(altura * (1 + largura * 4));
  for (let y = 0; y < altura; y++) {
    // Filtro 0 (nenhum) no primeiro byte da linha.
    linhas.set(rgba.subarray(y * largura * 4, (y + 1) * largura * 4), y * (1 + largura * 4) + 1);
  }
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", NodeZlib.deflateSync(linhas, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}
