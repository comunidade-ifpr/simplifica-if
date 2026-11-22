/**
 * Do modelo do DOCX aos elementos do texto: o que é título, parágrafo, item de lista, tabela e figura.
 *
 * O leitor (`leitor.ts`) diz o que o arquivo contém; este módulo decide o que isso significa num
 * documento digitado sem os estilos de título do Word, como os PPCs e as minutas costumam ser: um
 * parágrafo numerado e todo em negrito é título, mesmo no estilo Normal. Quem dá sentido de PPC
 * aos elementos (seções, matriz, ementário) é o `@simplifica-if/ppc`.
 */
import { match } from "@simplifica-if/kb/primitivas/regex";
import { aparar, contarCaracteres } from "@simplifica-if/kb/texto";
import {
  type CelulaOoxml,
  type DocumentoOoxml,
  type FiguraOoxml,
  type LinhaOoxml,
  type ParagrafoOoxml,
  runsDoParagrafo,
  type TabelaOoxml,
  textoDoParagrafo,
} from "./modelo.ts";

const r = String.raw;

export type Trecho = {
  texto: string;
  negrito: boolean;
  italico: boolean;
  tachado: boolean;
  url: string | null;
};

export type Titulo = { tipo: "titulo"; texto: string; nivel: number; estilo: string | null };

export type Paragrafo = {
  tipo: "paragrafo";
  trechos: Trecho[];
  estilo: string | null;
  itemDeLista: boolean;
  nivelLista: number;
  tipoLista: "marcador" | "numerada" | null;
};

/** Célula como o documento a grava, uma vez só, mesmo quando ocupa várias colunas ou linhas. */
export type CelulaTabela = {
  texto: string;
  /** Colunas da grade ocupadas pela célula. */
  colunas: number;
  /** Continuação de uma mescla vertical: o texto está na célula de cima. */
  continuacao: boolean;
};

/** Tabela com as células de cada linha; a grade, com as mesclas expandidas, sai de `tabelas.ts`. */
export type Tabela = { tipo: "tabela"; linhas: CelulaTabela[][] };

export type Figura = { tipo: "figura"; figura: FiguraOoxml };

export type Elemento = Titulo | Paragrafo | Tabela | Figura;

/** Texto de um parágrafo. */
export function textoDosTrechos(paragrafo: Paragrafo): string {
  return paragrafo.trechos.map((trecho) => trecho.texto).join("");
}

// ---------------------------------------------------------------- títulos

const NIVEL_POR_ESTILO: Record<string, number> = {
  Title: 1,
  Título: 1,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].flatMap((nivel) => [
      [`Heading ${nivel}`, nivel],
      [`Título ${nivel}`, nivel],
    ]),
  ),
};

const NUMERACAO_DE_SECAO = r`^(\d+(?:\.\d+)*\.?)\s*(.+)$`;

/**
 * Título reconhecido pela formatação: texto numerado (`1.`, `1.1`, `5.6.2`) todo em negrito, ou
 * texto curto todo em negrito com fonte de 14 pt ou mais. Só conta o negrito aplicado direto no
 * run; o herdado do estilo não é visto.
 */
function tituloPorFormatacao(paragrafo: ParagrafoOoxml): Titulo | null {
  const texto = aparar(textoDoParagrafo(paragrafo));
  if (!texto) return null;
  const runs = runsDoParagrafo(paragrafo);
  const todoNegrito = runs.filter((run) => aparar(run.texto)).every((run) => run.negrito === true);

  const numerado = match(NUMERACAO_DE_SECAO, texto);
  if (numerado && todoNegrito) {
    // `1.` e `1` são nível 1; `1.1.` e `1.1`, nível 2.
    const nivel = numerado[1]!.replace(/\.+$/, "").split(".").length;
    if (nivel <= 6) return { tipo: "titulo", texto, nivel, estilo: null };
  }

  if (contarCaracteres(texto) < 200 && todoNegrito) {
    const tamanho = runs.find((run) => run.tamanhoPt)?.tamanhoPt;
    if (tamanho && tamanho >= 14) {
      return { tipo: "titulo", texto, nivel: tamanho >= 18 ? 1 : tamanho >= 16 ? 2 : 3, estilo: null };
    }
  }
  return null;
}

