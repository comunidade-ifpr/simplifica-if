/** Dispositivos citados → IDs (`dispositivos.ts`): inciso com letra, item, faixas, conjunções e desempenho. */
import { describe, expect, test } from "bun:test";
import { analisarDispositivos, dispositivoAntes } from "./dispositivos.ts";
import { resolverCitacao } from "./resolver.ts";
import { normalizarCitacao } from "./texto-citacao.ts";

describe("analisarDispositivos", () => {
  test.each([
    ["art. 9º, inciso IV-A", ["#art9-ivA"]],
    ["art. 9, IV-A", ["#art9-ivA"]],
    ["art. 2º, item 3", ["#art2-item3"]],
    ["art. 4º, inciso I, alínea a, item 1", ["#art4-i-al-a-item1"]],
    ["art. 5º, alíneas a a c", ["#art5-al-a", "#art5-al-b", "#art5-al-c"]],
    ["art. 82 e parágrafo único", ["#art82", "#art82-parunico"]],
    ["art. 5º e § 1º", ["#art5", "#art5-par1"]],
    // sem regressão
    ["art. 28, § 2º", ["#art28-par2"]],
    ["art. 28, parágrafo único", ["#art28-parunico"]],
    ["incisos I-II do art. 3º", ["#art3-i", "#art3-ii"]],
    ["art. 36-A", ["#art36A"]],
  ])("%p", (texto, esperado) => {
    expect(analisarDispositivos(normalizarCitacao(texto))).toEqual(esperado);
  });

  test("inciso com letra na citação completa", () => {
    expect(resolverCitacao("Lei nº 9.394/1996, art. 9º, inciso IV-A").dispositivoId).toBe("#art9-ivA");
  });
});

describe("dispositivoAntes em tempo linear", () => {
  test.each([
    ["<br> repetido", `Art. 5º${"<br>".repeat(12)}! da Lei nº 9.394/1996`],
    ["espaços", `Art. 5º${" ".repeat(60)}! da Lei nº 9.394/1996`],
    ["tokens repetidos", `${"art. 5, ".repeat(40)}! da Lei nº 9.394/1996`],
    ["prefixo grande", `${"art 1 , ".repeat(2000)}x! da Lei nº 9.394/1996`],
  ])("%s", (_nome, texto) => {
    const inicio = performance.now();
    expect(resolverCitacao(texto).id).toBe("br/lei/1996/9394");
    const prefixo = normalizarCitacao(texto.slice(0, texto.indexOf(" da Lei") + 3));
    expect(dispositivoAntes(prefixo)).toBeNull();
    expect(performance.now() - inicio).toBeLessThan(50);
  });

  test("continua achando a cadeia antes da citação", () => {
    expect(dispositivoAntes(normalizarCitacao("nos termos do inciso III do art. 28 da"))).toBe("inciso iii do art. 28");
  });
});
