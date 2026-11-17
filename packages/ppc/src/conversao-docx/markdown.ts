/**
 * Escrita do Markdown bruto: elementos e seções do PPC em texto, antes da normalização
 * (`../normalizador-markdown.ts`).
 */
import { match } from "@simplifica-if/kb/primitivas/regex";
import { aparar, apararFim, apararInicio, ESPACOS } from "@simplifica-if/kb/texto";
import { type Elemento, type Paragrafo, type Tabela, textoDosTrechos, type Trecho } from "./elementos.ts";
import { type Secao, tituloCompleto } from "./secoes.ts";
import { normalizarTabela, type TabelaNormalizada, tabelaEmMarkdown } from "./tabelas.ts";

const r = String.raw;

function marcar(texto: string, trecho: Trecho): string {
  let marcado = texto;
  if (trecho.negrito && trecho.italico) marcado = `***${marcado}***`;
  else if (trecho.negrito) marcado = `**${marcado}**`;
  else if (trecho.italico) marcado = `*${marcado}*`;
  return trecho.tachado ? `~~${marcado}~~` : marcado;
}

/**
 * Formata um trecho. Os espaços das pontas ficam fora dos marcadores (em Markdown, `**texto **`
 * não fecha o negrito) e o trecho só de espaços sai sem marcador.
 */
function formatarTrecho(trecho: Trecho): string {
  const inicio = trecho.texto.length - apararInicio(trecho.texto).length;
  const fim = apararFim(trecho.texto).length;
  if (fim <= inicio) return trecho.texto;
  return trecho.texto.slice(0, inicio) + marcar(trecho.texto.slice(inicio, fim), trecho) + trecho.texto.slice(fim);
}

const mesmaFormatacao = (a: Trecho, b: Trecho) =>
  a.negrito === b.negrito && a.italico === b.italico && a.tachado === b.tachado && a.url === b.url;

/** Junta os trechos seguidos de mesma formatação: o Word parte um texto uniforme em vários runs. */
function unirTrechos(trechos: Trecho[]): Trecho[] {
  const unidos: Trecho[] = [];
  for (const trecho of trechos) {
    const anterior = unidos.at(-1);
    if (anterior && mesmaFormatacao(anterior, trecho)) anterior.texto += trecho.texto;
    else unidos.push({ ...trecho });
  }
  return unidos;
}

const ESQUEMAS_DE_LINK = /^(?:https?:\/\/|mailto:)/i;
const ESCAPES_DE_URL: Record<string, string> = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };

/**
 * Endereço que pode virar link no Markdown: só `http`, `https` e `mailto`, com espaços e
 * parênteses escapados. O endereço vem do documento, e o `PPC.md` é exibido no relatório: um
 * `javascript:` ou um `)` no meio abririam caminho para injetar marcação.
 */
function enderecoSeguro(url: string): string | null {
  if (!ESQUEMAS_DE_LINK.test(url)) return null;
  return url
    .replace(/[()<>]/g, (caractere) => ESCAPES_DE_URL[caractere]!)
    .replace(new RegExp(`[${ESPACOS}]`, "g"), "%20");
}

/** Trechos formatados; os trechos seguidos de um mesmo hyperlink viram um link só. */
function formatarTrechos(trechos: Trecho[]): string {
  const partes: string[] = [];
  let acumulado: string[] = [];
  let urlCorrente: string | null = null;
  const fecharLink = () => {
    if (!acumulado.length) return;
    const texto = acumulado.join("");
    const url = urlCorrente ? enderecoSeguro(urlCorrente) : null;
    partes.push(url ? `[${texto.replaceAll("\\", "\\\\").replaceAll("]", "\\]")}](${url})` : texto);
    acumulado = [];
  };
  for (const trecho of unirTrechos(trechos)) {
    if (trecho.url !== urlCorrente) {
      fecharLink();
      urlCorrente = trecho.url;
    }
    acumulado.push(formatarTrecho(trecho));
  }
  fecharLink();
  return partes.join("");
}

/**
 * Escritor com o estado da lista corrente: o primeiro bloco depois de uma lista ganha uma linha em
 * branco antes, para a lista não engolir o parágrafo seguinte.
 */
