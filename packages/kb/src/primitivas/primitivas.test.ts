/**
 * Primitivas de texto e de JSON tipado: similaridade de sequências,
 * representação e arredondamento de fracionários, serialização, case folding e
 * expressões regulares. Os valores esperados são gabaritos fixos.
 */
import { describe, expect, test } from "vite-plus/test";
import { SequenceMatcher } from "./sequencias.ts";
import { copiarValorJson, serializarJsonTipado, jsonTipadoIndentado, analisarJsonTipado } from "./json-tipado.ts";
import { escape, finditer, fullmatch, match, search, split, sub } from "./regex.ts";
import { casefold, colapsarEspacos, semMarcas, somenteDigitos } from "./texto.ts";
import {
  chavesNaOrdem,
  Flutuante,
  inteiroDoValor,
  ou,
  reprFloat,
  arredondarParaPar,
  textoDoValor,
  verdadeiro,
} from "./valores.ts";

/** Gerador congruencial dos casos (o mesmo que produziu os gabaritos). */
function gerar(semente: number, n: number, alfabeto: string[]): [string, number] {
  let x = BigInt(semente);
  let saida = "";
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245n + 12345n) % 2147483648n;
    saida += alfabeto[Number(x >> 16n) % alfabeto.length];
  }
  return [saida, Number(x)];
}

const GRANDE = [...Array.from({ length: 150 }, (_, k) => String.fromCodePoint(0x41 + k)), "😀"].join("");
const ALFABETOS = ["ab", "abc ", "abcde fghij", "tecnico em informatica", GRANDE].map((a) => Array.from(a));

// [semente, len(a), len(b), alfabeto, ratio(a, b), ratio(a, a mutada)]
const CASOS_SEQUENCIAS: Array<[number, number, number, number, number, number]> = [
  [1, 10, 7, 0, 0.5882352941176471, 0.7272727272727273],
  [2, 10, 7, 1, 0.47058823529411764, 0.7272727272727273],
  [4, 10, 7, 3, 0.35294117647058826, 0.7272727272727273],
  [6, 10, 201, 0, 0.0, 0.22988505747126436],
  [9, 10, 201, 3, 0.0, 0.1839080459770115],
  [10, 10, 201, 4, 0.02843601895734597, 0.1839080459770115],
  [11, 10, 399, 0, 0.004889975550122249, 0.13071895424836602],
  [15, 10, 399, 4, 0.019559902200488997, 0.10457516339869281],
  [16, 150, 7, 0, 0.08917197452229299, 0.304635761589404],
  [17, 150, 7, 1, 0.08917197452229299, 0.847682119205298],
  [18, 150, 7, 2, 0.050955414012738856, 0.847682119205298],
  [20, 150, 7, 4, 0.025477707006369428, 0.847682119205298],
  [21, 150, 201, 0, 0.0, 0.0],
  [25, 150, 201, 4, 0.03418803418803419, 0.6975476839237057],
  [26, 150, 399, 0, 0.014571948998178506, 0.0],
  [30, 150, 399, 4, 0.04007285974499089, 0.5912240184757506],
  [33, 250, 7, 2, 0.0311284046692607, 0.0],
  [35, 250, 7, 4, 0.007782101167315175, 0.852589641434263],
  [40, 250, 201, 4, 0.04878048780487805, 0.7548500881834215],
  [41, 250, 399, 0, 0.012326656394453005, 0.0],
  [45, 250, 399, 4, 0.02773497688751926, 0.6761453396524486],
  [48, 400, 7, 2, 0.02457002457002457, 0.0],
  [50, 400, 7, 4, 0.014742014742014743, 0.8528678304239401],
  [51, 400, 201, 0, 0.0066555740432612314, 0.0],
  [53, 400, 201, 2, 0.0033277870216306157, 0.0],
  [55, 400, 201, 4, 0.03993344425956739, 0.7889273356401384],
  [56, 400, 399, 0, 0.0050062578222778474, 0.0],
  [60, 400, 399, 4, 0.04505632040050062, 0.7331189710610932],
];

describe("SequenceMatcher", () => {
  test("ratio dos casos de gabarito, com autojunk", () => {
    for (const [semente, la, lb, indice, esperado, esperadoMutada] of CASOS_SEQUENCIAS) {
      const alfabeto = ALFABETOS[indice]!;
      const [a, x] = gerar(semente, la, alfabeto);
      const [b] = gerar(x, lb, alfabeto);
      const mutada =
        Array.from(a)
          .map((c, k) => (k % 7 ? c : "#"))
          .join("") +
        Array.from(b)
          .slice(0, Math.floor(lb / 3))
          .join("");
      expect([semente, new SequenceMatcher(a, b).ratio()]).toEqual([semente, esperado]);
      expect([semente, new SequenceMatcher(a, mutada).ratio()]).toEqual([semente, esperadoMutada]);
    }
  });

  test("casos curtos", () => {
    expect(new SequenceMatcher("", "").ratio()).toBe(1);
    expect(new SequenceMatcher("abc", "").ratio()).toBe(0);
    expect(new SequenceMatcher("tecnico em informatica", "tecnico em informatica para internet").ratio()).toBe(
      0.7586206896551724,
    );
  });
});

