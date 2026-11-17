import { describe, expect, test } from "vite-plus/test";
import { auditarBase, type BaseInstitucional } from "./auditoria.ts";
import { caminhoMarkdownPpc, interpretarVagasPpc, type Campus, type Curso } from "./curso.ts";
import type { OfertaIngresso } from "./ingresso.ts";
import type { Movimentacao } from "./movimentacao.ts";
import { montarProcessosSei, processosSeiDasMovimentacoes } from "../dados/processos-sei.ts";

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
    notionPageId: "pg-curso",
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
      curadoriaAno: "",
      dataCuradoriaAno: "",
      curadoriaVagas: "",
      dataCuradoriaVagas: "",
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
    const erros = auditarBase(base({ cursos: [curso(), curso({ id: "pg-2", campusIds: [] }), curso({ id: "pg-3" })] }));
    expect(erros).toEqual([
      "Curso 'Técnico em Exemplo' (pg-2): relação Campus deve conter exatamente 1 página",
      "Curso 'Técnico em Exemplo' (pg-3): curso_slug duplicado no campus exemplo com Curso 'Técnico em Exemplo' (pg-curso): tecnico-exemplo",
    ]);
  });

  test("exige o caminho de PPC que corresponde ao campus e ao curso", () => {
    const errado = curso({
      ppc: { ...curso().ppc, url: "https://x", markdownPath: "institucional/ifpr/ppcs/outro/x.md" },
    });
    expect(auditarBase(base({ cursos: [errado] }))[0]).toContain(
      "esperado institucional/ifpr/ppcs/exemplo/tecnico-exemplo.md",
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
      curadoriaAno: "Revisado",
      dataCuradoriaAno: "2026-11-13",
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

  test("exige curso em movimentação com processo SEI", () => {
    const erros = auditarBase(base({ movimentacoes: [movimentacao({ numeroSei: "123" })] }));
    expect(erros).toEqual(["Movimentação de curso 'Mov' (pg-mov): SEI Processo informado sem Curso ID"]);
  });
});

describe("processos SEI dos cursos", () => {
  test("um item por curso, número e tipo, sem movimentação sem número", () => {
    const movimentacoes = [
      movimentacao({ id: "b", numeroSei: "23411.000001/2026-01", tipo: "Ajuste PPC", cursoIds: ["exemplo/b"] }),
      movimentacao({
        id: "a",
        numeroSei: "23411.000001/2026-01",
        tipo: "Ajuste PPC",
        anotacoes: "nota",
        cursoIds: ["exemplo/b", "exemplo/a"],
      }),
      movimentacao({ id: "c", numeroSei: "", cursoIds: ["exemplo/a"] }),
      movimentacao({ id: "d", numeroSei: "23411.000002/2026-02", tipo: "", cursoIds: ["exemplo/a"] }),
    ];
    const arquivo = montarProcessosSei(processosSeiDasMovimentacoes(movimentacoes));
    expect(arquivo.total_itens).toBe(3);
    expect(arquivo.items).toEqual([
      { curso_id: "exemplo/a", numero: "23411.000001/2026-01", tipo: "Ajuste PPC", trecho_fonte: "nota" },
      { curso_id: "exemplo/a", numero: "23411.000002/2026-02", tipo: "outro" },
      { curso_id: "exemplo/b", numero: "23411.000001/2026-01", tipo: "Ajuste PPC" },
    ]);
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
