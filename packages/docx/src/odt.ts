/**
 * O texto de um `.odt` (OpenDocument Text, o formato do LibreOffice) em Markdown, para a IA ler.
 *
 * O ZIP é lido pelo mesmo `PacoteZip` do DOCX, com os mesmos limites e defesas, e o XML pelo mesmo
 * `analisarXml`. O `content.xml` vira o modelo de elementos do DOCX (`elementos.ts`), e a escrita é
 * a de `docxParaMarkdown` (`documentoEmMarkdown`): mesmo `Escritor`, mesmo orçamento de texto,
 * mesmas notas e mesma seção "Caixas de texto".
 *
 * Entram: títulos (`text:h`, pelo nível de estrutura; e o parágrafo de estilo "Title"), parágrafos,
 * listas (nível pelo aninhamento; numerada ou com marcadores pelo estilo da lista), tabelas (com as
 * mesclas, e as células cobertas repetindo a de origem, como no DOCX), links `http`, `https` e
 * `mailto`, negrito, itálico e tachado dos estilos (automáticos ou não, com herança), espaços
 * (`text:s`), tabulações, quebras de linha e notas de rodapé e de fim. O texto dos quadros e formas
 * (`draw:frame` com `draw:text-box`, `draw:custom-shape`…) vai para a seção "Caixas de texto" no fim.
 *
 * Ficam de fora: imagens, comentários (`office:annotation`), o texto excluído com o controle de
 * alterações (que só existe em `text:tracked-changes`), as quebras de página e os modelos de índice.
 * Não há detecção de título pela formatação, como a do DOCX digitado sem estilos.
 */
import { type Element, isTag, isText } from "domhandler";
import { aparar } from "@simplifica-if/kb/texto";
import type { CelulaTabela, Elemento, Paragrafo, Tabela, Titulo, Trecho } from "./elementos.ts";
import { ErroDocx } from "./erro.ts";
import type { LimitesDoPacote } from "./limites.ts";
import { documentoEmMarkdown, secaoDeCaixas } from "./markdown.ts";
import { marcaDeNota } from "./modelo.ts";
import { LIMITES_DE_TEXTO, type LimitesDeTexto } from "./orcamento.ts";
import { atributo, descendente, filho, filhos, filhosElementos } from "./xml.ts";
import { PacoteZip } from "./zip.ts";

export interface OpcoesOdtParaMarkdown {
  /** Limites de leitura do pacote; padrão: `LIMITES_PADRAO` de `limites.ts`. */
  readonly limites?: Partial<LimitesDoPacote>;
  /** Orçamento de texto do documento; padrão: `LIMITES_DE_TEXTO` de `orcamento.ts`. */
  readonly limitesDeTexto?: Partial<LimitesDeTexto>;
}

const TIPO_ODT = "application/vnd.oasis.opendocument.text";

// ---------------------------------------------------------------- estilos

/** `undefined`: o estilo não diz, e vale o herdado. */
type Formato = {
  readonly negrito?: boolean | undefined;
  readonly italico?: boolean | undefined;
  readonly tachado?: boolean | undefined;
};
type TipoLista = "numerada" | "marcador";

/** Níveis de herança percorridos (`style:parent-style-name`): corta ciclo e cadeia hostil. */
const PROFUNDIDADE_DE_HERANCA = 32;

const sobrepor = (base: Formato, sobre: Formato): Formato => ({
  negrito: sobre.negrito ?? base.negrito,
  italico: sobre.italico ?? base.italico,
  tachado: sobre.tachado ?? base.tachado,
});

function formatoDasPropriedades(estilo: Element): Formato {
  const propriedades = filho(estilo, "style:text-properties");
  if (!propriedades) return {};
  const peso = atributo(propriedades, "fo:font-weight");
  const italico = atributo(propriedades, "fo:font-style");
  const tachado = atributo(propriedades, "style:text-line-through-style");
  return {
    negrito: peso === null ? undefined : peso === "bold" || Number(peso) >= 600,
    italico: italico === null ? undefined : italico === "italic" || italico === "oblique",
    tachado: tachado === null ? undefined : tachado !== "none",
  };
}

