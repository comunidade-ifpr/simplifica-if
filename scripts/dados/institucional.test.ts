// @effect-diagnostics nodeBuiltinImport:off -- monta raízes temporárias com node:fs síncrono para o carregador síncrono sob teste
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { auditarBase } from "../dominio/auditoria.ts";
import {
  carregarDadosInstitucionais,
  type DadosInstitucionais,
  gravarDadosInstitucionais,
  paraDominio,
} from "./institucional.ts";
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

/** Um registro de cada coleção, com as relações por chave canônica. */
function dadosExemplo(): DadosInstitucionais {
  return {
    campi: [
      {
        campus_id: "exemplo",
        nome: "Campus Exemplo",
        site: "https://exemplo.ifpr.edu.br",
        calendario_academico: "https://exemplo.ifpr.edu.br/calendario",
        horarios_url: "https://exemplo.ifpr.edu.br/horarios",
        horarios_coletado_em: "2026-05-01",
      },
    ],
    cursos: [
      {
        campus_id: "exemplo",
        curso_slug: "tecnico-em-exemplo",
        nome: "Técnico em Exemplo",
        nivel: "Técnico",
        forma_oferta: "Integrado",
        modalidade: "Presencial",
        situacao: "Ativo",
        pagina_oficial: "https://exemplo.ifpr.edu.br/curso",
        cnct_id: "cnct:tecnico-em-informatica",
        suap: {
          id: 7,
          codigo: "EX001",
          vagas: 40,
          coletado_em: "2026-05-01T10:00",
          atualizado_em: "",
          matrizes: {
            resumo: "10 — MATRIZ 2026",
            urls: ["https://suap.ifpr.edu.br/edu/matriz/10/", "https://suap.ifpr.edu.br/edu/matriz/11/"],
            carga_horaria_comum_h: 3000,
            situacao: "Única ativa",
            coletado_em: "2026-11-05T10:00:00.000-03:00",
          },
        },
        ppc: {
          url: "https://exemplo.ifpr.edu.br/ppc.pdf",
          markdown_path: "institucional/ifpr/ppcs/exemplo/tecnico-em-exemplo/2025.md",
          vagas: "30-40",
          trecho_vagas: "serão ofertadas 40 vagas",
          periodicidade_vagas: "anual",
          curadoria_vagas: "Precisa de revisão",
        },
      },
    ],
    processos: [
      {
        processo_seletivo_id: "processo-seletivo-2026",
        nome: "Processo Seletivo 2026",
        ano_ingresso: 2026,
        instituicao: "IFPR",
        fontes: ["https://ifpr.edu.br/ps"],
        status_curadoria: "dados_curados",
        verificado_em: "2026-01-10",
      },
    ],
    editais: [
      {
        edital_id: "edital-1-2026",
        titulo: "Edital 1/2026",
        url: "https://ifpr.edu.br/edital",
        numero: "1/2026",
        ano: 2026,
        tipo: "principal",
        processos: ["processo-seletivo-2026"],
      },
    ],
    ofertas: [
      {
        oferta_id: "exemplo-tecnico-em-exemplo",
        processos: ["processo-seletivo-2026"],
        curso_nome: "Técnico em Exemplo",
        tipo_oferta: "Integrado",
        vagas: 40,
        url_fonte: "https://ifpr.edu.br/edital",
        pagina_fonte: 12,
        trecho_fonte: "Técnico em Exemplo — 40 vagas — Diurno (Manhã + 2 tardes)¹",
        forma_oferta: "Integrado",
        status_curadoria: "revisado",
        revisado_em: "2026-01-10",
        modalidade: "Presencial",
        turno: "Diurno (Manhã + 2 tardes)¹",
        turno_padronizado: "matutino-com-contraturno",
        turno_nota: "Nota ¹ do edital: aparece no Portal do Candidato como turno “Integral”.",
        campi: ["exemplo"],
        cursos: ["exemplo/tecnico-em-exemplo"],
        editais: ["edital-1-2026"],
      },
    ],
  };
}

describe("registros institucionais", () => {
  test("arquivos locais → domínio, sem achados da auditoria", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(dadosExemplo(), raiz);
    const { dados, erros } = carregarDadosInstitucionais(raiz);
    expect(erros).toEqual([]);

    expect(auditarBase(paraDominio(dados))).toEqual([]);
    expect(validarDadosInstitucionais(raiz, undefined, { arquivosDaBase: false }).erros).toEqual([]);
  });

  test("relações usam chaves canônicas e o arquivo fica no caminho da chave", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(dadosExemplo(), raiz);
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

  test("acusa schema inválido e arquivo fora do caminho da chave", () => {
    const raiz = raizTemporaria();
    gravarDadosInstitucionais(dadosExemplo(), raiz);
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
      "institucional/ifpr/campi/outro-nome.json: arquivo deveria estar em institucional/ifpr/campi/outro.json",
    );
    expect(erros.some((erro) => erro.startsWith("institucional/ifpr/campi/quebrado.json: nome"))).toBe(true);
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
      "institucional/ifpr/campi/x.json: extra: Entrada inválida: campo não permitido",
      "institucional/ifpr/campi/x.json: nome: Entrada inválida: campo obrigatório ausente",
      "institucional/ifpr/cursos/a/b.json: cnct_id: deve ser cnct:<slug do curso no CNCT>",
      "institucional/ifpr/cursos/a/b.json: suap.id: Entrada inválida: esperava um inteiro",
      "institucional/ifpr/editais/e.json: (raiz): Entrada inválida: esperava um objeto",
    ]);
  });

  test("acusa cnct_id que não existe no CNCT e turno fora do enum", () => {
    const raiz = raizTemporaria();
    const dados = dadosExemplo();
    dados.cursos[0] = { ...dados.cursos[0]!, cnct_id: "cnct:tecnico-em-nada" };
    gravarDadosInstitucionais(dados, raiz);
    expect(validarDadosInstitucionais(raiz, undefined, { arquivosDaBase: false }).erros).toEqual([
      "institucional/ifpr: Curso exemplo/tecnico-em-exemplo: cnct_id não existe no CNCT: cnct:tecnico-em-nada",
    ]);

    NodeFS.writeFileSync(
      NodePath.join(raiz, "ofertas", "processo-seletivo-2026", "exemplo-tecnico-em-exemplo.json"),
      JSON.stringify({ ...dados.ofertas[0], turno_padronizado: "Manhã" }),
    );
    expect(carregarDadosInstitucionais(raiz).erros.some((erro) => erro.includes(": turno_padronizado: "))).toBe(true);
  });

  test("a auditoria acusa curso de campus inexistente", () => {
    const raiz = raizTemporaria();
    const dados = dadosExemplo();
    dados.cursos[0] = { ...dados.cursos[0]!, campus_id: "fantasma", ppc: {} };
    gravarDadosInstitucionais(dados, raiz);
    const { erros } = validarDadosInstitucionais(raiz, undefined, { arquivosDaBase: false });
    expect(erros.some((erro) => erro.includes("registro desconhecido ou sem campus_id: fantasma"))).toBe(true);
  });
});
