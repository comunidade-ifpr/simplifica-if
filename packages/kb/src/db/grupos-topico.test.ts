/** Agrupamento das fichas da `revisar-ppc` por tópico (`agruparPorTopico`), sem banco. */
import { describe, expect, test } from "vite-plus/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { raizRepositorio } from "../normas/registro.ts";
import { lerTopicosFichas, type TopicoFichas } from "../ppcs/topicos.ts";
import { agruparPorTopico, type FichaPacote, TOPICO_TRANSVERSAL, topicoPrincipal } from "./pacote-contexto.ts";

const topicos: TopicoFichas[] = [
  { id: "a", titulo: "A", fichas: ["F1", "F2", "F3", "F4", "F5"] },
  { id: "b", titulo: "B", fichas: ["F2", "F6"] },
  { id: "c", titulo: "C", fichas: ["F7", "F8"] },
];
const ficha = (id: string, topicosTematicos: string[], tipoEscopo = "tematico"): FichaPacote => ({
  id,
  topicos_tematicos: topicosTematicos,
  tipo_escopo: tipoEscopo,
});

describe("tópico principal", () => {
  test("o mais específico; empate pela ordem da taxonomia; transversal e sem tópico vão ao grupo transversal", () => {
    expect(topicoPrincipal(ficha("F2", ["a", "b"]), topicos)).toBe("b");
    expect(topicoPrincipal(ficha("F9", ["c", "b"]), topicos)).toBe("b");
    expect(topicoPrincipal(ficha("T1", ["a"], "transversal"), topicos)).toBe(TOPICO_TRANSVERSAL);
    expect(topicoPrincipal(ficha("F0", ["inexistente"]), topicos)).toBe(TOPICO_TRANSVERSAL);
  });
});

describe("grupos por tópico", () => {
  const fichas = [
    ficha("F5", ["a"]),
    ficha("F1", ["a"]),
    ficha("F2", ["a", "b"]),
    ficha("F3", ["a"]),
    ficha("F4", ["a"]),
    ficha("F6", ["b"]),
    ficha("T1", ["c"], "transversal"),
  ];

  test("cada ficha uma vez, na ordem da taxonomia, transversal por último, fichas por ID", () => {
    const grupos = agruparPorTopico(fichas, topicos);
    expect(grupos.map((g) => [g.topico, g.escopo, g.fichas.map((f) => f.id)])).toEqual([
      ["a", "secoes", ["F1", "F3", "F4", "F5"]],
      ["b", "secoes", ["F2", "F6"]],
      [TOPICO_TRANSVERSAL, "completo", ["T1"]],
    ]);
  });

  test("tópico maior que o máximo vira partes equilibradas", () => {
    const grupos = agruparPorTopico(fichas, topicos, 3);
    expect(grupos.filter((g) => g.topico === "a").map((g) => [g.parte, g.partes, g.fichas.length])).toEqual([
      [1, 2, 2],
      [2, 2, 2],
    ]);
    expect(() => agruparPorTopico(fichas, topicos, 0)).toThrow("maior que zero");
  });

  test("nas fichas reais, toda ficha cai em exatamente um grupo de no máximo 20", () => {
    const raiz = raizRepositorio();
    const dir = path.join(raiz, ".agents/skills/revisar-ppc/base-analise/fichas");
    const reais = readdirSync(dir)
      .filter((nome) => nome.endsWith(".json"))
      .map((nome) => JSON.parse(readFileSync(path.join(dir, nome), "utf-8")) as FichaPacote);
    const grupos = agruparPorTopico(reais, lerTopicosFichas(raiz));
    const ids = grupos.flatMap((g) => g.fichas.map((f) => f.id));
    expect(ids.length).toBe(reais.length);
    expect(new Set(ids).size).toBe(reais.length);
    expect(grupos.every((g) => g.fichas.length <= 20)).toBe(true);
    expect(grupos.at(-1)!.topico).toBe(TOPICO_TRANSVERSAL);
    expect(grupos.at(-1)!.fichas.every((f) => f.tipo_escopo === "transversal")).toBe(true);
  });
});
