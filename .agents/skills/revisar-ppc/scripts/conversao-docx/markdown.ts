/**
 * Escrita do Markdown bruto: elementos e seções do PPC em texto, antes da normalização
 * (`../normalizador-markdown.ts`).
 */
import { sub } from "@simplifica-if/kb/python/re";
import { aparar } from "@simplifica-if/kb/texto";
import type { Elemento, Paragrafo, Trecho } from "./elementos.ts";
import { type Secao, tituloCompleto } from "./secoes.ts";
import { normalizarTabela, tabelaEmMarkdown } from "./tabelas.ts";

const r = String.raw;

function formatarTrecho(trecho: Trecho): string {
  let texto = trecho.texto;
  if (trecho.negrito && trecho.italico) texto = `***${texto}***`;
  else if (trecho.negrito) texto = `**${texto}**`;
  else if (trecho.italico) texto = `*${texto}*`;
  return trecho.tachado ? `~~${texto}~~` : texto;
}

/** Trechos formatados; os trechos seguidos de um mesmo hyperlink viram um link só. */
function formatarTrechos(trechos: Trecho[]): string {
  const partes: string[] = [];
  let acumulado: string[] = [];
  let urlCorrente: string | null = null;
  const fecharLink = () => {
    if (!acumulado.length) return;
    const texto = acumulado.join("");
    partes.push(urlCorrente ? `[${texto}](${urlCorrente})` : texto);
    acumulado = [];
  };
  for (const trecho of trechos) {
    if (trecho.url !== urlCorrente) {
      fecharLink();
      urlCorrente = trecho.url;
    }
    acumulado.push(formatarTrecho(trecho));
  }
  fecharLink();
  // Dois trechos em negrito colados (`**a****b**`) viram um só.
  return sub(r`\*{4,}`, "**", partes.join(""));
}

/**
 * Escritor com o estado da lista corrente: o primeiro bloco depois de uma lista ganha uma linha em
 * branco antes, para a lista não engolir o parágrafo seguinte.
 */
class Escritor {
  #emLista = false;

  #sairDaLista(): string {
    if (!this.#emLista) return "";
    this.#emLista = false;
    return "\n";
  }

  #paragrafo(paragrafo: Paragrafo): string {
    const texto = formatarTrechos(paragrafo.trechos);
    if (!paragrafo.itemDeLista) return this.#sairDaLista() + texto;
    this.#emLista = true;
    // O marcador digitado no texto ("1.", "•", "-") sai: o Markdown põe o dele.
    const semMarcador = sub(r`^[•\-\*–—]\s*`, "", sub(r`^[\d]+[.)]\s*`, "", texto));
    return `${"  ".repeat(paragrafo.nivelLista)}${paragrafo.tipoLista === "numerada" ? "1." : "-"} ${semMarcador}`;
  }

  elemento(elemento: Elemento): string {
    if (elemento.tipo === "titulo")
      return `${this.#sairDaLista()}${"#".repeat(Math.min(elemento.nivel, 6))} ${elemento.texto}`;
    if (elemento.tipo === "tabela") return this.#sairDaLista() + tabelaEmMarkdown(normalizarTabela(elemento));
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
    const linhas = [`${"#".repeat(Math.min(secao.nivel, 6))} ${tituloCompleto(secao)}`, ""];
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
export function escreverMarkdown(elementos: Elemento[], secoes: Secao[]): string {
  const escritor = new Escritor();
  if (!secoes.length) return escritor.elementos(elementos);
  return secoes.map((secao) => escritor.secao(secao)).join("\n");
}
