// @effect-diagnostics nodeBuiltinImport:off -- gerador síncrono de arquivos da skill, chamado pela CLI e por validar_base.ts
/**
 * Contratos da base de análise em Effect Schema: ficha e registro de marcos normativos.
 *
 * O Effect Schema é a fonte única. `schemas/ficha.schema.json` e `schemas/marcos-normativos.schema.json`
 * são gerados daqui (`revisar_ppc.ts gerar-schemas`, `Schema.toJsonSchemaDocument`, draft 2020-12),
 * conferidos por `gerar-schemas --check` e por `validar-base`, e servem de documentação e de entrada
 * para o ajv, que dá as mensagens de erro no formato do validador (`$.campo[0]: ...`). Por isso os
 * esquemas não usam refinamentos: tudo o que eles exigem cabe no JSON Schema. As checagens que
 * dependem da base (ID existente, norma revogada, marco) ficam em `validacao-base.ts`.
 *
 * As descrições são lidas pelos sub-agentes da revisão: mudar o texto muda a revisão.
 * `tests/schemas-gerados.test.ts` confere que o veredito, as mensagens e as descrições são os do
 * schema anterior, gerado do zod (`tests/fixtures/schemas-zod/`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { RE_ID_ATO, RE_ID_DISPOSITIVO, RE_REFERENCIA } from "@simplifica-if/kb/normas/ids";
import { esquemaReferenciaNormativa } from "@simplifica-if/kb/normas/referencia-estruturada";
import { escreverTexto } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

/**
 * `pattern` do JSON Schema para um `isPattern` cuja expressão não tem a flag `u`: sem ela, o
 * `Schema.isPattern` não exporta o padrão (o JSON Schema interpreta `pattern` como Unicode). As
 * expressões dos IDs só têm ASCII, e a leitura com e sem `u` coincide.
 */
const padraoJson = (expressao: RegExp) => ({ toJsonSchema: () => ({ pattern: expressao.source }) });

/**
 * Referência normativa estruturada (`{ ref, dispositivo?, papel, nota? }`): o esquema do kb, com o
 * `pattern` de `ref` e de `dispositivo` exportado para o JSON Schema (as anotações vão para a
 * última checagem de cada campo, o `isPattern`; a decodificação não muda).
 */
const referenciaNormativa = esquemaReferenciaNormativa.mapFields(
  Struct.evolve({
    ref: (campo) => campo.annotate(padraoJson(RE_REFERENCIA)),
    dispositivo: (campo) => Schema.optionalKey(campo.schema.annotate(padraoJson(RE_ID_DISPOSITIVO))),
  }),
);

/** Inteiro (seguro, como o `z.int()`) maior ou igual a 1; no JSON Schema, sem o limite superior. */
const inteiroPositivo = Schema.Number.check(
  Schema.isInt({ toJsonSchema: () => ({ type: "integer" }) }),
  Schema.isGreaterThanOrEqualTo(1),
);

const ESTADOS = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;
const textos = Schema.Array(Schema.String);

export const esquemaFicha = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  dominio: Schema.Literals(["identidade", "curriculo", "suporte", "transversal"]),
  criticidade: Schema.Literals(["BLOQ", "OBRIG", "REC"]),
  topicos_tematicos: textos,
  tipo_escopo: Schema.Literals(["tematico", "multitematico", "transversal", "condicional"]),
  ancoras_semanticas: textos,
  consultas: textos,
  referencias_normativas: Schema.optionalKey(
    Schema.Array(referenciaNormativa).annotate({
      description:
        "Uma entrada por dispositivo; entradas consecutivas da mesma norma e do mesmo papel formam uma citação no texto legível",
    }),
  ),
  pergunta: Schema.String,
  rubrica: Schema.String,
  boa_evidencia: Schema.String,
  ma_evidencia: Schema.String,
  escalonar_quando: Schema.optionalKey(Schema.String),
  evidencia_minima: inteiroPositivo,
  estados_permitidos: Schema.Array(Schema.Literals(ESTADOS)),
  feedback_autores: Schema.optionalKey(
    Schema.Struct({
      obrigatorio_quando_estado: Schema.optionalKey(Schema.Array(Schema.Literals(ESTADOS))),
      orientacao: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type Ficha = typeof esquemaFicha.Type;

export const esquemaMarcosNormativos = Schema.Struct({
  versao: inteiroPositivo,
  descricao: Schema.String,
  marcos: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      tema: Schema.String,
      linha: Schema.Array(Schema.String.check(Schema.isPattern(RE_ID_ATO, padraoJson(RE_ID_ATO))))
        .check(Schema.isMinLength(1))
        .annotate({
          description:
            "IDs dos atos do tema, do mais antigo ao mais recente conhecido; vigente, substituídas, antecessoras e dispositivos revogados são derivados de base-conhecimento/relacoes.yaml",
        }),
      aplica_a: Schema.String,
      fichas_responsaveis: textos,
      fichas_base_legal: textos,
      transicao: Schema.String,
      orientacao_analise: Schema.String,
    }),
  ),
});
export type MarcosNormativos = typeof esquemaMarcosNormativos.Type;
/** Marco como está no arquivo (identificação, transição e orientação). */
export type MarcoArquivo = MarcosNormativos["marcos"][number];

