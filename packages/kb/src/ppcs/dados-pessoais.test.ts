// @effect-diagnostics nodeBuiltinImport:off -- teste: compara com a regra do conversor Python por subprocesso
import { describe, expect, test } from "vite-plus/test";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { contarDocumentosPessoais, cpfValido, omitirDocumentosPessoais } from "./dados-pessoais.ts";

// Números de exemplo: 529.982.247-25 e 111.444.777-35 são CPFs de teste com dígito válido.
const CASOS: Array<[entrada: string, saida: string]> = [
  ["**CPF:** 529.982.247-25", "**CPF:** [CPF omitido]"],
  ["**RG:** 1.234.567-8 – SESP/PR", "**RG:** [RG omitido] – SESP/PR"],
  ["CPF: 529.982.247-25 RG: 12345678-9 ENDEREÇO:", "CPF: [CPF omitido] RG: [RG omitido] ENDEREÇO:"],
  [
    "portador da cédula de Identidade nº 1234567 e CPF 111 444 777-35, no uso",
    "portador da cédula de Identidade nº [RG omitido] e CPF [CPF omitido], no uso",
  ],
  ["portador do RG n° 12.345.678 SSP-SP e CPF n° 529.982.247-25,", "portador do RG n° [RG omitido] SSP-SP e CPF n° [CPF omitido],"],
  ["Carteira de Identidade 12345678-9 SSP/PR, CPF 529.982.247-25,", "Carteira de Identidade [RG omitido] SSP/PR, CPF [CPF omitido],"],
  ["CPF nº 111 444 777 35 resolvem", "CPF nº [CPF omitido] resolvem"],
  // Sem rótulo, só o número formatado com dígito válido.
  ["inscrito sob 529.982.247-25.", "inscrito sob [CPF omitido]."],
  ["inscrito sob 529.982.247-26.", "inscrito sob 529.982.247-26."],
  // Falsos positivos que ficam: Lattes e ISBN quebrados, "órgãos", CNPJ, campo em branco.
  ["http://lattes.cnpq.br/12345<br>52998224725", "http://lattes.cnpq.br/12345<br>52998224725"],
  ["ISBN 9788521617259 85.", "ISBN 9788521617259 85."],
  ["órgãos 12345 e Órgão 2020", "órgãos 12345 e Órgão 2020"],
  ["CNPJ/MF sob o nº 12.345.678/0001-95", "CNPJ/MF sob o nº 12.345.678/0001-95"],
  ["portador do RG nº e CPF nº ;", "portador do RG nº e CPF nº ;"],
  ["identidade visual do IFPR (IFPR, 2019, p. 10)", "identidade visual do IFPR (IFPR, 2019, p. 10)"],
];

describe("omissão de CPF e RG", () => {
  test("dígito verificador do CPF", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });

  test.each(CASOS)("%s", (entrada, saida) => {
    expect(omitirDocumentosPessoais(entrada)).toBe(saida);
  });

  test("conta o que a omissão trocaria, e nada depois dela", () => {
    const texto = CASOS.map(([entrada]) => entrada).join("\n");
    expect(contarDocumentosPessoais(texto)).toEqual({ cpf: 7, rg: 5 });
    expect(contarDocumentosPessoais(omitirDocumentosPessoais(texto))).toEqual({ cpf: 0, rg: 0 });
  });

  const python = NodeChildProcess.spawnSync("python3", ["--version"]).status === 0;
  test.skipIf(!python)("o conversor Python aplica a mesma regra", () => {
    const scripts = NodePath.resolve(import.meta.dirname, "../../../../scripts");
    const resultado = NodeChildProcess.spawnSync(
      "python3",
      [
        "-c",
        "import json, sys; from converter_ppcs_markdown import omitir_documentos_pessoais as o; " +
          "print(json.dumps([o(t) for t in json.load(sys.stdin)]))",
      ],
      { cwd: scripts, input: JSON.stringify(CASOS.map(([entrada]) => entrada)), encoding: "utf-8" },
    );
    expect(resultado.stderr).toBe("");
    expect(JSON.parse(resultado.stdout)).toEqual(CASOS.map(([, saida]) => saida));
  });
});
