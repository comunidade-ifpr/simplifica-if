import type { CnctDoIndice, CursoDoIndice, NormaDoIndice } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import {
  A_CONFIRMAR,
  cursosPorCnct,
  dataBr,
  filtrarCnct,
  filtrarCursos,
  filtrarNormas,
  nomeResultado,
  nomeTurno,
  nomeVigencia,
  opcoes,
  pedidoSobre,
  quantos,
  ressalvaDoFato,
} from "./colecoes.ts";
import { nomeDaPagina } from "./nomes.ts";

const norma = (n: Partial<NormaDoIndice> & Pick<NormaDoIndice, "id" | "titulo">): NormaDoIndice => ({
  tipo: "Resolução",
  numero: null,
  ano: null,
  orgao: "CNE/CP",
  situacao: "base",
  status_vigencia: "vigente",
  vigencia_a_confirmar: false,
  ementa: null,
  apelidos: [],
  link: `ifpr://norma/${n.id}`,
  ...n,
});

const curso = (c: Partial<CursoDoIndice> & Pick<CursoDoIndice, "id" | "nome" | "campus">): CursoDoIndice => ({
  campus_nome: c.campus,
  nivel: "médio",
  forma_oferta: "subsequente",
  modalidade: "presencial",
  situacao: "ativo",
  cnct: null,
  ppc: null,
  turnos: [],
  processos: [],
  pagina_oficial: null,
  link: `ifpr://curso/${c.id}`,
  ...c,
});

describe("nomes", () => {
  it("situação de vigência, turno, resultado do cruzamento e data", () => {
    expect(nomeVigencia("vigente")).toBe("Em vigor");
    expect(nomeVigencia("parcialmente revogada")).toBe("Revogada em parte");
    expect(nomeVigencia(null)).toBe("Sem situação registrada");
    expect(nomeTurno("matutino-com-contraturno")).toBe("Matutino com contraturno");
    expect(nomeResultado("diverge")).toEqual({ nome: "Diverge", alerta: true });
    expect(nomeResultado("confere").alerta).toBe(false);
    expect(nomeResultado("outro-caso").nome).toBe("Outro caso");
    expect(dataBr("2026-03-20")).toBe("20/03/2026");
  });

  it("a ressalva de cada fato do PPC que não foi revisado; a contagem no singular e no plural", () => {
    expect(ressalvaDoFato("Revisado")).toBeNull();
    expect(ressalvaDoFato("extraido")).toBe("Extraído, conferir");
    expect(ressalvaDoFato("Precisa de revisão")).toBe("Precisa de revisão");
    expect(ressalvaDoFato("Pendente")).toBe("Precisa de revisão");
    expect(quantos(1, "item de pauta", "itens de pauta")).toBe("1 item de pauta");
    expect(quantos(3, "item de pauta", "itens de pauta")).toBe("3 itens de pauta");
  });

  it("o pedido para a IA leva o nome e o link, sem enviar nada", () => {
    expect(pedidoSobre("o Campus Curitiba", ["ifpr://campus/curitiba"])).toBe(
      "Sobre o Campus Curitiba (ifpr://campus/curitiba):\n",
    );
    expect(pedidoSobre("a reunião", [])).toBe("Sobre a reunião:\n");
  });

  it("o nome da página vem do índice; sem ele, o nome curto do link", () => {
    const indice = {
      normas: [],
      cursos: [
        curso({ id: "curitiba/enf", nome: "Técnico em Enfermagem", campus: "curitiba", campus_nome: "Curitiba" }),
      ],
      ppcs: [],
      campi: [],
      cnct: [],
      fichas: [],
      processos: [],
      reunioes: [],
    };
    expect(nomeDaPagina("ifpr://curso/curitiba/enf", indice)).toBe("o curso Técnico em Enfermagem, Campus Curitiba");
    expect(nomeDaPagina("ifpr://norma/br/cne-cp/res/2021/1#art20", indice)).toBe("Res. CNE/CP 1/2021, art. 20");
  });
});