/** Os estilos de parágrafo, de texto e de lista de `styles.xml` e `content.xml`. */
class Estilos {
  readonly #estilos = new Map<string, { pai: string | null; formato: Formato }>();
  readonly #listas = new Map<string, Map<number, TipoLista>>();

  /** Lê os estilos de uma parte; os lidos depois valem sobre os de mesmo nome. */
  ler(raiz: Element | null): void {
    if (!raiz) return;
    for (const grupo of [...filhos(raiz, "office:styles"), ...filhos(raiz, "office:automatic-styles")]) {
      for (const estilo of filhosElementos(grupo)) {
        const nome = atributo(estilo, "style:name");
        if (nome === null) continue;
        if (estilo.name === "style:style") {
          this.#estilos.set(`${atributo(estilo, "style:family")}:${nome}`, {
            pai: atributo(estilo, "style:parent-style-name"),
            formato: formatoDasPropriedades(estilo),
          });
        } else if (estilo.name === "text:list-style") {
          const niveis = new Map<number, TipoLista>();
          for (const nivel of filhosElementos(estilo)) {
            const numero = Number(atributo(nivel, "text:level") ?? "1");
            const numerada =
              nivel.name === "text:list-level-style-number" && atributo(nivel, "style:num-format") !== "";
            niveis.set(numero, numerada ? "numerada" : "marcador");
          }
          this.#listas.set(nome, niveis);
        }
      }
    }
  }

  /** Os estilos da cadeia de herança, do próprio ao mais geral. */
  #cadeia(familia: string, nome: string | null): Array<{ nome: string; formato: Formato }> {
    const cadeia: Array<{ nome: string; formato: Formato }> = [];
    for (let atual = nome; atual !== null && cadeia.length < PROFUNDIDADE_DE_HERANCA;) {
      const estilo = this.#estilos.get(`${familia}:${atual}`);
      if (!estilo) break;
      cadeia.push({ nome: atual, formato: estilo.formato });
      atual = estilo.pai;
    }
    return cadeia;
  }

  /** Negrito, itálico e tachado de um estilo, com o herdado. */
  formato(familia: "paragraph" | "text", nome: string | null): Formato {
    return this.#cadeia(familia, nome).reduceRight<Formato>((herdado, item) => sobrepor(herdado, item.formato), {});
  }

  /** Parágrafo de estilo "Title" (ou derivado dele): o título do documento. */
  ehTituloDoDocumento(nome: string | null): boolean {
    return this.#cadeia("paragraph", nome).some((item) => item.nome === "Title");
  }

  /** Numerada ou com marcadores, pelo estilo da lista no nível (0 é o primeiro). */
  tipoDaLista(nome: string | null, nivel: number): TipoLista {
    return (nome === null ? undefined : this.#listas.get(nome)?.get(nivel + 1)) ?? "marcador";
  }
}

// ---------------------------------------------------------------- conteúdo

/** Elementos que não têm texto do documento, em qualquer lugar. */
const IGNORADOS = new Set([
  "office:annotation",
  "office:annotation-end",
  "office:forms",
  "text:tracked-changes",
  "text:change",
  "text:change-start",
  "text:change-end",
  "text:soft-page-break",
  "text:ruby-text",
  "text:note-citation",
  "text:sequence-decls",
  "text:variable-decls",
  "text:user-field-decls",
  "text:dde-connection-decls",
  "table:calculation-settings",
]);

/** Ignorado: a lista acima e os modelos de índice (`text:table-of-content-source`…). */
const ignorado = (elemento: Element) => IGNORADOS.has(elemento.name) || elemento.name.endsWith("-source");
/** Quadro ou forma: o texto vai para "Caixas de texto". */
const ehDesenho = (elemento: Element) => elemento.name.startsWith("draw:");
const ehParagrafo = (elemento: Element) => elemento.name === "text:p" || elemento.name === "text:h";

