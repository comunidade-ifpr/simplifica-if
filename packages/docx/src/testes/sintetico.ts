/**
 * Construtor de DOCX sintéticos para testes: OOXML mínimo escrito à mão e empacotado com `fflate`,
 * sem Word. Não é usado em produção; fica em `src/` para que os testes de outros
 * pacotes (`@simplifica-if/ppc`, a skill `revisar-ppc`) o importem.
 */
import { strToU8, zipSync } from "fflate";
import { problemasOoxml } from "./validar-ooxml.ts";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

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

export type OpcoesParagrafo = Formato & {
  estilo?: string;
  recuo?: number;
  /** Numeração automática (`w:numPr`): id da numeração (veja `NUMERACAO_PADRAO`) e nível. */
  numeracao?: { id: number; nivel?: number };
};

/** Parágrafo de um texto só (com a formatação dada) ou de XML de runs já montado. */
export function par(conteudo: string, opcoes: OpcoesParagrafo = {}): string {
  const { estilo, recuo, numeracao, ...formato } = opcoes;
  const propriedades =
    (estilo ? `<w:pStyle w:val="${estilo}"/>` : "") +
    (numeracao
      ? `<w:numPr><w:ilvl w:val="${numeracao.nivel ?? 0}"/><w:numId w:val="${numeracao.id}"/></w:numPr>`
      : "") +
    (recuo ? `<w:ind w:left="${recuo}"/>` : "");
  const runs = conteudo.startsWith("<") ? conteudo : run(conteudo, formato);
  return `<w:p>${propriedades ? `<w:pPr>${propriedades}</w:pPr>` : ""}${runs}</w:p>`;
}

/** Título numerado em negrito, como os PPCs costumam digitar (sem estilo de título). */
export const titulo = (texto: string) => par(texto, { negrito: true });

export type OpcoesCelula = { colunas?: number; vertical?: "inicio" | "continua" };

/** Conteúdo de bloco que termina numa tabela (inclusive dentro de controles de conteúdo). */
const terminaEmTabela = (xml: string) => /<\/w:tbl>(?:<\/w:sdtContent><\/w:sdt>)*$/.test(xml);

/**
 * O Word exige um parágrafo depois de uma tabela no fim de uma célula, de uma caixa de texto ou do
 * corpo; sem ele, recusa o arquivo ("conteúdo ilegível").
 */
export const comParagrafoFinal = (xml: string) => (terminaEmTabela(xml) ? `${xml}<w:p/>` : xml);

/** Célula com um parágrafo por linha do texto, ou com o XML dado (que ganha parágrafo final, se preciso). */
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
  return `<w:tc>${propriedades ? `<w:tcPr>${propriedades}</w:tcPr>` : ""}${comParagrafoFinal(paragrafos) || "<w:p/>"}</w:tc>`;
}

export function linha(celulas: string[], opcoes: { antes?: number } = {}): string {
  return `<w:tr>${opcoes.antes ? `<w:trPr><w:gridBefore w:val="${opcoes.antes}"/></w:trPr>` : ""}${celulas.join("")}</w:tr>`;
}

/** Colunas da grade ocupadas por uma linha: células, `w:gridSpan` e `w:gridBefore`/`w:gridAfter`. */
function colunasDaLinha(xml: string): number {
  let profundidade = 0;
  let colunas = 0;
  for (const [, fecha, nome, resto] of xml.matchAll(/<(\/?)w:(tbl|tc|gridSpan|gridBefore|gridAfter)\b([^>]*)>/g)) {
    if (nome === "tbl") {
      if (!resto!.endsWith("/")) profundidade += fecha ? -1 : 1;
      continue;
    }
    if (profundidade > 0 || fecha) continue;
    const valor = Number(/w:val="(\d+)"/.exec(resto!)?.[1] ?? 1);
    colunas += nome === "tc" ? 1 : nome === "gridSpan" ? valor - 1 : valor;
  }
  return colunas;
}

/** Tabela com a grade (`w:tblGrid`) que o Word grava: uma `w:gridCol` por coluna, 9.000 twips no total. */
export function tabela(linhas: string[]): string {
  const colunas = Math.max(1, ...linhas.map(colunasDaLinha));
  const largura = Math.floor(9000 / colunas);
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    `<w:tblGrid>${`<w:gridCol w:w="${largura}"/>`.repeat(colunas)}</w:tblGrid>${linhas.join("")}</w:tbl>`
  );
}

