import { describe, expect, test } from "vite-plus/test";
import { representar, textoDe, valoresIguais } from "./json.ts";
import {
  aparar,
  apararCaracteres,
  apararFim,
  apararFimEnquanto,
  apararInicio,
  ESPACOS,
  compararTexto,
  contarCaracteres,
  dividirLinhas,
  linhasDeArquivo,
  ordenarCaminhos,
  prefixo,
} from "./texto.ts";

describe("texto", () => {
  test("aparar usa o conjunto ESPACOS (inclui \\x1c e \\x85, exclui BOM)", () => {
    expect(aparar("\x1c\x85  texto 　")).toBe("texto");
    expect(aparar("﻿texto")).toBe("﻿texto");
    expect(apararInicio("  a ")).toBe("a ");
    expect(apararCaracteres(" - 1 Título - ", " -")).toBe("1 Título");
  });

  test(
    "aparar sem expressão regular: mesma resposta, e linear numa sequência longa de espaços no meio",
    { timeout: 5_000 },
    () => {
      const reFim = new RegExp(`[${ESPACOS}]+$`);
      const reInicio = new RegExp(`^[${ESPACOS}]+`);
      const pedacos = [
        "",
        " ",
        "\t",
        "\n",
        "\x0b",
        "\x1c",
        "\x1f",
        "\x85",
        "\xa0",
        "\u1680",
        "\u2003",
        "\u2028",
        "\u202f",
        "\u205f",
        "\u3000",
        "\ufeff",
        "\u200b",
        "a",
        "é",
        "😀",
        "-",
      ];
      let semente = 20261116;
      const sortear = (limite: number) => ((semente = (Math.imul(semente, 1103515245) + 12345) >>> 0) >>> 8) % limite;
      for (let caso = 0; caso < 2000; caso += 1) {
        const texto = Array.from({ length: sortear(8) }, () => pedacos[sortear(pedacos.length)]!).join("");
        expect(apararFim(texto), JSON.stringify(texto)).toBe(texto.replace(reFim, ""));
        expect(apararInicio(texto), JSON.stringify(texto)).toBe(texto.replace(reInicio, ""));
        expect(aparar(texto), JSON.stringify(texto)).toBe(texto.replace(reInicio, "").replace(reFim, ""));
      }
      // Com `[espaços]+$`, 80 mil tabulações entre duas letras custavam 89 s.
      const hostil = `a${"\t".repeat(500_000)}b`;
      expect(aparar(hostil)).toBe(hostil);
      expect(apararFim(`${hostil}  `)).toBe(hostil);
      expect(apararFimEnquanto("título:;. .", (caractere) => ":;.".includes(caractere))).toBe("título:;. ");
    },
  );

  test("dividirLinhas separa em todos os terminadores e descarta a última linha vazia", () => {
    expect(dividirLinhas("a\nb\r\nc\rd\fe\x0bf\x1cg\x85h\u2028i\n")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
    ]);
    expect(dividirLinhas("")).toEqual([]);
    expect(dividirLinhas("\n\n")).toEqual(["", ""]);
  });

  test("linhasDeArquivo separa só em \\n", () => {
    expect(linhasDeArquivo("a\x85b\nc\n")).toEqual(["a\x85b", "c"]);
    expect(linhasDeArquivo("")).toEqual([]);
    expect(linhasDeArquivo("\n")).toEqual([""]);
  });

  test("contarCaracteres e prefixo contam code points", () => {
    expect(contarCaracteres("😀é")).toBe(2);
    expect(prefixo("😀😀😀", 2)).toBe("😀😀");
  });

  test("ordenação por code point, não por UTF-16 nem por localidade", () => {
    expect(["｡", "😀", "b", "B", "á"].sort(compararTexto)).toEqual(["B", "b", "á", "｡", "😀"]);
    expect(ordenarCaminhos(["/r/a-c/x.md", "/r/a/b.md", "/r/a/a.md"])).toEqual([
      "/r/a/a.md",
      "/r/a/b.md",
      "/r/a-c/x.md",
    ]);
  });
});

describe("json", () => {
  test("representar usa a notação literal das mensagens", () => {
    expect(representar(["a", "it's", "x\"y'z", null, true, 3])).toBe(`['a', "it's", 'x"y\\'z', None, True, 3]`);
    expect(representar({ id: "x", n: [1] })).toBe("{'id': 'x', 'n': [1]}");
    expect(representar("tab\tnl\n\x01\xa0")).toBe("'tab\\tnl\\n\\x01\\xa0'");
    expect(textoDe("a")).toBe("a");
    expect(textoDe(undefined)).toBe("None");
  });

  test("valoresIguais: booleano vale 0/1, ausente vale null, ordem de chaves não importa", () => {
    expect(valoresIguais(true, 1)).toBe(true);
    expect(valoresIguais({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(valoresIguais(null, undefined)).toBe(true);
    expect(valoresIguais("1", 1)).toBe(false);
  });
});
