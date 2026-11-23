import { expect, test } from "vite-plus/test";
import { artigosCitados, artigosInexistentes } from "./pontos-chave.ts";

test("os artigos do parêntese final, em lista e em faixa", () => {
  expect(artigosCitados("Carga horária mínima de 800 h (art. 29).")).toEqual(["29"]);
  expect(artigosCitados("Formatos de oferta (arts. 48 a 53)")).toEqual(["48", "53"]);
  expect(artigosCitados("Certificação (art. 44, §§ 5º e 6º; art. 45, § 8º).")).toEqual(["44", "45"]);
  expect(artigosCitados("PPC (arts. 26 e 28; art. 36-A)")).toEqual(["26", "28", "36A"]);
  expect(artigosCitados("Reserva (arts. 3º ao 5º)")).toEqual(["3", "5"]);
  expect(artigosCitados("Oferta (art. 5º, I; e 7º)")).toEqual(["5", "7"]);
  expect(artigosCitados("Prazo (art. 4º, § 2º, e art. 9º, I a III)")).toEqual(["4", "9"]);
});

test("o parêntese final que nomeia outro ato não é conferido", () => {
  expect(artigosCitados("Vale para todo o currículo (Lei nº 9.394/1996, art. 26-A, § 2º).")).toEqual([]);
});

test("artigo de outra norma no meio do item não conta; item sem parêntese final, nada", () => {
  expect(artigosCitados("Substitui o art. 6º da Resolução CNE/CEB nº 3/2025 nesta matéria (art. 30).")).toEqual(["30"]);
  expect(artigosCitados("O AEE não é componente curricular.")).toEqual([]);
});

test("acusa o artigo que a norma não tem, no ato ou no anexo", () => {
  const dispositivos = [{ dispositivo: "#art29" }, { dispositivo: "#anexo1-art3" }, { dispositivo: "#art29-par1" }];
  expect(artigosInexistentes("x (arts. 29 e 3)", dispositivos)).toEqual([]);
  expect(artigosInexistentes("x (art. 30)", dispositivos)).toEqual(["30"]);
});
