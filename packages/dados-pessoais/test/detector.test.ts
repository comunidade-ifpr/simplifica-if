/**
 * O detector de dados pessoais (M1.13): casos válidos e inválidos de cada tipo, os falsos positivos
 * que os PPCs trazem (processo SEI, CNPJ, SIAPE, datas, códigos, telefone do campus) e as máscaras.
 * Os CPFs aqui são números de teste com DV válido, não de pessoas.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  cpfValido,
  descreverContagem,
  detectarDadosPessoais,
  emailInstitucional,
  mascarar,
  resumirAchados,
  trechoMascarado,
} from "../src/detector.ts";

const tipos = (texto: string) => detectarDadosPessoais(texto).map((achado) => achado.tipo);
const valores = (texto: string) => detectarDadosPessoais(texto).map((achado) => texto.slice(achado.inicio, achado.fim));

describe("CPF", () => {
  test("dígitos verificadores", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("11144477735")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("1234567890")).toBe(false);
  });

  test("formatado e com DV válido: avisa sem rótulo", () => {
    expect(valores("Aluno 529.982.247-25 matriculado")).toEqual(["529.982.247-25"]);
    expect(tipos("(111.444.777-35)")).toEqual(["cpf"]);
  });

  test("DV inválido ou dígitos repetidos: não avisa", () => {
    expect(tipos("529.982.247-24")).toEqual([]);
    expect(tipos("000.000.000-00 e 111.111.111-11")).toEqual([]);
  });

  test("sem formato só com 'CPF' logo antes", () => {
    expect(tipos("número 52998224725 do protocolo")).toEqual([]);
    expect(valores("CPF: 52998224725")).toEqual(["52998224725"]);
    expect(valores("portador do C.P.F. nº 529982247-25")).toEqual(["529982247-25"]);
  });

  test("pedaço de número maior não é CPF", () => {
    expect(tipos("CPF 5299822472512")).toEqual([]);
    expect(tipos("cod. 1.529.982.247-25")).toEqual([]);
    expect(tipos("529.982.247-25/0001")).toEqual([]);
  });
});

describe("RG", () => {
  test("com rótulo", () => {
    expect(valores("portador do RG nº 12.345.678-9 SSP/PR")).toEqual(["12.345.678-9"]);
    expect(valores("Carteira de Identidade nº 7654321")).toEqual(["7654321"]);
    expect(valores("Registro Geral: 4.123.456-7")).toEqual(["4.123.456-7"]);
    expect(valores("RG 1234567-X")).toEqual(["1234567-X"]);
  });

  test("sem rótulo ou curto demais: não avisa", () => {
    expect(tipos("12.345.678-9")).toEqual([]);
    expect(tipos("RG 1234")).toEqual([]);
    expect(tipos("identidade visual do IFPR 2024")).toEqual([]);
  });
});

describe("telefone", () => {
  test("celular com DDD válido", () => {
    expect(valores("Contato: (41) 99876-5432.")).toEqual(["(41) 99876-5432"]);
    expect(valores("ligue 41 99876-5432")).toEqual(["41 99876-5432"]);
    expect(valores("+55 41 99876-5432")).toEqual(["+55 41 99876-5432"]);
    expect(valores("(41)998765432")).toEqual(["(41)998765432"]);
  });

  test("celular sem DDD só depois de telefone, celular, WhatsApp", () => {
    expect(valores("WhatsApp: 99876-5432")).toEqual(["99876-5432"]);
    expect(valores("celular 99876-5432")).toEqual(["99876-5432"]);
    expect(tipos("código 99876-5432")).toEqual([]);
  });

  test("fixo, DDD inexistente e 0800 não avisam", () => {
    expect(tipos("Secretaria: (41) 3535-1234")).toEqual([]);
    expect(tipos("Telefone: 3535-1234")).toEqual([]);
    expect(tipos("(20) 99876-5432")).toEqual([]);
    expect(tipos("0800 644 0000")).toEqual([]);
  });
});

describe("e-mail", () => {
  test("fora do IFPR avisa; ifpr.edu.br e subdomínios, não", () => {
    expect(emailInstitucional("coord.tads@ifpr.edu.br")).toBe(true);
    expect(emailInstitucional("x@curitiba.ifpr.edu.br")).toBe(true);
    expect(emailInstitucional("x@ifpr.edu.br.example.com")).toBe(false);
    expect(emailInstitucional("x@naoifpr.edu.br")).toBe(false);
    expect(valores("escreva para maria.silva@gmail.com ou secretaria@ifpr.edu.br")).toEqual(["maria.silva@gmail.com"]);
  });
});

describe("falsos positivos dos PPCs", () => {
  test.each([
    ["processo SEI", "Processo SEI nº 23411.012345/2024-12"],
    ["processo SEI sem pontuação", "23411012345202412"],
    ["CNPJ", "CNPJ 10.652.179/0001-15"],
    ["CNPJ sem pontuação", "10652179000115"],
    ["SIAPE", "SIAPE 1234567"],
    ["datas", "de 01/02/2024 a 31-12-2025"],
    ["código de curso e carga horária", "Curso 12345 – 1.200 horas – Portaria nº 1.234/2024"],
    ["CEP", "CEP 80230-150"],
    ["telefone do campus", "Fone: (41) 3535-1800 – ramal 2045"],
    ["link do IFPR", "https://ifpr.edu.br/curitiba"],
  ])("%s", (_nome, texto) => expect(tipos(texto)).toEqual([]));
});

describe("máscaras e trechos", () => {
  test("cada tipo mascarado", () => {
    expect(mascarar("cpf", "529.982.247-25")).toBe("529.***.***-**");
    expect(mascarar("rg", "12.345.678-9")).toBe("12.***.***-*");
    expect(mascarar("telefone", "(41) 99876-5432")).toBe("(41) *****-**32");
    expect(mascarar("telefone", "+55 41 99876-5432")).toBe("+55 41 *****-**32");
    expect(mascarar("email", "maria.silva@gmail.com")).toBe("m***@g***.com");
    expect(mascarar("email", "a@uol.com.br")).toBe("a***@u***.com.br");
  });

  test("o trecho mascara todos os achados dentro dele, sem cortar um ao meio", () => {
    const texto = "Fulano, CPF 529.982.247-25, celular (41) 99876-5432, e-mail fulano@gmail.com, mora em Curitiba.";
    const achados = detectarDadosPessoais(texto);
    expect(achados.map((achado) => achado.tipo)).toEqual(["cpf", "telefone", "email"]);
    const trecho = trechoMascarado(texto, achados[1]!, achados, 12);
    expect(trecho).toBe("…529.***.***-**, celular (41) *****-**32, e-mail f***@g***.com…");
    expect(trecho).not.toMatch(/982|9876|fulano@/);
  });

  test("resumo de um documento: contagem por tipo e o lugar", () => {
    const resumo = resumirAchados([
      { onde: "linha 1", texto: "Sem nada." },
      { onde: "linha 2", texto: "CPF 529.982.247-25 e 111.444.777-35" },
      { onde: "linha 5", texto: "ana@hotmail.com" },
    ]);
    expect(resumo.total).toBe(3);
    expect(resumo.porTipo).toEqual({ cpf: 2, rg: 0, telefone: 0, email: 1 });
    expect(resumo.exemplos.map((exemplo) => exemplo.onde)).toEqual(["linha 2", "linha 2", "linha 5"]);
    expect(JSON.stringify(resumo)).not.toMatch(/982\.247|444\.777|ana@/);
    expect(resumirAchados([{ onde: "x", texto: "a@b.com ".repeat(30) }], 5).exemplos).toHaveLength(5);
  });

  test("contagem por extenso", () => {
    expect(descreverContagem({ cpf: 2, rg: 0, telefone: 0, email: 1 })).toBe("2 CPFs e 1 e-mail pessoal");
    expect(descreverContagem({ cpf: 1, rg: 1, telefone: 3, email: 0 })).toBe("1 CPF, 1 RG e 3 celulares");
  });
});
