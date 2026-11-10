import { describe, expect, test } from "bun:test";
import {
  compararTexto,
  iguais,
  ordenarCaminhos,
  prefixo,
  regexPython,
  repr,
  splitlines,
  strip,
  stripChars,
  tamanho,
  urlsplit,
} from "./python.ts";

describe("equivalências com Python", () => {
  test("strip usa o conjunto de espaços do Python (inclui \\x1c e \\x85, exclui BOM)", () => {
    expect(strip("\x1c\x85  texto 　")).toBe("texto");
    expect(strip("﻿texto")).toBe("﻿texto");
    expect(stripChars(" - 1 Título - ", " -")).toBe("1 Título");
  });

  test("splitlines separa nos terminadores do Python e descarta a última linha vazia", () => {
    expect(splitlines("a\nb\r\nc\rd\fe\x0bf\x1cg\x85h i\n")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(splitlines("")).toEqual([]);
    expect(splitlines("\n\n")).toEqual(["", ""]);
  });

  test("tamanho e prefixo contam code points", () => {
    expect(tamanho("😀é")).toBe(2);
    expect(prefixo("😀😀😀", 2)).toBe("😀😀");
  });

  test("ordenação por code point, não por UTF-16 nem por localidade", () => {
    expect(["｡", "😀", "b", "B", "á"].sort(compararTexto)).toEqual(["B", "b", "á", "｡", "😀"]);
    expect(ordenarCaminhos(["/r/a-c/x.md", "/r/a/b.md", "/r/a/a.md"])).toEqual(["/r/a/a.md", "/r/a/b.md", "/r/a-c/x.md"]);
  });

  test("repr reproduz o Python para textos, listas, dicts e escalares", () => {
    expect(repr(["a", "it's", 'x"y\'z', null, true, 3])).toBe(`['a', "it's", 'x"y\\'z', None, True, 3]`);
    expect(repr({ id: "x", n: [1] })).toBe("{'id': 'x', 'n': [1]}");
    expect(repr("tab\tnl\n\x01 ")).toBe("'tab\\tnl\\n\\x01\\xa0'");
  });

  test("iguais segue o == do Python (bool é int, dicts sem ordem)", () => {
    expect(iguais(true, 1)).toBe(true);
    expect(iguais({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(iguais(null, undefined)).toBe(true);
    expect(iguais("1", 1)).toBe(false);
  });

  test("regexPython traduz \\d, $ e . com a semântica do re", () => {
    expect(regexPython("^\\d{4}$").test("２０２６")).toBe(true);
    expect(regexPython("^abc$").test("abc\n")).toBe(true);
    expect(regexPython("^a.c$").test("a\nc")).toBe(false);
    expect(regexPython("^[\\d-]+$").test("12-3")).toBe(true);
    expect(regexPython("^a\\-b\\#c[\\-\\#]$").test("a-b#c#")).toBe(true);
  });

  test("urlsplit extrai esquema e netloc como urllib", () => {
    expect(urlsplit("HTTPS://ifpr.edu.br/x")).toEqual({ scheme: "https", netloc: "ifpr.edu.br" });
    expect(urlsplit("  https://a?b")).toEqual({ scheme: "https", netloc: "a" });
    expect(urlsplit("nao-url")).toEqual({ scheme: "", netloc: "" });
    expect(() => urlsplit("https://[x")).toThrow("Invalid IPv6 URL");
  });
});
