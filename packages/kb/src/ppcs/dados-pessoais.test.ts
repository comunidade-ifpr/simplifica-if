// @effect-diagnostics nodeBuiltinImport:off -- teste: lê os casos de dados-pessoais.casos.json
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { contarDadosPessoais, cpfValido, omitirDadosPessoais, totalDadosPessoais } from "./dados-pessoais.ts";

/** Casos de entrada e saída esperada da omissão. */
const CASOS = JSON.parse(
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "dados-pessoais.casos.json"), "utf-8"),
) as Array<{ descricao: string; entrada: string; saida: string }>;

describe("omissão de dados pessoais", () => {
  test("dígito verificador do CPF", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });

  test.each(CASOS)("$descricao", ({ entrada, saida }) => {
    expect(omitirDadosPessoais(entrada)).toBe(saida);
  });

  test("conta por categoria o que a omissão trocaria, e nada depois dela", () => {
    const texto = CASOS.map((caso) => caso.entrada).join("\n\n");
    const antes = contarDadosPessoais(texto);
    expect(antes).toEqual({ cpf: 8, rg: 10, telefone: 6, matricula: 1, siape: 4 });
    expect(totalDadosPessoais(contarDadosPessoais(omitirDadosPessoais(texto)))).toBe(0);
  });
});
