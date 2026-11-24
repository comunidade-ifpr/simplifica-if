import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import { notasDoTexto } from "./estrutura.ts";
import { carregarFonteVigencia, intervalosVigencia, statusDoTexto, statusEm } from "./vigencia.ts";

const disp = (texto: string, revogado = false) => ({ revogado, notas: notasDoTexto(texto) });

test("o status que o texto mostra: revogação de dispositivo pesa mais que alteração", () => {
  expect(statusDoTexto([disp("Texto.")])).toBeNull();
  expect(statusDoTexto([disp("Texto. (Vide Lei nº 13.415, de 2017) (Regulamento) (Vigência)")])).toBeNull();
  expect(statusDoTexto([disp("Texto. (Incluído pela Lei nº 14.913, de 2024)")])).toBe("alterada");
  expect(statusDoTexto([disp("Texto. (Redação dada pela Lei nº 14.913, de 2024)"), disp("(Revogado)", true)])).toBe(
    "parcialmente revogada",
  );
});

describe("o piso do texto consolidado na base", () => {
  const fonte = carregarFonteVigencia(raizRepositorio());
  const em = fonte.consolidado.em;

  test("lei alterada só por atos sem texto na base: alterada da data de referência em diante", () => {
    const estagio = "br/lei/2008/11788";
    expect(fonte.relacoes.some((r) => r.alvo === estagio && (r.tipo === "altera" || r.tipo === "revoga"))).toBe(false);
    expect(statusEm(estagio, em, fonte)).toMatchObject({ status: "alterada" });
    // antes dela, só as relações registradas decidem: a nota de redação não traz a data do efeito
    expect(statusEm(estagio, "2020-01-01", fonte).status).toBe("vigente");
    expect(intervalosVigencia(estagio, fonte).at(-1)).toMatchObject({
      de: em,
      ate: null,
      status: "alterada",
      fonte: "texto consolidado",
    });
  });

  test("dispositivo revogado no texto: parcialmente revogada", () => {
    expect(statusEm("br/lei/2008/11892", em, fonte).status).toBe("parcialmente revogada");
  });

  test("o piso não rebaixa o que as relações já dizem nem atinge norma sem nota", () => {
    expect(statusEm("ifpr/proens/in/2021/1", em, fonte).status).toBe("revogada");
    expect(fonte.consolidado.status.has("br/lei/2024/14945")).toBe(false);
  });
});