/** Marco com os campos derivados de `relacoes.yaml` (vigente, substituídas etc.), sem a linha. */
export interface Marco {
  id: string;
  tema: string;
  vigente: string;
  aplica_a: string;
  substitui: string[];
  antecessoras_historicas: string[];
  dispositivos_revogados: string[];
  fichas_responsaveis: string[];
  fichas_base_legal: string[];
  transicao: string;
  orientacao_analise: string;
  [campo: string]: unknown;
}

/** Esquemas gerados, pelo nome do arquivo em `schemas/`. */
const GERADOS = {
  "ficha.schema.json": { esquema: esquemaFicha, titulo: "Ficha de análise PPC" },
  "marcos-normativos.schema.json": { esquema: esquemaMarcosNormativos, titulo: "Registro de marcos normativos" },
} as const;
export type NomeSchemaGerado = keyof typeof GERADOS;
export const SCHEMAS_GERADOS = Object.keys(GERADOS) as NomeSchemaGerado[];

const DIALETO = "https://json-schema.org/draft/2020-12/schema";

/**
 * JSON Schema (draft 2020-12) gerado do Effect Schema, com `$id` e título estáveis. Os objetos
 * recusam chaves a mais (`additionalProperties: false`), como na decodificação com
 * `onExcessProperty: "error"`; as definições compartilhadas, se houver, vão em `$defs`.
 */
export function jsonSchemaGerado(nome: NomeSchemaGerado): ObjetoJson {
  const { esquema, titulo } = GERADOS[nome];
  const documento = Schema.toJsonSchemaDocument(esquema, { onExcessProperty: "error" });
  const definicoes = Object.keys(documento.definitions).length ? { $defs: documento.definitions } : {};
  return {
    $schema: DIALETO,
    $id: `https://simplifica-if.local/revisar-ppc/${nome}`,
    title: titulo,
    description: `Gerado de .agents/skills/revisar-ppc/scripts/esquemas.ts (Effect Schema) por \`revisar_ppc.ts gerar-schemas\`; não edite à mão.`,
    ...(documento.schema as ObjetoJson),
    ...definicoes,
  };
}

/** Grava os JSON Schemas gerados em `schemas/`. */
export function escreverSchemas(caminhos: CaminhosAnalise = caminhosPadrao()): string[] {
  return SCHEMAS_GERADOS.map((nome) => {
    const arquivo = NodePath.join(caminhos.schemasDir, nome);
    escreverTexto(arquivo, jsonIndentado(jsonSchemaGerado(nome)));
    return arquivo;
  });
}

/** Arquivos de `schemas/` que não coincidem com o gerado do Effect Schema (vazio quando estão em dia). */
export function schemasDesatualizados(caminhos: CaminhosAnalise = caminhosPadrao()): string[] {
  return SCHEMAS_GERADOS.map((nome) => NodePath.join(caminhos.schemasDir, nome)).filter(
    (arquivo) =>
      !NodeFS.existsSync(arquivo) ||
      NodeFS.readFileSync(arquivo, "utf-8") !==
        jsonIndentado(jsonSchemaGerado(NodePath.basename(arquivo) as NomeSchemaGerado)),
  );
}