// [valor, repr, repr(round(valor, 4)), repr(round(valor, 2))]
const FLOATS: Array<[number, string, string, string]> = [
  [0.5, "0.5", "0.5", "0.5"],
  [1.0, "1.0", "1.0", "1.0"],
  [100.0, "100.0", "100.0", "100.0"],
  [1e16, "1e+16", "1e+16", "1e+16"],
  [1.5e16, "1.5e+16", "1.5e+16", "1.5e+16"],
  [1234567890123456.0, "1234567890123456.0", "1234567890123456.0", "1234567890123456.0"],
  [0.0001, "0.0001", "0.0001", "0.0"],
  [1e-5, "1e-05", "0.0", "0.0"],
  [1e-7, "1e-07", "0.0", "0.0"],
  [123.456, "123.456", "123.456", "123.46"],
  [-2.5, "-2.5", "-2.5", "-2.5"],
  [1e22, "1e+22", "1e+22", "1e+22"],
  [0.1 + 0.2, "0.30000000000000004", "0.3", "0.3"],
  [5e-324, "5e-324", "0.0", "0.0"],
  [1.7976931348623157e308, "1.7976931348623157e+308", "1.7976931348623157e+308", "1.7976931348623157e+308"],
  [0.03125, "0.03125", "0.0312", "0.03"],
  [2.675, "2.675", "2.675", "2.67"],
  [0.00015, "0.00015", "0.0001", "0.0"],
  [0.8571428571428571, "0.8571428571428571", "0.8571", "0.86"],
  [-0.0, "-0.0", "-0.0", "-0.0"],
];

describe("valores", () => {
  test("repr e round de float", () => {
    for (const [valor, repr, r4, r2] of FLOATS) {
      expect([
        valor,
        reprFloat(valor),
        reprFloat(arredondarParaPar(valor, 4)),
        reprFloat(arredondarParaPar(valor, 2)),
      ]).toEqual([valor, repr, r4, r2]);
    }
  });

  test("texto de lista", () => {
    expect(textoDoValor(["a'b", 'c"d', null, true, new Flutuante(1), { k: 2 }])).toBe(
      `["a'b", 'c"d', None, True, 1.0, {'k': 2}]`,
    );
  });

  test("verdade, or e int", () => {
    expect([verdadeiro(new Flutuante(0)), verdadeiro({}), verdadeiro([0]), verdadeiro("0")]).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(ou("", null, 0, "x")).toBe("x");
    expect(ou("", 0)).toBe(0);
    expect([
      inteiroDoValor(" 12 "),
      inteiroDoValor("١٢"),
      inteiroDoValor(new Flutuante(2.7)),
      inteiroDoValor(true),
    ]).toEqual([12, 12, 2, 1]);
    expect(() => inteiroDoValor("1²")).toThrow();
    expect(() => inteiroDoValor(null)).toThrow();
  });
});

describe("json", () => {
  test("serialização com indentação", () => {
    const valor = analisarJsonTipado(
      '{"a": [1, 2.0, {"b": null, "c": true}], "d": {}, "e": [], "z": "aç\\n\\"\\\\\\u0001", "2": 1}',
    );
    expect(serializarJsonTipado(valor, { indent: 2 })).toBe(
      [
        "{",
        '  "a": [',
        "    1,",
        "    2.0,",
        "    {",
        '      "b": null,',
        '      "c": true',
        "    }",
        "  ],",
        '  "d": {},',
        '  "e": [],',
        '  "z": "aç\\n\\"\\\\\\u0001",',
        '  "2": 1',
        "}",
      ].join("\n"),
    );
    expect(jsonTipadoIndentado([])).toBe("[]\n");
  });

  test("serialização compacta, chaves ordenadas e separadores padrão", () => {
    expect(
      serializarJsonTipado(analisarJsonTipado('{"b": 1, "a": ["é", 1.5e16]}'), {
        ordenarChaves: true,
        separadores: [",", ":"],
      }),
    ).toBe('{"a":["é",1.5e+16],"b":1}');
    expect(serializarJsonTipado({ b: 1, a: [1, 2] })).toBe('{"b": 1, "a": [1, 2]}');
  });

  test("análise preserva ordem de chaves numéricas, floats, inteiros grandes e NaN", () => {
    const valor = analisarJsonTipado(
      '{"z": 1, "10": 2, "2": 3, "big": 123456789012345678901, "n": NaN, "z": 4}',
    ) as Record<string, unknown>;
    expect(chavesNaOrdem(valor)).toEqual(["z", "10", "2", "big", "n"]);
    expect(valor.z).toBe(4);
    expect(serializarJsonTipado(valor)).toBe('{"z": 4, "10": 2, "2": 3, "big": 123456789012345678901, "n": NaN}');
    expect(serializarJsonTipado(copiarValorJson(valor))).toBe(serializarJsonTipado(valor));
    expect(serializarJsonTipado({ ...valor, novo: 1 })).toBe(
      '{"z": 4, "10": 2, "2": 3, "big": 123456789012345678901, "n": NaN, "novo": 1}',
    );
    expect(() => analisarJsonTipado('{"a": "\u0001"}')).toThrow();
    expect(() => analisarJsonTipado("[1,]")).toThrow();
    expect((analisarJsonTipado('{"__proto__": 1}') as Record<string, unknown>).__proto__).toBe(1);
  });
});

