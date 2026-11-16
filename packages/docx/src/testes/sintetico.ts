/**
 * Construtor de DOCX sintéticos para testes: OOXML mínimo escrito à mão e empacotado com `fflate`,
 * sem Word nem `python-docx`. Não é usado em produção; fica em `src/` para que os testes de outros
 * pacotes (`@simplifica-if/ppc`, a skill `revisar-ppc`) o importem.
 */
import { strToU8, zipSync } from "fflate";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const escaparXml = (texto: string) =>
  texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export type Formato = { negrito?: boolean; italico?: boolean; tachado?: boolean; tamanho?: number };

/** Run: `\t` vira `w:tab` e `\n` vira `w:br`. */
export function run(texto: string, formato: Formato = {}): string {
  const propriedades =
    (formato.negrito ? "<w:b/>" : "") +
    (formato.italico ? "<w:i/>" : "") +
    (formato.tachado ? "<w:strike/>" : "") +
    (formato.tamanho ? `<w:sz w:val="${formato.tamanho * 2}"/>` : "");
  const conteudo = texto
    .split(/(\t|\n)/)
    .map((parte) =>
      parte === "\t"
        ? "<w:tab/>"
        : parte === "\n"
          ? "<w:br/>"
          : parte
            ? `<w:t xml:space="preserve">${escaparXml(parte)}</w:t>`
            : "",
    )
    .join("");
  return `<w:r>${propriedades ? `<w:rPr>${propriedades}</w:rPr>` : ""}${conteudo}</w:r>`;
}

export type OpcoesParagrafo = Formato & { estilo?: string; recuo?: number };

/** Parágrafo de um texto só (com a formatação dada) ou de XML de runs já montado. */
export function par(conteudo: string, opcoes: OpcoesParagrafo = {}): string {
  const { estilo, recuo, ...formato } = opcoes;
  const propriedades = (estilo ? `<w:pStyle w:val="${estilo}"/>` : "") + (recuo ? `<w:ind w:left="${recuo}"/>` : "");
  const runs = conteudo.startsWith("<") ? conteudo : run(conteudo, formato);
  return `<w:p>${propriedades ? `<w:pPr>${propriedades}</w:pPr>` : ""}${runs}</w:p>`;
}

/** Título numerado em negrito, como os PPCs costumam digitar (sem estilo de título). */
export const titulo = (texto: string) => par(texto, { negrito: true });

export type OpcoesCelula = { colunas?: number; vertical?: "inicio" | "continua" };

/** Célula com um parágrafo por linha do texto, ou com o XML dado. */
export function celula(conteudo: string, opcoes: OpcoesCelula = {}): string {
  const propriedades =
    (opcoes.colunas ? `<w:gridSpan w:val="${opcoes.colunas}"/>` : "") +
    (opcoes.vertical ? `<w:vMerge${opcoes.vertical === "inicio" ? ' w:val="restart"' : ""}/>` : "");
  const paragrafos = conteudo.startsWith("<")
    ? conteudo
    : conteudo
        .split("\n")
        .map((linha) => par(linha))
        .join("");
  return `<w:tc>${propriedades ? `<w:tcPr>${propriedades}</w:tcPr>` : ""}${paragrafos || "<w:p/>"}</w:tc>`;
}

export function linha(celulas: string[], opcoes: { antes?: number } = {}): string {
  return `<w:tr>${opcoes.antes ? `<w:trPr><w:gridBefore w:val="${opcoes.antes}"/></w:trPr>` : ""}${celulas.join("")}</w:tr>`;
}

export const tabela = (linhas: string[]) => `<w:tbl><w:tblPr/>${linhas.join("")}</w:tbl>`;

/** Tabela simples: cada item é uma linha de textos (ou de células já montadas). */
export const tabelaDeTextos = (linhas: string[][]) =>
  tabela(linhas.map((itens) => linha(itens.map((item) => (item.startsWith("<w:tc>") ? item : celula(item))))));

