/**
 * Tabelas de uma página pelas bordas desenhadas (`tabelasDaPagina`): os traços horizontais e
 * verticais que se cruzam formam a grade, e cada item de texto cai na célula do seu centro.
 *
 * 1. Os traços quase colineares (até 1,5 pt) e que se tocam viram um só.
 * 2. Os traços que se cruzam formam um grupo; o grupo com 2 ou mais horizontais e 2 ou mais
 *    verticais, e mais de uma célula, é uma tabela.
 * 3. As linhas da grade são os y dos horizontais e as colunas, os x dos verticais. A célula mesclada
 *    não tem borda no meio: o texto dela cai numa das células que ela cobre, e as outras ficam vazias,
 *    como o conversor antigo fazia.
 * 4. Linha e coluna sem texto saem.
 *
 * Tabela sem borda (colunas só por alinhamento) não é reconhecida: o texto dela sai linha a linha.
 */
import type { SegmentoHorizontal, SegmentoVertical, Segmentos } from "./geometria.ts";

const TOLERANCIA = 1.5;
const TOQUE = 2.5;
/** Bordas mais próximas que isso são a mesma (borda dupla, ou retângulo fino desenhado como borda). */
const AGRUPAMENTO = 4;

export interface ItemPosicionado {
  /** Índice do item na página, para quem chama tirá-lo do texto corrido. */
  readonly indice: number;
  readonly texto: string;
  readonly x: number;
  /** Linha de base. */
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
  readonly negrito: boolean;
}

export interface Tabela {
  readonly topo: number;
  readonly base: number;
  readonly esquerda: number;
  readonly direita: number;
  /** As células, linha a linha; a primeira linha é o cabeçalho. */
  readonly linhas: string[][];
  /** Índices dos itens de texto que caíram na tabela. */
  readonly itens: ReadonlySet<number>;
}

function juntarHorizontais(segmentos: SegmentoHorizontal[]): SegmentoHorizontal[] {
  const ordenados = segmentos.toSorted((a, b) => a.y - b.y || a.x0 - b.x0);
  const saida: SegmentoHorizontal[] = [];
  for (const s of ordenados) {
    const igual = saida.find((t) => Math.abs(t.y - s.y) <= TOLERANCIA && s.x0 <= t.x1 + TOQUE && s.x1 >= t.x0 - TOQUE);
    if (igual) {
      const i = saida.indexOf(igual);
      saida[i] = { y: (igual.y + s.y) / 2, x0: Math.min(igual.x0, s.x0), x1: Math.max(igual.x1, s.x1) };
    } else saida.push(s);
  }
  return saida;
}

function juntarVerticais(segmentos: SegmentoVertical[]): SegmentoVertical[] {
  const ordenados = segmentos.toSorted((a, b) => a.x - b.x || a.y0 - b.y0);
  const saida: SegmentoVertical[] = [];
  for (const s of ordenados) {
    const igual = saida.find((t) => Math.abs(t.x - s.x) <= TOLERANCIA && s.y0 <= t.y1 + TOQUE && s.y1 >= t.y0 - TOQUE);
    if (igual) {
      const i = saida.indexOf(igual);
      saida[i] = { x: (igual.x + s.x) / 2, y0: Math.min(igual.y0, s.y0), y1: Math.max(igual.y1, s.y1) };
    } else saida.push(s);
  }
  return saida;
}

const cruzam = (h: SegmentoHorizontal, v: SegmentoVertical) =>
  v.x >= h.x0 - TOQUE && v.x <= h.x1 + TOQUE && h.y >= v.y0 - TOQUE && h.y <= v.y1 + TOQUE;