describe("texto", () => {
  test("casefold", () => {
    const casos: Array<[string, string]> = [
      ["Straße", "strasse"],
      ["ﬁm", "fim"],
      ["ΣΑΣ", "σασ"],
      ["İ", "i̇"],
      ["Ꭰᏸ", "ᎠᏰ"],
      ["ǅ", "ǆ"],
      ["ẞ", "ss"],
      ["\u0390", "\u03b9\u0308\u0301"],
    ];
    for (const [texto, esperado] of casos) expect(casefold(texto)).toBe(esperado);
  });

  test("espaços, marcas e dígitos", () => {
    expect(colapsarEspacos("\x1c a　b\x85 ")).toBe("a b");
    expect(semMarcas("Ação São")).toBe("Acao Sao");
    expect(somenteDigitos("a1²٣x")).toBe("1²٣");
  });
});

describe("regex", () => {
  test("classes Unicode", () => {
    expect(search("\\d+", "x ٣4")?.[0]).toBe("٣4");
    expect(search("^a\\s+b$", "a\x1cb\n")).not.toBeNull();
    expect(search("^a.b$", "a\rb")).not.toBeNull();
    expect(search("\\bcurso\\b", "écurso")).toBeNull();
    expect(search("\\bcurso\\b", "o curso.")).not.toBeNull();
    expect(match("[]a]+", "]a]b")?.[0]).toBe("]a]");
    expect(fullmatch("#{1,6}", "###")).not.toBeNull();
    expect(fullmatch("#{1,6}", "### ")).toBeNull();
    expect(search("CURSO", "curso", { ignoreCase: true })).not.toBeNull();
  });

  test("sub com referências e escape", () => {
    expect(sub("\\*\\*\\s+([^*]+?)\\s+\\*\\*", "**\\1**", "a ** negrito ** b $1")).toBe("a **negrito** b $1");
    expect(search(`(^|\\s)${escape("sao jose")}($|\\s)`, "campus sao jose dos pinhais")).not.toBeNull();
  });

  test("DOTALL: o ponto casa a quebra de linha", () => {
    expect(
      search("ementa:(.+?)(?=bibliografia|$)", "Ementa: a\nb\nBibliografia", { ignoreCase: true })?.[1],
    ).toBeUndefined();
    expect(
      search("ementa:(.+?)(?=bibliografia|$)", "Ementa: a\nb\nBibliografia", { ignoreCase: true, dotAll: true })?.[1],
    ).toBe(" a\nb\n");
    // Sem a flag, o mesmo padrão continua parando na quebra (os dois ficam no cache separados).
    expect(search("a(.+)", "a1\n2")?.[1]).toBe("1");
    expect(search("a(.+)", "a1\n2", { dotAll: true })?.[1]).toBe("1\n2");
  });

  test("split e finditer", () => {
    expect(split("(?<=[.!?])\\s+(?=[A-Z]{2,},)", "SILVA, A. Um. SOUZA, B. Dois. e fim")).toEqual([
      "SILVA, A. Um.",
      "SOUZA, B. Dois. e fim",
    ]);
    expect(split(",", "a,b,,c")).toEqual(["a", "b", "", "c"]);
    expect(split("x", "abc")).toEqual(["abc"]);
    expect(() => split("(,)", "a,b")).toThrow(/grupos de captura/);
    expect(split("(?:,|;)(?=b)", "a,b;c")).toEqual(["a", "b;c"]);
    expect(finditer("\\d+", "a1b22c٣").map((m) => [m.index, m[0]])).toEqual([
      [1, "1"],
      [3, "22"],
      [6, "٣"],
    ]);
  });
});
