/**
 * Texto das normas por bloco, como os Markdown estão hoje: cada título (`#` a `######`) abre um
 * bloco que vai até o próximo título. É a unidade de busca de normas até a fase 5 entregar os
 * dispositivos (artigo, parágrafo, inciso com o caput herdado); depois disso o banco ganha a tabela
 * `dispositivos` (veja `fontes-normativas.ts`) e os blocos continuam como texto de apoio.
 *
 * O bloco cujo título é um artigo ("Art. 28", "Art. 36-A") recebe `artigo` e o ID de dispositivo
 * `#art28`/`#art36A`; nas normas que ainda não usam `#### Art.` como título, o artigo é achado pela
 * linha que começa com "Art. N" (`trechoDoArtigo`).
 */
import { aparar } from "../texto.ts";

export interface BlocoNorma {
  ordem: number;
  /** Título do bloco, sem os `#`; `null` no texto antes do primeiro título. */
  titulo: string | null;
  nivel: number;
  /** Títulos ancestrais e o próprio, separados por " > ". */
  caminho: string;
  artigo: string | null;
  dispositivo: string | null;
  /** Linhas (desde 1, no arquivo com o front matter). */
  linha_inicio: number;
  linha_fim: number;
  /** Corpo literal do bloco (sem a linha do título), sem linhas vazias nas pontas. */
  texto: string;
}

const RE_TITULO = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_ARTIGO = /^[*_\s]*Art(?:igo)?\.?\s*(\d+)\s*(?:[ºo°]\.?)?\s*(?:-\s*([A-Z])\b)?/i;

/** Número do artigo ("28", "36-A") e ID de dispositivo (`#art28`, `#art36A`) de um título ou linha. */
export function artigoDe(texto: string): { artigo: string; dispositivo: string } | null {
  const m = RE_ARTIGO.exec(texto);
  if (!m) return null;
  const letra = m[2]?.toUpperCase();
  return { artigo: letra ? `${m[1]}-${letra}` : m[1]!, dispositivo: `#art${m[1]}${letra ?? ""}` };
}

function semMarcacao(titulo: string): string {
  return aparar(titulo.replace(/\*\*/g, "").replace(/\s+/g, " "));
}

/** Blocos de uma norma (texto do arquivo inteiro; o front matter não vira bloco). */
export function blocosDaNorma(markdown: string): BlocoNorma[] {
  const linhas = markdown.replace(/\r\n?/g, "\n").split("\n");
  let inicio = 0;
  if (linhas[0] === "---") {
    const fim = linhas.indexOf("---", 1);
    if (fim !== -1) inicio = fim + 1;
  }
  type Aberto = { titulo: string | null; nivel: number; linha: number };
  const titulos: Aberto[] = [{ titulo: null, nivel: 0, linha: inicio - 1 }];
  for (let i = inicio; i < linhas.length; i += 1) {
    const m = RE_TITULO.exec(linhas[i]!);
    if (m) titulos.push({ titulo: semMarcacao(m[2]!), nivel: m[1]!.length, linha: i });
  }
  const pilha: { titulo: string; nivel: number }[] = [];
  const blocos: BlocoNorma[] = [];
  for (const [indice, t] of titulos.entries()) {
    const proximo = titulos[indice + 1]?.linha ?? linhas.length;
    const corpo = linhas.slice(t.linha + 1, proximo);
    let primeira = 0;
    while (primeira < corpo.length && !aparar(corpo[primeira]!)) primeira += 1;
    let ultima = corpo.length - 1;
    while (ultima >= primeira && !aparar(corpo[ultima]!)) ultima -= 1;
    const texto = corpo.slice(primeira, ultima + 1).join("\n");
    if (t.titulo === null && !texto) continue;
    if (t.titulo !== null) {
      while (pilha.length && pilha[pilha.length - 1]!.nivel >= t.nivel) pilha.pop();
      pilha.push({ titulo: t.titulo, nivel: t.nivel });
    }
    const artigo = t.titulo ? artigoDe(t.titulo) : null;
    blocos.push({
      ordem: blocos.length,
      titulo: t.titulo,
      nivel: t.nivel,
      caminho: pilha.map((p) => p.titulo).join(" > "),
      artigo: artigo?.artigo ?? null,
      dispositivo: artigo?.dispositivo ?? null,
      linha_inicio: t.titulo === null ? t.linha + 2 + primeira : t.linha + 1,
      linha_fim: ultima >= primeira ? t.linha + 1 + ultima + 1 : t.linha + 1,
      texto,
    });
  }
  return blocos;
}

/**
 * Trecho literal de um artigo pelas linhas do arquivo: da linha que começa com "Art. N" (título ou
 * parágrafo) até antes do próximo artigo ou título de nível igual ou maior. Serve às normas sem
 * `#### Art.` e aos dispositivos citados pelas fichas até a fase 5.
 */
export function trechoDoArtigo(
  markdown: string,
  artigo: string,
): { linha_inicio: number; linha_fim: number; texto: string } | null {
  const linhas = markdown.replace(/\r\n?/g, "\n").split("\n");
  let inicio = -1;
  for (let i = 0; i < linhas.length; i += 1) {
    const sem = linhas[i]!.replace(/^#{1,6}\s+/, "");
    if (artigoDe(sem)?.artigo === artigo) {
      inicio = i;
      break;
    }
  }
  if (inicio === -1) return null;
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i += 1) {
    const linha = linhas[i]!;
    const sem = linha.replace(/^#{1,6}\s+/, "");
    if (artigoDe(sem) || /^#{1,3}\s/.test(linha)) {
      fim = i;
      break;
    }
  }
  while (fim - 1 > inicio && !aparar(linhas[fim - 1]!)) fim -= 1;
  return { linha_inicio: inicio + 1, linha_fim: fim, texto: linhas.slice(inicio, fim).join("\n") };
}
