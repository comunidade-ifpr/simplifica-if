// @effect-diagnostics nodeBuiltinImport:off -- teste: lê os casos e compara com a regra do conversor Python por subprocesso
import { describe, expect, test } from "vite-plus/test";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { contarDadosPessoais, cpfValido, omitirDadosPessoais, totalDadosPessoais } from "./dados-pessoais.ts";

/** Os mesmos casos valem para a regra TS e para a do conversor Python. */
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

  const python = NodeChildProcess.spawnSync("python3", ["--version"]).status === 0;
  test.skipIf(!python)("o conversor Python aplica a mesma regra aos mesmos casos", () => {
    const scripts = NodePath.resolve(import.meta.dirname, "../../../../scripts");
    const resultado = NodeChildProcess.spawnSync(
      "python3",
      [
        "-c",
        "import json, sys; from converter_ppcs_markdown import aplicar_omissao as o; " +
          "print(json.dumps([o(t) for t in json.load(sys.stdin)], ensure_ascii=False))",
      ],
      { cwd: scripts, input: JSON.stringify(CASOS.map((caso) => caso.entrada)), encoding: "utf-8" },
    );
    expect(resultado.stderr).toBe("");
    const saidas = JSON.parse(resultado.stdout) as Array<[string, Record<string, number>]>;
    expect(saidas.map(([texto]) => texto)).toEqual(CASOS.map((caso) => caso.saida));
    expect(saidas.map(([, contagem]) => contagem)).toEqual(CASOS.map((caso) => contarDadosPessoais(caso.entrada)));
  });
});
