import { describe, expect, it } from "vite-plus/test";
import { ErroPdf, mensagemErroPdf, type MotivoErroPdf } from "../src/erro.ts";
import { linhasDosItens, paragrafosDasLinhas, pdfParaMarkdown } from "../src/markdown.ts";
import { montarPdf } from "../src/testes/sintetico.ts";

async function motivo(promessa: Promise<unknown>): Promise<MotivoErroPdf | undefined> {
  try {
    await promessa;
    return undefined;
  } catch (erro) {
    if (erro instanceof ErroPdf) return erro.motivo;
    throw erro;
  }
}

const PARAGRAFO = [
  "O estudante tem direito ao acompanhamento pedagógico em",
  "todas as etapas do curso, conforme o regulamento do estu-",
  "dante e do campus.",
];

describe("pdfParaMarkdown", () => {
  it("escreve o texto por página, com o marcador da página e os parágrafos juntados", async () => {
    const pdf = montarPdf({
      paginas: [["Título da norma", "", ...PARAGRAFO, "", "1) primeiro item", "2) segundo (item)"], ["Art. 2º Fim."]],
    });
    expect(await pdfParaMarkdown(pdf)).toBe(
      [
        "<!-- página 1 -->",
        "Título da norma",
        "O estudante tem direito ao acompanhamento pedagógico em todas as etapas do curso, conforme o regulamento do estudante e do campus.",
        "1) primeiro item",
        "2) segundo (item)",
        "<!-- página 2 -->",
        "Art. 2º Fim.",
      ].join("\n\n") + "\n",
    );
  });

  it("marca a página sem texto e não mexe nos bytes de quem chama", async () => {
    const pdf = montarPdf({ paginas: [[], ["Só a segunda página tem texto."]] });
    const copia = pdf.slice();
    expect(await pdfParaMarkdown(pdf)).toBe(
      "<!-- página 1: sem texto -->\n\n<!-- página 2 -->\n\nSó a segunda página tem texto.\n",
    );
    expect(pdf).toEqual(copia);
  });

  it("recusa o que não é PDF, o PDF sem texto, o corrompido e o protegido", async () => {
    expect(await motivo(pdfParaMarkdown(new TextEncoder().encode("PK\u0003\u0004 um docx")))).toBe("nao-e-pdf");
    expect(await motivo(pdfParaMarkdown(new Uint8Array()))).toBe("nao-e-pdf");
    expect(await motivo(pdfParaMarkdown(montarPdf({ paginas: [[], []] })))).toBe("sem-texto");
    expect(await motivo(pdfParaMarkdown(new TextEncoder().encode("%PDF-1.4\nlixo")))).toBe("corrompido");
    expect(await motivo(pdfParaMarkdown(montarPdf({ paginas: [["segredo"]], protegido: true })))).toBe("protegido");
  });

  it("aceita lixo antes da assinatura, como os leitores de PDF", async () => {
    const pdf = montarPdf({ paginas: [["Texto."]] });
    const comLixo = new Uint8Array([...new TextEncoder().encode("lixo\n"), ...pdf]);
    expect(await pdfParaMarkdown(comLixo)).toContain("Texto.");
  });

  it("para no limite de páginas e no de caracteres", async () => {
    const pdf = montarPdf({ paginas: [["um"], ["dois"], ["três"]] });
    await expect(pdfParaMarkdown(pdf, { paginas: 2 })).rejects.toMatchObject({
      dados: { motivo: "paginas-demais", paginas: 3, limite: 2 },
    });
    expect(await pdfParaMarkdown(pdf, { paginas: 3 })).toContain("três");
    await expect(pdfParaMarkdown(pdf, { caracteres: 40 })).rejects.toMatchObject({
      dados: { motivo: "texto-demais", limite: 40 },
    });
  });
});

describe("linhas e parágrafos", () => {
  const item = (str: string, x: number, y: number, hasEOL = false) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width: str.length * 6,
    height: 12,
    hasEOL,
  });

  it("separa as linhas pelo hasEOL e pela altura, e põe espaço entre itens afastados", () => {
    const linhas = linhasDosItens([
      item("Art.", 72, 700),
      item("1º", 110, 700, true),
      item("Parágrafo", 72, 686),
      item("único.", 130, 686),
      item("Outra", 72, 672),
    ]);
    expect(linhas.map((linha) => linha.texto)).toEqual(["Art. 1º", "Parágrafo único.", "Outra"]);
  });

  it("não junta a linha curta, a de marcador de lista nem a que vem depois de um espaço maior", () => {
    const linha = (texto: string, y: number, x1 = 540) => ({ texto, x0: 72, x1, y, altura: 12 });
    expect(
      paragrafosDasLinhas([
        linha("um texto que chega à margem", 700),
        linha("e continua aqui.", 686, 200),
        linha("Curta.", 672, 540),
        linha("- item", 658),
        linha("depois do vão", 630),
        linha("bem-", 616),
        linha("Estar", 602),
      ]),
    ).toEqual(["um texto que chega à margem e continua aqui.", "Curta.", "- item", "depois do vão bem- Estar"]);
  });
});

describe("mensagemErroPdf", () => {
  it("monta a frase dos dados", () => {
    expect(mensagemErroPdf({ motivo: "paginas-demais", paginas: 612, limite: 500 })).toBe(
      "O PDF tem 612 páginas, e o limite é de 500. Separe as páginas que interessam num PDF menor.",
    );
    expect(mensagemErroPdf({ motivo: "texto-demais", limite: 8_000_000 })).toBe(
      "O PDF tem texto demais para ser convertido (mais de 8 milhões de caracteres).",
    );
    expect(new ErroPdf({ motivo: "sem-texto" }).message).toMatch(/^O PDF não tem texto: é digitalizado/);
  });
});