/** Tabela em grade regular; a conversão passa uma função com memória, que normaliza cada tabela uma vez. */
export type NormalizarTabela = (tabela: Tabela) => TabelaNormalizada;

class Escritor {
  readonly #normalizar: NormalizarTabela;
  #emLista = false;

  constructor(normalizar: NormalizarTabela) {
    this.#normalizar = normalizar;
  }

  /** Marcador do título: um nível abaixo do do documento (`#` é o título do documento). */
  #cerquilhas(nivel: number): string {
    return "#".repeat(Math.min(nivel + 1, 6));
  }

  #sairDaLista(): string {
    if (!this.#emLista) return "";
    this.#emLista = false;
    return "\n";
  }

  #paragrafo(paragrafo: Paragrafo): string {
    const texto = formatarTrechos(paragrafo.trechos);
    if (!paragrafo.itemDeLista) return this.#sairDaLista() + texto;
    this.#emLista = true;
    const recuo = "  ".repeat(paragrafo.nivelLista);
    const digitado = aparar(textoDosTrechos(paragrafo));
    if (paragrafo.tipoLista !== "numerada") {
      // O marcador digitado ("•", "-") sai. A conferência é no texto sem formatação: no texto
      // formatado, o `*` inicial pode ser o do negrito.
      const marcador = match(r`^[•\-\*–—]\s*`, digitado)?.[0];
      return `${recuo}- ${marcador && texto.startsWith(marcador) ? texto.slice(marcador.length) : texto}`;
    }
    // O número digitado já é um item de lista do Markdown, e fica: "2. texto" continua "2.".
    if (match(r`^[\d]+[.)]\s`, digitado)) return recuo + texto;
    // A alínea mantém a letra, que o texto cita ("nos termos da alínea b").
    if (match(r`^[a-z][.)]\s`, digitado, { ignoreCase: true })) return `${recuo}- ${texto}`;
    return `${recuo}1. ${texto}`;
  }

  elemento(elemento: Elemento): string {
    if (elemento.tipo === "titulo")
      return `${this.#sairDaLista()}${this.#cerquilhas(elemento.nivel)} ${elemento.texto}`;
    if (elemento.tipo === "tabela") return this.#sairDaLista() + tabelaEmMarkdown(this.#normalizar(elemento));
    if (elemento.tipo === "paragrafo") return this.#paragrafo(elemento);
    // A figura não tem texto; a da representação gráfica entra depois, pela seção (`figura.ts`).
    return "";
  }

  /** Documento sem seções (nenhum título reconhecido): os elementos em sequência. */
  elementos(elementos: Elemento[]): string {
    const linhas: string[] = [];
    for (const elemento of elementos) {
      const texto = this.elemento(elemento);
      if (!texto) continue;
      if (elemento.tipo === "titulo" && linhas.length && aparar(linhas.at(-1)!)) linhas.push("");
      linhas.push(texto);
      if (elemento.tipo === "titulo" || elemento.tipo === "tabela") linhas.push("");
    }
    if (this.#emLista) linhas.push("");
    return linhas.join("\n");
  }

  secao(secao: Secao): string {
    const linhas = [`${this.#cerquilhas(secao.nivel)} ${tituloCompleto(secao)}`, ""];
    for (const elemento of secao.elementos) {
      const texto = this.elemento(elemento);
      if (!texto) continue;
      linhas.push(texto);
      if (elemento.tipo === "tabela") linhas.push("");
    }
    for (const subsecao of secao.subsecoes) linhas.push("", this.secao(subsecao));
    return linhas.join("\n");
  }
}

/** Markdown bruto do documento: por seções quando há títulos, senão os elementos em sequência. */
export function escreverMarkdown(
  elementos: Elemento[],
  secoes: Secao[],
  normalizar: NormalizarTabela = normalizarTabela,
): string {
  const escritor = new Escritor(normalizar);
  if (!secoes.length) return escritor.elementos(elementos);
  return secoes.map((secao) => escritor.secao(secao)).join("\n");
}
