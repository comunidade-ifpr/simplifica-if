/**
 * Primitivas de formatação: quebra de
 * linhas, escape de HTML, expansão de tabs, divisão de linha de comando,
 * codificação de URL, URI de caminho e número com casas fixas. Os valores
 * esperados são gabaritos fixos.
 */
import { describe, expect, test } from "vite-plus/test";
import { escapeHtml } from "./html.ts";
import { dividirComandoShell } from "./shell.ts";
import { expandirTabs } from "./texto.ts";
import { wrap } from "./quebra-de-linhas.ts";
import { caminhoComoUri, quote } from "./url.ts";
import { formatoFixo } from "./valores.ts";

const CASOS_WRAP: Array<[string, number, boolean, string[]]> = [
  ["", 5, false, []],
  ["", 20, true, []],
  ["", 20, false, []],
  ["", 110, false, []],
  ["   ", 5, false, []],
  ["   ", 20, true, []],
  ["   ", 20, false, []],
  ["   ", 110, false, []],
  ["uma frase curta", 5, false, ["uma", "frase", "curta"]],
  ["uma frase curta", 20, true, ["uma frase curta"]],
  ["uma frase curta", 20, false, ["uma frase curta"]],
  ["uma frase curta", 110, false, ["uma frase curta"]],
  [
    "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra ",
    5,
    false,
    [
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
    ],
  ],
  [
    "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra ",
    20,
    true,
    [
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
    ],
  ],
  [
    "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra ",
    20,
    false,
    [
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
    ],
  ],
  [
    "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra ",
    110,
    false,
    [
      "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra",
      "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra",
      "palavra palavra palavra palavra",
    ],
  ],
  ["a\tb\tcc\tddd\te", 5, false, ["a", "b", "cc", "ddd", "e"]],
  ["a\tb\tcc\tddd\te", 20, true, ["a       b       cc", "ddd     e"]],
  ["a\tb\tcc\tddd\te", 20, false, ["a       b       cc", "ddd     e"]],
  ["a\tb\tcc\tddd\te", 110, false, ["a       b       cc      ddd     e"]],
  ["linha1\nlinha2\r\nlinha3\u000bfim\f.", 5, false, ["linha1", "linha2", "linha3", "fim ."]],
  ["linha1\nlinha2\r\nlinha3\u000bfim\f.", 20, true, ["linha1 linha2", "linha3 fim ."]],
  ["linha1\nlinha2\r\nlinha3\u000bfim\f.", 20, false, ["linha1 linha2", "linha3 fim ."]],
  ["linha1\nlinha2\r\nlinha3\u000bfim\f.", 110, false, ["linha1 linha2  linha3 fim ."]],
  ["xxxxxxxxxxxxxxxxxxxxxxxxx y zzz", 5, false, ["xxxxxxxxxxxxxxxxxxxxxxxxx", "y zzz"]],
  ["xxxxxxxxxxxxxxxxxxxxxxxxx y zzz", 20, true, ["xxxxxxxxxxxxxxxxxxxx", "xxxxx y zzz"]],
  ["xxxxxxxxxxxxxxxxxxxxxxxxx y zzz", 20, false, ["xxxxxxxxxxxxxxxxxxxxxxxxx", "y zzz"]],
  ["xxxxxxxxxxxxxxxxxxxxxxxxx y zzz", 110, false, ["xxxxxxxxxxxxxxxxxxxxxxxxx y zzz"]],
  ["a   b 　 c", 5, false, ["a   b", "　 c"]],
  ["a   b 　 c", 20, true, ["a   b 　 c"]],
  ["a   b 　 c", 20, false, ["a   b 　 c"]],
  ["a   b 　 c", 110, false, ["a   b 　 c"]],
  [
    "  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra  ",
    5,
    false,
    [
      " ",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
      "palavra",
    ],
  ],
  [
    "  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra  ",
    20,
    true,
    [
      "  palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra ",
    ],
  ],
  [
    "  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra  ",
    20,
    false,
    [
      "  palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra",
      "palavra palavra ",
    ],
  ],
  [
    "  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra  ",
    110,
    false,
    ["  palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra "],
  ],
  ["😀😀😀😀😀😀😀😀😀😀😀😀 fim ßßßßßßßßß", 5, false, ["😀😀😀😀😀😀😀😀😀😀😀😀", "fim", "ßßßßßßßßß"]],
  ["😀😀😀😀😀😀😀😀😀😀😀😀 fim ßßßßßßßßß", 20, true, ["😀😀😀😀😀😀😀😀😀😀😀😀 fim", "ßßßßßßßßß"]],
  ["😀😀😀😀😀😀😀😀😀😀😀😀 fim ßßßßßßßßß", 20, false, ["😀😀😀😀😀😀😀😀😀😀😀😀 fim", "ßßßßßßßßß"]],
  ["😀😀😀😀😀😀😀😀😀😀😀😀 fim ßßßßßßßßß", 110, false, ["😀😀😀😀😀😀😀😀😀😀😀😀 fim ßßßßßßßßß"]],
  [
    "hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra ",
    5,
    false,
    [
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
    ],
  ],
  [
    "hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra ",
    20,
    true,
    [
      "hífen-composto muito",
      "-longo-que-nao-quebr",
      "a hífen-composto mui",
      "to-longo-que-nao-que",
      "bra hífen-composto m",
      "uito-longo-que-nao-q",
      "uebra hífen-composto",
      "muito-longo-que-nao-",
      "quebra",
    ],
  ],
  [
    "hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra ",
    20,
    false,
    [
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
      "hífen-composto",
      "muito-longo-que-nao-quebra",
    ],
  ],
  [
    "hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra ",
    110,
    false,
    [
      "hífen-composto muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra hífen-composto",
      "muito-longo-que-nao-quebra hífen-composto muito-longo-que-nao-quebra",
    ],
  ],
  ["  espaços   múltiplos   no   meio   ", 5, false, ["espaços", "múltiplos", "no", "meio"]],
  ["  espaços   múltiplos   no   meio   ", 20, true, ["  espaços", "múltiplos   no", "meio"]],
  ["  espaços   múltiplos   no   meio   ", 20, false, ["  espaços", "múltiplos   no", "meio"]],
  ["  espaços   múltiplos   no   meio   ", 110, false, ["  espaços   múltiplos   no   meio"]],
  ["\ttab inicial e\tno meio", 5, false, ["tab", "inicial", "e", "no", "meio"]],
  ["\ttab inicial e\tno meio", 20, true, ["        tab inicial", "e   no meio"]],
  ["\ttab inicial e\tno meio", 20, false, ["        tab inicial", "e   no meio"]],
  ["\ttab inicial e\tno meio", 110, false, ["        tab inicial e   no meio"]],
];
const CASOS_ESCAPE: Array<[string, string, string]> = [
  ["a&b<c>d\"e'f", "a&amp;b&lt;c&gt;d&quot;e&#x27;f", "a&amp;b&lt;c&gt;d\"e'f"],
  ["&amp;", "&amp;amp;", "&amp;amp;"],
  ["", "", ""],
  ["sem nada", "sem nada", "sem nada"],
  ["😀'\"", "😀&#x27;&quot;", "😀'\""],
];
const CASOS_EXPAND: Array<[string, number, string]> = [
  ["a\tb", 8, "a       b"],
  ["a\tb", 4, "a   b"],
  ["a\tb", 0, "ab"],
  ["a\tb", 1, "a b"],
  ["\t", 8, "        "],
  ["\t", 4, "    "],
  ["\t", 0, ""],
  ["\t", 1, " "],
  ["ab\tc\nd\te\rf\tg", 8, "ab      c\nd       e\rf       g"],
  ["ab\tc\nd\te\rf\tg", 4, "ab  c\nd   e\rf   g"],
  ["ab\tc\nd\te\rf\tg", 0, "abc\nde\rfg"],
  ["ab\tc\nd\te\rf\tg", 1, "ab c\nd e\rf g"],
  ["😀\tx", 8, "😀       x"],
  ["😀\tx", 4, "😀   x"],
  ["😀\tx", 0, "😀x"],
  ["😀\tx", 1, "😀 x"],
  ["1234567\t8", 8, "1234567 8"],
  ["1234567\t8", 4, "1234567 8"],
  ["1234567\t8", 0, "12345678"],
  ["1234567\t8", 1, "1234567 8"],
  ["12345678\tx", 8, "12345678        x"],
  ["12345678\tx", 4, "12345678    x"],
  ["12345678\tx", 0, "12345678x"],
  ["12345678\tx", 1, "12345678 x"],
];
const CASOS_SHELL: Array<[string, string[] | null, string | null]> = [
  ["npx --yes surge", ["npx", "--yes", "surge"], null],
  ["'a b' c", ["a b", "c"], null],
  ['a"b c"d', ["ab cd"], null],
  ['x "a\\"b" \'c\\d\'', ["x", 'a"b', "c\\d"], null],
  ["a\\ b", ["a b"], null],
  ["''", [""], null],
  ['a "" b', ["a", "", "b"], null],
  ["  ", [], null],
  ["a\tb\nc", ["a", "b", "c"], null],
  ['x "\\$y\\\\"', ["x", "\\$y\\"], null],
  ["a 'b", null, "No closing quotation"],
  ['a "b', null, "No closing quotation"],
  ["a\\", null, "No escaped character"],
  ['"a\\', null, "No escaped character"],
];
const CASOS_URIS: Array<[string, string]> = [
  ["/tmp/a b/é&(x)+;=@#%?.html", "file:///tmp/a%20b/%C3%A9%26%28x%29%2B%3B%3D%40%23%25%3F.html"],
  ["/a/b~c_d.e-f", "file:///a/b~c_d.e-f"],
  ["//dupla/x", "file:////dupla/x"],
  ["///tripla/x", "file:///tripla/x"],
  ["/😀/ß", "file:///%F0%9F%98%80/%C3%9F"],
];
const CASOS_QUOTES: Array<[string, string, string]> = [
  ["a b/c?d", "/", "a%20b/c%3Fd"],
  ["a b/c?d", "", "a%20b%2Fc%3Fd"],
  ["a b/c?d", ":@", "a%20b%2Fc%3Fd"],
  ["é~_.-", "/", "%C3%A9~_.-"],
  ["é~_.-", "", "%C3%A9~_.-"],
  ["é~_.-", ":@", "%C3%A9~_.-"],
  ["!*'();:@&=+$,/?#[]", "/", "%21%2A%27%28%29%3B%3A%40%26%3D%2B%24%2C/%3F%23%5B%5D"],
  ["!*'();:@&=+$,/?#[]", "", "%21%2A%27%28%29%3B%3A%40%26%3D%2B%24%2C%2F%3F%23%5B%5D"],
  ["!*'();:@&=+$,/?#[]", ":@", "%21%2A%27%28%29%3B:@%26%3D%2B%24%2C%2F%3F%23%5B%5D"],
];
const CASOS_FIXOS: Array<[number, string]> = [
  [0.125, "0.12"],
  [0.375, "0.38"],
  [0.625, "0.62"],
  [0.875, "0.88"],
  [0.005, "0.01"],
  [0.015, "0.01"],
  [0.995, "0.99"],
  [1.0, "1.00"],
  [0.0, "0.00"],
  [-0.0, "-0.00"],
  [-0.001, "-0.00"],
  [0.33333, "0.33"],
  [2.675, "2.67"],
  [1e-10, "0.00"],
  [123.456, "123.46"],
];

