import { describe, expect, test } from "vite-plus/test";
import { dadosPessoaisEUrlsInternas } from "./normas.ts";

describe("validar_base: dados pessoais e URLs internas", () => {
  test("acusa cada categoria só com contagens, sem repetir o valor", () => {
    const texto = [
      "CPF: 529.982.247-25 RG: 12.345.678-9",
      "Telefone: (41) 99999-1234",
      "|Ana|20231234567|",
      "SIAPE: 1234567",
    ].join("\n");
    const erros = dadosPessoaisEUrlsInternas("institucional/ifpr/ppcs/a/b.md", texto);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("1 CPF, 1 RG, 1 celular, 1 matrícula, 1 SIAPE");
    for (const valor of ["529.982.247-25", "99999-1234", "20231234567", "1234567"]) {
      expect(erros[0]).not.toContain(valor);
    }
  });

  test("recusa planilha do Google fora do horarios_url de campus e URL de sessão do SEI", () => {
    const planilha = "https://docs.google.com/spreadsheets/d/abc/edit";
    expect(dadosPessoaisEUrlsInternas("institucional/ifpr/processos-sei/index.json", `Origem: ${planilha}`)).toEqual([
      "institucional/ifpr/processos-sei/index.json contém 1 link(s) de planilha do Google; tire o link (semPlanilhasGoogle)",
    ]);
    expect(
      dadosPessoaisEUrlsInternas("institucional/ifpr/campi/colombo.json", `  "horarios_url": "${planilha}",`),
    ).toEqual([]);
    expect(
      dadosPessoaisEUrlsInternas("x.md", "https://sei.ifpr.edu.br/sei/controlador.php?acao=x&infra_hash=0123abcd0123"),
    ).toHaveLength(1);
    expect(dadosPessoaisEUrlsInternas("x.md", "Fone: (44) 3482-1234; e-mail coordenacao@ifpr.edu.br")).toEqual([]);
  });
});
