// @effect-diagnostics nodeBuiltinImport:off -- os testes leem os schemas e as fichas dos arquivos da base
/**
 * Contratos da base da revisão de PPC (`esquemas.ts`): os arquivos de `schemas/` são os gerados do
 * Effect Schema, toda ficha da base e o registro de marcos estão no contrato, e cada desvio é
 * recusado com o caminho do campo (`$.referencias_normativas[0].ref`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import type { ObjetoJson } from "@simplifica-if/kb/json";
import { caminhosRevisaoPpc } from "./caminhos.ts";
import { decodificarContrato, jsonSchemaGerado, SCHEMAS_GERADOS } from "./esquemas.ts";
import { geradosRevisaoPpc } from "./gerados.ts";
import { lerJson, listarJson } from "./validacao.ts";

const caminhos = caminhosRevisaoPpc();

/** Cópia profunda de um JSON, para as mutações dos exemplos inválidos. */
const copia = <T>(valor: T): T => structuredClone(valor);

/** Todas as fichas da base. */
function fichasValidas(): Array<[string, unknown]> {
  return listarJson(caminhos.fichas).map((arquivo) => [NodePath.relative(caminhos.raiz, arquivo), lerJson(arquivo)]);
}

const FICHA = lerJson(NodePath.join(caminhos.fichas, "ct-curr-02.json")) as ObjetoJson;
const MARCOS = lerJson(caminhos.marcos) as ObjetoJson & { marcos: ObjetoJson[] };

/** Desvio do contrato: descrição, caminhos esperados dos problemas e a mutação. */
type Mutacao<T> = [descricao: string, caminhos: string[], mudar: (valor: T) => void];

