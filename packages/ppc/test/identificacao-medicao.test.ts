/**
 * Medição da identificação do curso (`src/identificacao.ts`) nos PPCs técnicos da base: o CNCT e a
 * forma de oferta achados no documento contra o registro do curso
 * (`base-conhecimento/institucional/ifpr/cursos/`). O registro só serve de gabarito; a identificação
 * lê só o Markdown.
 *
 * O teste trava os números medidos: CNCT errado (um curso que não é o do PPC) não pode aparecer, e os
 * acertos não podem cair. O PROEJA é registrado na base com `forma_oferta: integrado`; a
 * identificação o devolve como `proeja`, e o gabarito conta o PROEJA pelo nome do curso.
 */
import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { carregarBaseRevisao, lerPpc, ppcsTecnicos } from "../scripts/base-tecnica.ts";
import { identificarCurso } from "../src/identificacao.ts";

const raiz = raizRepositorio();
const base = await carregarBaseRevisao(raiz);
const ppcs = ppcsTecnicos(raiz, base.cncts).filter((ppc) => ppc.cnct);

const formaEsperada = (forma: string, id: string) => (forma === "integrado" && /proeja/.test(id) ? "proeja" : forma);

const medicao = ppcs.map((ppc) => {
  const achado = identificarCurso(lerPpc(ppc), base.cncts);
  return {
    id: ppc.id,
    cnct: achado.cnct === null ? "nulo" : achado.cnct.slug === ppc.cnct!.slug ? "certo" : "errado",
    cnctAchado: achado.cnct?.slug ?? null,
    cnctEsperado: ppc.cnct!.slug,
    denominacao: achado.denominacao,
    forma: achado.forma === null ? "nula" : achado.forma === formaEsperada(ppc.forma, ppc.id) ? "certa" : "errada",
    formaAchada: achado.forma,
    formaEsperada: formaEsperada(ppc.forma, ppc.id),
  };
});

/**
 * Medido em 21/11/2026, de 109: 108 certos e 1 nulo (PPC escaneado com OCR sem espaços). Antes, com a
 * busca da denominação do CNCT no início do texto: 97 certos e 12 errados.
 * 24/11/2026: 7 PPCs técnicos foram para as pendências (ano sem evidência); de 102, 101 certos e o mesmo 1 nulo.
 */
const CNCT_CERTOS = 101;
/**
 * Medido em 21/11/2026: 109 de 109. Antes: 96, com 13 erradas (10 PROEJA por menção ao programa no
 * texto institucional, 3 integrado no lugar de subsequente).
 * 24/11/2026: 7 PPCs técnicos foram para as pendências (ano sem evidência); 102 de 102.
 */
const FORMAS_CERTAS = 102;

describe("identificação do curso nos PPCs técnicos da base", () => {
  test("amostra", () => {
    expect(ppcs.length).toBeGreaterThanOrEqual(100);
  });

  test("CNCT: nenhum curso errado, e os acertos não caem", () => {
    const errados = medicao.filter((m) => m.cnct === "errado");
    expect(errados, JSON.stringify(errados, null, 1)).toEqual([]);
    const nulos = medicao.filter((m) => m.cnct === "nulo");
    const certos = medicao.filter((m) => m.cnct === "certo").length;
    expect(certos, JSON.stringify(nulos, null, 1)).toBeGreaterThanOrEqual(CNCT_CERTOS);
  });

  test("forma de oferta: os acertos não caem", () => {
    const falhas = medicao.filter((m) => m.forma !== "certa");
    expect(medicao.length - falhas.length, JSON.stringify(falhas, null, 1)).toBeGreaterThanOrEqual(FORMAS_CERTAS);
  });
});
