// @effect-diagnostics nodeBuiltinImport:off -- os testes leem os schemas e as fichas dos arquivos da base
/**
 * Veredito dos JSON Schemas gerados (`gerar-schemas`): a ficha e o registro de marcos validam igual
 * no schema anterior ao C3 (cópia congelada em `fixtures/schemas-anteriores/`), e no gerado hoje
 * de `scripts/esquemas.ts`. O arquivo pode mudar de forma (ordem das chaves, `$defs`); o que não
 * pode mudar é o que se aceita e o que se recusa, as mensagens do validador e as descrições, que os
 * sub-agentes da revisão leem.
 */
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { ehObjeto, type ObjetoJson } from "@simplifica-if/kb/json";
import { compilarJsonSchema } from "@simplifica-if/kb/schema";
import { lerJson, listarArquivos } from "../scripts/arquivos.ts";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { jsonSchemaGerado, type NomeSchemaGerado, SCHEMAS_GERADOS } from "../scripts/esquemas.ts";
import { validarSchemaAnalise } from "../scripts/schema-analise.ts";

const caminhos = caminhosPadrao();
const ANTERIORES = NodePath.join(caminhos.appDir, "tests", "fixtures", "schemas-anteriores");

const anterior = (nome: NomeSchemaGerado) => lerJson(NodePath.join(ANTERIORES, nome)) as ObjetoJson;
const atual = (nome: NomeSchemaGerado) => jsonSchemaGerado(nome);

/** Cópia profunda de um JSON, para as mutações dos exemplos inválidos. */
const copia = <T>(valor: T): T => structuredClone(valor);

/** Todas as fichas da base e o exemplo de contrato. */
function fichasValidas(): Array<[string, unknown]> {
  const arquivos = [
    ...listarArquivos(caminhos.fichasDir, ".json"),
    NodePath.join(caminhos.contratosDir, "ficha.exemplo.json"),
  ];
  return arquivos.map((arquivo) => [NodePath.relative(caminhos.appDir, arquivo), lerJson(arquivo)]);
}

const FICHA = lerJson(NodePath.join(caminhos.fichasDir, "ct-curr-02.json")) as ObjetoJson;
const MARCOS = lerJson(caminhos.marcosNormativosPath) as ObjetoJson & { marcos: ObjetoJson[] };

type Mutacao<T> = [descricao: string, mudar: (valor: T) => void];

