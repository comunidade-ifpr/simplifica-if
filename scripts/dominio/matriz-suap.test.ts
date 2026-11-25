// @effect-diagnostics nodeBuiltinImport:off -- lê a fixture do relatório com node:fs síncrono, como os vizinhos
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ESTRITO, validarJson } from "../esquema.ts";
import {
  consolidarMatrizes,
  ESQUEMA_RELATORIO_MATRIZES,
  esquemaRelatorioMatrizes,
  resumoMatrizesAtivas,
} from "./matriz-suap.ts";

/** A fixture do relatório, que vai copiada para a coleta de fora com o esquema. */
const FIXTURE_RELATORIO = new URL("./fixtures/relatorio-matrizes-suap.json", import.meta.url);

const fixture = (): Record<string, unknown> & { cursos: Array<Record<string, unknown>> } =>
  JSON.parse(NodeFS.readFileSync(FIXTURE_RELATORIO, "utf-8"));
const lerRelatorio = (valor: unknown) => validarJson(esquemaRelatorioMatrizes, valor, "Relatório de teste");
// Com `ESTRITO`, como a aplicação: o `Schema.is` aceitaria chave a mais, e o contrato recusa.
const relatorioValido = (valor: unknown) =>
  Exit.isSuccess(Schema.decodeUnknownExit(esquemaRelatorioMatrizes)(valor, ESTRITO));

describe("domínio das matrizes", () => {
  const ativa = (id: number, carga: number) => ({
    id,
    ativa: true as const,
    descricao: `M${id}`,
    url: `https://suap.ifpr.edu.br/edu/matriz/${id}/`,
    carga_horaria_h: carga,
    campos: {},
  });

  it("classifica a situação das matrizes ativas", () => {
    expect(consolidarMatrizes([])).toEqual({ situacao: "Sem matriz ativa", carga_horaria_comum_h: null });
    expect(consolidarMatrizes([ativa(1, 1200), ativa(2, 1200)])).toEqual({
      situacao: "Múltiplas — mesma CH",
      carga_horaria_comum_h: 1200,
    });
    expect(consolidarMatrizes([ativa(1, 0), ativa(2, 3390)])).toEqual({
      situacao: "Múltiplas — CH divergentes",
      carga_horaria_comum_h: null,
    });
    expect(consolidarMatrizes([ativa(1, 1200), ativa(2, 800)])).toEqual({
      situacao: "Múltiplas — CH divergentes",
      carga_horaria_comum_h: null,
    });
  });

  it("resume as matrizes ativas no formato gravado no cadastro do curso", () => {
    const matriz = { ...ativa(10, 1200), campos: { "Exige estágio e afins": "Não" } };
    expect(resumoMatrizesAtivas([matriz])).toBe(
      "10 — M10 — CH exibida: 1200 h; estágio exigido: Não; CH mínima de estágio (separada): não informada",
    );
    expect(resumoMatrizesAtivas([])).toBe("");
    expect(resumoMatrizesAtivas([ativa(11, 0)])).toContain("CH exibida: 0 h;");
  });
});

const ativaRelatorio = (id: number) => ({
  id,
  ativa: true,
  descricao: "",
  url: `https://suap.ifpr.edu.br/edu/matriz/${id}/`,
  carga_horaria_h: 800,
  campos: {},
});

describe(`relatório de coleta (${ESQUEMA_RELATORIO_MATRIZES})`, () => {
  it("a fixture tem o formato, e a leitura não altera nada", () => {
    const valor = fixture();
    expect(lerRelatorio(valor)).toEqual(valor);
  });

  it("matriz inativa não traz url, carga nem campos", () => {
    const lido = lerRelatorio(fixture());
    expect(Object.keys(lido.cursos[0]!.matrizes[1]!)).toEqual(["id", "ativa", "descricao"]);
  });

  it("aceita falhas de coleta com a identidade do curso", () => {
    const erro = { curso_id: "exemplo/tecnico-em-exemplo", suap_id: 7, codigo: "EX001", erro: "Campus divergente" };
    expect(lerRelatorio({ ...fixture(), erros: [erro] }).erros[0]?.erro).toBe("Campus divergente");
  });

  it("aceita matriz ativa com carga 0, como o SUAP mostra a matriz sem componentes", () => {
    const valor = {
      ...fixture(),
      cursos: [{ ...fixture().cursos[0], matrizes: [{ ...ativaRelatorio(1), carga_horaria_h: 0 }] }],
    };
    expect(lerRelatorio(valor)).toEqual(valor);
  });

  it("rejeita relatório sem a lista de erros, para não gravar às cegas", () => {
    const { erros: _, ...semErros } = fixture();
    expect(() => lerRelatorio(semErros)).toThrow("erros");
  });

  it.each([
    ["esquema de outra versão", { esquema: "matrizes-suap/2" }],
    ["derivação no curso", { cursos: [{ ...fixture().cursos[0], situacao: "Única ativa" }] }],
    ["campo só do coletor", { segundos_suap: 1.5 }],
    ["SUAP ID como texto", { cursos: [{ ...fixture().cursos[0], suap_id: "7" }] }],
    ["ativa como texto", { cursos: [{ ...fixture().cursos[0], matrizes: [{ id: 1, ativa: "Sim", descricao: "" }] }] }],
    [
      "matriz ativa sem url nem carga",
      { cursos: [{ ...fixture().cursos[0], matrizes: [{ id: 1, ativa: true, descricao: "" }] }] },
    ],
    [
      "matriz ativa sem campos",
      {
        cursos: [
          {
            ...fixture().cursos[0],
            matrizes: [
              {
                id: 1,
                ativa: true,
                descricao: "",
                url: "https://suap.ifpr.edu.br/edu/matriz/1/",
                carga_horaria_h: 800,
              },
            ],
          },
        ],
      },
    ],
    [
      "matriz inativa com carga",
      {
        cursos: [{ ...fixture().cursos[0], matrizes: [{ id: 1, ativa: false, descricao: "", carga_horaria_h: 800 }] }],
      },
    ],
    [
      "url de fora do SUAP",
      {
        cursos: [
          {
            ...fixture().cursos[0],
            matrizes: [
              { id: 1, ativa: true, descricao: "", url: "https://exemplo.com/1/", carga_horaria_h: 800, campos: {} },
            ],
          },
        ],
      },
    ],
    [
      "matriz ativa com carga negativa",
      { cursos: [{ ...fixture().cursos[0], matrizes: [{ ...ativaRelatorio(1), carga_horaria_h: -1 }] }] },
    ],
    ["coletado_em vazio", { coletado_em: "" }],
    ["coletado_em sem hora", { coletado_em: "2026-11-19" }],
    ["coletado_em sem fuso", { coletado_em: "2026-11-19T10:00:00" }],
  ])("rejeita %s", (_, alteracao) => {
    expect(relatorioValido({ ...fixture(), ...alteracao })).toBe(false);
  });
});
