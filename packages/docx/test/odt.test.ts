/**
 * `odtParaMarkdown`: o texto de um `.odt` em Markdown, sobre ODT sintéticos. Os casos hostis
 * repetem os do DOCX (`leitor.test.ts`, `markdown.test.ts`): o ZIP e o XML são os mesmos.
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { mensagemErroDocx, type MotivoErroDocx } from "../src/erro.ts";
import { LIMITES_PADRAO } from "../src/limites.ts";
import { odtParaMarkdown } from "../src/odt.ts";
import { ErroDocx } from "../src/pacote.ts";
import {
  celula,
  coberta,
  h,
  link,
  linha,
  lista,
  montarOdt,
  nota,
  p,
  quadro,
  span,
  tabela,
} from "../src/testes/sintetico-odt.ts";
import { montarDocx, par } from "../src/testes/sintetico.ts";

const md = (corpo: string, extras: Partial<Parameters<typeof montarOdt>[0]> = {}) =>
  odtParaMarkdown(montarOdt({ corpo, ...extras }));

function erroDe(acao: () => unknown): ErroDocx {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDocx);
    return erro as ErroDocx;
  }
  throw new Error("não lançou");
}

function esperarMotivo(acao: () => unknown, motivo: MotivoErroDocx): ErroDocx {
  const erro = erroDe(acao);
  expect(erro.motivo).toBe(motivo);
  expect(erro.dados.formato).toBe("ODT");
  return erro;
}

describe("odtParaMarkdown", () => {
  test("o que vem antes do primeiro título fica, e cada parágrafo é um parágrafo", () => {
    const corpo =
      p("Dispõe sobre a minuta.") + p("RESOLVE:") + h("Capítulo I") + p("Texto do capítulo.") + h("Seção 1", 2) + p("");
    expect(md(corpo)).toBe(
      "Dispõe sobre a minuta.\n\nRESOLVE:\n\n## Capítulo I\n\nTexto do capítulo.\n\n### Seção 1\n",
    );
  });

  test("o parágrafo de estilo Title (ou derivado dele) é o título de nível 1", () => {
    const estilos = '<style:style style:name="Title" style:family="paragraph"/>';
    const automaticos = '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Title"/>';
    expect(md(p("Minuta", "P1") + p("Corpo."), { estilos, estilosAutomaticos: automaticos })).toBe(
      "## Minuta\n\nCorpo.\n",
    );
  });

  test("negrito, itálico e tachado pelos estilos, com herança do parágrafo e dos estilos comuns", () => {
    const estilos =
      '<style:style style:name="Strong_20_Emphasis" style:family="text"><style:text-properties fo:font-weight="700"/></style:style>';
    const automaticos =
      '<style:style style:name="T9" style:family="text" style:parent-style-name="Strong_20_Emphasis"/>' +
      '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
      '<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
      '<style:style style:name="T3" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>' +
      '<style:style style:name="P1" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style>' +
      '<style:style style:name="T4" style:family="text"><style:text-properties fo:font-weight="normal"/></style:style>';
    const corpo =
      p(`<text:span text:style-name="T1">negrito</text:span> e ${span("itálico", "T2")} e ${span("velho", "T3")}`) +
      p(span("herdado", "T9")) +
      p(`Todo em negrito, ${span("menos isto", "T4")}.`, "P1");
    expect(md(corpo, { estilos, estilosAutomaticos: automaticos })).toBe(
      "**negrito** e *itálico* e ~~velho~~\n\n**herdado**\n\n**Todo em negrito,** menos isto**.**\n",
    );
  });

  test("lista com níveis, numerada × marcadores pelo estilo da lista", () => {
    const corpo =
      lista(["Primeiro", p("Segundo") + lista(["Sub um", "Sub dois"])], "L2") +
      p("Depois.") +
      lista(["Item", p("Outro") + lista(["Fundo"])], "L1");
    expect(md(corpo)).toBe(
      "1. Primeiro\n1. Segundo\n  - Sub um\n  - Sub dois\n\nDepois.\n\n- Item\n- Outro\n  - Fundo\n",
    );
  });

  test("tabela com mescla horizontal e vertical: a célula se repete em cada posição coberta", () => {
    const corpo = tabela(
      [
        linha([celula("Componente"), celula("Carga horária", { colunas: 2 }), coberta()]),
        linha([celula("Matemática", { linhas: 2 }), celula("80"), celula("1º")]),
        linha([coberta(), celula("40"), celula("2º")]),
      ],
      3,
    );
    expect(md(corpo)).toBe(
      "| Componente | Carga horária | Carga horária |\n" +
        "|---|---:|---|\n" +
        "| Matemática | 80 | 1º |\n" +
        "| Matemática | 40 | 2º |\n",
    );
  });

  test("célula com vários parágrafos vira uma linha com <br>", () => {
    expect(md(tabela([linha([celula(p("um") + p("dois")), celula("três")])]))).toBe(
      "| um<br>dois | três |\n|---|---|\n",
    );
  });

  test("links: só http, https e mailto viram link", () => {
    const corpo = p(
      `Veja ${link("o site", "https://ifpr.edu.br/a b")}, ${link("escreva", "mailto:x@ifpr.edu.br")} e ${link("isto", "javascript:alert(1)")}.`,
    );
    expect(md(corpo)).toBe("Veja [o site](https://ifpr.edu.br/a%20b), [escreva](mailto:x@ifpr.edu.br) e isto.\n");
  });

  test("notas de rodapé e de fim, cada série numerada na ordem do texto, com as definições no fim", () => {
    const corpo =
      p(`Primeira${nota("ftn1", ["Nota um."])} e fim${nota("edn1", ["Nota de fim."], "fim")}.`) +
      p(`Segunda${nota("ftn2", ["Dois parágrafos.", "Segundo."])}.`);
    expect(md(corpo)).toBe(
      "Primeira[^1] e fim[^fim-1].\n\nSegunda[^2].\n\n" +
        "[^1]: Nota um.\n\n[^2]: Dois parágrafos.\n\n    Segundo.\n\n[^fim-1]: Nota de fim.\n",
    );
  });

  test("texto excluído com controle de alterações fica de fora; o inserido fica", () => {
    const inicioDoCorpo =
      '<text:tracked-changes><text:changed-region text:id="ct1"><text:deletion>' +
      '<office:change-info><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">X</dc:creator></office:change-info>' +
      p("texto apagado") +
      '</text:deletion></text:changed-region><text:changed-region text:id="ct2"><text:insertion>' +
      "<office:change-info/></text:insertion></text:changed-region></text:tracked-changes>";
    const corpo = p(
      'Antes <text:change text:change-id="ct1"/>e <text:change-start text:change-id="ct2"/>novo<text:change-end text:change-id="ct2"/> depois.',
    );
    expect(md(corpo, { inicioDoCorpo })).toBe("Antes e novo depois.\n");
  });

  test("espaços: text:s, tabulação, quebra de linha e o espaço do XML que não conta", () => {
    const corpo =
      p('a <text:s text:c="3"/>b<text:tab/>c<text:line-break/>d') +
      p("  espaços\n   do   XML  ") +
      p("<text:s/>recuo<text:soft-page-break/> fim");
    expect(md(corpo)).toBe("a    b\tc\nd\n\nespaços do XML\n\n recuo fim\n");
  });

  test("comentário e imagem ficam de fora; o texto do quadro vai para Caixas de texto", () => {
    const corpo =
      p(
        'Texto<office:annotation><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">X</dc:creator>' +
          `${p("comentário")}</office:annotation> visível.${quadro(["Na caixa.", "Outra linha."])}`,
      ) + p('<draw:frame draw:name="Imagem1"><draw:image xlink:href="Pictures/a.png"/></draw:frame>');
    expect(md(corpo)).toBe("Texto visível.\n\n## Caixas de texto\n\nNa caixa.\n\nOutra linha.\n");
  });

  test("seções e índices: o texto dentro entra, o modelo do índice não", () => {
    const corpo =
      '<text:table-of-content text:name="Sumário"><text:table-of-content-source>' +
      "<text:index-title-template>Modelo</text:index-title-template></text:table-of-content-source>" +
      `<text:index-body>${p("1 Introdução")}</text:index-body></text:table-of-content>` +
      `<text:section text:name="S1">${h("Introdução")}${p("Texto.")}</text:section>`;
    expect(md(corpo)).toBe("1 Introdução\n\n## Introdução\n\nTexto.\n");
  });

  test("documento sem texto: sem-texto", () => {
    esperarMotivo(() => md(p("") + p("   ") + p('<text:s text:c="4"/>')), "sem-texto");
    esperarMotivo(() => md(tabela([linha([celula(""), celula("")])])), "sem-texto");
  });

  test("não é ODT: um .docx, outro tipo de OpenDocument ou pacote sem tipo", () => {
    const docx = esperarMotivo(() => odtParaMarkdown(montarDocx({ corpo: par("x") })), "nao-e-odt");
    expect(docx.message).toBe(
      "O arquivo não é um documento de texto OpenDocument (.odt): o pacote não declara esse tipo de documento.",
    );
    esperarMotivo(
      () => odtParaMarkdown(montarOdt({ corpo: p("x"), mimetype: "application/vnd.oasis.opendocument.spreadsheet" })),
      "nao-e-odt",
    );
    // Sem o `mimetype`, vale o tipo da entrada `/` do manifesto.
    expect(odtParaMarkdown(montarOdt({ corpo: p("x"), mimetype: null }))).toBe("x\n");
    esperarMotivo(() => odtParaMarkdown(zipSync({ "a.txt": strToU8("x") })), "nao-e-odt");
    esperarMotivo(
      () => odtParaMarkdown(montarOdt({ corpo: "", partes: { "content.xml": "<x/>" } })),
      "sem-documento-principal",
    );
  });

  test("cifrado: protegido, com a frase do ODT", () => {
    const manifestoExtra =
      '<manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="x">' +
      '<manifest:algorithm manifest:algorithm-name="Blowfish CFB" manifest:initialisation-vector="x"/>' +
      "</manifest:encryption-data>";
    const erro = esperarMotivo(() => odtParaMarkdown(montarOdt({ corpo: p("x"), manifestoExtra })), "protegido");
    expect(erro.message).toBe("O arquivo ODT está protegido por senha. Salve sem senha e tente de novo.");
  });

  test("arquivo hostil ou quebrado sai com ErroDocx e a frase do ODT", () => {
    expect(esperarMotivo(() => odtParaMarkdown(strToU8("isto não é zip")), "nao-e-zip").message).toBe(
      "O arquivo não é um ODT: não tem o formato de pacote (ZIP) dos documentos OpenDocument.",
    );
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Array<number>(500).fill(0)]);
    esperarMotivo(() => odtParaMarkdown(ole), "doc-ou-protegido");
    const odt = montarOdt({ corpo: p("x") });
    esperarMotivo(() => odtParaMarkdown(odt.slice(0, 200)), "zip-corrompido");
    expect(
      esperarMotivo(() => odtParaMarkdown(odt, { limites: { bytesDoArquivo: 100 } }), "arquivo-grande-demais").message,
    ).toMatch(/^O arquivo ODT tem 0 MB, e o limite é de 0 MB\..*No LibreOffice, compacte as imagens/);
    esperarMotivo(
      () => odtParaMarkdown(montarOdt({ corpo: p("x").repeat(200) }), { limites: { elementosPorParte: 100 } }),
      "elementos-demais",
    );
    expect(
      esperarMotivo(() => odtParaMarkdown(montarOdt({ corpo: "<text:p>aberto" })), "xml-mal-formado").message,
    ).toBe("O arquivo ODT está corrompido: content.xml não é um XML bem formado.");
  });

  test("aninhamento profundo é recusado, não estoura a pilha", () => {
    const niveis = LIMITES_PADRAO.profundidadeDoXml;
    const corpo = `${"<text:section>".repeat(niveis)}${p("x")}${"</text:section>".repeat(niveis)}`;
    expect(esperarMotivo(() => md(corpo), "aninhamento-demais").message).toBe(
      "O arquivo ODT não pôde ser lido: content.xml tem elementos aninhados demais.",
    );
  });

  test("bomba de compressão no content.xml: compressão anormal", { timeout: 10_000 }, () => {
    const corpo = p(" ".repeat(20_000_000));
    esperarMotivo(() => md(corpo), "compressao-anormal");
  });

  test("entradas demais no ZIP", () => {
    const partes: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) partes[`x/${i}.xml`] = "";
    const odt = montarOdt({ corpo: p("a"), partes });
    esperarMotivo(() => odtParaMarkdown(odt, { limites: { entradas: 100 } }), "partes-demais");
    expect(odtParaMarkdown(odt)).toBe("a\n");
  });

  test("contagens hostis: text:c, colunas e linhas repetidas não multiplicam a memória", () => {
    esperarMotivo(() => md(p('x<text:s text:c="1000000000"/>y')), "sequencia-sem-texto");
    esperarMotivo(
      () =>
        odtParaMarkdown(montarOdt({ corpo: p(`x${'<text:s text:c="900"/>y'.repeat(10_000)}`) }), {
          limitesDeTexto: { caracteresNoDocumento: 1_000_000 },
        }),
      "texto-demais",
    );
    const larga = '<table:table-cell table:number-columns-repeated="1000000000"/>';
    expect(esperarMotivo(() => md(tabela([linha([celula("a"), larga])])), "celulas-por-linha").message).toBe(
      "O arquivo ODT não pôde ser lido: há uma tabela com mais de 1024 células numa linha.",
    );
    const alta = `<table:table-row table:number-rows-repeated="1000000000">${celula("a")}${celula("b")}</table:table-row>`;
    esperarMotivo(() => md(tabela([alta])), "tabela-grande-demais");
    // Mescla que diz cobrir um bilhão de linhas e colunas: só as posições cobertas que existem contam.
    const mescla = tabela([
      linha([celula("a", { colunas: 1_000_000_000, linhas: 1_000_000_000 }), coberta()]),
      linha([coberta(), coberta()]),
    ]);
    expect(md(mescla)).toBe("| a | a |\n|---|---|\n| a | a |\n");
  });

  test("o orçamento de texto vale, inclusive para as notas", () => {
    const corpo = p(`Texto${nota("ftn1", ["n".repeat(2000)])}`);
    expect(md(corpo)).toContain("[^1]: ");
    esperarMotivo(
      () => odtParaMarkdown(montarOdt({ corpo }), { limitesDeTexto: { caracteresPorBloco: 1000 } }),
      "bloco-longo",
    );
  });
});

describe("mensagemErroDocx com o formato", () => {
  test("sem formato, a frase do DOCX; com ODT, a do ODT", () => {
    expect(mensagemErroDocx({ motivo: "partes-demais", limite: 10 })).toBe(
      "O arquivo DOCX tem partes demais (o limite é de 10).",
    );
    expect(mensagemErroDocx({ motivo: "partes-demais", limite: 10, formato: "ODT" })).toBe(
      "O arquivo ODT tem partes demais (o limite é de 10).",
    );
    expect(mensagemErroDocx({ motivo: "sem-documento-principal", formato: "ODT" })).toBe(
      "O arquivo não é um documento OpenDocument: o pacote não tem documento principal.",
    );
  });
});
