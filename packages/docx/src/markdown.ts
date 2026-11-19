/**
 * Escrita de Markdown a partir dos elementos do documento (`elementos.ts`) e a conversão de um
 * `.docx` qualquer em Markdown para a IA ler (`docxParaMarkdown`).
 *
 * A conversão do PPC (`@simplifica-if/ppc`) usa o mesmo `Escritor`, por seções, e normaliza o
 * resultado com as regras de PPC; `docxParaMarkdown` escreve os elementos em sequência, sem seções
 * e sem normalizador.
 */
import { match } from "@simplifica-if/kb/primitivas/regex";
import { aparar, apararFim, apararInicio, ESPACOS } from "@simplifica-if/kb/texto";
import {
  type Elemento,
  elementosDoDocumento,
  type Paragrafo,
  type Tabela,
  temTexto,
  textoDosTrechos,
  type Trecho,
} from "./elementos.ts";
import { ErroDocx } from "./erro.ts";
import { lerPacote, textosDeCaixas } from "./leitor.ts";
import type { LimitesDoPacote } from "./limites.ts";
import { type NotaOoxml, NAO_CARACTERES_DA_MARCA, RE_MARCA_DE_NOTA } from "./modelo.ts";
import { type LimitesDeTexto, Orcamento } from "./orcamento.ts";
import { PacoteOoxml } from "./pacote.ts";
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
 * parênteses escapados. O endereço vem do documento, e o Markdown é exibido (o `PPC.md` no
 * relatório): um `javascript:` ou um `)` no meio abririam caminho para injetar marcação.
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

/** Linha de título: um nível abaixo do do documento (`#` é o título do documento). */
export function linhaDeTitulo(nivel: number, texto: string): string {
  return `${"#".repeat(Math.min(nivel + 1, 6))} ${texto}`;
}

/** Tabela em grade regular; a conversão do PPC passa uma função com memória, que normaliza cada tabela uma vez. */
export type NormalizarTabela = (tabela: Tabela) => TabelaNormalizada;

export type OpcoesSequencia = {
  /**
   * Linha em branco entre parágrafos (salvo entre itens da mesma lista), para que cada parágrafo
   * do Word seja um parágrafo do Markdown. A conversão do PPC não a usa: o normalizador separa.
   */
  separarParagrafos?: boolean;
};

const ehItemDeLista = (elemento: Elemento) => elemento.tipo === "paragrafo" && elemento.itemDeLista;

/**
 * Escritor com o estado da lista corrente: o primeiro bloco depois de uma lista ganha uma linha em
 * branco antes, para a lista não engolir o parágrafo seguinte. O estado vale de uma chamada a outra
 * (a conversão do PPC escreve seção por seção com o mesmo escritor).
 */
export class Escritor {
  readonly #normalizar: NormalizarTabela;
  #emLista = false;