/** Inteiro de um atributo de contagem (`text:c`, `table:number-columns-spanned`…), no mínimo 1. */
function contagem(elemento: Element, nome: string): number {
  const valor = Number(atributo(elemento, nome) ?? "1");
  return Number.isFinite(valor) && valor >= 1 ? Math.floor(valor) : 1;
}

type ContextoDeLista = { nivel: number; estilo: string | null };

/** A célula de origem que ocupa uma posição da grade, até onde a mescla vai. */
type Origem = { celula: CelulaTabela; fimLinha: number; fimColuna: number };

class LeitorOdt {
  readonly #estilos: Estilos;
  readonly #limites: LimitesDoPacote;
  readonly #limitesDeTexto: LimitesDeTexto;
  /** O texto de cada nota, pela chave da marca (`r:<n>`, `f:<n>`). */
  readonly notas = new Map<string, Elemento[]>();
  /** O texto dos quadros e formas, um item por parágrafo. */
  readonly caixas: string[] = [];
  #notasLidas = 0;
  #caracteres = 0;

  constructor(estilos: Estilos, limites: LimitesDoPacote, limitesDeTexto: LimitesDeTexto) {
    this.#estilos = estilos;
    this.#limites = limites;
    this.#limitesDeTexto = limitesDeTexto;
  }

