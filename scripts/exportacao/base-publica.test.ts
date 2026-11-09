import { describe, expect, test } from "bun:test";
import { auditarBase, type BaseInstitucional } from "../dominio/auditoria.ts";
import { caminhoMarkdownPpc, interpretarVagasPpc, type Campus, type Curso } from "../dominio/curso.ts";
import type { Movimentacao } from "../dominio/movimentacao.ts";
import { dataHoraJson, montarCampi, montarProcessos } from "./base-publica.ts";

const CAMPUS: Campus = {
  id: "pg-campus",
  titulo: "Campus Exemplo",
  campusId: "exemplo",
  nome: "Campus Exemplo",
  site: "https://exemplo.ifpr.edu.br",
  calendarioAcademico: "https://exemplo.ifpr.edu.br/calendario",
  horariosColetadoEm: "",
  horariosUrl: "",
};

function curso(parcial: Partial<Curso> = {}): Curso {
  return {
    id: "pg-curso",
    titulo: "Técnico em Exemplo",
    slug: "tecnico-exemplo",
    nome: "Técnico em Exemplo",
    nivel: "Técnico",
    tipoOferta: "integrado",
    paginaOficial: "",
    modalidade: "",
    situacao: "",
    campusIds: ["pg-campus"],
    suap: { codigo: "", coletadoEm: "", atualizadoEm: "", matrizes: { resumo: "", urls: "", situacao: "", coletadoEm: "" } },
    ppc: {
      url: "",
      markdownPath: "",
      vagas: "",
      trechoVagas: "",
      periodicidadeVagas: "",
      curadoria: "",
      dataCuradoria: "",
    },
    ...parcial,
  };
}

function movimentacao(parcial: Partial<Movimentacao>): Movimentacao {
  return {
    id: "pg-mov",
    titulo: "Mov",
    situacao: "Concluído",
    processo: "",
    numeroSei: "",
    tipo: "",
    anotacoes: "",
    cursoIds: [],
    ultimaMovimentacaoEm: "",
    observacoes: "",
    tramitacao: { unidadesPendentes: [] },
    ...parcial,
  };
}

function base(parcial: Partial<BaseInstitucional> = {}): BaseInstitucional {
  return { campi: [CAMPUS], cursos: [curso()], movimentacoes: [], processos: [], editais: [], ofertas: [], ...parcial };
}

describe("auditarBase", () => {
  test("aceita uma base coerente", () => {
    expect(auditarBase(base())).toEqual([]);
  });

  test("aponta curso sem campus e slug duplicado no mesmo campus", () => {
    const erros = auditarBase(
      base({ cursos: [curso(), curso({ id: "pg-2", campusIds: [] }), curso({ id: "pg-3" })] }),
    );
    expect(erros).toEqual([
      "Curso 'Técnico em Exemplo' (pg-2): relação Campus deve conter exatamente 1 página",
      "Curso 'Técnico em Exemplo' (pg-3): curso_slug duplicado no campus exemplo com Curso 'Técnico em Exemplo' (pg-curso): tecnico-exemplo",
    ]);
  });

  test("exige o caminho de PPC que corresponde ao campus e ao curso", () => {
    const errado = curso({ ppc: { ...curso().ppc, url: "https://x", markdownPath: "institucional/ifpr/ppcs/outro/x.md" } });
    expect(auditarBase(base({ cursos: [errado] }))[0]).toContain("esperado institucional/ifpr/ppcs/exemplo/tecnico-exemplo.md");
  });

  test("exige curso em movimentação com processo SEI", () => {
    const erros = auditarBase(base({ movimentacoes: [movimentacao({ numeroSei: "123" })] }));
    expect(erros).toEqual(["Movimentação de curso 'Mov' (pg-mov): SEI Processo informado sem relação Curso"]);
  });
});

describe("montagem dos JSONs públicos", () => {
  test("omite campos vazios e publica processos SEI sem repetir", () => {
    const movimentacoes = [
      movimentacao({ id: "b", numeroSei: "1", tipo: "Ajuste PPC", cursoIds: ["pg-curso"] }),
      movimentacao({ id: "a", numeroSei: "1", tipo: "Ajuste PPC", anotacoes: "nota", cursoIds: ["pg-curso"] }),
      movimentacao({ id: "c", numeroSei: "", cursoIds: ["pg-curso"] }),
    ];
    const [campus] = montarCampi(base({ movimentacoes }));
    expect(campus).toEqual({
      id: "exemplo",
      nome: "Campus Exemplo",
      links: { site: CAMPUS.site, calendario_academico: CAMPUS.calendarioAcademico },
      cursos: [
        {
          curso_slug: "tecnico-exemplo",
          notion_page_id: "pg-curso",
          nome: "Técnico em Exemplo",
          nivel: "Técnico",
          tipo_oferta: "integrado",
          sei: { processos: [{ numero: "1", tipo: "Ajuste PPC", trecho_fonte: "nota" }] },
        },
      ],
    });
  });

  test("usa a data de hoje quando o processo seletivo não foi verificado", () => {
    const processos = montarProcessos(
      base({
        processos: [
          {
            id: "pg-ps",
            titulo: "PS",
            processoSeletivoId: "ps-2027",
            nome: "PS 2027",
            anoIngresso: 2027,
            instituicao: "",
            fontes: [],
            statusCuradoria: "outro",
            verificadoEm: "",
            observacoes: "",
          },
        ],
      }),
      "2026-11-09",
    );
    expect(processos[0]).toMatchObject({
      instituicao: "IFPR",
      curadoria: { status_ofertas: "dados_parciais", verificado_em: "2026-11-09" },
    });
  });

  test("completa data e fuso", () => {
    expect(dataHoraJson("2026-11-09")).toBe("2026-11-09T00:00:00-03:00");
    expect(dataHoraJson("2026-11-09T10:30")).toBe("2026-11-09T10:30:00-03:00");
    expect(dataHoraJson("2026-11-09T10:30:15.000-03:00")).toBe("2026-11-09T10:30:15-03:00");
  });
});

describe("domínio de curso", () => {
  test("interpreta vagas exatas e intervalo", () => {
    expect(interpretarVagasPpc("40")).toEqual({ quantidade: 40 });
    expect(interpretarVagasPpc("40 – 30")).toEqual({ quantidade: 40, minimo: 30, maximo: 40 });
    expect(interpretarVagasPpc("quarenta")).toBeNull();
  });

  test("aceita link do Markdown pela URL pública", () => {
    expect(caminhoMarkdownPpc("https://simplifica-if.github.io/base-conhecimento/institucional/ifpr/ppcs/a/b.md")).toBe(
      "institucional/ifpr/ppcs/a/b.md",
    );
    expect(caminhoMarkdownPpc("https://outro.site/a.md")).toBe("");
  });
});