  constructor(normalizar: NormalizarTabela = normalizarTabela) {
    this.#normalizar = normalizar;
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

  /** Um elemento em Markdown; texto vazio para o que não tem texto (a figura). */
  elemento(elemento: Elemento): string {
    if (elemento.tipo === "titulo") return this.#sairDaLista() + linhaDeTitulo(elemento.nivel, elemento.texto);
    if (elemento.tipo === "tabela") return this.#sairDaLista() + tabelaEmMarkdown(this.#normalizar(elemento));
    if (elemento.tipo === "paragrafo") return this.#paragrafo(elemento);
    // A figura não tem texto; a da representação gráfica do PPC entra depois, pela seção.
    return "";
  }

  /** Os elementos em sequência, sem seções. */
  elementos(elementos: Elemento[], opcoes: OpcoesSequencia = {}): string {
    const linhas: string[] = [];
    let anterior: Elemento | null = null;
    for (const elemento of elementos) {
      let texto = this.elemento(elemento);
      if (!texto) continue;
      if (opcoes.separarParagrafos) {
        // A separação é decidida aqui; a quebra de saída da lista seria uma segunda linha em branco.
        if (texto.startsWith("\n")) texto = texto.slice(1);
        const mesmaLista = anterior !== null && ehItemDeLista(anterior) && ehItemDeLista(elemento);
        if (linhas.length && aparar(linhas.at(-1)!) && !mesmaLista) linhas.push("");
      } else if (elemento.tipo === "titulo" && linhas.length && aparar(linhas.at(-1)!)) linhas.push("");
      linhas.push(texto);
      if (elemento.tipo === "titulo" || elemento.tipo === "tabela") linhas.push("");
      anterior = elemento;
    }
    if (this.#emLista && !opcoes.separarParagrafos) linhas.push("");
    return linhas.join("\n");
  }
}

// ---------------------------------------------------------------- docxParaMarkdown

export interface OpcoesDocxParaMarkdown {
  /** Limites de leitura do pacote; padrão: `LIMITES_PADRAO` de `limites.ts`. */
  readonly limites?: Partial<LimitesDoPacote>;
  /** Orçamento de texto do documento; padrão: `LIMITES_DE_TEXTO` de `orcamento.ts`. */
  readonly limitesDeTexto?: Partial<LimitesDeTexto>;
}

/** Parágrafo simples, sem formatação: as linhas das caixas de texto. */
const paragrafoSimples = (texto: string): Paragrafo => ({
  tipo: "paragrafo",
  trechos: [{ texto, negrito: false, italico: false, tachado: false, url: null }],
  estilo: null,
  itemDeLista: false,
  nivelLista: 0,
  tipoLista: null,
});

/**
 * As caixas de texto e formas, cada linha não vazia um parágrafo. O texto delas não passa pelas notas:
 * os não caracteres da marca saem, para um texto digitado na caixa não fingir uma referência.
 */
function elementosDasCaixas(pacote: PacoteOoxml): Elemento[] {
  const linhas = textosDeCaixas(pacote)
    .flatMap((caixa) => caixa.split("\n"))
    .map((linha) => aparar(linha.replace(NAO_CARACTERES_DA_MARCA, "")))
    .filter(Boolean);
  if (!linhas.length) return [];
  return [{ tipo: "titulo", texto: "Caixas de texto", nivel: 1, estilo: null }, ...linhas.map(paragrafoSimples)];
}

/** Definição de nota de rodapé do Markdown: as linhas seguintes recuadas em quatro espaços. */
function definicaoDeNota(rotulo: string, texto: string): string {
  const [primeira = "", ...resto] = texto.split("\n");
  const seguintes = resto.map((linha) => (linha ? `    ${linha}` : ""));
  return [`[^${rotulo}]: ${primeira}`.trimEnd(), ...seguintes].join("\n");
}

/**
 * O texto de um `.docx` qualquer em Markdown, para a IA ler. Lança `ErroDocx`.
 *
 * - Todos os elementos saem em sequência, inclusive o que vem antes do primeiro título (numa
 *   minuta, a ementa e o "RESOLVE:"): não há detecção de seções nem normalizador de PPC.
 * - Títulos viram `##` (nível 1) em diante, tabelas viram tabelas Markdown e listas, listas, como
 *   na conversão do PPC; cada parágrafo do Word é um parágrafo do Markdown.
 * - Notas: as de rodapé saem como `[^1]`, `[^2]`…, e as de fim como `[^fim-1]`, `[^fim-2]`…, cada
 *   série numerada na ordem em que a referência aparece no texto; as definições vão para o fim, as
 *   de rodapé antes das de fim. Referência a nota que não existe no arquivo sai do texto, e nota sem
 *   referência fica de fora, como no Word.
 * - O texto das caixas de texto e formas vai para uma seção "Caixas de texto", no fim.
 * - Figuras não têm texto e ficam de fora.
 * - Os limites do pacote e o orçamento de texto valem como na conversão do PPC; documento sem texto
 *   sai com o motivo `sem-texto`.
 */
export function docxParaMarkdown(bytes: Uint8Array, opcoes: OpcoesDocxParaMarkdown = {}): string {
  const pacote = new PacoteOoxml(bytes, opcoes.limites);
  const documento = lerPacote(pacote, { notas: true });
  const elementos = elementosDoDocumento(documento);
  const caixas = elementosDasCaixas(pacote);
  if (!elementos.some(temTexto) && !caixas.length) throw new ErroDocx({ motivo: "sem-texto" });
  const notas = new Map<string, { nota: NotaOoxml; elementos: Elemento[] }>();
  for (const nota of documento.notas) {
    const chave = `${nota.tipo === "rodape" ? "r" : "f"}:${nota.id}`;
    // Com ids repetidos vale a primeira nota.
    if (!notas.has(chave))
      notas.set(chave, { nota, elementos: elementosDoDocumento({ ...documento, blocos: nota.blocos }) });
  }

  const orcamento = new Orcamento(opcoes.limitesDeTexto);
  orcamento.conferirElementos([...elementos, ...caixas, ...[...notas.values()].flatMap((item) => item.elementos)]);
  const normalizar: NormalizarTabela = (tabela) =>
    normalizarTabela(tabela, (caracteres) => orcamento.gastar(caracteres));
  const sequencia = { separarParagrafos: true };

  const escritor = new Escritor(normalizar);
  const corpo = [escritor.elementos(elementos, sequencia), escritor.elementos(caixas, sequencia)]
    .filter((parte) => aparar(parte))
    .join("\n\n");

  const rotulos = new Map<string, string>();
  const contagem = { r: 0, f: 0 };
  const texto = corpo.replace(RE_MARCA_DE_NOTA, (_marca, tipo: "r" | "f", id: string) => {
    const chave = `${tipo}:${id}`;
    if (!notas.has(chave)) return "";
    let rotulo = rotulos.get(chave);
    if (rotulo === undefined) {
      contagem[tipo] += 1;
      rotulo = tipo === "r" ? String(contagem.r) : `fim-${contagem.f}`;
      rotulos.set(chave, rotulo);
    }
    return `[^${rotulo}]`;
  });
  const definicoes = [...rotulos]
    .sort(([a], [b]) => (a[0] === b[0] ? 0 : a[0] === "r" ? -1 : 1))
    .map(([chave, rotulo]) => {
      const conteudo = new Escritor(normalizar).elementos(notas.get(chave)!.elementos, sequencia);
      // Uma referência dentro de uma nota não tem para onde apontar.
      return definicaoDeNota(
        rotulo,
        aparar(conteudo.replace(RE_MARCA_DE_NOTA, "").replace(NAO_CARACTERES_DA_MARCA, "")),
      );
    });

  const markdown = `${[aparar(texto), ...definicoes].filter(Boolean).join("\n\n")}\n`;
  // O Markdown gerado também sai do orçamento.
  new Orcamento(opcoes.limitesDeTexto).gastar(markdown.length);
  return markdown;
}