  /**
   * Conta o texto lido: o `text:s` multiplica espaços (`text:c="1000000000"` num arquivo de poucos
   * bytes), e o teto do documento corta antes de a memória ir embora.
   */
  #gastar(caracteres: number): void {
    this.#caracteres += caracteres;
    if (this.#caracteres > this.#limitesDeTexto.caracteresNoDocumento) {
      throw new ErroDocx({ motivo: "texto-demais", limite: this.#limitesDeTexto.caracteresNoDocumento });
    }
  }

  // ------------------------------------------------ blocos

  /** Os blocos de um conteiner (o corpo, uma seção, um item de lista, o corpo de uma nota). */
  blocos(conteiner: Element, saida: Elemento[], lista: ContextoDeLista | null): void {
    for (const elemento of filhosElementos(conteiner)) {
      if (ignorado(elemento)) continue;
      if (ehDesenho(elemento)) this.#caixa(elemento);
      else if (elemento.name === "text:h") {
        const titulo = this.#titulo(elemento);
        if (titulo) saida.push(titulo);
      } else if (elemento.name === "text:p") {
        const paragrafo = this.#paragrafo(elemento, lista);
        if (paragrafo) saida.push(paragrafo);
      } else if (elemento.name === "text:list") {
        const contexto = {
          nivel: lista ? lista.nivel + 1 : 0,
          estilo: atributo(elemento, "text:style-name") ?? lista?.estilo ?? null,
        };
        for (const item of filhosElementos(elemento)) {
          if (item.name === "text:list-item") this.blocos(item, saida, contexto);
          // O cabeçalho da lista não tem marcador nem número.
          else if (item.name === "text:list-header") this.blocos(item, saida, null);
        }
      } else if (elemento.name === "table:table") saida.push(this.#tabela(elemento));
      // Seção, índice (`text:index-body`) e outros conteineres: o que importa está dentro.
      else this.blocos(elemento, saida, lista);
    }
  }

  #titulo(elemento: Element): Titulo | null {
    const texto = aparar(this.#textoSimples(elemento, true));
    if (!texto) return null;
    const nivel = contagem(elemento, "text:outline-level");
    return { tipo: "titulo", texto, nivel, estilo: atributo(elemento, "text:style-name") };
  }

  #paragrafo(elemento: Element, lista: ContextoDeLista | null): Titulo | Paragrafo | null {
    const estilo = atributo(elemento, "text:style-name");
    const trechos = this.#trechosDoParagrafo(elemento, this.#estilos.formato("paragraph", estilo), true);
    const texto = aparar(trechos.map((trecho) => trecho.texto).join(""));
    if (!texto) return null;
    if (!lista && this.#estilos.ehTituloDoDocumento(estilo)) return { tipo: "titulo", texto, nivel: 1, estilo };
    return {
      tipo: "paragrafo",
      trechos,
      estilo,
      itemDeLista: lista !== null,
      nivelLista: lista?.nivel ?? 0,
      tipoLista: lista ? this.#estilos.tipoDaLista(lista.estilo, lista.nivel) : null,
    };
  }

  // ------------------------------------------------ texto de um parágrafo

  /**
   * Os trechos de um parágrafo. Os espaços seguem a regra do ODF: espaço, tabulação e quebra de
   * linha no texto valem um espaço, e o espaço no início do parágrafo ou depois de outro some; o
   * espaço que conta vem em `text:s`, a tabulação em `text:tab` e a quebra em `text:line-break`.
   */
  #trechos(
    elemento: Element,
    formato: Formato,
    url: string | null,
    saida: Trecho[],
    estado: { espaco: boolean; colapsado: boolean },
    comNotas: boolean,
  ): void {
    /** `colapsado`: o último caractere é um espaço do XML (o do texto, não o de `text:s`). */
    const emitir = (texto: string, colapsado = false) => {
      estado.colapsado = colapsado;
      this.#gastar(texto.length);
      saida.push({
        texto,
        negrito: formato.negrito === true,
        italico: formato.italico === true,
        tachado: formato.tachado === true,
        url,
      });
    };
    for (const no of elemento.children) {
      if (isText(no)) {
        let texto = no.data.replace(/[ \t\r\n]+/g, " ");
        if (estado.espaco && texto.startsWith(" ")) texto = texto.slice(1);
        if (!texto) continue;
        estado.espaco = texto.endsWith(" ");
        emitir(texto, estado.espaco);
        continue;
      }
      if (!isTag(no) || ignorado(no)) continue;
      if (ehDesenho(no)) {
        this.#caixa(no);
        continue;
      }
      switch (no.name) {
        case "text:span":
          this.#trechos(
            no,
            sobrepor(formato, this.#estilos.formato("text", atributo(no, "text:style-name"))),
            url,
            saida,
            estado,
            comNotas,
          );
          break;
        case "text:a":
          this.#trechos(
            no,
            sobrepor(formato, this.#estilos.formato("text", atributo(no, "text:style-name"))),
            atributo(no, "xlink:href") ?? url,
            saida,
            estado,
            comNotas,
          );
          break;
        case "text:s":
          // Acima da sequência sem texto do orçamento, o documento já seria recusado.
          emitir(" ".repeat(Math.min(contagem(no, "text:c"), this.#limitesDeTexto.sequenciaSemTexto + 1)));
          estado.espaco = true;
          break;
        case "text:tab":
          emitir("\t");
          estado.espaco = true;
          break;
        case "text:line-break":
          emitir("\n");
          estado.espaco = true;
          break;
        case "text:note":
          if (comNotas) emitir(this.#nota(no));
          break;
        default:
          // Campos (`text:date`, `text:page-number`…), `text:ruby-base`, `text:meta`: o texto mostrado está dentro.
          this.#trechos(no, formato, url, saida, estado, comNotas);
      }
    }
  }

  /** Os trechos de um parágrafo, sem o espaço do XML no fim (que no ODF não conta). */
  #trechosDoParagrafo(elemento: Element, formato: Formato, comNotas: boolean): Trecho[] {
    const trechos: Trecho[] = [];
    const estado = { espaco: true, colapsado: false };
    this.#trechos(elemento, formato, null, trechos, estado, comNotas);
    const ultimo = trechos.at(-1);
    if (estado.colapsado && ultimo) {
      ultimo.texto = ultimo.texto.slice(0, -1);
      if (!ultimo.texto) trechos.pop();
    }
    return trechos;
  }

  /** O texto de um parágrafo, sem formatação. */
  #textoSimples(elemento: Element, comNotas: boolean): string {
    return this.#trechosDoParagrafo(elemento, {}, comNotas)
      .map((trecho) => trecho.texto)
      .join("");
  }

  /** Lê a nota e devolve a marca da referência. */
  #nota(nota: Element): string {
    const tipo = atributo(nota, "text:note-class") === "endnote" ? "fim" : "rodape";
    this.#notasLidas += 1;
    const id = String(this.#notasLidas);
    const elementos: Elemento[] = [];
    const corpo = filho(nota, "text:note-body");
    if (corpo) this.blocos(corpo, elementos, null);
    this.notas.set(`${tipo === "rodape" ? "r" : "f"}:${id}`, elementos);
    return marcaDeNota(tipo, id);
  }

  /** O texto de um quadro ou forma, um item por parágrafo; uma nota lá dentro fica de fora. */
  #caixa(desenho: Element): void {
    for (const elemento of filhosElementos(desenho)) {
      if (ignorado(elemento)) continue;
      if (ehParagrafo(elemento)) this.caixas.push(this.#textoSimples(elemento, false));
      else this.#caixa(elemento);
    }
  }

  // ------------------------------------------------ tabelas

  /** O texto de uma célula: os parágrafos, um por linha, inclusive os de lista e de tabela aninhada. */
  #textoDaCelula(celula: Element): string {
    const linhas: string[] = [];
    const visitar = (conteiner: Element) => {
      for (const elemento of filhosElementos(conteiner)) {
        if (ignorado(elemento)) continue;
        if (ehDesenho(elemento)) this.#caixa(elemento);
        else if (ehParagrafo(elemento)) linhas.push(this.#textoSimples(elemento, true));
        else visitar(elemento);
      }
    };
    visitar(celula);
    return aparar(linhas.join("\n"));
  }

  /** As linhas da tabela, inclusive as de cabeçalho e de grupos (`table:table-header-rows`…). */
  #linhas(conteiner: Element): Element[] {
    const linhas: Element[] = [];
    for (const elemento of filhosElementos(conteiner)) {
      if (elemento.name === "table:table-row") linhas.push(elemento);
      else if (/^table:table-(?:header-)?rows$|^table:table-row-group$/.test(elemento.name)) {
        linhas.push(...this.#linhas(elemento));
      }
    }
    return linhas;
  }

  /**
   * A tabela como a do DOCX: cada célula uma vez, com as colunas que ocupa e a marca de
   * continuação. O ODF grava cada posição coberta como `table:covered-table-cell`: ela continua a
   * célula de cima, se a mescla vertical chega até ela, ou alarga a da esquerda, se a horizontal
   * chega.
   */
  #tabela(tabela: Element): Tabela {
    const { celulasPorLinha, posicoesPorTabela } = this.#limites;
    const linhas: CelulaTabela[][] = [];
    let acima: Origem[] = [];
    let posicoes = 0;
    for (const elementoDaLinha of this.#linhas(tabela)) {
      const indice = linhas.length;
      const linha: CelulaTabela[] = [];
      const origens: Origem[] = [];
      let esquerda: Origem | null = null;
      for (const elemento of filhosElementos(elementoDaLinha)) {
        const coberta = elemento.name === "table:covered-table-cell";
        if (!coberta && elemento.name !== "table:table-cell") continue;
        const repeticoes = contagem(elemento, "table:number-columns-repeated");
        if (origens.length + repeticoes > celulasPorLinha) {
          throw new ErroDocx({ motivo: "celulas-por-linha", limite: celulasPorLinha });
        }
        const texto = coberta ? "" : this.#textoDaCelula(elemento);
        for (let i = 0; i < repeticoes; i += 1) {
          const coluna = origens.length;
          const deCima = acima[coluna];
          let origem: Origem;
          if (!coberta) {
            const celula = { texto, colunas: 1, continuacao: false };
            linha.push(celula);
            origem = {
              celula,
              fimLinha: indice + contagem(elemento, "table:number-rows-spanned") - 1,
              fimColuna: coluna + contagem(elemento, "table:number-columns-spanned") - 1,
            };
            esquerda = origem;
          } else if (deCima && deCima.fimLinha >= indice) {
            // A continuação de uma mescla de várias colunas é uma célula só, como a de cima.
            if (origens.at(-1) === deCima && linha.at(-1)?.continuacao) linha.at(-1)!.colunas += 1;
            else linha.push({ texto: "", colunas: 1, continuacao: true });
            origem = deCima;
          } else if (esquerda && esquerda.fimColuna >= coluna && linha.length) {
            linha.at(-1)!.colunas += 1;
            origem = esquerda;
          } else {
            // Posição coberta que nenhuma mescla alcança (arquivo malformado): vazia.
            const celula = { texto: "", colunas: 1, continuacao: false };
            linha.push(celula);
            origem = { celula, fimLinha: indice, fimColuna: coluna };
          }
          origens.push(origem);
        }
      }
      if (!linha.length) continue;
      const repeticoes = contagem(elementoDaLinha, "table:number-rows-repeated");
      posicoes += origens.length * repeticoes;
      if (posicoes > posicoesPorTabela) throw new ErroDocx({ motivo: "tabela-grande-demais" });
      for (let i = 0; i < repeticoes; i += 1) linhas.push(linha);
      acima = origens;
    }
    return { tipo: "tabela", linhas };
  }
}

// ---------------------------------------------------------------- pacote

/** O tipo declarado: o arquivo `mimetype` ou, sem ele, a entrada `/` do manifesto. */
function tipoDoPacote(pacote: PacoteZip, manifesto: Element | null): string | null {
  const bytes = pacote.binario("mimetype");
  if (bytes) return aparar(new TextDecoder("utf-8").decode(bytes));
  for (const entrada of manifesto ? filhos(manifesto, "manifest:file-entry") : []) {
    if (atributo(entrada, "manifest:full-path") === "/") return atributo(entrada, "manifest:media-type");
  }
  return null;
}

function converter(bytes: Uint8Array, opcoes: OpcoesOdtParaMarkdown): string {
  const pacote = new PacoteZip(bytes, opcoes.limites);
  const manifesto = pacote.xml("META-INF/manifest.xml");
  if (tipoDoPacote(pacote, manifesto) !== TIPO_ODT) throw new ErroDocx({ motivo: "nao-e-odt" });
  // Com senha, as partes são cifradas uma a uma, e o manifesto diz como.
  if (manifesto && descendente(manifesto, "manifest:encryption-data")) throw new ErroDocx({ motivo: "protegido" });
  const conteudo = pacote.xml("content.xml");
  const corpo = conteudo && descendente(conteudo, "office:text");
  if (!conteudo || !corpo) throw new ErroDocx({ motivo: "sem-documento-principal" });

  const estilos = new Estilos();
  estilos.ler(pacote.xml("styles.xml"));
  estilos.ler(conteudo);
  const leitor = new LeitorOdt(estilos, pacote.limites, { ...LIMITES_DE_TEXTO, ...opcoes.limitesDeTexto });
  const elementos: Elemento[] = [];
  leitor.blocos(corpo, elementos, null);
  return documentoEmMarkdown(
    { elementos, caixas: secaoDeCaixas(leitor.caixas), notas: leitor.notas },
    opcoes.limitesDeTexto,
  );
}

/**
 * O texto de um `.odt` em Markdown, para a IA ler. Lança `ErroDocx` (com `formato: "ODT"`).
 *
 * A saída tem o estilo da de `docxParaMarkdown`: o que vem antes do primeiro título fica, cada
 * parágrafo é um parágrafo, as notas saem como `[^1]` e `[^fim-1]` com as definições no fim, e o
 * texto dos quadros vai para "Caixas de texto". O que entra e o que fica de fora está no início
 * deste módulo.
 */
export function odtParaMarkdown(bytes: Uint8Array, opcoes: OpcoesOdtParaMarkdown = {}): string {
  try {
    return converter(bytes, opcoes);
  } catch (erro) {
    if (erro instanceof ErroDocx) throw new ErroDocx({ ...erro.dados, formato: "ODT" });
    throw erro;
  }
}
