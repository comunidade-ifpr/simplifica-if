import { describe, expect, test } from "vite-plus/test";
import { ehInteiro, representar, textoDe, valoresIguais } from "./json.ts";
import { ehUrlAbsoluta, partesUrl, regexDoSchema } from "./schema.ts";
import {
  aparar,
  apararCaracteres,
  apararInicio,
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

  test("ehInteiro aceita booleanos", () => {
    expect(ehInteiro(true)).toBe(true);
    expect(ehInteiro(2)).toBe(true);
    expect(ehInteiro(1.5)).toBe(false);
  });
});

describe("padrões e URLs dos schemas", () => {
  test("regexDoSchema traduz \\d, $ e . para a semântica dos schemas", () => {
    expect(regexDoSchema("^\\d{4}$").test("２０２６")).toBe(true);
    expect(regexDoSchema("^abc$").test("abc\n")).toBe(true);
    expect(regexDoSchema("^a.c$").test("a\nc")).toBe(false);
    expect(regexDoSchema("^[\\d-]+$").test("12-3")).toBe(true);
    expect(regexDoSchema("^a\\-b\\#c[\\-\\#]$").test("a-b#c#")).toBe(true);
  });

  test("partesUrl extrai esquema e autoridade", () => {
    expect(partesUrl("HTTPS://ifpr.edu.br/x")).toEqual({ esquema: "https", autoridade: "ifpr.edu.br" });
    expect(partesUrl("  https://a?b")).toEqual({ esquema: "https", autoridade: "a" });
    expect(partesUrl("nao-url")).toEqual({ esquema: "", autoridade: "" });
    expect(() => partesUrl("https://[x")).toThrow("Invalid IPv6 URL");
  });

  test("ehUrlAbsoluta exige autoridade explícita e não aceita espaços", () => {
    expect(ehUrlAbsoluta("https://ifpr.edu.br", "https")).toBe(true);
    expect(ehUrlAbsoluta("http://ifpr.edu.br", "https")).toBe(false);
    expect(ehUrlAbsoluta("https:ifpr.edu.br")).toBe(false);
    expect(ehUrlAbsoluta("https:///ifpr.edu.br")).toBe(false);
    expect(ehUrlAbsoluta("https://:80")).toBe(true);
    expect(ehUrlAbsoluta("https://a b")).toBe(false);
    expect(ehUrlAbsoluta("ftp://x")).toBe(true);
  });
});
