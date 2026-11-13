/**
 * Contratos zod da base de análise: ficha e registro de marcos normativos.
 *
 * O zod é a fonte única. `schemas/ficha.schema.json` e `schemas/marcos-normativos.schema.json` são
 * gerados daqui (`analise_ppc.ts gerar-schemas`), conferidos por `gerar-schemas --check` e por
 * `validar-base`, e servem de documentação e de entrada para o ajv, que dá as mensagens de erro no
 * formato do validador (`$.campo[0]: ...`). Por isso os esquemas não usam refinamentos: tudo o que
 * eles exigem cabe no JSON Schema. As checagens que dependem da base (ID existente, norma revogada,
 * marco) ficam em `validacao-base.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { RE_ID_ATO, RE_ID_ATO_COM_DISPOSITIVO } from "@simplifica-if/kb/normas/ids";
import { esquemaReferenciaNormativa } from "@simplifica-if/kb/normas/referencia-estruturada";
import { escreverTexto } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

const ESTADOS = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;

export const esquemaFicha = z.strictObject({
  id: z.string(),
  titulo: z.string(),
  dominio: z.enum(["identidade", "curriculo", "suporte", "transversal"]),
  criticidade: z.enum(["BLOQ", "OBRIG", "REC"]),
  topicos_tematicos: z.array(z.string()),
  tipo_escopo: z.enum(["tematico", "multitematico", "transversal", "condicional"]),
  ancoras_semanticas: z.array(z.string()),
  consultas: z.array(z.string()),
  referencias_normativas: z
    .array(esquemaReferenciaNormativa)
    .optional()
    .describe(
      "Uma entrada por dispositivo; entradas consecutivas da mesma norma e do mesmo papel formam uma citação no texto legível",
    ),
  pergunta: z.string(),
  rubrica: z.string(),
  boa_evidencia: z.string(),
  ma_evidencia: z.string(),
  escalonar_quando: z.string().optional(),
  evidencia_minima: z.int().min(1),
  estados_permitidos: z.array(z.enum(ESTADOS)),
  feedback_autores: z
    .strictObject({
      obrigatorio_quando_estado: z.array(z.enum(ESTADOS)).optional(),
      orientacao: z.string().optional(),
    })
    .optional(),
});
export type Ficha = z.output<typeof esquemaFicha>;

const idAto = z.string().regex(RE_ID_ATO);

export const esquemaMarcosNormativos = z.strictObject({
  versao: z.int().min(1),
  descricao: z.string(),
  marcos: z.array(
    z.strictObject({
      id: z.string(),
      tema: z.string(),
      vigente: idAto.describe("ID do ato vigente, com texto na base (manifest.json)"),
      aplica_a: z.string(),
      substitui: z.array(idAto).describe("IDs dos atos substituídos pelo vigente"),
      antecessoras_historicas: z.array(idAto),
      dispositivos_revogados: z
        .array(z.string().regex(RE_ID_ATO_COM_DISPOSITIVO))
        .describe("ID do ato com o dispositivo revogado, como br/cne-ceb/res/2025/3#art6-iii"),
      fichas_responsaveis: z.array(z.string()),
      fichas_base_legal: z.array(z.string()),
      transicao: z.string(),
      orientacao_analise: z.string(),
    }),
  ),
});
export type MarcosNormativos = z.output<typeof esquemaMarcosNormativos>;
export type Marco = MarcosNormativos["marcos"][number];

/** Esquemas gerados, pelo nome do arquivo em `schemas/`. */
const GERADOS = {
  "ficha.schema.json": { esquema: esquemaFicha, titulo: "Ficha de análise PPC" },
  "marcos-normativos.schema.json": { esquema: esquemaMarcosNormativos, titulo: "Registro de marcos normativos" },
} as const;
export type NomeSchemaGerado = keyof typeof GERADOS;
export const SCHEMAS_GERADOS = Object.keys(GERADOS) as NomeSchemaGerado[];

/** JSON Schema (draft 2020-12) gerado do zod, com `$id` e título estáveis. */
export function jsonSchemaGerado(nome: NomeSchemaGerado): ObjetoJson {
  const { esquema, titulo } = GERADOS[nome];
  const gerado = z.toJSONSchema(esquema, {
    target: "draft-2020-12",
    override: (contexto) => {
      // `z.int()` emite os limites de inteiro seguro; o contrato não tem limite superior.
      const no = contexto.jsonSchema as ObjetoJson;
      if (no.maximum === Number.MAX_SAFE_INTEGER) delete no.maximum;
    },
  }) as ObjetoJson;
  const { $schema, ...resto } = gerado;
  return {
    $schema,
    $id: `https://simplifica-if.local/analise-ppc/${nome}`,
    title: titulo,
    description: `Gerado de .agents/skills/analise-ppc/scripts/esquemas.ts (zod) por \`analise_ppc.ts gerar-schemas\`; não edite à mão.`,
    ...resto,
  };
}

/** Grava os JSON Schemas gerados em `schemas/`. */
export function escreverSchemas(caminhos: CaminhosAnalise = caminhosPadrao()): string[] {
  return SCHEMAS_GERADOS.map((nome) => {
    const arquivo = path.join(caminhos.schemasDir, nome);
    escreverTexto(arquivo, jsonIndentado(jsonSchemaGerado(nome)));
    return arquivo;
  });
}

/** Arquivos de `schemas/` que não coincidem com o gerado do zod (vazio quando estão em dia). */
export function schemasDesatualizados(caminhos: CaminhosAnalise = caminhosPadrao()): string[] {
  return SCHEMAS_GERADOS.map((nome) => path.join(caminhos.schemasDir, nome)).filter(
    (arquivo) =>
      !existsSync(arquivo) ||
      readFileSync(arquivo, "utf-8") !== jsonIndentado(jsonSchemaGerado(path.basename(arquivo) as NomeSchemaGerado)),
  );
}