const COMECA_COM_NUMERO_DE_SECAO = r`^\d+(?:\.\d+)*\.?\s`;

/**
 * Texto de corpo num parágrafo com estilo de título. Acontece quando o autor escreve o corpo logo
 * depois do título sem trocar o estilo; tratado como título, cada frase abriria uma seção e a
 * seção de verdade ficaria vazia. É corpo:
 * - a frase de 200 caracteres ou mais;
 * - o item de lista com marcador (numeração automática do tipo `bullet`);
 * - sem numeração de seção no início, o texto terminado em ponto e vírgula, ou o de oito palavras
 *   ou mais terminado em ponto ou dois-pontos.
 */
function ehTextoDeCorpo(paragrafo: ParagrafoOoxml, texto: string): boolean {
  if (contarCaracteres(texto) >= 200 || paragrafo.numeracao?.formato === "bullet") return true;
  if (match(COMECA_COM_NUMERO_DE_SECAO, texto)) return false;
  if (texto.endsWith(";")) return true;
  return /[.:]$/.test(texto) && texto.split(/\s+/).length >= 8;
}

// ---------------------------------------------------------------- listas

const ESTILOS_DE_LISTA = [
  "List Bullet",
  "List Number",
  "List Paragraph",
  "Lista com marcadores",
  "Lista numerada",
  "Parágrafo de Lista",
];
const MARCADORES = ["•", "-", "*", "–", "—"];

/**
 * Item de lista pelo estilo, pela numeração automática do Word ou pelo próprio texto (`1.`, `a)`,
 * `•`, `-`).
 */
function itemDeLista(paragrafo: ParagrafoOoxml): Pick<Paragrafo, "itemDeLista" | "nivelLista" | "tipoLista"> {
  const numeracao = paragrafo.numeracao;
  if (numeracao) {
    return {
      itemDeLista: true,
      nivelLista: numeracao.nivel,
      tipoLista: numeracao.formato === "bullet" ? "marcador" : "numerada",
    };
  }
  const estilo = paragrafo.estilo ?? "";
  if (ESTILOS_DE_LISTA.some((nome) => estilo.includes(nome))) {
    const numerada = estilo.includes("Number") || estilo.includes("numerada");
    // Cada meia polegada de recuo é um nível.
    const nivel = paragrafo.recuoEsquerdoEmu ? Math.trunc(paragrafo.recuoEsquerdoEmu / 914400 / 0.5) : 0;
    return { itemDeLista: true, nivelLista: nivel, tipoLista: numerada ? "numerada" : "marcador" };
  }
  const texto = aparar(textoDoParagrafo(paragrafo));
  if (match(r`^[\d]+[.)]\s`, texto) || match(r`^[a-z][.)]\s`, texto, { ignoreCase: true })) {
    return { itemDeLista: true, nivelLista: 0, tipoLista: "numerada" };
  }
  if (MARCADORES.some((marcador) => texto.startsWith(marcador)) && contarCaracteres(texto) > 2) {
    return { itemDeLista: true, nivelLista: 0, tipoLista: "marcador" };
  }
  return { itemDeLista: false, nivelLista: 0, tipoLista: null };
}

// ---------------------------------------------------------------- parágrafos

function trechosDoParagrafo(paragrafo: ParagrafoOoxml): Trecho[] {
  const trechos: Trecho[] = [];
  for (const item of paragrafo.itens) {
    const url = item.tipo === "hyperlink" ? item.url : null;
    for (const run of item.tipo === "run" ? [item] : item.runs) {
      if (!run.texto) continue;
      trechos.push({
        texto: run.texto,
        negrito: run.negrito === true,
        italico: run.italico === true,
        tachado: run.tachado === true,
        url,
      });
    }
  }
  return trechos;
}

