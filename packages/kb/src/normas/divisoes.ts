/**
 * As divisões de uma norma (Livro, Parte, Título, Capítulo, Seção, Subseção): o reconhecimento do
 * cabeçalho que abre uma e o nível de cabeçalho de cada tipo no Markdown da base. Usado pelo parser
 * (`estrutura.ts`, que acusa o nível errado) e pelo sumário do leitor (`sumario.ts`).
 */
export const TIPOS_DIVISAO = ["livro", "parte", "titulo", "capitulo", "secao", "subsecao"] as const;
export type TipoDivisao = (typeof TIPOS_DIVISAO)[number];

/** O número da divisão: `III`, `2`, `II-A`, `IV – A` (a letra do Planalto, com espaços), `Única`. */
const NUMERAL = String.raw`(?:[IVXLC]+|\d+)(?:\s?[-–]\s?[A-Z](?=$|\s))?|[ÚU]NIC[OA]|[Úú]nic[oa]`;

const RE_NOTA_DE_REDACAO =
  /\s*\((?:Redação dada|Incluíd[oa]|Acrescid[oa]|Acrescentad[oa]|Revogad[oa]|Renumerad[oa]|Vide|Vigência|Regulamento)\b[^()]*\)\s*/g;

/** O nome de uma divisão sem a nota de redação ("(Incluído pela Lei nº 12.677, de 2012)"); `null` se só havia ela. */
export function nomeSemNotas(nome: string): string | null {
  const limpo = nome.replace(RE_NOTA_DE_REDACAO, " ").trim();
  return limpo === "" ? null : limpo;
}
const RE_DIVISAO = new RegExp(
  String.raw`^(LIVRO|Livro|PARTE|Parte|TÍTULO|Título|CAPÍTULO|Capítulo|SEÇÃO|Seção|SUBSEÇÃO|Subseção)\s+(${NUMERAL})(?=$|[\s.:–—-])\s*(.*)$`,
  "su",
);

const TIPO_DA_PALAVRA: Readonly<Record<string, TipoDivisao>> = {
  livro: "livro",
  parte: "parte",
  título: "titulo",
  capítulo: "capitulo",
  seção: "secao",
  subseção: "subsecao",
};

/** O nível de cabeçalho de cada divisão no Markdown da base (a rubrica fica um nível abaixo). */
export const NIVEL_DO_CABECALHO: Readonly<Record<TipoDivisao, number>> = {
  livro: 2,
  parte: 2,
  titulo: 2,
  capitulo: 3,
  secao: 4,
  subsecao: 5,
};

export interface Divisao {
  tipo: TipoDivisao;
  rotulo: string;
  nome: string | null;
}

/** A divisão que um cabeçalho abre (`CAPÍTULO II – DA OFERTA`, `Seção I Da Frequência`), ou `null`. */
export function divisaoDoCabecalho(texto: string): Divisao | null {
  const m = RE_DIVISAO.exec(texto.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const tipo = TIPO_DA_PALAVRA[m[1]!.toLowerCase()];
  if (tipo === undefined) return null;
  // "CAPÍTULO II-A (Incluído pela Lei nº 12.677, de 2012)": a nota de redação não é o nome
  const nome = nomeSemNotas(m[3]!.replace(/^[\s.:–—-]+/, ""));
  return { tipo, rotulo: `${m[1]} ${m[2]!.replace(/\s?[-–]\s?/, "-")}`, nome };
}