describe("filtros", () => {
  const normas = [
    norma({
      id: "br/lei/1996/9394",
      titulo: "Lei nº 9.394/1996",
      tipo: "Lei",
      orgao: "Presidência da República",
      ano: 1996,
      apelidos: ["LDB"],
    }),
    norma({
      id: "br/cne-cp/res/2021/1",
      titulo: "Resolução CNE/CP nº 1/2021",
      ano: 2021,
      status_vigencia: "revogada",
      vigencia_a_confirmar: true,
    }),
    norma({ id: "br/cne-cp/res/2026/2", titulo: "Resolução CNE/CP nº 2/2026", ano: 2026 }),
  ];

  it("normas por órgão, ano, vigência (inclusive a confirmar) e texto, mais recentes primeiro", () => {
    expect(filtrarNormas(normas, {}).map((n) => n.ano)).toEqual([2026, 2021, 1996]);
    expect(filtrarNormas(normas, { orgao: "CNE/CP" })).toHaveLength(2);
    expect(filtrarNormas(normas, { ano: "2021" }).map((n) => n.id)).toEqual(["br/cne-cp/res/2021/1"]);
    expect(filtrarNormas(normas, { vigencia: "revogada" })).toHaveLength(1);
    expect(filtrarNormas(normas, { vigencia: A_CONFIRMAR }).map((n) => n.ano)).toEqual([2021]);
    expect(filtrarNormas(normas, { texto: "ldb" }).map((n) => n.ano)).toEqual([1996]);
    expect(filtrarNormas(normas, { texto: "resolucao 2026" }).map((n) => n.ano)).toEqual([2026]);
  });

  const cursos = [
    curso({
      id: "curitiba/enf",
      nome: "Técnico em Enfermagem",
      campus: "curitiba",
      turnos: ["noturno"],
      processos: ["ps-2026"],
      cnct: { slug: "enf", nome: "Técnico em Enfermagem", eixo: "Ambiente e Saúde" },
    }),
    curso({
      id: "foz/fis",
      nome: "Licenciatura em Física",
      campus: "foz",
      nivel: "superior",
      forma_oferta: "licenciatura",
    }),
    curso({
      id: "foz/enf",
      nome: "Técnico em Enfermagem",
      campus: "foz",
      turnos: ["matutino"],
      cnct: { slug: "enf", nome: "Técnico em Enfermagem", eixo: "Ambiente e Saúde" },
    }),
  ];

  it("cursos por campus, nível, eixo, turno, processo e texto sem acento", () => {
    expect(filtrarCursos(cursos, { campus: "foz" })).toHaveLength(2);
    expect(filtrarCursos(cursos, { nivel: "superior" }).map((c) => c.id)).toEqual(["foz/fis"]);
    expect(filtrarCursos(cursos, { eixo: "Ambiente e Saúde" })).toHaveLength(2);
    expect(filtrarCursos(cursos, { turno: "noturno" }).map((c) => c.id)).toEqual(["curitiba/enf"]);
    expect(filtrarCursos(cursos, { processo: "ps-2026" }).map((c) => c.id)).toEqual(["curitiba/enf"]);
    expect(filtrarCursos(cursos, { texto: "fisica" }).map((c) => c.id)).toEqual(["foz/fis"]);
    expect(filtrarCursos(cursos, { texto: "enferm foz" }).map((c) => c.id)).toEqual(["foz/enf"]);
  });

  it("CNCT: os que o IFPR oferta e quantos cursos cada um tem", () => {
    const cnct: CnctDoIndice[] = [
      {
        slug: "enf",
        denominacao: "Técnico em Enfermagem",
        eixo: "Ambiente e Saúde",
        area: null,
        carga_horaria_minima: 1200,
        link: "ifpr://cnct/enf",
      },
      {
        slug: "agro",
        denominacao: "Técnico em Agropecuária",
        eixo: "Recursos Naturais",
        area: null,
        carga_horaria_minima: 1200,
        link: "ifpr://cnct/agro",
      },
    ];
    expect(filtrarCnct(cnct, cursos, {}).map((c) => c.slug)).toEqual(["agro", "enf"]);
    expect(filtrarCnct(cnct, cursos, { ofertados: true }).map((c) => c.slug)).toEqual(["enf"]);
    expect(cursosPorCnct(cursos).get("enf")).toBe(2);
  });

  it("as opções de um filtro: distintas, sem vazio, em ordem do português", () => {
    expect(opcoes(["Óleo", "abacate", null, "", "Zinco", "abacate", undefined])).toEqual(["abacate", "Óleo", "Zinco"]);
  });
});