/** Título, parágrafo ou nada (parágrafo vazio). */
function elementoDoParagrafo(paragrafo: ParagrafoOoxml): Titulo | Paragrafo | null {
  const nivel = paragrafo.estilo === null ? undefined : NIVEL_POR_ESTILO[paragrafo.estilo];
  if (nivel !== undefined) {
    const texto = aparar(textoDoParagrafo(paragrafo));
    if (!texto) return null;
    if (!ehTextoDeCorpo(paragrafo, texto)) return { tipo: "titulo", texto, nivel, estilo: paragrafo.estilo };
  }
  const titulo = tituloPorFormatacao(paragrafo);
  if (titulo) return titulo;
  const trechos = trechosDoParagrafo(paragrafo);
  if (!aparar(trechos.map((trecho) => trecho.texto).join(""))) return null;
  return { tipo: "paragrafo", trechos, estilo: paragrafo.estilo, ...itemDeLista(paragrafo) };
}

// ---------------------------------------------------------------- tabelas

/**
 * As células de uma linha como o arquivo as grava, cada uma uma vez: as colunas que ocupa
 * (`w:gridSpan`) e a marca de continuação de mescla vertical. As colunas puladas no início
 * (`w:gridBefore`) viram uma célula vazia, para que as demais fiquem na coluna certa da grade. A
 * expansão em grade, com as repetições das mesclas, fica em `tabelas.ts`.
 */
function linhaDaTabela(linha: LinhaOoxml, celulas: CelulaOoxml[], profundo: boolean): CelulaTabela[] {
  const lidas = celulas.map((celula): CelulaTabela => ({
    texto: profundo ? celula.textoProfundo : aparar(celula.texto),
    colunas: celula.colunas,
    continuacao: celula.mesclaVertical === "continuacao",
  }));
  if (!lidas.length || !linha.colunasAntes) return lidas;
  return [{ texto: "", colunas: linha.colunasAntes, continuacao: false }, ...lidas];
}

/**
 * Só as células filhas diretas da linha (numa linha que tem alguma, as embrulhadas em `w:sdt`
 * também são dela), com o texto dos parágrafos delas.
 */
function celulasDiretas(tabela: TabelaOoxml): CelulaTabela[][] {
  const mista = tabela.linhas.some((linha) => linha.celulas.some((celula) => celula.direta));
  return tabela.linhas.map((linha) =>
    linhaDaTabela(
      linha,
      linha.celulas.filter((celula) => celula.direta || (mista && celula.embrulhada)),
      false,
    ),
  );
}

/**
 * Todas as células descendentes da linha, com o texto de todos os parágrafos delas. Usada nas
 * tabelas embrulhadas em `w:sdt` (Google Docs), em que a linha não tem células filhas diretas.
 */
function celulasDescendentes(tabela: TabelaOoxml): CelulaTabela[][] {
  return tabela.linhas.map((linha) => linhaDaTabela(linha, linha.celulas, true)).filter((linha) => linha.length > 0);
}

function elementoDaTabela(tabela: TabelaOoxml): Tabela {
  if (tabela.emControle) return { tipo: "tabela", linhas: celulasDescendentes(tabela) };
  const linhas = celulasDiretas(tabela);
  // Nenhuma célula direta com texto: as células estão embrulhadas (ou a tabela é vazia).
  const temTexto = linhas.some((linha) => linha.some((celula) => celula.texto));
  return { tipo: "tabela", linhas: temTexto ? linhas : celulasDescendentes(tabela) };
}

// ---------------------------------------------------------------- documento

/** Elementos na ordem do documento; a figura de um parágrafo vem antes do texto dele. */
export function elementosDoDocumento(documento: DocumentoOoxml): Elemento[] {
  const elementos: Elemento[] = [];
  for (const bloco of documento.blocos) {
    if (bloco.tipo === "tabela") {
      elementos.push(elementoDaTabela(bloco));
      continue;
    }
    if (bloco.figura) elementos.push({ tipo: "figura", figura: bloco.figura });
    const elemento = elementoDoParagrafo(bloco);
    if (elemento) elementos.push(elemento);
  }
  return elementos;
}

/** Elemento com texto: título, parágrafo ou tabela com alguma célula preenchida. */
export function temTexto(elemento: Elemento): boolean {
  if (elemento.tipo === "titulo" || elemento.tipo === "paragrafo") return true;
  return elemento.tipo === "tabela" && elemento.linhas.some((linha) => linha.some((celula) => celula.texto));
}
