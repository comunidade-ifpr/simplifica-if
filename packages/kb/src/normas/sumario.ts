/**
 * O sumário de uma norma, para o índice de navegação do leitor: as divisões (Livro, Parte, Título,
 * Capítulo, Seção, Subseção) e os anexos, com a linha de cada um, o nível no índice e a faixa de
 * artigos que ele cobre.
 *
 * O nível vem do tipo da divisão, não da profundidade do cabeçalho: `####` é do artigo, e Título,
 * Capítulo e Seção não cabem acima dele em níveis distintos. O nome (a rubrica, "DAS FORMAS DE
 * OFERTA") vem no próprio cabeçalho, depois do rótulo, ou nos cabeçalhos seguintes, sem texto no meio.
 * Um anexo recomeça a contagem: as divisões dele ficam no mesmo nível das do ato.
 *
 * Norma sem artigos (nota técnica, parecer): um tópico por cabeçalho do texto, pelo nível do cabeçalho.
 */
import type { Heading } from "mdast";
import { divisaoDoCabecalho, nomeSemNotas, TIPOS_DIVISAO, type TipoDivisao } from "./divisoes.ts";
import { rotuloArtigo } from "./estrutura.ts";
import { arvoreMarkdown, textoDoNo } from "./markdown.ts";

export const TIPOS_ITEM_SUMARIO = [...TIPOS_DIVISAO, "anexo", "topico"] as const;
export type TipoItemSumario = (typeof TIPOS_ITEM_SUMARIO)[number];

export interface ItemSumario {
  tipo: TipoItemSumario;
  /** O rótulo como está no texto: `TÍTULO III`, `Seção I`, `ANEXO I`; no tópico, o cabeçalho inteiro. */
  rotulo: string;
  /** O nome da divisão (`DO ACESSO, DA PERMANÊNCIA E DO ÊXITO`); `null` se o texto não traz. */
  nome: string | null;
  /** O nível no índice, desde 0. */
  nivel: number;
  /** A linha do cabeçalho no arquivo, desde 1. */
  linha: number;
  /** A linha do último cabeçalho do item (a do nome, quando ele vem em cabeçalho próprio). */
  linha_fim: number;
  /** O primeiro e o último artigo da divisão (`14`, `36-A`); `null` sem artigos. */
  artigos: { primeiro: string; ultimo: string } | null;
}

/** O que o sumário usa de um dispositivo (as colunas de `dispositivos` no `kb.sqlite`). */
export interface DispositivoDoSumario {
  readonly dispositivo: string;
  readonly tipo: string;
  readonly linha_inicio: number;
}

/** O número do artigo como se lê (`14`, `36-A`), do sufixo do dispositivo (`#anexo1-art36A`). */
function numeroDoArtigo(dispositivo: string): string {
  const m = /art(\d+)([A-Z]?)$/.exec(dispositivo);
  return m ? `${m[1]}${m[2] ? `-${m[2]}` : ""}` : dispositivo.replace(/^#/, "");
}

/** O sumário de uma norma, do Markdown do arquivo e dos dispositivos dela. */
export function sumarioDaNorma(markdown: string, dispositivos: ReadonlyArray<DispositivoDoSumario>): ItemSumario[] {
  const artigos = dispositivos.filter((d) => d.tipo === "artigo");
  const anexos = new Set(dispositivos.filter((d) => d.tipo === "anexo").map((d) => d.linha_inicio));
  const porSecao = artigos.length === 0;
  const itens: ItemSumario[] = [];
  /** A profundidade do cabeçalho de cada tópico, para o nível relativo (norma sem artigos). */
  const profundidades = new Map<ItemSumario, number>();
  const pilha: TipoDivisao[] = [];
  /** O item que ainda pode receber o nome dos cabeçalhos seguintes. */
  let aberto: ItemSumario | null = null;

  const novo = (tipo: TipoItemSumario, rotulo: string, nome: string | null, nivel: number, no: Heading) => {
    const linha = no.position?.start.line ?? 1;
    const item: ItemSumario = { tipo, rotulo, nome, nivel, linha, linha_fim: linha, artigos: null };
    itens.push(item);
    return item;
  };

  for (const no of arvoreMarkdown(markdown).children) {
    if (no.type !== "heading") {
      aberto = null;
      continue;
    }
    const texto = textoDoNo(no).trim().replace(/\s+/g, " ");
    if (porSecao) {
      profundidades.set(novo("topico", texto, null, 0, no), no.depth);
      continue;
    }
    if (rotuloArtigo(texto) !== null) {
      aberto = null;
      continue;
    }
    if (anexos.has(no.position?.start.line ?? 0)) {
      pilha.length = 0;
      aberto = novo("anexo", texto, null, 0, no);
      continue;
    }
    const divisao = divisaoDoCabecalho(texto);
    if (divisao !== null) {
      const ordem = TIPOS_DIVISAO.indexOf(divisao.tipo);
      while (pilha.length > 0 && TIPOS_DIVISAO.indexOf(pilha.at(-1)!) >= ordem) pilha.pop();
      aberto = novo(divisao.tipo, divisao.rotulo, divisao.nome, pilha.length, no);
      pilha.push(divisao.tipo);
      continue;
    }
    // a rubrica: o nome da divisão no cabeçalho seguinte (às vezes partido em dois)
    if (aberto !== null) {
      const nome = nomeSemNotas(texto);
      if (nome !== null) aberto.nome = aberto.nome === null ? nome : `${aberto.nome} ${nome}`;
      aberto.linha_fim = no.position?.start.line ?? aberto.linha_fim;
    }
  }

  if (porSecao && profundidades.size > 0) {
    const raso = Math.min(...profundidades.values());
    for (const [item, profundidade] of profundidades) item.nivel = profundidade - raso;
  }

  itens.forEach((item, i) => {
    if (item.tipo === "topico") return;
    // o anexo vai até o próximo anexo ou tópico: as divisões dele ficam no mesmo nível
    const seguinte = itens
      .slice(i + 1)
      .find((outro) =>
        item.tipo === "anexo" ? outro.tipo === "anexo" || outro.tipo === "topico" : outro.nivel <= item.nivel,
      );
    const fim = seguinte?.linha ?? Number.POSITIVE_INFINITY;
    const dentro = artigos.filter((a) => a.linha_inicio >= item.linha && a.linha_inicio < fim);
    if (dentro.length > 0) {
      item.artigos = {
        primeiro: numeroDoArtigo(dentro[0]!.dispositivo),
        ultimo: numeroDoArtigo(dentro.at(-1)!.dispositivo),
      };
    }
  });
  return itens;
}
