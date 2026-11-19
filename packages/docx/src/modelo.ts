/**
 * Modelo intermediário de um DOCX: o que o arquivo diz, sem nada de PPC.
 *
 * É a fronteira entre a leitura do OOXML (`leitor.ts`) e as regras de domínio (`elementos.ts`
 * em diante): quem decide o que é título, item de lista ou matriz curricular trabalha só com estes
 * tipos, nunca com XML.
 *
 * A formatação é só a direta (a que está no próprio run), sem a herdada do estilo: é o que a
 * detecção de títulos sempre usou, e é o que um PPC digitado "na mão" (negrito e tamanho aplicados
 * sobre o estilo Normal) permite distinguir.
 */

/** Trecho de texto com formatação direta; `null` quando o run não define a propriedade. */
export type RunOoxml = {
  texto: string;
  negrito: boolean | null;
  italico: boolean | null;
  tachado: boolean | null;
  /** Tamanho da fonte em pontos. */
  tamanhoPt: number | null;
};

export type ItemParagrafo =
  | ({ tipo: "run" } & RunOoxml)
  | {
      tipo: "hyperlink";
      /** Endereço com a âncora; `null` para link interno ou relação quebrada. */ url: string | null;
      runs: RunOoxml[];
    };

/** Figura ancorada num parágrafo. */
export type FiguraOoxml =
  | {
      tipo: "imagem";
      /** `drawing`: DrawingML (`a:blip`); `vml`: imagem legada (`v:imagedata`, em `w:pict` ou `w:object`). */
      origem: "drawing" | "vml";
      idRelacao: string;
      /** Parte do ZIP com a barra inicial (`/word/media/image1.png`); `null` se a relação não resolve. */
      parte: string | null;
      textoAlternativo: string;
      larguraEmu: number | null;
      alturaEmu: number | null;
    }
  | {
      /** Desenho feito com formas do Word, sem arquivo de imagem. */
      tipo: "forma";
      origem: "drawing" | "vml";
    };

export type ParagrafoOoxml = {
  tipo: "paragrafo";
  /** Dentro de um controle de conteúdo (`w:sdt`) no nível do corpo, como o Google Docs exporta. */
  emControle: boolean;
  /** Nome do estilo de parágrafo (o aplicado ou o padrão do documento), como o Word o exibe. */
  estilo: string | null;
  /** Recuo esquerdo direto (`w:ind/@w:left`), em EMU. */
  recuoEsquerdoEmu: number | null;
  itens: ItemParagrafo[];
  /**
   * Numeração automática aplicada direto no parágrafo (`w:numPr`): o nível e o formato do
   * marcador (`bullet`, `decimal`, `lowerLetter`, `upperRoman`…). `null` sem numeração.
   */
  numeracao: { nivel: number; formato: string } | null;
  /** Primeira figura do parágrafo; só é lida em parágrafos do corpo fora de `w:sdt`. */
  figura: FiguraOoxml | null;
};

export type CelulaOoxml = {
  /** Filha direta da linha; `false` para célula embrulhada em `w:sdt` ou de tabela aninhada. */
  direta: boolean;
  /**
   * Célula da própria linha, mas embrulhada em `w:sdt` ou `w:customXml` (não é de tabela
   * aninhada).
   */
  embrulhada: boolean;
  /** Colunas da grade ocupadas (`w:gridSpan`), de 1 a 63 (o máximo do Word). */
  colunas: number;
  /** Mescla vertical (`w:vMerge`): onde ela começa ou continua. */
  mesclaVertical: "inicio" | "continuacao" | null;
  /** Texto dos parágrafos filhos diretos, um por linha (com tabulações e quebras). */
  texto: string;
  /**
   * Texto de todos os parágrafos descendentes não vazios, um por linha, cada um lido
   * como os do corpo.
   */
  textoProfundo: string;
};

export type LinhaOoxml = {
  /** Colunas da grade vazias antes da primeira célula (`w:gridBefore`), de 0 a 63. */
  colunasAntes: number;
  /** Todas as células descendentes da linha, na ordem do documento. */
  celulas: CelulaOoxml[];
};

export type TabelaOoxml = {
  tipo: "tabela";
  emControle: boolean;
  linhas: LinhaOoxml[];
};

export type BlocoOoxml = ParagrafoOoxml | TabelaOoxml;

/** Propriedades do documento (`docProps/core.xml`); texto vazio e data `null` quando ausentes. */
export type PropriedadesOoxml = {
  titulo: string;
  autor: string;
  assunto: string;
  palavrasChave: string;
  /** Datas em UTC, no formato `AAAA-MM-DDTHH:MM:SS+00:00`. */
  criadoEm: string | null;
  modificadoEm: string | null;
  modificadoPor: string;
};

/** Nota de rodapé (`word/footnotes.xml`) ou de fim (`word/endnotes.xml`). */
export type TipoNota = "rodape" | "fim";

export type NotaOoxml = {
  tipo: TipoNota;
  /** `w:id` da nota, como está no arquivo. */
  id: string;
  /** Conteúdo da nota, lido como o corpo. */
  blocos: BlocoOoxml[];
};

export type DocumentoOoxml = {
  blocos: BlocoOoxml[];
  propriedades: PropriedadesOoxml;
  /**
   * Notas de rodapé e de fim, na ordem dos arquivos, sem as de separador; vazio quando a leitura
   * não as pede (`OpcoesLeitura.notas`).
   */
  notas: NotaOoxml[];
};

/**
 * Marca de referência a nota, no texto do run onde a referência está (`w:footnoteReference`,
 * `w:endnoteReference`), quando a leitura pede as notas. Usa dois não caracteres do Unicode
 * (U+FDD0 e U+FDD1, reservados para uso interno) para não colidir com texto do documento; o leitor
 * tira os dois do texto lido quando as notas estão ligadas. É texto e não item do parágrafo porque
 * a célula de tabela é lida como texto e a referência também aparece nela.
 */
const INICIO_DA_MARCA = "\uFDD0";
const FIM_DA_MARCA = "\uFDD1";
export const NAO_CARACTERES_DA_MARCA = /[\uFDD0\uFDD1]/g;

export function marcaDeNota(tipo: TipoNota, id: string): string {
  return `${INICIO_DA_MARCA}${tipo === "rodape" ? "r" : "f"}${id.replace(NAO_CARACTERES_DA_MARCA, "")}${FIM_DA_MARCA}`;
}

/** As marcas de nota num texto: grupo 1 é `r` (rodapé) ou `f` (fim), grupo 2 é o id. */
export const RE_MARCA_DE_NOTA = /\uFDD0([rf])([^\uFDD1]*)\uFDD1/g;

/** Texto de um run ou hyperlink do parágrafo. */
export function textoDoItem(item: ItemParagrafo): string {
  return item.tipo === "run" ? item.texto : item.runs.map((run) => run.texto).join("");
}

/** Texto completo do parágrafo. */
export function textoDoParagrafo(paragrafo: ParagrafoOoxml): string {
  return paragrafo.itens.map(textoDoItem).join("");
}

/** Runs do parágrafo, com os de dentro dos hyperlinks, na ordem do texto. */
export function runsDoParagrafo(paragrafo: ParagrafoOoxml): RunOoxml[] {
  return paragrafo.itens.flatMap((item) => (item.tipo === "run" ? [item] : item.runs));
}
