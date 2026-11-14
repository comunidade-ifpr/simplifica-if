// @effect-diagnostics nodeBuiltinImport:off -- monta raízes temporárias com node:fs síncrono para o carregador síncrono sob teste
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { BaseInstitucional } from "../dominio/auditoria.ts";
import type { Campus, Curso } from "../dominio/curso.ts";
import type { EditalIngresso, OfertaIngresso, ProcessoSeletivo } from "../dominio/ingresso.ts";
import type { Movimentacao } from "../dominio/movimentacao.ts";
import { montarCampi, montarProcessos } from "../exportacao/base-publica.ts";
import { RepositorioCursosLocal } from "./cursos.ts";
import { carregarDadosInstitucionais, deDominio, gravarDadosInstitucionais, paraDominio } from "./institucional.ts";
import { validarDadosInstitucionais } from "./validacao.ts";

const raizes: string[] = [];
function raizTemporaria(): string {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dados-teste-"));
  raizes.push(raiz);
  return raiz;
}
afterEach(() => {
  for (const raiz of raizes.splice(0)) NodeFS.rmSync(raiz, { recursive: true, force: true });
});

const campus: Campus = {
  id: "pg-campus",
  titulo: "Campus Exemplo",
  campusId: "exemplo",
  nome: "Campus Exemplo",
  site: "https://exemplo.ifpr.edu.br",
  calendarioAcademico: "https://exemplo.ifpr.edu.br/calendario",
  horariosColetadoEm: "2026-05-01",
  horariosUrl: "https://exemplo.ifpr.edu.br/horarios",
};

const curso: Curso = {
  id: "pg-curso",
  notionPageId: "pg-curso",
  titulo: "Técnico em Exemplo",
  slug: "tecnico-em-exemplo",
  nome: "Técnico em Exemplo",
  nivel: "Técnico",
  tipoOferta: "Integrado",
  paginaOficial: "https://exemplo.ifpr.edu.br/curso",
  modalidade: "Presencial",
  situacao: "Ativo",
  cnctId: "cnct:tecnico-em-informatica",
  cnctAusencia: "",
  campusIds: ["pg-campus"],
  suap: {
    id: 7,
    codigo: "EX001",
    vagas: 40,
    coletadoEm: "2026-05-01T10:00",
    atualizadoEm: "",
    matrizes: {
      resumo: "10 — MATRIZ 2026",
      urls: "https://suap.ifpr.edu.br/edu/matriz/10/\nhttps://suap.ifpr.edu.br/edu/matriz/11/",
      cargaHorariaComumH: 3000,
      situacao: "Única ativa",
      coletadoEm: "2026-11-05T10:00:00.000-03:00",
    },
  },
  ppc: {
    url: "https://exemplo.ifpr.edu.br/ppc.pdf",
    markdownPath: "institucional/ifpr/ppcs/exemplo/tecnico-em-exemplo.md",
    anoDocumento: 2025,
    vagas: "30-40",
    trechoVagas: "serão ofertadas 40 vagas",
    periodicidadeVagas: "anual",
    curadoriaAno: "Revisado",
    dataCuradoriaAno: "2026-05-20",
    curadoriaVagas: "Precisa de revisão",
    dataCuradoriaVagas: "",
  },
};

const processo: ProcessoSeletivo = {
  id: "pg-ps",
  titulo: "PS 2026",
  processoSeletivoId: "processo-seletivo-2026",
  nome: "Processo Seletivo 2026",
  anoIngresso: 2026,
  instituicao: "IFPR",
  fontes: ["https://ifpr.edu.br/ps"],
  statusCuradoria: "dados_curados",
  verificadoEm: "2026-01-10",
  observacoes: "",
};

const edital: EditalIngresso = {
  id: "pg-edital",
  titulo: "Edital 1/2026",
  editalId: "edital-1-2026",
  url: "https://ifpr.edu.br/edital",
  numero: "1/2026",
  ano: 2026,
  tipo: "principal",
  processoIds: ["pg-ps"],
};

const oferta: OfertaIngresso = {
  id: "pg-oferta",
  titulo: "Oferta",
  ofertaId: "exemplo-tecnico-em-exemplo",
  cursoNome: "Técnico em Exemplo",
  tipoOferta: "Integrado",
  vagas: 40,
  urlFonte: "https://ifpr.edu.br/edital",
  paginaFonte: 12,
  trechoFonte: "Técnico em Exemplo — 40 vagas — Diurno (Manhã + 2 tardes)¹",
  formaOferta: "Integrado",
  statusCuradoria: "revisado",
  revisadoEm: "2026-01-10",
  modalidade: "Presencial",
  turno: "Diurno (Manhã + 2 tardes)¹",
  turnoPadronizado: "matutino-com-contraturno",
  turnoNota: "Nota ¹ do edital: aparece no Portal do Candidato como turno “Integral”.",
  campusIdOriginal: "",
  cursoSlugOriginal: "",
  processoIds: ["pg-ps"],
  campusIds: ["pg-campus"],
  cursoIds: ["pg-curso"],
  editalIds: ["pg-edital"],
};

