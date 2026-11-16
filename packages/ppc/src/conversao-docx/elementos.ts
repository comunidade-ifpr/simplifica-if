/**
 * Do modelo do DOCX aos elementos do PPC: o que é título, parágrafo, item de lista, tabela e figura.
 *
 * Aqui começam as regras de domínio. O leitor (`ooxml/`) diz o que o arquivo contém; este módulo
 * decide o que isso significa num PPC, que costuma ser digitado sem os estilos de título do Word:
 * um parágrafo numerado e todo em negrito é título, mesmo no estilo Normal.
 */
import { match } from "@simplifica-if/kb/python/re";
import { aparar, contarCaracteres } from "@simplifica-if/kb/texto";
import {
  type DocumentoOoxml,
  type FiguraOoxml,
  type ParagrafoOoxml,
  runsDoParagrafo,
  type TabelaOoxml,
  textoDoParagrafo,
} from "@simplifica-if/docx/modelo";

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

export type CelulaTabela = {
  texto: string;
  /** Colunas ocupadas pela célula. */
  colunas: number;
  /** Continuação de uma mescla vertical: o texto está na célula de cima. */
  continuacao: boolean;
};

export type Tabela = { tipo: "tabela"; linhas: CelulaTabela[][] };

export type Figura = { tipo: "figura"; figura: FiguraOoxml };

export type Elemento = Titulo | Paragrafo | Tabela | Figura;

/** Texto de um parágrafo do PPC. */
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
 * Item de lista pelo estilo ou pelo próprio texto (`1.`, `a)`, `•`, `-`).
 *
 * A numeração automática do Word (`w:numPr`) não é consultada: a conversão em Python a procurava
 * no lugar errado e nunca a encontrou, e as fichas foram calibradas com o Markdown que sai assim.
 */
function itemDeLista(paragrafo: ParagrafoOoxml): Pick<Paragrafo, "itemDeLista" | "nivelLista" | "tipoLista"> {
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
    return texto ? { tipo: "titulo", texto, nivel, estilo: paragrafo.estilo } : null;
  }
  const titulo = tituloPorFormatacao(paragrafo);
  if (titulo) return titulo;
  const trechos = trechosDoParagrafo(paragrafo);
  if (!aparar(trechos.map((trecho) => trecho.texto).join(""))) return null;
  return { tipo: "paragrafo", trechos, estilo: paragrafo.estilo, ...itemDeLista(paragrafo) };
}

// ---------------------------------------------------------------- tabelas

/**
 * Grade em que a célula mesclada se repete: uma célula que ocupa três colunas aparece três vezes,
 * e a continuação de uma mescla vertical repete a célula de cima. É a leitura do `python-docx`
 * (`row.cells`), da qual a extração da matriz curricular depende: "CARGA HORÁRIA TOTAL DO CURSO"
 * mesclada sobre "Ano" e "Componente" chega nas duas colunas.
 *
 * Só vê as células filhas diretas da linha; as embrulhadas em `w:sdt` ficam para `gradeDireta`.
 */
function gradeRepetida(tabela: TabelaOoxml): CelulaTabela[][] {
  const diretas = tabela.linhas.map((linha) => linha.celulas.filter((celula) => celula.direta));
  /** Célula que guarda o conteúdo: a própria, ou a do topo da mescla vertical. */
  const origem = (indiceLinha: number, indiceCelula: number): (typeof diretas)[number][number] => {
    const celula = diretas[indiceLinha]![indiceCelula]!;
    if (celula.mesclaVertical !== "continuacao" || indiceLinha === 0) return celula;
    let deslocamento = tabela.linhas[indiceLinha]!.colunasAntes;
    for (let i = 0; i < indiceCelula; i += 1) deslocamento += diretas[indiceLinha]![i]!.colunas;
    // A célula de cima é a que começa exatamente na mesma coluna da grade.
    let restante = deslocamento - tabela.linhas[indiceLinha - 1]!.colunasAntes;
    for (const [indice, acima] of diretas[indiceLinha - 1]!.entries()) {
      if (restante < 0) break;
      if (restante === 0) return origem(indiceLinha - 1, indice);
      restante -= acima.colunas;
    }
    // Mescla malformada (nada começa nessa coluna na linha de cima): a célula vale por si. O
    // `python-docx` lança `ValueError` aqui e a conversão antiga abortava.
    return celula;
  };
  return diretas.map((linha, indiceLinha) =>
    linha.flatMap((_, indiceCelula) => {
      const celula = origem(indiceLinha, indiceCelula);
      const lida: CelulaTabela = { texto: aparar(celula.texto), colunas: 1, continuacao: false };
      return Array.from({ length: celula.colunas }, () => lida);
    }),
  );
}

/**
 * Grade lida direto do XML: todas as células descendentes da linha, cada uma uma vez, com o número
 * de colunas e a marca de continuação. Usada nas tabelas embrulhadas em `w:sdt` (Google Docs), em
 * que a linha não tem células filhas diretas.
 */
function gradeDireta(tabela: TabelaOoxml): CelulaTabela[][] {
  return tabela.linhas
    .map((linha) =>
      linha.celulas.map((celula): CelulaTabela => ({
        texto: celula.textoProfundo,
        colunas: celula.colunas,
        continuacao: celula.mesclaVertical === "continuacao",
      })),
    )
    .filter((linha) => linha.length > 0);
}

function elementoDaTabela(tabela: TabelaOoxml): Tabela {
  if (tabela.emControle) return { tipo: "tabela", linhas: gradeDireta(tabela) };
  const linhas = gradeRepetida(tabela);
  // Nenhuma célula direta com texto: as células estão embrulhadas (ou a tabela é vazia).
  const temTexto = linhas.some((linha) => linha.some((celula) => celula.texto));
  return { tipo: "tabela", linhas: temTexto ? linhas : gradeDireta(tabela) };
}

// ---------------------------------------------------------------- documento

/** Elementos do PPC na ordem do documento; a figura de um parágrafo vem antes do texto dele. */
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
