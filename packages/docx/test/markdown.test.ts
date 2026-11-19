/**
 * `docxParaMarkdown`: o texto de um `.docx` qualquer em Markdown, sobre DOCX sintéticos. Os casos
 * hostis repetem os de `leitor.test.ts`: tudo o que o leitor recusa sai daqui com `ErroDocx`.
 */
import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import type { MotivoErroDocx } from "../src/erro.ts";
import { docxParaMarkdown } from "../src/markdown.ts";
import { ErroDocx } from "../src/pacote.ts";
import {
  caixaDeTexto,
  hyperlink,
  linkExterno,
  montarDocx,
  nota,
  NUMERACAO_PADRAO,
  par,
  referenciaDeNota,
  run,
  tabelaDeTextos,
} from "../src/testes/sintetico.ts";

const md = (corpo: string, extras = {}) => docxParaMarkdown(montarDocx({ corpo, ...extras }));

function esperarMotivo(acao: () => unknown, motivo: MotivoErroDocx): void {
  let erro: unknown;
  try {
    acao();
  } catch (capturado) {
    erro = capturado;
  }
  expect(erro).toBeInstanceOf(ErroDocx);
  expect((erro as ErroDocx).motivo).toBe(motivo);
}

describe("docxParaMarkdown", () => {
  test("o que vem antes do primeiro título fica, e cada parágrafo é um parágrafo", () => {
    const corpo =
      par("Dispõe sobre a minuta.") +
      par("RESOLVE:") +
      par("Art. 1º Fica aprovado.", { estilo: "Ttulo1" }) +
      par("Texto do artigo.") +
      par("Seção", { estilo: "Ttulo2" }) +
      par(run("negrito", { negrito: true }) + run(" e ") + run("itálico", { italico: true }));
    expect(md(corpo)).toBe(
      [
        "Dispõe sobre a minuta.",
        "",
        "RESOLVE:",
        "",
        "## Art. 1º Fica aprovado.",
        "",
        "Texto do artigo.",
        "",
        "### Seção",
        "",
        "**negrito** e *itálico*",
        "",
      ].join("\n"),
    );
  });

  test("tabela", () => {
    expect(
      md(
        par("Antes.") +
          tabelaDeTextos([
            ["Nome", "Horas"],
            ["A", "40"],
            ["B | C", "80"],
          ]) +
          par("Depois."),
      ),
    ).toBe(
      ["Antes.", "", "| Nome | Horas |", "|---|---:|", "| A | 40 |", "| B \\| C | 80 |", "", "Depois.", ""].join("\n"),
    );
  });

  test("listas: itens seguidos sem linha em branco, separados do parágrafo seguinte", () => {
    const corpo =
      par("Considerando:") +
      par("primeiro", { numeracao: { id: 1 } }) +
      par("segundo", { numeracao: { id: 1 } }) +
      par("subitem", { numeracao: { id: 1, nivel: 1 } }) +
      par("Numerada:") +
      par("um", { numeracao: { id: 2 } }) +
      par("dois", { numeracao: { id: 2 } }) +
      par("Fim.");
    expect(md(corpo, { numeracao: NUMERACAO_PADRAO })).toBe(
      [
        "Considerando:",
        "",
        "- primeiro",
        "- segundo",
        "  - subitem",
        "",
        "Numerada:",
        "",
        "1. um",
        "1. dois",
        "",
        "Fim.",
        "",
      ].join("\n"),
    );
  });

  test("link seguro vira link; o de esquema perigoso fica só o texto", () => {
    const corpo = par(
      run("Veja ") + hyperlink("o portal", 'r:id="rIdLink"') + run(" e ") + hyperlink("isto", 'r:id="rIdMau"'),
    );
    const relacoes = [linkExterno("rIdLink", "https://www.gov.br/mec/"), linkExterno("rIdMau", "javascript:alert(1)")];
    expect(md(corpo, { relacoes })).toBe("Veja [o portal](https://www.gov.br/mec/) e isto\n");
  });

  test("notas de rodapé e de fim: numeradas na ordem do texto, definições no fim", () => {
    const corpo =
      par(run("Primeira") + referenciaDeNota(5) + run(" e segunda") + referenciaDeNota(3) + run(".")) +
      par(run("Fim") + referenciaDeNota(2, "fim") + run(" e de novo") + referenciaDeNota(5) + run(".")) +
      tabelaDeTextos([["Coluna"], [`<w:tc>${par(run("Na célula") + referenciaDeNota(1, "fim"))}</w:tc>`]]) +
      par(run("Inexistente") + referenciaDeNota(99) + run("."));
    const notas = {
      rodape: [
        nota(3, ["Nota três."]),
        nota(5, ["Nota cinco, primeiro parágrafo.", "Segundo parágrafo."]),
        nota(8, ["Sem referência."]),
      ],
      fim: [nota(1, ["Fim um."], "fim"), nota(2, ["Fim dois."], "fim")],
    };
    expect(md(corpo, { notas })).toBe(
      [
        "Primeira[^1] e segunda[^2].",
        "",
        "Fim[^fim-1] e de novo[^1].",
        "",
        "| Coluna |",
        "|---|",
        "| Na célula[^fim-2] |",
        "",
        "Inexistente.",
        "",
        "[^1]: Nota cinco, primeiro parágrafo.",
        "",
        "    Segundo parágrafo.",
        "",
        "[^2]: Nota três.",
        "",
        "[^fim-1]: Fim dois.",
        "",
        "[^fim-2]: Fim um.",
        "",
      ].join("\n"),
    );
  });

  test("alteração controlada: a inserção entra, a exclusão não", () => {
    const corpo = par(
      run("Prazo de ") +
        `<w:del w:id="1" w:author="Revisor" w:date="2026-11-01T00:00:00Z"><w:r><w:delText>30</w:delText></w:r></w:del>` +
        `<w:ins w:id="2" w:author="Revisor" w:date="2026-11-01T00:00:00Z">${run("60")}</w:ins>` +
        run(" dias."),
    );
    expect(md(corpo)).toBe("Prazo de 60 dias.\n");
  });

  test("caixas de texto vão para uma seção no fim", () => {
    const corpo = par("Corpo.") + par(caixaDeTexto(par("Na caixa.") + par("Segunda linha.")));
    expect(md(corpo)).toBe(["Corpo.", "", "## Caixas de texto", "", "Na caixa.", "", "Segunda linha.", ""].join("\n"));
  });

  test("a marca de nota digitada numa caixa de texto não vira referência", () => {
    const corpo =
      par(run("Real") + referenciaDeNota(1) + run(".")) + par(caixaDeTexto(par("Forjada\uFDD0r1\uFDD1 aqui.")));
    const saida = md(corpo, { notas: { rodape: [nota(1, ["Nota um."])] } });
    expect(saida).toContain("Real[^1].");
    expect(saida).toContain("Forjadar1 aqui.");
    expect(saida.match(/\[\^1\]/g)).toHaveLength(2);
  });

  test("documento sem texto: sem-texto", () => {
    esperarMotivo(() => md(par("") + par("   ")), "sem-texto");
    esperarMotivo(() => md(tabelaDeTextos([["", ""]])), "sem-texto");
  });

  test("arquivo hostil ou quebrado sai com ErroDocx", () => {
    esperarMotivo(() => docxParaMarkdown(strToU8("isto não é zip")), "nao-e-zip");
    esperarMotivo(() => docxParaMarkdown(zipSync({ "a.txt": strToU8("x") })), "sem-documento-principal");
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Array<number>(500).fill(0)]);
    esperarMotivo(() => docxParaMarkdown(ole), "doc-ou-protegido");
    const docx = montarDocx({ corpo: par("x") });
    esperarMotivo(() => docxParaMarkdown(docx.slice(0, 200)), "zip-corrompido");
    esperarMotivo(() => docxParaMarkdown(docx, { limites: { bytesDoArquivo: 100 } }), "arquivo-grande-demais");
    esperarMotivo(
      () => docxParaMarkdown(montarDocx({ corpo: par("x").repeat(200) }), { limites: { elementosPorParte: 100 } }),
      "elementos-demais",
    );
  });

  test("o orçamento de texto vale, inclusive para as notas", () => {
    const corpo = par(run("Texto") + referenciaDeNota(1));
    const notas = { rodape: [nota(1, ["n".repeat(2000)])] };
    expect(md(corpo, { notas })).toContain("[^1]: ");
    esperarMotivo(
      () => docxParaMarkdown(montarDocx({ corpo, notas }), { limitesDeTexto: { caracteresPorBloco: 1000 } }),
      "bloco-longo",
    );
    esperarMotivo(
      () =>
        docxParaMarkdown(montarDocx({ corpo: par("palavra ".repeat(50)) }), {
          limitesDeTexto: { caracteresNoDocumento: 100 },
        }),
      "texto-demais",
    );
  });
});
