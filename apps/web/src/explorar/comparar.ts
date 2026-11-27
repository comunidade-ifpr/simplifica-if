/**
 * Os textos e as escolhas do modo Comparar (`/explorar/comparar?a=…&b=…`): a relação de cada linha nos
 * termos da tabela, a contagem dos filhos do artigo mostrado só pelo caput, o "também corresponde" do
 * N→1, o filtro "Só o que mudou" e as entradas: o leitor da norma, pelo índice, e a paleta, pela busca.
 *
 * Funções puras, sem React: o teste de unidade as confere.
 */
import type { ComparacaoBusca, LinhaComparada, NormaDoIndice } from "@simplifica-if/contratos-app";

/** A relação de uma linha: o sinal do meio e o nome. */
export const RELACOES = {
  equivalente: { sinal: "=", nome: "equivalente" },
  parcial: { sinal: "≈", nome: "parcial" },
  "sem-equivalente": { sinal: "−", nome: "sem equivalente" },
  novo: { sinal: "+", nome: "novo" },
} as const;

export type Relacao = keyof typeof RELACOES;

const NOMES_FILHOS: Readonly<Record<string, readonly [string, string]>> = {
  artigo: ["artigo", "artigos"],
  paragrafo: ["parágrafo", "parágrafos"],
  inciso: ["inciso", "incisos"],
  alinea: ["alínea", "alíneas"],
  item: ["item", "itens"],
  anexo: ["anexo", "anexos"],
  secao: ["seção", "seções"],
};

/** Os filhos que a linha não mostra: "17 incisos", "2 parágrafos e 3 incisos"; `null` sem filhos. */
export function textoSubordinados(
  subordinados: ReadonlyArray<{ readonly tipo: string; readonly quantos: number }>,
): string | null {
  const partes = subordinados.map(({ tipo, quantos }) => {
    const [um, varios] = NOMES_FILHOS[tipo] ?? [tipo, tipo];
    return `${quantos} ${quantos === 1 ? um : varios}`;
  });
  if (partes.length === 0) return null;
  return partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
}

/** O rótulo dentro da frase: "Art. 5º, § 2º" → "art. 5º, § 2º". */
const naFrase = (rotulo: string) => rotulo.replace(/^Art\./, "art.");

/**
 * N→1: "Também corresponde ao art. 11 da 1/2021."; com várias, a lista. Os dispositivos são da norma de
 * origem (`norma`, o título dela), que a frase nomeia: senão "art. 32" se confunde com o do destino.
 */
export function textoTambem(tambem: ReadonlyArray<{ readonly rotulo: string }>, norma: string): string | null {
  if (tambem.length === 0) return null;
  const da = `da ${numeroDaNorma(norma)}`;
  if (tambem.length === 1) return `Também corresponde ao ${naFrase(tambem[0]!.rotulo)} ${da}.`;
  const lista = tambem.map((t) => naFrase(t.rotulo));
  return `Também corresponde a estes dispositivos ${da}: ${lista.slice(0, -1).join("; ")} e ${lista.at(-1)}.`;
}

/** A linha que herdou o item: "Pela linha do art. 5º.". */
export function textoHerdado(herdado: { readonly rotulo: string }): string {
  return `Pela linha do ${naFrase(herdado.rotulo)}.`;
}

/**
 * "Só o que mudou" esconde os pares `equivalente` de texto idêntico (depois de normalizar) e sem nota. O
 * par `parcial` fica mesmo com o texto igual: a mudança está nos filhos, e a nota da tabela diz qual.
 */
export function linhasVisiveis(
  linhas: ReadonlyArray<LinhaComparada>,
  soOQueMudou: boolean,
): ReadonlyArray<LinhaComparada> {
  return soOQueMudou ? linhas.filter((l) => !(l.identicos && l.tipo === "equivalente" && l.nota === null)) : linhas;
}

/**
 * O nome curto de uma norma, para "Novos na 2/2026" e "da 1/2021": a resolução pelo número
 * ("Resolução CNE/CP nº 2/2026" → "2/2026"); outra norma, pelo título sem a data ("Lei nº 9.394, de 20
 * de dezembro de 1996" → "Lei nº 9.394").
 */
export function numeroDaNorma(titulo: string): string {
  const semData = titulo.replace(/,\s+de\s.*$/, "");
  return /^Resolução\b.*\bnº\s*(\d+\/\d{4})$/.exec(semData)?.[1] ?? semData;
}

/** Uma comparação que se abre: a origem da tabela em `a`, o destino em `b`. */
export interface Comparacao {
  readonly a: string;
  readonly b: string;
  readonly titulo: string;
  readonly detalhe: string;
}

/** A comparação que a busca devolve, nos textos da opção da paleta. */
export const comparacaoDaBusca = (c: ComparacaoBusca): Comparacao => ({
  a: c.a,
  b: c.b,
  titulo: c.relacao === "sucessora" ? "Comparar com a sucessora" : "Comparar com a anterior",
  detalhe: `${c.titulo_a} ⇄ ${c.titulo_b}`,
});

/** As comparações da norma `id` aberta no leitor, pelo índice: uma por tabela de correspondência. */
export function comparacoesDe(id: string, normas: ReadonlyArray<NormaDoIndice>): Comparacao[] {
  const titulo = (x: string) => normas.find((n) => n.id === x)?.titulo ?? x;
  return (normas.find((n) => n.id === id)?.comparar_com ?? []).map((c) => {
    const [a, b] = c.relacao === "sucessora" ? [id, c.norma] : [c.norma, id];
    return comparacaoDaBusca({ a, b, titulo_a: titulo(a), titulo_b: titulo(b), relacao: c.relacao });
  });
}