/** Os valores ordenados, com os próximos (até `TOLERANCIA`) reunidos na média. */
function agrupar(valores: number[]): number[] {
  const ordenados = valores.toSorted((a, b) => a - b);
  const grupos: number[][] = [];
  for (const v of ordenados) {
    const ultimo = grupos.at(-1);
    if (ultimo && v - ultimo.at(-1)! <= AGRUPAMENTO) ultimo.push(v);
    else grupos.push([v]);
  }
  return grupos.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Índice do intervalo de `limites` (ordenados) em que `v` cai, ou -1. */
function intervalo(limites: number[], v: number): number {
  for (let i = 0; i + 1 < limites.length; i += 1) if (v >= limites[i]! && v <= limites[i + 1]!) return i;
  return -1;
}

const HIFEN_PARTIDO = /\p{Ll}-$/u;
const COMECA_MINUSCULA = /^\p{Ll}/u;

/** O texto de uma célula: os itens em linhas (de cima para baixo), as linhas juntas com espaço. */
function textoDaCelula(itens: ItemPosicionado[]): string {
  const ordenados = itens.toSorted((a, b) => b.y - a.y || a.x - b.x);
  const linhas: { y: number; altura: number; partes: ItemPosicionado[] }[] = [];
  for (const item of ordenados) {
    const linha = linhas.find((l) => Math.abs(l.y - item.y) <= Math.max(l.altura, item.altura) / 2);
    if (linha) linha.partes.push(item);
    else linhas.push({ y: item.y, altura: item.altura, partes: [item] });
  }
  let texto = "";
  for (const linha of linhas) {
    const partes = linha.partes.toSorted((a, b) => a.x - b.x);
    let textoLinha = "";
    let fim = -Infinity;
    for (const parte of partes) {
      const separa = textoLinha && parte.x - fim > parte.altura * 0.15 && !/\s$/u.test(textoLinha);
      textoLinha += (separa ? " " : "") + parte.texto;
      fim = parte.x + parte.largura;
    }
    textoLinha = textoLinha.replace(/\s+/gu, " ").trim();
    if (!textoLinha) continue;
    if (!texto) texto = textoLinha;
    else if (HIFEN_PARTIDO.test(texto) && COMECA_MINUSCULA.test(textoLinha)) texto = texto.slice(0, -1) + textoLinha;
    else texto += ` ${textoLinha}`;
  }
  return texto;
}

export function tabelasDaPagina(segmentos: Segmentos, itens: ReadonlyArray<ItemPosicionado>): Tabela[] {
  const horizontais = juntarHorizontais(segmentos.horizontais);
  const verticais = juntarVerticais(segmentos.verticais);

  // Grupos de traços que se cruzam (união e busca sobre horizontais e verticais).
  const pai = Array.from({ length: horizontais.length + verticais.length }, (_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i]!)));
  horizontais.forEach((h, i) =>
    verticais.forEach((v, j) => {
      if (cruzam(h, v)) pai[raiz(i)] = raiz(horizontais.length + j);
    }),
  );
  const grupos = new Map<number, { hs: SegmentoHorizontal[]; vs: SegmentoVertical[] }>();
  horizontais.forEach((h, i) => {
    const g = grupos.get(raiz(i)) ?? { hs: [], vs: [] };
    g.hs.push(h);
    grupos.set(raiz(i), g);
  });
  verticais.forEach((v, j) => {
    const g = grupos.get(raiz(horizontais.length + j)) ?? { hs: [], vs: [] };
    g.vs.push(v);
    grupos.set(raiz(horizontais.length + j), g);
  });

  const tabelas: Tabela[] = [];
  for (const { hs, vs } of grupos.values()) {
    if (hs.length < 2 || vs.length < 2) continue;
    const ys = agrupar(hs.map((h) => h.y)).toReversed(); // de cima para baixo
    const xs = agrupar(vs.map((v) => v.x));
    if (ys.length < 2 || xs.length < 2 || (ys.length - 1) * (xs.length - 1) < 2) continue;
    const topo = ys[0]!;
    const base = ys.at(-1)!;
    const esquerda = xs[0]!;
    const direita = xs.at(-1)!;

    const nLinhas = ys.length - 1;
    const nColunas = xs.length - 1;
    // Células mescladas: a célula sem borda entre ela e a vizinha é a mesma (união e busca na grade);
    // o texto vai para a de cima à esquerda, e as outras ficam vazias.
    const ancora = Array.from({ length: nLinhas * nColunas }, (_, i) => i);
    const raizCelula = (i: number): number => (ancora[i] === i ? i : (ancora[i] = raizCelula(ancora[i]!)));
    const unir = (a: number, b: number) => {
      const [ra, rb] = [raizCelula(a), raizCelula(b)];
      if (ra !== rb) ancora[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    const temVertical = (x: number, y: number) =>
      vs.some((v) => Math.abs(v.x - x) <= TOLERANCIA * 2 && y >= v.y0 - TOQUE && y <= v.y1 + TOQUE);
    const temHorizontal = (y: number, x: number) =>
      hs.some((h) => Math.abs(h.y - y) <= TOLERANCIA * 2 && x >= h.x0 - TOQUE && x <= h.x1 + TOQUE);
    for (let r = 0; r < nLinhas; r += 1)
      for (let c = 0; c < nColunas; c += 1) {
        const meioY = (ys[r]! + ys[r + 1]!) / 2;
        const meioX = (xs[c]! + xs[c + 1]!) / 2;
        if (c + 1 < nColunas && !temVertical(xs[c + 1]!, meioY)) unir(r * nColunas + c, r * nColunas + c + 1);
        if (r + 1 < nLinhas && !temHorizontal(ys[r + 1]!, meioX)) unir(r * nColunas + c, (r + 1) * nColunas + c);
      }

    const celulas: ItemPosicionado[][][] = Array.from({ length: nLinhas }, () =>
      Array.from({ length: nColunas }, () => []),
    );
    const usados = new Set<number>();
    const ysCrescentes = ys.toReversed();
    for (const item of itens) {
      const cx = item.x + item.largura / 2;
      const cy = item.y + item.altura / 3;
      if (cx < esquerda || cx > direita || cy < base || cy > topo) continue;
      const coluna = intervalo(xs, cx);
      const linhaDeBaixo = intervalo(ysCrescentes, cy);
      if (coluna < 0 || linhaDeBaixo < 0) continue;
      const destino = raizCelula((nLinhas - 1 - linhaDeBaixo) * nColunas + coluna);
      celulas[Math.floor(destino / nColunas)]![destino % nColunas]!.push(item);
      usados.add(item.indice);
    }
    if (!usados.size) continue;

    let linhas = celulas.map((linha) => linha.map(textoDaCelula));
    linhas = linhas.filter((linha) => linha.some((c) => c !== ""));
    const colunasComTexto = linhas[0]!.map((_, c) => linhas.some((linha) => linha[c] !== ""));
    linhas = linhas.map((linha) => linha.filter((_, c) => colunasComTexto[c]));
    // Uma célula só (moldura em volta de um parágrafo) não é tabela.
    if (linhas.length * (linhas[0]?.length ?? 0) < 2) continue;
    tabelas.push({ topo, base, esquerda, direita, linhas, itens: usados });
  }
  return tabelas.sort((a, b) => b.topo - a.topo);
}

/** A tabela em Markdown, com a primeira linha de cabeçalho; `|` no texto vira `\|`. */
export function tabelaEmMarkdown(todas: ReadonlyArray<ReadonlyArray<string>>): string {
  const colunas = Math.max(...todas.map((l) => l.length));
  // O título que ocupa sozinho a primeira linha ("PRIMEIRO PERÍODO") sai da tabela, em negrito.
  const primeira = todas[0]!.filter((c) => c !== "");
  if (colunas >= 3 && todas.length >= 3 && primeira.length === 1 && todas[0]![0] !== "")
    return `**${primeira[0]}**\n\n${tabelaEmMarkdown(todas.slice(1))}`;
  const linhas = todas;
  const linha = (celulas: ReadonlyArray<string>) =>
    `|${Array.from({ length: colunas }, (_, i) => (celulas[i] ?? "").replaceAll("|", "\\|")).join("|")}|`;
  return [
    linha(linhas[0]!),
    `|${Array.from({ length: colunas }, () => "---").join("|")}|`,
    ...linhas.slice(1).map(linha),
  ].join("\n");
}