describe("wrap", () => {
  test("casos de gabarito, sem quebra em hífens", () => {
    for (const [texto, largura, longas, esperado] of CASOS_WRAP) {
      expect([texto, largura, longas, wrap(texto, largura, { quebrarPalavrasLongas: longas })]).toEqual([
        texto,
        largura,
        longas,
        esperado,
      ]);
    }
  });
  test("largura inválida", () => {
    expect(() => wrap("a", 0)).toThrow("invalid width");
  });
});

describe("escapeHtml", () => {
  test("com e sem aspas, apóstrofo como &#x27;", () => {
    for (const [texto, comAspas, semAspas] of CASOS_ESCAPE) {
      expect(escapeHtml(texto)).toBe(comAspas);
      expect(escapeHtml(texto, false)).toBe(semAspas);
    }
  });
});

describe("expandirTabs", () => {
  test("colunas, \\n e \\r", () => {
    for (const [texto, tamanho, esperado] of CASOS_EXPAND) expect(expandirTabs(texto, tamanho)).toBe(esperado);
  });
});

describe("dividirComandoShell", () => {
  test("aspas, escapes e erros", () => {
    for (const [texto, esperado, erro] of CASOS_SHELL) {
      if (erro) expect(() => dividirComandoShell(texto)).toThrow(erro);
      else expect(dividirComandoShell(texto)).toEqual(esperado!);
    }
  });
});

describe("url", () => {
  test("quote", () => {
    for (const [texto, seguros, esperado] of CASOS_QUOTES) expect(quote(texto, seguros)).toBe(esperado);
  });
  test("caminhoComoUri", () => {
    for (const [caminho, esperado] of CASOS_URIS) expect(caminhoComoUri(caminho)).toBe(esperado);
    expect(() => caminhoComoUri("relativo/x")).toThrow("relative");
  });
});

describe("formatoFixo", () => {
  test("empate para o par sobre o valor binário e -0.00", () => {
    for (const [valor, esperado] of CASOS_FIXOS) expect(formatoFixo(valor, 2)).toBe(esperado);
  });
});
