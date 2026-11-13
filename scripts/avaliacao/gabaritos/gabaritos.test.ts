import { describe, expect, test } from "bun:test";
import { esquemaGabaritoConjunto, type GabaritoConjunto } from "../esquema.ts";
import { citacoesCneCp1de2021, citacoesCneCp2de2026 } from "./citacoes.ts";
import { GERADORES } from "./conjuntos.ts";
import { cnctDoCurso, carregarFontes } from "./fontes.ts";
import { divergencias, gerarArquivos } from "./gerar.ts";

const fontes = carregarFontes();
const arquivos = gerarArquivos(fontes);

function gabarito(nome: string): GabaritoConjunto {
  return esquemaGabaritoConjunto.parse(JSON.parse(arquivos.get(nome) ?? "null"));
}

describe("geradores de gabarito", () => {
  test("os arquivos versionados em avaliacao/gabaritos/ estão atualizados", () => {
    expect(divergencias(arquivos)).toEqual([]);
  });

  test("a geração é determinística", () => {
    expect(gerarArquivos(fontes)).toEqual(arquivos);
  });

  test("todo gerador produz gabarito válido e ordenado", () => {
    for (const nome of Object.keys(GERADORES)) {
      const { esperado } = gabarito(nome);
      expect(esperado).toEqual([...new Set(esperado)].sort());
    }
  });

  test("Q12: art. 71 alcança todo técnico em oferta, e não só quem cita a norma de 2021", () => {
    const q12 = gabarito("q12-tecnicos-em-oferta.json");
    const q02 = new Set(gabarito("q02-ppcs-citam-cne-cp-1-2021.json").esperado);
    expect(q12.detalhes.total).toBe(q12.esperado.length);
    expect(q12.esperado.filter((id) => !q02.has(id)).length).toBeGreaterThan(0);
    const fora = q12.detalhes.fora_do_conjunto as Record<string, string | null>;
    expect(fora["curso:arapongas/tecnico-em-melhoria-de-processos"]).toBe("suspenso");
    expect(q12.esperado).not.toContain("curso:arapongas/tecnico-em-melhoria-de-processos");
  });

  test("Q05: só o PPC de Ivaiporã tem seção de acompanhamento de egresso", () => {
    const q05 = gabarito("q05-ppcs-agropecuaria.json");
    expect(q05.esperado).toHaveLength(3);
    const comSecao = Object.entries(q05.detalhes as Record<string, { secoes_acompanhamento_egresso: string[] }>)
      .filter(([, detalhe]) => detalhe.secoes_acompanhamento_egresso.length > 0)
      .map(([id]) => id);
    expect(comSecao).toEqual(["curso:ivaipora/tecnico-em-agropecuaria-integrado-ao-ensino-medio"]);
  });

  test("Q20: nenhum PPC técnico cita a Res. CNE/CP nº 2/2026", () => {
    expect(gabarito("q20-ppcs-citam-cne-cp-2-2026.json").esperado).toEqual([]);
  });

  test("Q04: normas publicadas desde 2025 incluem a nova DCN e a Lei 15.468", () => {
    const q04 = gabarito("q04-normas-desde-2025.json");
    expect(q04.esperado).toContain("br/cne-cp/res/2026/2");
    expect(q04.esperado).toContain("br/lei/2026/15468");
    expect(q04.esperado).not.toContain("br/cne-cp/res/2021/1");
    expect(q04.avaliar_precisao).toBe(false);
  });

  test("Q08: o campus de Curitiba entra pela oferta noturna de Telecomunicações", () => {
    const q08 = gabarito("q08-campi-eixo-informacao-comunicacao.json");
    const curitiba = q08.detalhes["campus:curitiba"] as Array<{ curso: string; turno: string }>;
    expect(curitiba).toContainEqual(
      expect.objectContaining({ curso: "curso:curitiba/tecnico-em-telecomunicacoes", turno: "Noturno" }),
    );
  });
});

describe("CNCT do curso", () => {
  test("casa nomes com forma de oferta, PROEJA e prefixo ausente", () => {
    expect(cnctDoCurso("Técnico em Informática Integrado ao Ensino Médio", fontes.cnct)?.id).toBe(
      "tecnico-em-informatica",
    );
    expect(cnctDoCurso("Curso Técnico de Informática Integrado ao Ensino Médio", fontes.cnct)?.id).toBe(
      "tecnico-em-informatica",
    );
    expect(cnctDoCurso("Administração – PROEJA", fontes.cnct)?.id).toBe("tecnico-em-administracao");
    expect(cnctDoCurso("Mecânica", fontes.cnct)?.id).toBe("tecnico-em-mecanica");
    expect(cnctDoCurso("Técnico em Melhoria de Processos", fontes.cnct)).toBeUndefined();
  });
});

describe("citações às DCN da EPT", () => {
  test.each([
    "Resolução CNE/CP nº 1, de 5 de janeiro de 2021",
    "Resolução CNE/CP n. 01/2021",
    "Resolução CNE/CP nº01/2021",
    "Resolução CNE /CP nº 1/2021",
    "Resolução CNE/CP nº 01 de 05 dejaneiro de 2021",
    "Resolução CNE/CP nº 1. de 05 de janeiro de 2021",
    "Resolução CNE/CP nº 1, de 5 de janeiro<br>de 2021",
    "Resolução nº 1, de 5 de janeiro de 2021 (CNE/CP)",
    "Parecer CNE/CP nº 01/2021 que Define as Diretrizes",
    "Resolução CNE/CEB nº 1/2021, que define as Diretrizes Curriculares Nacionais Gerais para a Educação Profissional",
  ])("reconhece %p", (texto) => {
    expect(citacoesCneCp1de2021(texto).length).toBeGreaterThan(0);
  });

  test.each([
    "Resolução CNE/CP nº 05 de 2021 DCN CG",
    "Resolução CNE/CEB nº 01/2021 (EJA)",
    "Resolução CNE/CP nº 11/2021",
    "Resolução CNE/CP nº 1/2012",
    "mestre em educação profissional e tecnológica (2021)",
  ])("não reconhece %p", (texto) => {
    expect(citacoesCneCp1de2021(texto)).toEqual([]);
  });

  test("Res. CNE/CP nº 2/2026", () => {
    expect(citacoesCneCp2de2026("Resolução CNE/CP nº 2, de 11 de novembro de 2026")).toHaveLength(1);
    expect(citacoesCneCp2de2026("Resolução CNE/CP nº 2/2025")).toEqual([]);
  });
});
