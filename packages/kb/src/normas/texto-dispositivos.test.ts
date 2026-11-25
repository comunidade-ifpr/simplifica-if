/** Texto legível de IDs de dispositivo (`texto-dispositivos.ts`) alinhado ao contrato de `ids.ts`. */
import { describe, expect, test } from "vite-plus/test";
import { textoDispositivos } from "./texto-dispositivos.ts";

describe("textoDispositivos", () => {
  test.each([
    [["#art9-ivA"], "art. 9º, IV-A"],
    [["#art66-al-a"], 'art. 66, alínea "a"'],
    [["#art2-item3"], "art. 2º, item 3"],
    [["#art4-i-al-a-item1"], 'art. 4º, I, alínea "a", item 1'],
    [["#anexo1-art5"], "Anexo 1, art. 5º"],
    [["#anexo1-art5", "#anexo1-art6-par1"], "Anexo 1, arts. 5º e 6º, § 1º"],
    [["#secao1"], "seção 1"],
    [["#art9-iv", "#art9-ivA", "#art9-v"], "art. 9º, IV, IV-A e V"],
    // sem regressão
    [["#art29", "#art30", "#art37-par3"], "arts. 29, 30 e 37, § 3º"],
    [["#art5-ii-al-a"], 'art. 5º, II, alínea "a"'],
    [["#anexo1-item3"], "Anexo 1, item 3"],
  ])("%p → %p", (ids, esperado) => {
    expect(textoDispositivos(ids)).toBe(esperado);
  });

  test("ID malformado continua lançando erro", () => {
    expect(() => textoDispositivos(["#artigo5"])).toThrow("dispositivo malformado");
  });
});
