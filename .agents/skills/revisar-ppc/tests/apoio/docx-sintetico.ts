/**
 * DOCX sintéticos para os testes da conversão: OOXML mínimo escrito à mão e empacotado com
 * `fflate`, sem Word nem `python-docx`. Os documentos são fictícios (nenhum trecho de PPC real).
 *
 * `FIXTURES` é a lista usada pelos testes (`tests/conversao-docx.test.ts`) e pelo diferencial
 * contra a conversão antiga (`scripts/dev/diferencial-docx.ts`).
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

// ---------------------------------------------------------------- documentos

const SECAO_GRAFICA = titulo("5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO");

const QUADRO_EMENTA = (
  nome: string,
  periodo: string,
  carga: number,
  ementa: string,
  basica: string[],
  complementar: string[],
) =>
  [
    `COMPONENTE CURRICULAR: ${nome}`,
    `Período letivo: ${periodo}\tCarga horária total: ${carga} horas-aula`,
    `EMENTA: ${ementa}`,
    `BIBLIOGRAFIA BÁSICA:\n${basica.join("\n")}`,
    `BIBLIOGRAFIA COMPLEMENTAR:\n${complementar.join("\n")}`,
  ].map((texto) => [texto]);

const ANO = (texto: string, continua = false) =>
  celula(continua ? "" : texto, { vertical: continua ? "continua" : "inicio" });

/** PPC fictício completo: identificação, matriz no formato legado, ementário e figura PNG. */
function ppcMinimo(): PartesDocx {
  const cabecalhoMatriz = [
    "Ano",
    "Componente Curricular",
    "Número de aulas semanais",
    "CH hora-aula no período",
    "CH hora-relógio no período",
  ];
  const total = "CARGA HORÁRIA TOTAL DO CURSO";
  return {
    relacoes: [
      { id: "rId10", tipo: "image", alvo: "media/image1.png" },
      { id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/cnct", externa: true },
    ],
    midia: { "image1.png": PNG_MINIMO },
    corpo: [
      par("INSTITUTO FEDERAL DE TESTE", { negrito: true, tamanho: 12 }),
      par("PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM TESTES"),
      par("SUMÁRIO", { negrito: true }),
      par("1 APRESENTAÇÃO\t3"),
      par("5.6 MATRIZ CURRICULAR\t12"),
      titulo("1 APRESENTAÇÃO"),
      par("Este projeto apresenta o curso fictício usado nos testes da conversão."),
      tabelaDeTextos([
        ["Nome do curso:", "Curso Técnico em Testes"],
        ["Forma de oferta:", "Integrado"],
        ["Modalidade:", "Presencial"],
        ["Eixo tecnológico:", "Informação e Comunicação"],
        ["Câmpus:", "Campus Foz do Iguaçu"],
        ["Turno:", "Matutino e vespertino"],
        ["Total de vagas:", "40 vagas anuais"],
        ["Carga horária total:", "3.200 horas\nDistribuídas em três anos."],
        ["Base legal específica do curso:", "Resolução fictícia nº 1/2026 | CNCT"],
        ["2026", "Ano de início"],
      ]),
      tabelaDeTextos([["Tipo de matrícula: Por componente curricular"], ["Periodicidade: Anual"]]),
      titulo("1.1 JUSTIFICATIVA"),
      par(
        run("O curso atende à demanda regional, conforme o ") +
          hyperlink("Catálogo Nacional", 'r:id="rId11"') +
          run(" e o ") +
          run("plano", { italico: true }) +
          run(" institucional", { negrito: true, italico: true }) +
          run(" (versão antiga)", { tachado: true }) +
          run("."),
      ),
      par("a) formar profissionais para a região;"),
      par("b) integrar ensino, pesquisa e extensão."),
      par("Texto depois da lista."),
      titulo("5 ORGANIZAÇÃO CURRICULAR"),
      titulo("5.6 MATRIZ CURRICULAR"),
      tabela([
        linha([celula("MATRIZ CURRICULAR DO CURSO TÉCNICO EM TESTES", { colunas: 5 })]),
        linha([celula("Hora aula de 45 min", { colunas: 2 }), celula("Semanas do ano letivo: 40", { colunas: 3 })]),
        linha(cabecalhoMatriz.map((item) => celula(item))),
        linha([ANO("1º Ano"), celula("Língua Portuguesa"), celula("3"), celula("120"), celula("90")]),
        linha([ANO("", true), celula("Lógica de Programação"), celula("4"), celula("160"), celula("120")]),
        linha([ANO("", true), celula("Subtotal (Total do período)"), celula("7"), celula("280"), celula("210")]),
        linha([ANO("2º Ano"), celula("Banco de Dados"), celula("4"), celula("160"), celula("120")]),
        linha([ANO("", true), celula("Subtotal (Total do período)"), celula("4"), celula("160"), celula("120")]),
        linha([celula("Estágio Supervisionado", { colunas: 3 }), celula("240"), celula("200")]),
        linha([celula(total, { colunas: 3 }), celula("680"), celula("530")]),
      ]),
      par("Nota: a matriz acima é fictícia."),
      titulo("5.7 EMENTÁRIO"),
      tabelaDeTextos(
        QUADRO_EMENTA(
          "Língua Portuguesa",
          "1º ano",
          120,
          "Leitura e produção de textos.\nGêneros textuais.",
          [
            "SILVA, Maria. Gramática de teste. Sao Paulo: Editora Fictícia, 2020.",
            "- SOUZA, João de. Redação. 2. ed. Curitiba: Exemplo, 2019. ISBN 978-85-0000-000-0.",
          ],
          [
            "COSTA, Ana. Leitura. Rio de Janeiro: Teste, 2013.PEREIRA, Carlos. Texto e contexto. Porto Alegre: Modelo, 2018. v. 2.OLIVEIRA, Rita. Escrita. Campinas: Amostra, 2021.",
            "BRASIL. Lei nº 9.394, de 20 de dezembro de 1996. Disponível em: https://exemplo.gov.br. Acesso em: 1 jan. 2026.",
          ],
        ),
      ),
      // Quadro do Google Docs: tabela e células embrulhadas em controles, com colunas vazias.
      controle(
        tabela(
          QUADRO_EMENTA(
            "Banco de Dados",
            "2º Ano",
            160,
            "Modelagem de dados.",
            ["DATE, Christopher. Introdução a sistemas de bancos de dados. Rio de Janeiro: Elsevier, 2004."],
            ["ELMASRI, Ramez; NAVATHE, Shamkant. Sistemas de banco de dados. São Paulo: Pearson, 2011."],
          ).map(([texto]) => linha([controle(celula(texto!)), celula(""), celula("")])),
        ),
      ),
      SECAO_GRAFICA,
      par(imagem("rId10", "Fluxograma do curso")),
      par("Figura 1: itinerário formativo."),
      titulo("6 REFERÊNCIAS"),
      par("BRASIL. Catálogo Nacional de Cursos Técnicos. Brasília, 2021."),
    ].join(""),
  };
}

/** Matriz no formato de núcleos (FTP, FGB, NP), dividida em duas tabelas; a segunda continua sem cabeçalho. */
function ppcNucleos(): PartesDocx {
  const cabecalho = [
    "Ano",
    "Componente Curricular",
    "Nº de aulas semanais",
    "Hora-aula FTP",
    "Hora-aula FGB",
    "Hora-aula NP",
    "Hora-aula TOTAL",
    "Hora relógio TOTAL",
  ];
  return {
    corpo: [
      par("DOCUMENTO", { estilo: "Ttulo" }),
      par("Identificação do curso", { estilo: "Ttulo1" }),
      par("Curso: Técnico em Ensaios"),
      par("Campus: Campus de Teste"),
      par("Vagas: 35"),
      par("Organização curricular", { estilo: "Ttulo1" }),
      titulo("5.6 MATRIZ CURRICULAR"),
      tabela([
        linha(cabecalho.map((item) => celula(item))),
        linha([
          ANO("1"),
          celula("Matemática"),
          celula("4"),
          celula(""),
          celula("160"),
          celula(""),
          celula("160"),
          celula("133"),
        ]),
        linha([
          ANO("", true),
          celula("Eletricidade"),
          celula("2"),
          celula("80"),
          celula(""),
          celula(""),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("TOTAL ANO HORA-AULA", { colunas: 3 }),
          celula("80"),
          celula("160"),
          celula("0"),
          celula("240"),
          celula(""),
        ]),
        linha([
          celula("TOTAL ANO HORA-RELÓGIO", { colunas: 3 }),
          celula("67"),
          celula("133"),
          celula("0"),
          celula(""),
          celula("200"),
        ]),
      ]),
      par(""),
      tabela([
        linha([
          celula("2º ano"),
          celula("Projeto Integrador"),
          celula("2"),
          celula(""),
          celula(""),
          celula("80"),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("2º ano"),
          celula("Física"),
          celula("2"),
          celula(""),
          celula("80"),
          celula(""),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("2º ano"),
          celula("Automação"),
          celula("3"),
          celula("120"),
          celula(""),
          celula(""),
          celula("120"),
          celula("100"),
        ]),
        linha([
          celula("Atividades Complementares", { colunas: 3 }),
          celula(""),
          celula(""),
          celula(""),
          celula("60"),
          celula("50"),
        ]),
        linha([
          celula("C.H. (HORA RELÓGIO) TOTAL DO CURSO", { colunas: 3 }),
          celula("167"),
          celula("200"),
          celula("67"),
          celula("484"),
          celula(""),
        ]),
      ]),
      titulo("5.8 FLUXOGRAMA DO CURSO"),
      par(formas()),
      par("O fluxograma acima resume o itinerário."),
    ].join(""),
  };
}

/** Mesclas horizontais, verticais, em bloco e em L, e linha que começa depois da primeira coluna. */
function mesclas(): PartesDocx {
  return {
    corpo: [
      titulo("1 MESCLAS"),
      tabela([
        linha([celula("A"), celula("B e C", { colunas: 2 }), celula("D")]),
        linha([celula("Vertical", { vertical: "inicio" }), celula("x"), celula("y"), celula("z")]),
        linha([
          celula("", { vertical: "continua" }),
          celula("Bloco 2×2", { colunas: 2, vertical: "inicio" }),
          celula("w"),
        ]),
        linha([celula("fim"), celula("", { colunas: 2, vertical: "continua" }), celula("v")]),
      ]),
      par("Em L: a continuação é mais estreita que a célula de cima."),
      tabela([
        linha([celula("Topo largo", { colunas: 2, vertical: "inicio" }), celula("1")]),
        linha([celula("", { vertical: "continua" }), celula("perna"), celula("2")]),
        linha([celula("solta"), celula("3")], { antes: 1 }),
      ]),
      par("Tabela sem texto e tabela com célula de vários parágrafos."),
      tabelaDeTextos([
        ["", ""],
        ["", ""],
      ]),
      tabelaDeTextos([
        ["Campo | com barra", "linha 1\n\n  linha   2  \nlinha 3"],
        ["1,5", "10%"],
        ["2", "- 3"],
      ]),
    ].join(""),
  };
}

/** Controles de conteúdo (`w:sdt`) no corpo, em volta de células e aninhados. */
function controles(): PartesDocx {
  return {
    corpo: [
      titulo("1 CONTROLES"),
      controle(
        par("Parágrafo dentro de controle.") + controle(par("Parágrafo em controle aninhado.", { negrito: true })),
      ),
      controle(
        tabela([
          linha([celula("Item"), celula("Descrição", { colunas: 2 })]),
          linha([celula("Grupo", { vertical: "inicio" }), celula("a"), celula("b")]),
          linha([celula("", { vertical: "continua" }), celula("c"), celula("d\ne")]),
        ]),
      ),
      par("Tabela do corpo com as células embrulhadas:"),
      tabela([
        linha([controle(celula("Campus:")), controle(celula("Campus Embrulhado"))]),
        linha([controle(celula("Turno:")), controle(celula("Noturno"))]),
      ]),
      par("Tabela com uma célula direta e outra embrulhada:"),
      tabela([linha([celula("direta"), controle(celula("embrulhada"))])]),
      par("Tabela aninhada numa célula:"),
      tabela([
        linha([celula(par("fora") + tabelaDeTextos([["dentro 1", "dentro 2"]]) + par("depois")), celula("ao lado")]),
      ]),
    ].join(""),
  };
}

/** Alterações controladas e outros envoltórios de runs. */
function rastreadas(): PartesDocx {
  const insercao = (conteudo: string) =>
    `<w:ins w:id="1" w:author="Revisora" w:date="2026-01-01T00:00:00Z">${conteudo}</w:ins>`;
  const remocao = (texto: string) =>
    `<w:del w:id="2" w:author="Revisora" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>${texto}</w:delText></w:r></w:del>`;
  return {
    relacoes: [{ id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/norma", externa: true }],
    corpo: [
      titulo("1 ALTERAÇÕES CONTROLADAS"),
      par(run("O curso tem ") + remocao("três") + insercao(run("quatro")) + run(" anos de duração.")),
      par(insercao(run("Parágrafo inteiro inserido na revisão."))),
      par(
        run("Movido: ") +
          `<w:moveFrom w:id="3" w:author="R">${run("texto na origem")}</w:moveFrom>` +
          `<w:moveTo w:id="4" w:author="R">${run("texto no destino")}</w:moveTo>`,
      ),
      par(run("Marca: ") + `<w:smartTag w:uri="urn:x" w:element="place">${run("Curitiba")}</w:smartTag>` + run(".")),
      par(
        run("Campo: ") +
          `<w:fldSimple w:instr=" PAGE ">${run("12")}</w:fldSimple>` +
          run(" e controle ") +
          controle(run("em linha")) +
          run("."),
      ),
      par(run("Link revisado: ") + insercao(hyperlink("norma inserida", 'r:id="rId11"')) + run(".")),
      par(insercao(run("2 TÍTULO INSERIDO", { negrito: true }))),
      par("Texto da seção inserida."),
      tabelaDeTextos([
        ["Campo", "Valor"],
        [`<w:tc>${par(run("Duração: ") + insercao(run("4 anos")) + remocao("3 anos"))}</w:tc>`, "sem alteração"],
      ]),
    ].join(""),
  };
}

/** Tabulações, quebras, hífen incondicional, hyperlinks, formatação, títulos e listas. */
function textoEspecial(): PartesDocx {
  return {
    relacoes: [{ id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/pagina", externa: true }],
    corpo: [
      par("Título pelo estilo", { estilo: "Ttulo1" }),
      par("Subtítulo pelo estilo", { estilo: "Ttulo2" }),
      par("", { estilo: "Ttulo1" }),
      par("Coluna 1\tColuna 2\nsegunda linha"),
      par(
        `<w:r><w:t>guarda</w:t><w:noBreakHyphen/><w:t>chuva</w:t><w:br w:type="page"/><w:t> depois da página</w:t><w:cr/>` +
          `<w:t>nova linha</w:t><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/><w:t>à direita</w:t></w:r>`,
      ),
      par(
        hyperlink("externo com âncora", 'r:id="rId11" w:anchor="secao"') +
          run(" ") +
          hyperlink("interno", 'w:anchor="_Toc1"') +
          run(" ") +
          hyperlink("relação quebrada", 'r:id="rId99"') +
          run(" ") +
          `<w:hyperlink r:id="rId11">${run("em dois ", { negrito: true })}${run("pedaços", { negrito: true })}</w:hyperlink>`,
      ),
      par(run("negrito", { negrito: true }) + run(" colado", { negrito: true }) + run(" e normal")),
      par(`<w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/><w:strike w:val="1"/></w:rPr><w:t>só tachado</w:t></w:r>`),
      par("2.1 Numerado em negrito", { negrito: true }),
      par("2.1.1. Com ponto final", { negrito: true }),
      par("1.2.3.4.5.6.7 Fundo demais para título", { negrito: true }),
      par("2024 Número solto em negrito vira título", { negrito: true }),
      par("3 Numerado sem negrito"),
      par("Grande de 18", { negrito: true, tamanho: 18 }),
      par("Médio de 16", { negrito: true, tamanho: 16 }),
      par("Pequeno de 14", { negrito: true, tamanho: 14 }),
      par("Negrito de 12 não é título", { negrito: true, tamanho: 12 }),
      par("Item de lista pelo estilo", { estilo: "PargrafodaLista" }),
      par("Item recuado", { estilo: "PargrafodaLista", recuo: 1440 }),
      par("Numerado pelo estilo", { estilo: "Numerada", recuo: 720 }),
      par("Parágrafo depois da lista."),
      par("1) primeiro"),
      par("2. segundo"),
      par("a) alínea"),
      par("• marcador digitado"),
      par("– travessão"),
      par("-x"),
      par("Fim."),
      tabelaDeTextos([["Depois de parágrafo", "tabela"]]),
      par("• último item"),
      tabelaDeTextos([["Depois de lista", "tabela"]]),
    ].join(""),
  };
}

/** Documento sem nenhum título: os elementos saem em sequência. */
function semSecoes(): PartesDocx {
  return {
    propriedades: false,
    corpo: [
      par("Documento sem títulos."),
      par("- item um"),
      par("- item dois"),
      par("Parágrafo comum."),
      tabelaDeTextos([
        ["Componente Curricular", "Carga horária", "Semestre", "CH total"],
        ["Algoritmos", "80", "1", "80 h"],
        ["Legenda", "", "", ""],
        ["Redes", "sessenta", "2", ""],
      ]),
      par("* item final"),
    ].join(""),
  };
}

const figura = (conteudo: string, extras: Partial<PartesDocx> = {}): PartesDocx => ({
  corpo: [
    titulo("5 ORGANIZAÇÃO"),
    SECAO_GRAFICA,
    par("Texto antes da figura."),
    conteudo,
    titulo("5.12 OUTRA SEÇÃO"),
    par("Fim."),
  ].join(""),
  ...extras,
});

export type Fixture = {
  nome: string;
  partes: () => PartesDocx;
  /**
   * `false` quando o documento exercita uma diferença deliberada em relação à conversão em Python
   * (ou algo em que ela aborta): fica fora do diferencial e é coberto só pelos testes.
   */
  oraculo: boolean;
};

export const FIXTURES: Fixture[] = [
  { nome: "ppc-minimo", partes: ppcMinimo, oraculo: true },
  { nome: "ppc-nucleos", partes: ppcNucleos, oraculo: true },
  { nome: "mesclas", partes: mesclas, oraculo: true },
  { nome: "controles", partes: controles, oraculo: true },
  { nome: "rastreadas", partes: rastreadas, oraculo: true },
  { nome: "texto-especial", partes: textoEspecial, oraculo: true },
  { nome: "sem-secoes", partes: semSecoes, oraculo: true },
  { nome: "figura-vetorial", partes: () => figura(par(formas())), oraculo: true },
  { nome: "figura-legada", partes: () => figura(par(desenhoLegado())), oraculo: true },
  { nome: "figura-ausente", partes: () => figura(par("Só texto.")), oraculo: true },
  // A conversão em Python grava o EMF com o nome `representacao_grafica.png` e o anuncia como imagem.
  {
    nome: "figura-emf",
    partes: () =>
      figura(par(imagem("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.emf" }],
        midia: { "image1.emf": EMF_MINIMO },
      }),
    oraculo: false,
  },
  {
    nome: "figura-legada-emf",
    partes: () =>
      figura(par(desenhoLegado("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.emf" }],
        midia: { "image1.emf": EMF_MINIMO },
      }),
    oraculo: true,
  },
  // Idem, com o JPEG gravado como `.png`.
  {
    nome: "figura-jpeg",
    partes: () =>
      figura(par(imagem("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.jpeg" }],
        midia: { "image1.jpeg": PNG_MINIMO },
      }),
    oraculo: false,
  },
  // O `python-docx` lança `ValueError` nesta mescla (a continuação não tem célula acima na mesma coluna).
  {
    nome: "mescla-malformada",
    partes: () => ({
      corpo:
        titulo("1 MESCLA MALFORMADA") +
        tabela([
          linha([celula("larga", { colunas: 2 }), celula("c")]),
          linha([celula("a"), celula("órfã", { vertical: "continua" }), celula("c2")]),
          linha([celula("topo", { vertical: "continua" }), celula("x"), celula("y")]),
        ]),
    }),
    oraculo: false,
  },
];

/** Bytes do DOCX de uma fixture. */
export function docxDaFixture(nome: string): Uint8Array {
  const fixture = FIXTURES.find((item) => item.nome === nome);
  if (!fixture) throw new Error(`Fixture desconhecida: ${nome}`);
  return montarDocx(fixture.partes());
}
