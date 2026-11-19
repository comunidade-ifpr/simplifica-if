/**
 * Notas de rodapé e de fim no leitor (`OpcoesLeitura.notas`): desligadas, a leitura é a de sempre;
 * ligadas, as notas vêm em `DocumentoOoxml.notas` e a referência fica marcada no texto.
 */
import { describe, expect, test } from "vite-plus/test";
import { lerDocx } from "../src/leitor.ts";
import { marcaDeNota, type ParagrafoOoxml, textoDoParagrafo } from "../src/modelo.ts";
import { ErroDocx } from "../src/pacote.ts";
import { celula, linha, montarDocx, nota, par, referenciaDeNota, run, tabela } from "../src/testes/sintetico.ts";
import { problemasOoxml } from "../src/testes/validar-ooxml.ts";

const textos = (blocos: readonly { tipo: string }[]) =>
  blocos.filter((bloco): bloco is ParagrafoOoxml => bloco.tipo === "paragrafo").map(textoDoParagrafo);

const comNotas = montarDocx({
  corpo:
    par(run("Primeira") + referenciaDeNota(1) + run(" e segunda") + referenciaDeNota(2) + run(".")) +
    par(run("No fim") + referenciaDeNota(1, "fim") + run(".")),
  notas: {
    rodape: [nota(1, ["Nota um."]), nota(2, ["Primeiro parágrafo.", "Segundo parágrafo."])],
    fim: [nota(1, ["Nota de fim."], "fim")],
  },
});

describe("notas de rodapé e de fim", () => {
  test("o sintético com notas passa no validador", () => {
    expect(problemasOoxml(comNotas)).toEqual([]);
  });

  test("desligadas (padrão): a referência some e não há notas", () => {
    const documento = lerDocx(comNotas);
    expect(textos(documento.blocos)).toEqual(["Primeira e segunda.", "No fim."]);
    expect(documento.notas).toEqual([]);
  });

  test("ligadas: marca no lugar da referência, duas no mesmo parágrafo, e as notas sem os separadores", () => {
    const documento = lerDocx(comNotas, { notas: true });
    expect(textos(documento.blocos)).toEqual([
      `Primeira${marcaDeNota("rodape", "1")} e segunda${marcaDeNota("rodape", "2")}.`,
      `No fim${marcaDeNota("fim", "1")}.`,
    ]);
    expect(documento.notas.map((item) => [item.tipo, item.id, textos(item.blocos)])).toEqual([
      ["rodape", "1", [" Nota um."]],
      ["rodape", "2", [" Primeiro parágrafo.", "Segundo parágrafo."]],
      ["fim", "1", [" Nota de fim."]],
    ]);
  });

  test("referência a nota inexistente e documento sem a parte de notas não quebram", () => {
    const documento = lerDocx(montarDocx({ corpo: par(run("Texto") + referenciaDeNota(7)) }), { notas: true });
    expect(textos(documento.blocos)).toEqual([`Texto${marcaDeNota("rodape", "7")}`]);
    expect(documento.notas).toEqual([]);
  });

  test("a referência numa célula de tabela entra no texto da célula", () => {
    const corpo = tabela([linha([celula(par(run("Célula") + referenciaDeNota(1)))])]);
    const documento = lerDocx(montarDocx({ corpo, notas: { rodape: [nota(1, ["N."])] } }), { notas: true });
    const lida = documento.blocos[0]!;
    expect(lida.tipo === "tabela" && lida.linhas[0]!.celulas[0]!.texto).toBe(`Célula${marcaDeNota("rodape", "1")}`);
  });

  test("os não caracteres da marca no texto do documento não fingem uma marca", () => {
    const documento = lerDocx(montarDocx({ corpo: par("a﷐r1﷑b") }), { notas: true });
    expect(textos(documento.blocos)).toEqual(["ar1b"]);
  });

  test("a parte de notas passa pelos limites do pacote", () => {
    const grande = montarDocx({
      corpo: par(run("x") + referenciaDeNota(1)),
      notas: { rodape: [nota(1, ["y".repeat(200_000)])] },
    });
    expect(lerDocx(grande, { limites: { bytesPorParte: 100_000 } }).notas).toEqual([]);
    let erro: unknown;
    try {
      lerDocx(grande, { notas: true, limites: { bytesPorParte: 100_000 } });
    } catch (capturado) {
      erro = capturado;
    }
    expect(erro).toBeInstanceOf(ErroDocx);
    expect((erro as ErroDocx).motivo).toBe("parte-grande-demais");
    expect((erro as ErroDocx).dados.parte).toBe("word/footnotes.xml");
  });
});