const movimentacao: Movimentacao = {
  id: "pg-mov",
  titulo: "Ajuste",
  situacao: null,
  processo: "23411.000001/2026-01",
  numeroSei: "23411.000001/2026-01",
  tipo: "Ajuste PPC",
  anotacoes: "nota",
  cursoIds: ["pg-curso"],
  ultimaMovimentacaoEm: "",
  observacoes: "",
  tramitacao: { unidadesPendentes: [] },
};

const baseNotion: BaseInstitucional = {
  campi: [campus],
  cursos: [curso],
  processos: [processo],
  editais: [edital],
  ofertas: [oferta],
  movimentacoes: [movimentacao],
};

describe("dados/institucional", () => {
  test("Notion → arquivos locais → domínio gera os mesmos JSONs públicos", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(deDominio(baseNotion), raiz);
    const { dados, erros } = carregarDadosInstitucionais(raiz);
    expect(erros).toEqual([]);

    // No Notion, a movimentação aponta para o curso por `Curso ID`, a chave canônica.
    const baseLocal: BaseInstitucional = {
      ...paraDominio(dados),
      movimentacoes: [{ ...movimentacao, cursoIds: ["exemplo/tecnico-em-exemplo"] }],
    };
    expect(montarCampi(baseLocal)).toEqual(montarCampi(baseNotion));
    expect(montarProcessos(baseLocal, "2026-11-13")).toEqual(montarProcessos(baseNotion, "2026-11-13"));
    expect(validarDadosInstitucionais(raiz).erros).toEqual([]);
  });

  test("relações usam chaves canônicas e o arquivo fica no caminho da chave", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(deDominio(baseNotion), raiz);
    const ofertaLocal = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(raiz, "ofertas", "processo-seletivo-2026", "exemplo-tecnico-em-exemplo.json"),
        "utf-8",
      ),
    );
    expect(ofertaLocal.cursos).toEqual(["exemplo/tecnico-em-exemplo"]);
    expect(ofertaLocal.campi).toEqual(["exemplo"]);
    expect(ofertaLocal.editais).toEqual(["edital-1-2026"]);
    const cursoLocal = JSON.parse(
      NodeFS.readFileSync(NodePath.join(raiz, "cursos", "exemplo", "tecnico-em-exemplo.json"), "utf-8"),
    );
    expect(cursoLocal.suap.matrizes.urls).toHaveLength(2);
    expect(cursoLocal.suap).not.toHaveProperty("atualizado_em");
  });

  test("a migração falha se uma relação apontar para página desconhecida", () => {
    expect(() => deDominio({ ...baseNotion, ofertas: [{ ...oferta, cursoIds: ["pg-sumiu"] }] })).toThrow(
      "página desconhecida pg-sumiu",
    );
  });

  test("acusa schema inválido e arquivo fora do caminho da chave", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(deDominio(baseNotion), raiz);
    NodeFS.mkdirSync(NodePath.join(raiz, "campi"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(raiz, "campi", "outro-nome.json"),
      JSON.stringify({ campus_id: "outro", nome: "X" }),
    );
    NodeFS.writeFileSync(
      NodePath.join(raiz, "campi", "quebrado.json"),
      JSON.stringify({ campus_id: "quebrado", extra: 1 }),
    );

    const { erros } = carregarDadosInstitucionais(raiz);
    expect(erros).toContain(
      "dados/institucional/campi/outro-nome.json: arquivo deveria estar em dados/institucional/campi/outro.json",
    );
    expect(erros.some((erro) => erro.startsWith("dados/institucional/campi/quebrado.json: nome"))).toBe(true);
  });

  test("cada problema de schema vira uma linha em português, com arquivo e caminho", () => {
    const raiz = raizTemporaria();
    NodeFS.mkdirSync(NodePath.join(raiz, "campi"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(raiz, "campi", "x.json"), JSON.stringify({ campus_id: "x", extra: 1 }));
    NodeFS.mkdirSync(NodePath.join(raiz, "cursos", "a"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(raiz, "cursos", "a", "b.json"),
      JSON.stringify({ campus_id: "a", curso_slug: "b", nome: "B", cnct_id: "cnct:catalogo", suap: { id: 1.5 } }),
    );
    NodeFS.mkdirSync(NodePath.join(raiz, "editais"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(raiz, "editais", "e.json"), JSON.stringify([]));

    expect(carregarDadosInstitucionais(raiz).erros).toEqual([
      "dados/institucional/campi/x.json: extra: Entrada inválida: campo não permitido",
      "dados/institucional/campi/x.json: nome: Entrada inválida: campo obrigatório ausente",
      "dados/institucional/cursos/a/b.json: cnct_id: deve ser cnct:<slug do curso no CNCT>",
      "dados/institucional/cursos/a/b.json: suap.id: Entrada inválida: esperava um inteiro",
      "dados/institucional/editais/e.json: (raiz): Entrada inválida: esperava um objeto",
    ]);
  });

  test("acusa cnct_id que não existe no CNCT e turno fora do enum", () => {
    const raiz = raizTemporaria();
    const dados = deDominio(baseNotion);
    dados.cursos[0] = { ...dados.cursos[0]!, cnct_id: "cnct:tecnico-em-nada" };
    gravarDadosInstitucionais(dados, raiz);
    expect(validarDadosInstitucionais(raiz).erros).toEqual([
      "dados/institucional: Curso exemplo/tecnico-em-exemplo: cnct_id não existe no CNCT: cnct:tecnico-em-nada",
    ]);

    NodeFS.writeFileSync(
      NodePath.join(raiz, "ofertas", "processo-seletivo-2026", "exemplo-tecnico-em-exemplo.json"),
      JSON.stringify({ ...dados.ofertas[0], turno_padronizado: "Manhã" }),
    );
    expect(carregarDadosInstitucionais(raiz).erros.some((erro) => erro.includes(": turno_padronizado: "))).toBe(true);
  });

  test("a auditoria acusa curso de campus inexistente", () => {
    const raiz = raizTemporaria();
    const dados = deDominio(baseNotion);
    dados.cursos[0] = { ...dados.cursos[0]!, campus_id: "fantasma", ppc: {} };
    gravarDadosInstitucionais(dados, raiz);
    const { erros } = validarDadosInstitucionais(raiz);
    expect(erros.some((erro) => erro.includes("página desconhecida ou sem campus_id: fantasma"))).toBe(true);
  });
});

describe("RepositorioCursosLocal", () => {
  test("lista cursos com SUAP ID e grava as matrizes no arquivo do curso", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(deDominio(baseNotion), raiz);
    const repositorio = new RepositorioCursosLocal(raiz);
    const [paraColeta] = repositorio.listarParaColeta();
    expect(paraColeta).toEqual({
      curso_id: "exemplo/tecnico-em-exemplo",
      nome: "Técnico em Exemplo",
      campus: "Campus Exemplo",
      forma: "Integrado",
      codigo: "EX001",
      suap_id: 7,
    });

    repositorio.gravarMatrizes(
      {
        ...paraColeta!,
        url: "https://suap.ifpr.edu.br/edu/cursocampus/7/",
        titulo_suap: "Curso",
        matrizes: [
          {
            id: 12,
            ativa: true,
            descricao: "MATRIZ 2027",
            url: "https://suap.ifpr.edu.br/edu/matriz/12/",
            carga_horaria_h: 3100,
            campos: {},
          },
        ],
        situacao: "Única ativa",
        carga_horaria_comum_h: 3100,
        segundos: 1,
      },
      "2026-11-13T10:00:00-03:00",
    );
    const salvo = paraDominio(carregarDadosInstitucionais(raiz).dados).cursos[0]!.suap.matrizes;
    expect(salvo.cargaHorariaComumH).toBe(3100);
    expect(salvo.urls).toBe("https://suap.ifpr.edu.br/edu/matriz/12/");
    expect(salvo.coletadoEm).toBe("2026-11-13T10:00:00-03:00");
  });

  test("recusa gravar se o código SUAP mudou desde a coleta", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(deDominio(baseNotion), raiz);
    const repositorio = new RepositorioCursosLocal(raiz);
    const [paraColeta] = repositorio.listarParaColeta();
    expect(() =>
      repositorio.gravarMatrizes(
        {
          ...paraColeta!,
          codigo: "OUTRO",
          url: "",
          titulo_suap: "",
          matrizes: [],
          situacao: "Sem matriz ativa",
          carga_horaria_comum_h: null,
          segundos: 0,
        },
        "2026-11-13T10:00:00-03:00",
      ),
    ).toThrow("Curso alterado desde a coleta");
  });
});
