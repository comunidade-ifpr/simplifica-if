/**
 * O validador estrutural de teste (`src/testes/validar-ooxml.ts`): cada regra pega o defeito que a
 * motivou, e os documentos sintéticos bem montados passam.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { comentarDocx } from "../src/comentarios.ts";
import {
  caixaDeTexto,
  celula,
  formas,
  hyperlink,
  imagem,
  linha,
  linkExterno,
  montarDocx,
  par,
  PNG_MINIMO,
  tabela,
  tabelaDeTextos,
} from "../src/testes/sintetico.ts";
import { problemasOoxml } from "../src/testes/validar-ooxml.ts";

/** Troca o `document.xml` de um DOCX sintético. */
function comDocumento(docx: Uint8Array, trocar: (xml: string) => string): Uint8Array {
  const partes = unzipSync(docx);
  partes["word/document.xml"] = strToU8(trocar(strFromU8(partes["word/document.xml"]!)));
  return zipSync(partes);
}

const BASE = montarDocx({ corpo: par("Texto.") });

describe("problemasOoxml", () => {
  test("documentos sintéticos completos passam: tabela, caixas de texto, imagem, formas e link", () => {
    const docx = montarDocx({
      corpo:
        par(hyperlink("link", 'r:id="rIdLink"')) +
        par(imagem("rIdImagem", "Figura", 1)) +
        par(formas(2)) +
        par(caixaDeTexto(par("caixa atual"), { idDesenho: 3 })) +
        par(caixaDeTexto(par("caixa legada"), { formato: "vml", idDesenho: 4 })) +
        tabela([linha([celula("a", { colunas: 2 })]), linha([celula("b"), celula(tabelaDeTextos([["aninhada"]]))])]),
      relacoes: [linkExterno("rIdLink"), { id: "rIdImagem", tipo: "image", alvo: "media/imagem.png" }],
      midia: { "imagem.png": PNG_MINIMO },
    });
    expect(problemasOoxml(docx)).toEqual([]);
    const documento = strFromU8(unzipSync(docx)["word/document.xml"]!);
    // O gerador fecha com parágrafo a célula e o corpo que terminariam em tabela, e declara a grade.
    expect(documento).toContain("</w:tbl><w:p/></w:tc>");
    expect(documento).toContain("</w:tbl><w:p/><w:sectPr>");
    expect(documento).toContain('<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>');
  });

  test("referência a relação inexistente (o hiperlink que impedia o Word de abrir a amostra 4)", () => {
    const docx = montarDocx({ corpo: par(hyperlink("link", 'r:id="rIdLink"')), validar: false });
    expect(problemasOoxml(docx)).toEqual([
      'word/document.xml: w:hyperlink/@r:id="rIdLink" sem relação em word/_rels/document.xml.rels',
    ]);
    expect(() => montarDocx({ corpo: par(hyperlink("link", 'r:id="rIdLink"')) })).toThrow(/Word recusaria/);
  });

  test("corpo e célula que terminam em tabela; tabela sem grade ou com grade curta", () => {
    const semGrade = "<w:tbl><w:tblPr/><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>";
    const docx = comDocumento(BASE, (xml) => xml.replace(/<w:p>.*<\/w:p>/, semGrade));
    expect(problemasOoxml(docx)).toEqual([
      "word/document.xml: o corpo termina em w:tbl, não num parágrafo (w:p)",
      "word/document.xml: a tabela 1 sem w:tblGrid logo depois de w:tblPr",
    ]);
    const curta =
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc><w:tc>' +
      `${semGrade.replace("<w:tblPr/>", "<w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>")}</w:tc></w:tr></w:tbl><w:p/>`;
    expect(problemasOoxml(comDocumento(BASE, (xml) => xml.replace(/<w:p>.*<\/w:p>/, curta)))).toEqual([
      "word/document.xml: a tabela 1 ocupa 2 colunas, mas w:tblGrid declara 1",
      "word/document.xml: a célula 2 termina em w:tbl, não num parágrafo (w:p)",
    ]);
  });

  test("prefixo sem declaração, mc:Ignorable e mc:Choice com prefixo desconhecido", () => {
    const docx = comDocumento(BASE, (xml) =>
      xml
        .replace(
          "<w:document ",
          '<w:document mc:Ignorable="w14 w15" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ',
        )
        .replace(
          "<w:p>",
          '<w:p w15:x="1"><w:r><mc:AlternateContent><mc:Choice Requires="wpg"/></mc:AlternateContent></w:r>',
        ),
    );
    expect(problemasOoxml(docx)).toEqual([
      'word/document.xml: mc:Ignorable cita o prefixo "w15", sem declaração',
      'word/document.xml: prefixo "w15:" sem declaração (w:p/@w15:x)',
      'word/document.xml: mc:Choice Requires="wpg" sem declaração do prefixo',
    ]);
  });

  test("tipos de conteúdo, relação para parte ausente e desenhos com o mesmo id", () => {
    const partes = unzipSync(
      montarDocx({
        corpo: par(imagem("rIdA", "", 1)) + par(imagem("rIdA", "", 1)),
        relacoes: [{ id: "rIdA", tipo: "image", alvo: "media/a.png" }],
        midia: { "a.png": PNG_MINIMO },
        validar: false,
      }),
    );
    partes["word/extra.bin"] = strToU8("x");
    delete partes["word/media/a.png"];
    expect(problemasOoxml(zipSync(partes))).toEqual([
      "[Content_Types].xml não dá tipo a word/extra.bin",
      "word/_rels/document.xml.rels: a relação rIdA aponta media/a.png, que não está no pacote",
      'word/document.xml: wp:docPr id="1" repetido',
    ]);
  });

  test("comentários: marca sem comentário, referência repetida e intervalo invertido", () => {
    const comentado = comentarDocx(BASE, [{ trechos: ["Texto"], texto: "nota" }], {
      data: "2026-11-16T12:00:00Z",
    }).docx;
    expect(problemasOoxml(comentado)).toEqual([]);
    const marcas =
      '<w:p><w:commentRangeEnd w:id="0"/><w:r><w:t>Texto.</w:t></w:r><w:commentRangeStart w:id="0"/>' +
      '<w:r><w:commentReference w:id="0"/></w:r><w:r><w:commentReference w:id="0"/></w:r>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p>';
    expect(problemasOoxml(comDocumento(comentado, (xml) => xml.replace(/<w:p>.*<\/w:p>/, marcas)))).toEqual([
      "word/document.xml: comentário 0 com 2 referências (w:commentReference)",
      "word/document.xml: comentário 0 com o fim do intervalo antes do início",
      "word/document.xml: marca do comentário 7, que não existe",
    ]);
  });

  test("comentário na última célula de um documento que termina em tabela: continua válido", () => {
    const docx = montarDocx({
      corpo:
        par("Início.") +
        tabelaDeTextos([
          ["Componente", "Carga"],
          ["AEE", "40"],
        ]),
    });
    const { docx: comentado, ancoradas } = comentarDocx(
      docx,
      [
        { trechos: ["40"], texto: "conferir" },
        { trechos: ["ausente"], texto: "seção", noInicioSeAusente: true },
      ],
      { data: "2026-11-16T12:00:00Z" },
    );
    expect(ancoradas).toHaveLength(2);
    expect(problemasOoxml(comentado)).toEqual([]);
    expect(strFromU8(unzipSync(comentado)["word/document.xml"]!)).toContain("</w:tbl><w:p/><w:sectPr>");
  });
});