const FICHAS_INVALIDAS: Array<Mutacao<ObjetoJson & { referencias_normativas: ObjetoJson[] }>> = [
  ["campo a mais na ficha", ["$.extra"], (f) => void (f.extra = 1)],
  ["campo obrigatório ausente (titulo)", ["$.titulo"], (f) => void delete f.titulo],
  ["campo obrigatório ausente (estados_permitidos)", ["$.estados_permitidos"], (f) => void delete f.estados_permitidos],
  ["id numérico", ["$.id"], (f) => void (f.id = 12)],
  ["id nulo", ["$.id"], (f) => void (f.id = null)],
  ["dominio fora do enum", ["$.dominio"], (f) => void (f.dominio = "outro")],
  ["criticidade fora do enum", ["$.criticidade"], (f) => void (f.criticidade = "bloq")],
  ["tipo_escopo fora do enum", ["$.tipo_escopo"], (f) => void (f.tipo_escopo = "geral")],
  ["execucao ausente", ["$.execucao"], (f) => void delete f.execucao],
  ["execucao com modo fora do enum", ["$.execucao.modo"], (f) => void (f.execucao = { modo: "X", justificativa: "a" })],
  ["execucao sem justificativa", ["$.execucao.justificativa"], (f) => void (f.execucao = { modo: "D" })],
  [
    "execucao com justificativa vazia",
    ["$.execucao.justificativa"],
    (f) => void (f.execucao = { modo: "J", justificativa: "" }),
  ],
  ["topicos_tematicos como texto", ["$.topicos_tematicos"], (f) => void (f.topicos_tematicos = "estagio")],
  ["item de topicos_tematicos numérico", ["$.topicos_tematicos[0]"], (f) => void (f.topicos_tematicos = [1])],
  ["consultas como objeto", ["$.consultas"], (f) => void (f.consultas = {})],
  ["evidencia_minima zero", ["$.evidencia_minima"], (f) => void (f.evidencia_minima = 0)],
  ["evidencia_minima negativa", ["$.evidencia_minima"], (f) => void (f.evidencia_minima = -3)],
  ["evidencia_minima fracionária", ["$.evidencia_minima"], (f) => void (f.evidencia_minima = 1.5)],
  ["evidencia_minima em texto", ["$.evidencia_minima"], (f) => void (f.evidencia_minima = "2")],
  ["estado fora do enum", ["$.estados_permitidos[1]"], (f) => void (f.estados_permitidos = ["ATENDE", "PARCIAL"])],
  ["escalonar_quando nulo", ["$.escalonar_quando"], (f) => void (f.escalonar_quando = null)],
  [
    "feedback_autores com campo a mais",
    ["$.feedback_autores.extra"],
    (f) => void (f.feedback_autores = { orientacao: "x", extra: true }),
  ],
  [
    "feedback_autores com estado fora do enum",
    ["$.feedback_autores.obrigatorio_quando_estado[1]"],
    (f) => void (f.feedback_autores = { obrigatorio_quando_estado: ["ATENDE", "talvez"] }),
  ],
  ["feedback_autores como lista", ["$.feedback_autores"], (f) => void (f.feedback_autores = [])],
  [
    "referencias_normativas como texto",
    ["$.referencias_normativas"],
    (f) => void (f.referencias_normativas = "Lei nº 9.394/1996" as never),
  ],
  [
    "referência como texto",
    ["$.referencias_normativas[0]"],
    (f) => void (f.referencias_normativas = ["br/lei/1996/9394"] as never),
  ],
  [
    "referência com campo a mais",
    ["$.referencias_normativas[0].fonte"],
    (f) => void (f.referencias_normativas[0]!.fonte = "x"),
  ],
  ["referência sem ref", ["$.referencias_normativas[0].ref"], (f) => void delete f.referencias_normativas[0]!.ref],
  [
    "referência sem papel",
    ["$.referencias_normativas[0].papel"],
    (f) => void delete f.referencias_normativas[0]!.papel,
  ],
  [
    "ref por extenso",
    ["$.referencias_normativas[0].ref"],
    (f) => void (f.referencias_normativas[0]!.ref = "Resolução CNE/CP nº 2/2026"),
  ],
  [
    "ref com sufixo",
    ["$.referencias_normativas[0].ref"],
    (f) => void (f.referencias_normativas[0]!.ref = "br/lei/1996/9394~compilacao"),
  ],
  ["ref numérica", ["$.referencias_normativas[0].ref"], (f) => void (f.referencias_normativas[0]!.ref = 9394)],
  [
    "dispositivo sem #",
    ["$.referencias_normativas[0].dispositivo"],
    (f) => void (f.referencias_normativas[0]!.dispositivo = "art28-vii"),
  ],
  [
    "dispositivo por extenso",
    ["$.referencias_normativas[0].dispositivo"],
    (f) => void (f.referencias_normativas[0]!.dispositivo = "art. 38"),
  ],
  [
    "dispositivo com ordinal",
    ["$.referencias_normativas[0].dispositivo"],
    (f) => void (f.referencias_normativas[0]!.dispositivo = "#art38º"),
  ],
  [
    "papel fora do enum",
    ["$.referencias_normativas[0].papel"],
    (f) => void (f.referencias_normativas[0]!.papel = "principal"),
  ],
  ["nota vazia", ["$.referencias_normativas[0].nota"], (f) => void (f.referencias_normativas[0]!.nota = "")],
  ["nota numérica", ["$.referencias_normativas[0].nota"], (f) => void (f.referencias_normativas[0]!.nota = 1)],
  [
    "vários erros juntos",
    [
      "$.extra",
      "$.dominio",
      "$.referencias_normativas[5].outra",
      "$.referencias_normativas[5].ref",
      "$.referencias_normativas[5].dispositivo",
      "$.referencias_normativas[5].papel",
      "$.referencias_normativas[5].nota",
      "$.pergunta",
      "$.evidencia_minima",
    ],
    (f) => {
      f.extra = true;
      delete f.pergunta;
      f.dominio = "x";
      f.evidencia_minima = 0;
      f.referencias_normativas.push({ ref: "Lei 9394", dispositivo: "art. 1", papel: "x", nota: "", outra: 1 });
    },
  ],
];

