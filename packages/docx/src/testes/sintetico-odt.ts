/**
 * Construtor de ODT sintéticos para testes: OpenDocument mínimo escrito à mão e empacotado com
 * `fflate`, sem LibreOffice. Não é usado em produção.
 */
import { strToU8, type Zippable, zipSync } from "fflate";
import { escaparXml } from "./sintetico.ts";

export const TIPO_ODT = "application/vnd.oasis.opendocument.text";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'office:version="1.3"';

/** Conteúdo de parágrafo: com `<` é XML já montado (texto e elementos); sem, texto escapado. */
const conteudo = (texto: string) => (texto.includes("<") ? texto : escaparXml(texto));

export const p = (texto: string, estilo?: string) =>
  `<text:p${estilo ? ` text:style-name="${estilo}"` : ""}>${conteudo(texto)}</text:p>`;

export const h = (texto: string, nivel = 1) => `<text:h text:outline-level="${nivel}">${conteudo(texto)}</text:h>`;

export const span = (texto: string, estilo: string) =>
  `<text:span text:style-name="${estilo}">${conteudo(texto)}</text:span>`;

export const link = (texto: string, url: string) =>
  `<text:a xlink:type="simple" xlink:href="${escaparXml(url)}">${conteudo(texto)}</text:a>`;

/** Lista; cada item é texto (um parágrafo) ou XML já montado (outra lista, vários parágrafos). */
export const lista = (itens: string[], estilo?: string) =>
  `<text:list${estilo ? ` text:style-name="${estilo}"` : ""}>${itens
    .map((item) => `<text:list-item>${item.startsWith("<") ? item : p(item)}</text:list-item>`)
    .join("")}</text:list>`;

export type OpcoesCelulaOdt = { colunas?: number; linhas?: number };

export const celula = (texto: string, opcoes: OpcoesCelulaOdt = {}) =>
  `<table:table-cell office:value-type="string"` +
  (opcoes.colunas ? ` table:number-columns-spanned="${opcoes.colunas}"` : "") +
  (opcoes.linhas ? ` table:number-rows-spanned="${opcoes.linhas}"` : "") +
  `>${texto.startsWith("<") ? texto : p(texto)}</table:table-cell>`;

export const coberta = () => "<table:covered-table-cell/>";

export const linha = (celulas: string[]) => `<table:table-row>${celulas.join("")}</table:table-row>`;

export const tabela = (linhas: string[], colunas = 2) =>
  `<table:table table:name="Tabela1"><table:table-column table:number-columns-repeated="${colunas}"/>` +
  `${linhas.join("")}</table:table>`;

/** Nota no lugar da referência: `rodape` (`footnote`) ou `fim` (`endnote`). */
export const nota = (id: string, paragrafos: string[], tipo: "rodape" | "fim" = "rodape") =>
  `<text:note text:id="${id}" text:note-class="${tipo === "rodape" ? "footnote" : "endnote"}">` +
  `<text:note-citation>${escaparXml(id)}</text:note-citation>` +
  `<text:note-body>${paragrafos.map((texto) => p(texto)).join("")}</text:note-body></text:note>`;

/** Quadro com caixa de texto, como o LibreOffice grava (âncora no parágrafo). */
export const quadro = (paragrafos: string[]) =>
  `<draw:frame draw:name="Quadro1" text:anchor-type="paragraph" svg:width="5cm">` +
  `<draw:text-box>${paragrafos.map((texto) => p(texto)).join("")}</draw:text-box></draw:frame>`;

/** Estilos automáticos de texto usados nos testes: `T1` negrito, `T2` itálico, `T3` tachado. */
export const ESTILOS_DE_TEXTO =
  '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
  '<style:style style:name="T3" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>';

/** Listas: `L1` com marcadores, `L2` numerada no nível 1 e com marcadores no 2. */
export const ESTILOS_DE_LISTA =
  '<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/>' +
  '<text:list-level-style-bullet text:level="2" text:bullet-char="◦"/></text:list-style>' +
  '<text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1"/>' +
  '<text:list-level-style-bullet text:level="2" text:bullet-char="•"/></text:list-style>';

export type OpcoesOdt = {
  /** O conteúdo de `office:text`. */
  corpo: string;
  /** Estilos automáticos de `content.xml`; padrão: `ESTILOS_DE_TEXTO` e `ESTILOS_DE_LISTA`. */
  estilosAutomaticos?: string;
  /** Estilos comuns, em `styles.xml`. */
  estilos?: string;
  /** Antes do corpo, em `office:text` (o `text:tracked-changes`). */
  inicioDoCorpo?: string;
  /** O conteúdo do arquivo `mimetype`; `null` o tira do pacote. */
  mimetype?: string | null;
  /** Elementos a mais no manifesto (`manifest:encryption-data` dentro de uma entrada). */
  manifestoExtra?: string;
  /** Partes a mais, ou trocadas (`content.xml` cru). */
  partes?: Record<string, string>;
};

/** O `.odt` com `mimetype` como primeira entrada, sem compressão, como o formato pede. */
export function montarOdt(opcoes: OpcoesOdt): Uint8Array {
  const automaticos = opcoes.estilosAutomaticos ?? ESTILOS_DE_TEXTO + ESTILOS_DE_LISTA;
  const content =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}>` +
    `<office:automatic-styles>${automaticos}</office:automatic-styles>` +
    `<office:body><office:text>${opcoes.inicioDoCorpo ?? ""}${opcoes.corpo}</office:text></office:body>` +
    "</office:document-content>";
  const styles =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}>` +
    `<office:styles>${opcoes.estilos ?? ""}</office:styles></office:document-styles>`;
  const manifesto =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${TIPO_ODT}"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml">${opcoes.manifestoExtra ?? ""}</manifest:file-entry>` +
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    "</manifest:manifest>";
  const arquivos: Zippable = {};
  const mimetype = opcoes.mimetype === undefined ? TIPO_ODT : opcoes.mimetype;
  if (mimetype !== null) arquivos["mimetype"] = [strToU8(mimetype), { level: 0 }];
  const partes: Record<string, string> = {
    "content.xml": content,
    "styles.xml": styles,
    "META-INF/manifest.xml": manifesto,
    ...opcoes.partes,
  };
  for (const [nome, texto] of Object.entries(partes)) arquivos[nome] = strToU8(texto);
  return zipSync(arquivos);
}