/** Tabela simples: cada item é uma linha de textos (ou de células já montadas). */
export const tabelaDeTextos = (linhas: string[][]) =>
  tabela(linhas.map((itens) => linha(itens.map((item) => (item.startsWith("<w:tc>") ? item : celula(item))))));

/** Controle de conteúdo (`w:sdt`), como o Google Docs embrulha blocos e células. */
export const controle = (conteudo: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${conteudo}</w:sdtContent></w:sdt>`;

export const hyperlink = (texto: string, atributos: string) => `<w:hyperlink ${atributos}>${run(texto)}</w:hyperlink>`;

const URI_PICTURE = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const URI_WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const RETANGULO = (cx: number, cy: number) =>
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
const EM_LINHA = 'distT="0" distB="0" distL="0" distR="0"';

/**
 * Imagem DrawingML (`a:blip`) dentro de um run, com os elementos que o esquema exige (`pic:nvPicPr`,
 * `pic:spPr`, o `uri` de `a:graphicData`). `idDesenho` é o `wp:docPr/@id`, único no documento.
 */
export const imagem = (idRelacao: string, descricao = "", idDesenho = 1) =>
  `<w:r><w:drawing><wp:inline ${EM_LINHA}><wp:extent cx="914400" cy="457200"/>` +
  `<wp:docPr id="${idDesenho}" name="Figura ${idDesenho}" descr="${escaparXml(descricao)}"/>` +
  `<a:graphic><a:graphicData uri="${URI_PICTURE}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Figura ${idDesenho}"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${idRelacao}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr>${RETANGULO(914400, 457200)}</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** Fluxograma desenhado com formas: DrawingML sem bitmap (`wps:wsp`), com a versão VML de compatibilidade. */
export const formas = (idDesenho = 2) =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline ${EM_LINHA}><wp:extent cx="914400" cy="457200"/>` +
  `<wp:docPr id="${idDesenho}" name="Forma ${idDesenho}"/><a:graphic><a:graphicData uri="${URI_WPS}">` +
  `<wps:wsp><wps:cNvSpPr/><wps:spPr>${RETANGULO(914400, 457200)}</wps:spPr><wps:bodyPr/></wps:wsp>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:rect style="width:72pt;height:36pt"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

/** Desenho VML legado; com `idRelacao`, é uma imagem (`v:imagedata`). */
export const desenhoLegado = (idRelacao?: string) =>
  `<w:r><w:pict><v:shape id="Desenho" style="width:72pt;height:36pt">${idRelacao ? `<v:imagedata r:id="${idRelacao}" o:title="Fluxograma"/>` : ""}</v:shape></w:pict></w:r>`;

/** O tipo de forma 202 (caixa de texto) do VML, que o Word declara antes da primeira caixa. */
const TIPO_CAIXA_VML =
  '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
  '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';

const caixaVml = (conteudo: string, idDesenho: number) =>
  `<w:pict>${TIPO_CAIXA_VML}<v:shape id="Caixa de Texto ${idDesenho}" o:spid="_x0000_s${1025 + idDesenho}" type="#_x0000_t202" ` +
  `style="position:absolute;margin-left:0;margin-top:0;width:300pt;height:40pt;z-index:251659264;visibility:visible" stroked="f">` +
  `<v:textbox><w:txbxContent>${conteudo}</w:txbxContent></v:textbox><w10:wrap type="square"/></v:shape></w:pict>`;

/**
 * Caixa de texto dentro de um run. `"atual"` é como o Word grava desde 2010: `mc:AlternateContent` com
 * a forma DrawingML (`wps:wsp` com `wps:txbx`) no `mc:Choice` e a mesma caixa em VML no `mc:Fallback`.
 * `"vml"` é só a versão VML (`w:pict`), como gravavam o Word 2007 e conversores antigos.
 * `conteudo` são parágrafos (`par(...)`); ganha parágrafo final se terminar em tabela.
 */
export function caixaDeTexto(conteudo: string, opcoes: { formato?: "atual" | "vml"; idDesenho?: number } = {}): string {
  const id = opcoes.idDesenho ?? 3;
  const texto = comParagrafoFinal(conteudo);
  if (opcoes.formato === "vml") return `<w:r>${caixaVml(texto, id)}</w:r>`;
  const cx = 3810000;
  const cy = 508000;
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>` +
    `<wp:anchor distT="45720" distB="45720" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" ` +
    `behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>` +
    `<wp:docPr id="${id}" name="Caixa de Texto ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${URI_WPS}"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr>${RETANGULO(cx, cy)}<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${texto}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>` +
    `</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
    `<mc:Fallback>${caixaVml(texto, id)}</mc:Fallback></mc:AlternateContent></w:r>`
  );
}

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

const nivelDeNumeracao = (nivel: number, formato: string, texto: string) =>
  `<w:lvl w:ilvl="${nivel}"><w:start w:val="1"/><w:numFmt w:val="${formato}"/><w:lvlText w:val="${texto}"/></w:lvl>`;

/**
 * `word/numbering.xml` para os testes: numeração 1 com marcadores, 2 decimal com alíneas no segundo
 * nível, 3 em romanos e 4 que redefine o primeiro nível da 2 como marcador (`w:lvlOverride`).
 */
export const NUMERACAO_PADRAO =
  `<w:abstractNum w:abstractNumId="0">${nivelDeNumeracao(0, "bullet", "●")}${nivelDeNumeracao(1, "bullet", "○")}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1">${nivelDeNumeracao(0, "decimal", "%1.")}${nivelDeNumeracao(1, "lowerLetter", "%2)")}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2">${nivelDeNumeracao(0, "upperRoman", "%1.")}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
  `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
  `<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>` +
  `<w:num w:numId="4"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0">${nivelDeNumeracao(0, "bullet", "–")}</w:lvlOverride></w:num>`;

const PROPRIEDADES_PADRAO =
  `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>PPC fictício</dc:title><dc:creator>Autora de Teste</dc:creator>` +
  `<cp:lastModifiedBy>Revisor de Teste</cp:lastModifiedBy>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">2026-03-05T10:38:00Z</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-04-22T00:06:00-03:00</dcterms:modified>` +
  `</cp:coreProperties>`;

/** Referência a nota de rodapé ou de fim num run sobrescrito, como o Word grava. */
export const referenciaDeNota = (id: number, tipo: "rodape" | "fim" = "rodape") =>
  `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${tipo === "rodape" ? "footnote" : "endnote"}Reference w:id="${id}"/></w:r>`;

/**
 * Nota de rodapé (`w:footnote`) ou de fim (`w:endnote`), um parágrafo por texto; o primeiro começa
 * com o número da nota (`w:footnoteRef`), como o Word grava. Vai em `PartesDocx.notas`.
 */
export function nota(id: number, textos: string[], tipo: "rodape" | "fim" = "rodape"): string {
  const nome = tipo === "rodape" ? "footnote" : "endnote";
  const numero = `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${nome}Ref/></w:r>`;
  const paragrafos = textos.map((texto, indice) =>
    par((indice === 0 ? numero : "") + run(indice === 0 ? ` ${texto}` : texto)),
  );
  return `<w:${nome} w:id="${id}">${paragrafos.join("") || "<w:p/>"}</w:${nome}>`;
}

/** As notas de separador e de continuação, que o Word grava antes das notas (ids -1 e 0). */
const separadoresDeNotas = (nome: string) =>
  `<w:${nome} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${nome}>` +
  `<w:${nome} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${nome}>`;

export type Relacao = { id: string; tipo: "image" | "hyperlink"; alvo: string; externa?: boolean };

export type PartesDocx = {
  /** XML dos blocos do corpo. */
  corpo: string;
  relacoes?: Relacao[];
  /** Arquivos em `word/media/`, por nome. */
  midia?: Record<string, Uint8Array>;
  /** `false` omite o `docProps/core.xml` (como o Google Docs). */
  propriedades?: boolean;
  /** Conteúdo de `word/numbering.xml` (por exemplo `NUMERACAO_PADRAO`); sem ele, a parte não existe. */
  numeracao?: string;
  /**
   * Notas de `word/footnotes.xml` e `word/endnotes.xml` (`nota(...)`), depois dos separadores; sem
   * elas, a parte não existe.
   */
  notas?: { rodape?: string[]; fim?: string[] };
  /**
   * `false` deixa de conferir o pacote com `problemasOoxml` (as regras que, violadas, fazem o Word
   * recusar o arquivo). Só para os testes que montam de propósito um documento que o Word não abriria.
   */
  validar?: boolean;
};

const SECAO = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

/** Relação de hiperlink externo, para o `r:id` de `hyperlink(...)`: sem ela, o Word não abre o arquivo. */
export const linkExterno = (id: string, alvo = "https://www.gov.br/mec/"): Relacao => ({
  id,
  tipo: "hyperlink",
  alvo,
  externa: true,
});

/**
 * Empacota o documento num `.docx`. O corpo ganha um parágrafo final quando termina em tabela, e o
 * pacote é conferido com `problemasOoxml` (lança se o Word o recusaria), salvo `validar: false`.
 */
export function montarDocx(partes: PartesDocx): Uint8Array {
  const comPropriedades = partes.propriedades !== false;
  const rodape = partes.notas?.rodape;
  const fim = partes.notas?.fim;
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
        (partes.numeracao
          ? `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`
          : "") +
        (rodape
          ? `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`
          : "") +
        (fim
          ? `<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>`
          : "") +
        `</Types>`,
    ),
    "_rels/.rels": relacoes([
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`,
      comPropriedades
        ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
        : "",
    ]),
    "word/document.xml": xml(
      `<w:document ${NS}><w:body>${comParagrafoFinal(partes.corpo)}${SECAO}</w:body></w:document>`,
    ),
    "word/styles.xml": xml(ESTILOS_PADRAO),
    "word/_rels/document.xml.rels": relacoes([
      `<Relationship Id="rIdEstilos" Type="${REL}/styles" Target="styles.xml"/>`,
      partes.numeracao ? `<Relationship Id="rIdNumeracao" Type="${REL}/numbering" Target="numbering.xml"/>` : "",
      rodape ? `<Relationship Id="rIdNotasDeRodape" Type="${REL}/footnotes" Target="footnotes.xml"/>` : "",
      fim ? `<Relationship Id="rIdNotasDeFim" Type="${REL}/endnotes" Target="endnotes.xml"/>` : "",
      ...(partes.relacoes ?? []).map(
        (item) =>
          `<Relationship Id="${item.id}" Type="${REL}/${item.tipo}" Target="${escaparXml(item.alvo)}"${item.externa ? ' TargetMode="External"' : ""}/>`,
      ),
    ]),
  };
  if (comPropriedades) arquivos["docProps/core.xml"] = xml(PROPRIEDADES_PADRAO);
  if (partes.numeracao) arquivos["word/numbering.xml"] = xml(`<w:numbering ${NS}>${partes.numeracao}</w:numbering>`);
  if (rodape)
    arquivos["word/footnotes.xml"] = xml(
      `<w:footnotes ${NS}>${separadoresDeNotas("footnote")}${rodape.join("")}</w:footnotes>`,
    );
  if (fim)
    arquivos["word/endnotes.xml"] = xml(
      `<w:endnotes ${NS}>${separadoresDeNotas("endnote")}${fim.join("")}</w:endnotes>`,
    );
  for (const [nome, bytes] of Object.entries(partes.midia ?? {})) arquivos[`word/media/${nome}`] = bytes;
  // Data fixa nas entradas do ZIP, para o mesmo documento dar sempre os mesmos bytes.
  const docx = zipSync(arquivos, { mtime: "2026-01-01T12:00:00Z" });
  if (partes.validar !== false) {
    const problemas = problemasOoxml(docx);
    if (problemas.length) throw new Error(`DOCX sintético que o Word recusaria:\n- ${problemas.join("\n- ")}`);
  }
  return docx;
}

/** PNG de 1×1 pixel. */
export const PNG_MINIMO = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (caractere) => caractere.charCodeAt(0),
);

/** Bytes com a assinatura de um EMF; o conteúdo não importa para a conversão, que só copia. */
export const EMF_MINIMO = Uint8Array.from([1, 0, 0, 0, 88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x20, 0x45, 0x4d, 0x46]);