/** Controle de conteúdo (`w:sdt`), como o Google Docs embrulha blocos e células. */
export const controle = (conteudo: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${conteudo}</w:sdtContent></w:sdt>`;

export const hyperlink = (texto: string, atributos: string) => `<w:hyperlink ${atributos}>${run(texto)}</w:hyperlink>`;

/** Imagem DrawingML (`a:blip`) dentro de um run. */
export const imagem = (idRelacao: string, descricao = "") =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Figura" descr="${descricao}"/>` +
  `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${idRelacao}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r>`;

/** Fluxograma desenhado com formas: DrawingML sem bitmap, com a versão VML de compatibilidade. */
export const formas = () =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/>` +
  `<wp:docPr id="2" name="Forma"/><a:graphic><a:graphicData/></a:graphic></wp:inline></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:rect style="width:72pt;height:36pt"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

/** Desenho VML legado; com `idRelacao`, é uma imagem (`v:imagedata`). */
export const desenhoLegado = (idRelacao?: string) =>
  `<w:r><w:pict><v:shape style="width:72pt;height:36pt">${idRelacao ? `<v:imagedata r:id="${idRelacao}" o:title="Fluxograma"/>` : ""}</v:shape></w:pict></w:r>`;

const ESTILOS_PADRAO =
  `<w:styles ${NS}>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Ttulo2"><w:name w:val="heading 2"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Ttulo"><w:name w:val="Title"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="PargrafodaLista"><w:name w:val="List Paragraph"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Numerada"><w:name w:val="List Number"/></w:style>` +
  `<w:style w:type="character" w:styleId="Forte"><w:name w:val="Strong"/></w:style>` +
  `</w:styles>`;

const PROPRIEDADES_PADRAO =
  `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>PPC fictício</dc:title><dc:creator>Autora de Teste</dc:creator>` +
  `<cp:lastModifiedBy>Revisor de Teste</cp:lastModifiedBy>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">2026-03-05T10:38:00Z</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-04-22T00:06:00-03:00</dcterms:modified>` +
  `</cp:coreProperties>`;

export type Relacao = { id: string; tipo: "image" | "hyperlink"; alvo: string; externa?: boolean };

export type PartesDocx = {
  /** XML dos blocos do corpo. */
  corpo: string;
  relacoes?: Relacao[];
  /** Arquivos em `word/media/`, por nome. */
  midia?: Record<string, Uint8Array>;
  /** `false` omite o `docProps/core.xml` (como o Google Docs). */
  propriedades?: boolean;
};

/** Empacota o documento num `.docx`. */
export function montarDocx(partes: PartesDocx): Uint8Array {
  const comPropriedades = partes.propriedades !== false;
  const xml = (conteudo: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${conteudo}`);
  const relacoes = (itens: string[]) =>
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${itens.join("")}</Relationships>`,
    );
  const arquivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
        `<Default Extension="emf" ContentType="image/x-emf"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        (comPropriedades
          ? `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
          : "") +
        `</Types>`,
    ),
    "_rels/.rels": relacoes([
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`,
      comPropriedades
        ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
        : "",
    ]),
    "word/document.xml": xml(`<w:document ${NS}><w:body>${partes.corpo}<w:sectPr/></w:body></w:document>`),
    "word/styles.xml": xml(ESTILOS_PADRAO),
    "word/_rels/document.xml.rels": relacoes([
      `<Relationship Id="rIdEstilos" Type="${REL}/styles" Target="styles.xml"/>`,
      ...(partes.relacoes ?? []).map(
        (item) =>
          `<Relationship Id="${item.id}" Type="${REL}/${item.tipo}" Target="${escaparXml(item.alvo)}"${item.externa ? ' TargetMode="External"' : ""}/>`,
      ),
    ]),
  };
  if (comPropriedades) arquivos["docProps/core.xml"] = xml(PROPRIEDADES_PADRAO);
  for (const [nome, bytes] of Object.entries(partes.midia ?? {})) arquivos[`word/media/${nome}`] = bytes;
  // Data fixa nas entradas do ZIP, para o mesmo documento dar sempre os mesmos bytes.
  return zipSync(arquivos, { mtime: "2026-01-01T12:00:00Z" });
}

/** PNG de 1×1 pixel. */
export const PNG_MINIMO = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (caractere) => caractere.charCodeAt(0),
);

/** Bytes com a assinatura de um EMF; o conteúdo não importa para a conversão, que só copia. */
export const EMF_MINIMO = Uint8Array.from([1, 0, 0, 0, 88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x20, 0x45, 0x4d, 0x46]);