const MARCOS_INVALIDOS: Array<Mutacao<ObjetoJson & { marcos: ObjetoJson[] }>> = [
  ["campo a mais no registro", ["$.extra"], (m) => void (m.extra = 1)],
  ["versao ausente", ["$.versao"], (m) => void delete m.versao],
  ["versao zero", ["$.versao"], (m) => void (m.versao = 0)],
  ["versao fracionária", ["$.versao"], (m) => void (m.versao = 1.5)],
  ["versao em texto", ["$.versao"], (m) => void (m.versao = "1")],
  ["descricao numérica", ["$.descricao"], (m) => void (m.descricao = 1)],
  ["marcos como objeto", ["$.marcos"], (m) => void (m.marcos = {} as never)],
  ["marco como texto", ["$.marcos[0]"], (m) => void (m.marcos = ["dcn_ept"] as never)],
  ["marco com campo a mais", ["$.marcos[0].vigente"], (m) => void (m.marcos[0]!.vigente = "br/cne-cp/res/2026/2")],
  ["marco sem tema", ["$.marcos[0].tema"], (m) => void delete m.marcos[0]!.tema],
  ["marco sem linha", ["$.marcos[0].linha"], (m) => void delete m.marcos[0]!.linha],
  ["linha vazia", ["$.marcos[0].linha"], (m) => void (m.marcos[0]!.linha = [])],
  [
    "linha com ID com dispositivo",
    ["$.marcos[0].linha[0]"],
    (m) => void (m.marcos[0]!.linha = ["br/cne-cp/res/2026/2#art28"]),
  ],
  ["linha com ID externo", ["$.marcos[0].linha[0]"], (m) => void (m.marcos[0]!.linha = ["externo:abnt/nbr/6023"])],
  [
    "linha com ID por extenso",
    ["$.marcos[0].linha[0]"],
    (m) => void (m.marcos[0]!.linha = ["Resolução CNE/CP nº 2/2026"]),
  ],
  [
    "fichas_responsaveis com número",
    ["$.marcos[0].fichas_responsaveis[0]"],
    (m) => void (m.marcos[0]!.fichas_responsaveis = [1]),
  ],
  ["transicao nula", ["$.marcos[0].transicao"], (m) => void (m.marcos[0]!.transicao = null)],
];

/** Caminhos dos problemas, sem repetição, na ordem em que aparecem. */
const caminhosDosProblemas = (problemas: ReturnType<typeof decodificarContrato>) => [
  ...new Set(problemas.map((problema) => problema.caminho)),
];

describe("contratos da base da revisão de PPC", () => {
  test("os arquivos gerados (schemas e mapa) estão em dia", () => {
    for (const nome of SCHEMAS_GERADOS) {
      expect(lerJson(NodePath.join(caminhos.schemas, nome))).toEqual(jsonSchemaGerado(nome));
    }
    for (const { caminho, texto } of geradosRevisaoPpc()) {
      expect({ caminho, emDia: NodeFS.readFileSync(caminho, "utf-8") === texto }).toEqual({ caminho, emDia: true });
    }
  });

  test("todas as fichas da base estão no contrato", () => {
    const fichas = fichasValidas();
    expect(fichas.length).toBeGreaterThan(50);
    for (const [arquivo, ficha] of fichas) {
      expect({ arquivo, problemas: decodificarContrato("ficha.schema.json", ficha) }).toEqual({
        arquivo,
        problemas: [],
      });
    }
  });

  test("o registro de marcos normativos está no contrato", () => {
    expect(decodificarContrato("marcos-normativos.schema.json", MARCOS)).toEqual([]);
  });

  test.each(FICHAS_INVALIDAS)("ficha recusada: %s", (_, esperados, mudar) => {
    const ficha = copia(FICHA) as ObjetoJson & { referencias_normativas: ObjetoJson[] };
    mudar(ficha);
    const problemas = decodificarContrato("ficha.schema.json", ficha);
    expect(caminhosDosProblemas(problemas)).toEqual(esperados);
    expect(problemas.every((problema) => problema.mensagem.length > 0)).toBe(true);
  });

  test.each(MARCOS_INVALIDOS)("registro de marcos recusado: %s", (_, esperados, mudar) => {
    const marcos = copia(MARCOS);
    mudar(marcos);
    expect(caminhosDosProblemas(decodificarContrato("marcos-normativos.schema.json", marcos))).toEqual(esperados);
  });
});
