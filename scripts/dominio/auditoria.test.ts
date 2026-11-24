import { describe, expect, test } from "vite-plus/test";
import { auditarBase, type BaseInstitucional } from "./auditoria.ts";
import { interpretarVagasPpc, type Campus, type Curso } from "./curso.ts";
import type { OfertaIngresso } from "./ingresso.ts";

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
    nivel: "médio",
    tipoOferta: "integrado",
    paginaOficial: "",
    modalidade: "",
    situacao: "",
    cnctId: "",
    cnctAusencia: "",
    campusIds: ["pg-campus"],
    suap: {
      codigo: "",
      coletadoEm: "",
      atualizadoEm: "",
      matrizes: { resumo: "", urls: "", situacao: "", coletadoEm: "" },
    },
    ppc: {
      url: "",
      markdownPath: "",
      vagas: "",
      trechoVagas: "",
      periodicidadeVagas: "",
      curadoriaVagas: "",
      dataCuradoriaVagas: "",
    },
    ...parcial,
  };
}

function base(parcial: Partial<BaseInstitucional> = {}): BaseInstitucional {
  return { campi: [CAMPUS], cursos: [curso()], processos: [], editais: [], ofertas: [], ...parcial };
}

describe("auditarBase", () => {
  test("aceita uma base coerente", () => {
    expect(auditarBase(base())).toEqual([]);
  });

  test("aponta curso sem campus e slug duplicado no mesmo campus", () => {
    const erros = auditarBase(base({ cursos: [curso(), curso({ id: "pg-2", campusIds: [] }), curso({ id: "pg-3" })] }));
    expect(erros).toEqual([
      "Curso 'Técnico em Exemplo' (pg-2): relação Campus deve conter exatamente 1 registro",
      "Curso 'Técnico em Exemplo' (pg-3): curso_slug duplicado no campus exemplo com Curso 'Técnico em Exemplo' (pg-curso): tecnico-exemplo",
    ]);
  });

  test("exige o caminho de PPC que corresponde ao campus e ao curso", () => {
    const errado = curso({
      ppc: { ...curso().ppc, url: "https://x", markdownPath: "institucional/ifpr/ppcs/outro/x.md" },
    });
    expect(auditarBase(base({ cursos: [errado] }))[0]).toContain(
      "esperado institucional/ifpr/ppcs/exemplo/tecnico-exemplo/<versao>.md",
    );
  });

  test("exige cnct_id (ou ausência com motivo) em curso técnico ativo", () => {
    const ativo = { situacao: "ativo" };
    expect(auditarBase(base({ cursos: [curso(ativo)] }))).toEqual([
      "Curso 'Técnico em Exemplo' (pg-curso): curso técnico ativo sem cnct_id (ou cnct_ausencia com o motivo)",
    ]);
    expect(auditarBase(base({ cursos: [curso({ ...ativo, cnctId: "cnct:tecnico-em-informatica" })] }))).toEqual([]);
    expect(auditarBase(base({ cursos: [curso({ ...ativo, cnctAusencia: "oferta experimental" })] }))).toEqual([]);
    expect(auditarBase(base({ cursos: [curso({ situacao: "suspenso" })] }))).toEqual([]);
    expect(auditarBase(base({ cursos: [curso({ ...ativo, cnctId: "cnct:catalogo", cnctAusencia: "x" })] }))).toEqual([
      "Curso 'Técnico em Exemplo' (pg-curso): cnct_id inválido (esperado cnct:<slug do curso no CNCT>): cnct:catalogo",
      "Curso 'Técnico em Exemplo' (pg-curso): cnct_id e cnct_ausencia são excludentes",
    ]);
  });

  test("confere a curadoria do PPC campo a campo", () => {
    const ppc = {
      ...curso().ppc,
      curadoriaVagas: "talvez",
      dataCuradoriaVagas: "",
    };
    expect(auditarBase(base({ cursos: [curso({ ppc })] }))).toEqual([
      "Curso 'Técnico em Exemplo' (pg-curso): ppc.curadoria_vagas desconhecida: talvez",
    ]);
    const semStatus = { ...ppc, curadoriaVagas: "", dataCuradoriaVagas: "2026-11-13" };
    expect(auditarBase(base({ cursos: [curso({ ppc: semStatus })] }))).toEqual([
      "Curso 'Técnico em Exemplo' (pg-curso): ppc.data_curadoria_vagas sem ppc.curadoria_vagas",
    ]);
  });

  test("exige turno no enum e a nota de rodapé quando a grafia tem marca", () => {
    const oferta: OfertaIngresso = {
      id: "ps/oferta",
      titulo: "oferta",
      ofertaId: "oferta",
      cursoNome: "Técnico em Exemplo",
      tipoOferta: "técnico integrado",
      vagas: 40,
      urlFonte: "https://ifpr.edu.br/edital",
      trechoFonte: "Exemplo; Técnico em Exemplo; Turno: Diurno (Manhã + 2 tardes)¹; Vagas: 40",
      formaOferta: "",
      statusCuradoria: "",
      revisadoEm: "",
      modalidade: "",
      turno: "Diurno (Manhã + 2 tardes)¹",
      turnoPadronizado: "matutino-com-contraturno",
      turnoNota: "Nota ¹: aparece como Integral no Portal do Candidato.",
      campusIdOriginal: "exemplo",
      cursoSlugOriginal: "",
      processoIds: [],
      campusIds: [],
      cursoIds: [],
      editalIds: [],
    };
    const nome = "Oferta de ingresso 'oferta' (ps/oferta)";
    const erros = (parcial: Partial<OfertaIngresso>) =>
      auditarBase(base({ ofertas: [{ ...oferta, ...parcial }] })).filter((erro) => erro.includes("turno"));
    expect(erros({})).toEqual([]);
    expect(erros({ turnoNota: "" })).toEqual([`${nome}: turno com marca de rodapé sem turno_nota`]);
    expect(erros({ turnoPadronizado: "Manhã" })).toEqual([`${nome}: turno_padronizado fora do enum: Manhã`]);
    expect(erros({ turnoPadronizado: "" })).toEqual([`${nome}: turno sem turno_padronizado`]);
    expect(erros({ turno: "Integral" })).toEqual([
      `${nome}: turno "Integral" não aparece literalmente em trecho_fonte`,
    ]);
  });
});

describe("domínio de curso", () => {
  test("interpreta vagas exatas e intervalo", () => {
    expect(interpretarVagasPpc("40")).toEqual({ quantidade: 40 });
    expect(interpretarVagasPpc("40 – 30")).toEqual({ quantidade: 40, minimo: 30, maximo: 40 });
    expect(interpretarVagasPpc("quarenta")).toBeNull();
  });
});