const FICHAS_INVALIDAS: Array<Mutacao<ObjetoJson & { referencias_normativas: ObjetoJson[] }>> = [
  ["campo a mais na ficha", (f) => void (f.extra = 1)],
  ["campo obrigatório ausente (titulo)", (f) => void delete f.titulo],
  ["campo obrigatório ausente (estados_permitidos)", (f) => void delete f.estados_permitidos],
  ["id numérico", (f) => void (f.id = 12)],
  ["id nulo", (f) => void (f.id = null)],
  ["dominio fora do enum", (f) => void (f.dominio = "outro")],
  ["criticidade fora do enum", (f) => void (f.criticidade = "bloq")],
  ["tipo_escopo fora do enum", (f) => void (f.tipo_escopo = "geral")],
  ["topicos_tematicos como texto", (f) => void (f.topicos_tematicos = "estagio")],
  ["item de topicos_tematicos numérico", (f) => void (f.topicos_tematicos = [1])],
  ["consultas como objeto", (f) => void (f.consultas = {})],
  ["evidencia_minima zero", (f) => void (f.evidencia_minima = 0)],
  ["evidencia_minima negativa", (f) => void (f.evidencia_minima = -3)],
  ["evidencia_minima fracionária", (f) => void (f.evidencia_minima = 1.5)],
  ["evidencia_minima em texto", (f) => void (f.evidencia_minima = "2")],
  ["estado fora do enum", (f) => void (f.estados_permitidos = ["ATENDE", "PARCIAL"])],
  ["escalonar_quando nulo", (f) => void (f.escalonar_quando = null)],
  ["feedback_autores com campo a mais", (f) => void (f.feedback_autores = { orientacao: "x", extra: true })],
  [
    "feedback_autores com estado fora do enum",
    (f) => void (f.feedback_autores = { obrigatorio_quando_estado: ["ATENDE", "talvez"] }),
  ],
  ["feedback_autores como lista", (f) => void (f.feedback_autores = [])],
  ["referencias_normativas como texto", (f) => void (f.referencias_normativas = "Lei nº 9.394/1996" as never)],
  ["referência como texto", (f) => void (f.referencias_normativas = ["br/lei/1996/9394"] as never)],
  ["referência com campo a mais", (f) => void (f.referencias_normativas[0]!.fonte = "x")],
  ["referência sem ref", (f) => void delete f.referencias_normativas[0]!.ref],
  ["referência sem papel", (f) => void delete f.referencias_normativas[0]!.papel],
  ["ref por extenso", (f) => void (f.referencias_normativas[0]!.ref = "Resolução CNE/CP nº 2/2026")],
  ["ref com variante", (f) => void (f.referencias_normativas[0]!.ref = "br/lei/1996/9394~compilacao")],
  ["ref numérica", (f) => void (f.referencias_normativas[0]!.ref = 9394)],
  ["dispositivo sem #", (f) => void (f.referencias_normativas[0]!.dispositivo = "art28-vii")],
  ["dispositivo por extenso", (f) => void (f.referencias_normativas[0]!.dispositivo = "art. 38")],
  ["dispositivo com ordinal", (f) => void (f.referencias_normativas[0]!.dispositivo = "#art38º")],
  ["papel fora do enum", (f) => void (f.referencias_normativas[0]!.papel = "principal")],
  ["nota vazia", (f) => void (f.referencias_normativas[0]!.nota = "")],
  ["nota numérica", (f) => void (f.referencias_normativas[0]!.nota = 1)],
  [
    "vários erros juntos",
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
  ["campo a mais no registro", (m) => void (m.extra = 1)],
  ["versao ausente", (m) => void delete m.versao],
  ["versao zero", (m) => void (m.versao = 0)],
  ["versao fracionária", (m) => void (m.versao = 1.5)],
  ["versao em texto", (m) => void (m.versao = "1")],
  ["descricao numérica", (m) => void (m.descricao = 1)],
  ["marcos como objeto", (m) => void (m.marcos = {} as never)],
  ["marco como texto", (m) => void (m.marcos = ["dcn_ept"] as never)],
  ["marco com campo a mais", (m) => void (m.marcos[0]!.vigente = "br/cne-cp/res/2026/2")],
  ["marco sem tema", (m) => void delete m.marcos[0]!.tema],
  ["marco sem linha", (m) => void delete m.marcos[0]!.linha],
  ["linha vazia", (m) => void (m.marcos[0]!.linha = [])],
  ["linha com ID com dispositivo", (m) => void (m.marcos[0]!.linha = ["br/cne-cp/res/2026/2#art28"])],
  ["linha com ID externo", (m) => void (m.marcos[0]!.linha = ["externo:abnt/nbr/6023"])],
  ["linha com ID por extenso", (m) => void (m.marcos[0]!.linha = ["Resolução CNE/CP nº 2/2026"])],
  ["fichas_responsaveis com número", (m) => void (m.marcos[0]!.fichas_responsaveis = [1])],
  ["transicao nula", (m) => void (m.marcos[0]!.transicao = null)],
];

/** Veredito e mensagens do validador nos dois schemas. */
function conferir(nome: NomeSchemaGerado, valor: unknown) {
  const [antigo, novo] = [anterior(nome), atual(nome)];
  return {
    veredito: [compilarJsonSchema(antigo)(valor), compilarJsonSchema(novo)(valor)],
    mensagens: [validarSchemaAnalise(valor, antigo), validarSchemaAnalise(valor, novo)],
  };
}

/**
 * Descrições por caminho de instância (`$.referencias_normativas[].ref`), seguindo `properties`,
 * `items` e `$ref` (para `$defs`), sem a do documento (que diz de onde ele foi gerado).
 */
function descricoes(documento: ObjetoJson): Map<string, string> {
  const defs = (ehObjeto(documento.$defs) ? documento.$defs : {}) as Record<string, ObjetoJson>;
  const saida = new Map<string, string>();
  const visitar = (no: unknown, caminho: string): void => {
    if (!ehObjeto(no)) return;
    if (typeof no.$ref === "string") visitar(defs[no.$ref.replace("#/$defs/", "")], caminho);
    if (typeof no.description === "string" && caminho !== "$") saida.set(caminho, no.description);
    if (ehObjeto(no.properties)) {
      for (const [nome, filho] of Object.entries(no.properties)) visitar(filho, `${caminho}.${nome}`);
    }
    if (no.items !== undefined) visitar(no.items, `${caminho}[]`);
    for (const chave of ["anyOf", "allOf", "oneOf"] as const) {
      if (Array.isArray(no[chave])) for (const alternativa of no[chave]) visitar(alternativa, caminho);
    }
  };
  visitar(documento, "$");
  return saida;
}

describe("JSON Schemas gerados: o mesmo veredito do schema anterior ao C3", () => {
  test("os arquivos de base-analise/schemas/ são os gerados hoje", () => {
    for (const nome of SCHEMAS_GERADOS) {
      expect(lerJson(NodePath.join(caminhos.schemasDir, nome))).toEqual(atual(nome));
    }
  });

  test("todas as fichas da base e o exemplo de contrato validam nos dois", () => {
    const fichas = fichasValidas();
    expect(fichas.length).toBeGreaterThan(50);
    for (const [arquivo, ficha] of fichas) {
      expect({ arquivo, ...conferir("ficha.schema.json", ficha) }).toEqual({
        arquivo,
        veredito: [true, true],
        mensagens: [[], []],
      });
    }
  });

  test("o registro de marcos normativos valida nos dois", () => {
    expect(conferir("marcos-normativos.schema.json", MARCOS)).toEqual({ veredito: [true, true], mensagens: [[], []] });
  });

  test.each(FICHAS_INVALIDAS)("ficha inválida recusada pelos dois, com as mesmas mensagens: %s", (_, mudar) => {
    const ficha = copia(FICHA) as ObjetoJson & { referencias_normativas: ObjetoJson[] };
    mudar(ficha);
    const { veredito, mensagens } = conferir("ficha.schema.json", ficha);
    expect(veredito).toEqual([false, false]);
    expect(mensagens[0]!.length).toBeGreaterThan(0);
    expect(mensagens[1]).toEqual(mensagens[0]);
  });

  test.each(MARCOS_INVALIDOS)(
    "registro de marcos inválido recusado pelos dois, com as mesmas mensagens: %s",
    (_, mudar) => {
      const marcos = copia(MARCOS);
      mudar(marcos);
      const { veredito, mensagens } = conferir("marcos-normativos.schema.json", marcos);
      expect(veredito).toEqual([false, false]);
      expect(mensagens[0]!.length).toBeGreaterThan(0);
      expect(mensagens[1]).toEqual(mensagens[0]);
    },
  );

  test.each(SCHEMAS_GERADOS)("as descrições são as mesmas, por caminho: %s", (nome) => {
    const antigas = descricoes(anterior(nome));
    expect(antigas.size).toBeGreaterThan(0);
    expect(Object.fromEntries(descricoes(atual(nome)))).toEqual(Object.fromEntries(antigas));
  });
});
