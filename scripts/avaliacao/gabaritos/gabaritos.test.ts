import { describe, expect, test } from "bun:test";
import { esquemaGabaritoConjunto, type GabaritoConjunto } from "../esquema.ts";
import { GERADORES } from "./conjuntos.ts";
import { cnctDoCadastro, cnctDoCurso, carregarFontes } from "./fontes.ts";
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
    const curitiba = q08.detalhes["campus:curitiba"] as Array<{ curso: string; turno: string; turno_original: string }>;
    expect(curitiba).toContainEqual(
      expect.objectContaining({
        curso: "curso:curitiba/tecnico-em-telecomunicacoes",
        turno: "noturno",
        turno_original: "Noturno",
      }),
    );
  });
});

describe("CNCT do curso", () => {
  test("todo curso técnico em oferta tem cnct_id do catálogo ou ausência com motivo", () => {
    const tecnicos = fontes.dados.cursos.filter(
      (curso) => curso.nivel === "médio" && ["ativo", "em_oferta"].includes(curso.situacao ?? ""),
    );
    expect(tecnicos.length).toBeGreaterThan(100);
    for (const curso of tecnicos) {
      expect(Boolean(cnctDoCadastro(curso, fontes.cnct)) || Boolean(curso.cnct_ausencia)).toBe(true);
    }
  });

  test("a proposta pelo nome concorda com o cnct_id cadastrado", () => {
    for (const curso of fontes.dados.cursos.filter((item) => item.cnct_id)) {
      expect(`cnct:${cnctDoCurso(curso.nome, fontes.cnct)?.id}`).toBe(curso.cnct_id!);
    }
  });

  test("propõe pelo nome com forma de oferta, PROEJA e prefixo ausente com forma de oferta, PROEJA e prefixo ausente", () => {
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
