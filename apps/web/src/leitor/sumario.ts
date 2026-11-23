/**
 * O índice de navegação do leitor ("Neste documento"), sem o DOM: os itens do sumário da norma
 * (`lerDocumento`) como a lateral os mostra, quais aparecem conforme o trecho em leitura, e o artigo que
 * a pessoa pede em "Ir ao art.".
 */
import type { Ancora, DadosDocumento } from "@simplifica-if/contratos-app";

export type ItemSumario = DadosDocumento["sumario"][number];

/** O pedido de rolagem que o índice faz ao `Documento`: o `id` do elemento e a linha dele no arquivo. */
export interface Destino {
  readonly id: string;
  readonly linha: number;
}

export const IR_PARA = "simplifica:leitor-ir-para";

/** O `id` que o `Documento` põe no cabeçalho de um item do sumário. */
export const idDoItem = (item: Pick<ItemSumario, "linha">): string => `sumario-${item.linha}`;

/** As âncoras que o `Documento` acrescenta às dos dispositivos, para o índice rolar até o item. */
export const ancorasDoSumario = (sumario: ReadonlyArray<ItemSumario>) =>
  sumario.map((item) => ({ id: idDoItem(item), linha_inicio: item.linha }));

/** As linhas dos cabeçalhos de divisão (o rótulo e o nome), que o texto mostra centralizados. */
export function linhasDeDivisao(sumario: ReadonlyArray<ItemSumario>): ReadonlySet<number> {
  const linhas = new Set<number>();
  for (const item of sumario) {
    if (item.tipo === "topico" || item.tipo === "anexo") continue;
    for (let linha = item.linha; linha <= item.linha_fim; linha += 1) linhas.add(linha);
  }
  return linhas;
}

const PREFIXO: Readonly<Partial<Record<ItemSumario["tipo"], string>>> = {
  livro: "Livro",
  parte: "Parte",
  titulo: "Título",
  capitulo: "Cap.",
  secao: "Seção",
  subsecao: "Subseção",
};

/** O rótulo como o índice mostra: `Cap. II`, `Seção Única`; o anexo e o tópico, como estão no texto. */
export function rotuloCurto(item: Pick<ItemSumario, "tipo" | "rotulo">): string {
  const prefixo = PREFIXO[item.tipo];
  if (prefixo === undefined) return item.rotulo;
  const numero = item.rotulo.replace(/^\S+\s+/, "");
  return `${prefixo} ${/^[IVXLC\d-]+[A-Z]?$/.test(numero) ? numero : numero.toLowerCase()}`;
}

/** A faixa de artigos do item: `14–72`, ou `18` quando é um só; `null` sem artigos. */
export function faixaDeArtigos(item: Pick<ItemSumario, "artigos">): string | null {
  if (item.artigos === null) return null;
  const { primeiro, ultimo } = item.artigos;
  return primeiro === ultimo ? primeiro : `${primeiro}–${ultimo}`;
}

/** A faixa por extenso, para o leitor de tela: "artigos 14 a 72". */
export function faixaPorExtenso(item: Pick<ItemSumario, "artigos">): string | null {
  if (item.artigos === null) return null;
  const { primeiro, ultimo } = item.artigos;
  return primeiro === ultimo ? `artigo ${primeiro}` : `artigos ${primeiro} a ${ultimo}`;
}

/** Até que nível o índice mostra sempre; os mais fundos, só no ramo em leitura. */
export const NIVEIS_FIXOS = 2;

/**
 * Os itens que o índice mostra: os dos dois primeiros níveis sempre; os mais fundos (as seções de um
 * capítulo), só os do item de segundo nível em que está o `ativo` (o índice do item em leitura).
 */
export function itensVisiveis(sumario: ReadonlyArray<ItemSumario>, ativo: number | null): ReadonlyArray<number> {
  /** O item de segundo nível que contém cada item fundo; -1 nos rasos. */
  const ramo: number[] = [];
  let atual = -1;
  sumario.forEach((item, i) => {
    if (item.nivel < NIVEIS_FIXOS - 1) atual = -1;
    else if (item.nivel === NIVEIS_FIXOS - 1) atual = i;
    ramo.push(item.nivel >= NIVEIS_FIXOS ? atual : -1);
  });
  const aberto = ativo === null ? -1 : sumario[ativo]!.nivel >= NIVEIS_FIXOS ? ramo[ativo]! : ativo;
  return sumario.flatMap((item, i) => (item.nivel < NIVEIS_FIXOS || (aberto !== -1 && ramo[i] === aberto) ? [i] : []));
}

/** Os artigos do documento, para a grade da norma sem divisões e para "Ir ao art.". */
export const artigosDe = (ancoras: ReadonlyArray<Ancora>): ReadonlyArray<Ancora> =>
  ancoras.filter((a) => a.tipo === "artigo");

/** O número do artigo como se lê (`14`, `36-A`), do `id` da âncora (`art14`, `anexo1-art36A`). */
export function numeroDoArtigo(id: string): string {
  const m = /art(\d+)([A-Z]?)$/.exec(id);
  return m ? `${m[1]}${m[2] ? `-${m[2]}` : ""}` : id;
}

/**
 * O artigo que a pessoa pediu em "Ir ao art." (`14`, `art. 36-A`, `5º`): o do ato primeiro; se o ato não
 * tem esse número, o do anexo (o estatuto, o regulamento). `null` se o texto não é um número de artigo
 * ou a norma não o tem.
 */
export function artigoPedido(texto: string, ancoras: ReadonlyArray<Ancora>): Ancora | null {
  const m = /^\s*(?:art(?:igo)?\.?\s*)?(\d+)\s*[ºo°ª]?\.?\s*(?:-?\s*([a-z]))?\s*\.?\s*$/i.exec(texto);
  if (!m) return null;
  const sufixo = `art${Number(m[1])}${(m[2] ?? "").toUpperCase()}`;
  const artigos = artigosDe(ancoras);
  return artigos.find((a) => a.id === sufixo) ?? artigos.find((a) => a.id.endsWith(`-${sufixo}`)) ?? null;
}

/** Com menos artigos que isto, a norma sem divisões não ganha a grade. */
export const MINIMO_DA_GRADE = 4;

/** O que o índice tem a mostrar: as divisões (com "Ir ao art."), a grade de artigos, os tópicos. */
export function conteudoDoIndice(documento: Pick<DadosDocumento, "sumario" | "ancoras">): {
  readonly itens: ReadonlyArray<ItemSumario>;
  readonly artigos: ReadonlyArray<Ancora>;
  readonly comDivisoes: boolean;
  readonly comGrade: boolean;
  readonly vazio: boolean;
} {
  const artigos = artigosDe(documento.ancoras);
  const comDivisoes = documento.sumario.some((item) => item.tipo !== "topico");
  const comGrade = !comDivisoes && artigos.length >= MINIMO_DA_GRADE;
  return {
    itens: documento.sumario,
    artigos,
    comDivisoes,
    comGrade,
    vazio: !comGrade && documento.sumario.length < 2,
  };
}
