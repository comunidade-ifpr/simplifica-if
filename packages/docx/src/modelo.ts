/**
 * Modelo intermediário de um DOCX: o que o arquivo diz, sem nada de PPC.
 *
 * É a fronteira entre a leitura do OOXML (`leitor.ts`) e as regras de domínio (`../elementos.ts`
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
   * marcador (`bullet`, `decimal`, `lowerLetter`, `upperRoman`…). `null` sem numeração e no modo
   * `python-docx`, que não a lê.
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
   * aninhada). Só o modo `documento` a distingue; no `python-docx` é sempre `false`.
   */
  embrulhada: boolean;
  /** Colunas da grade ocupadas (`w:gridSpan`), de 1 a 63 (o máximo do Word). */
  colunas: number;
  /** Mescla vertical (`w:vMerge`): onde ela começa ou continua. */
  mesclaVertical: "inicio" | "continuacao" | null;
  /** Texto dos parágrafos filhos diretos, um por linha (com tabulações e quebras). */
  texto: string;
  /**
   * Texto de todos os parágrafos descendentes não vazios, um por linha. No modo `documento`, cada
   * parágrafo é lido como os do corpo; no `python-docx`, é a junção crua dos `w:t` (sem tabulações,
   * com o texto movido e as duas versões de `mc:AlternateContent`).
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

export type DocumentoOoxml = {
  blocos: BlocoOoxml[];
  propriedades: PropriedadesOoxml;
};

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
