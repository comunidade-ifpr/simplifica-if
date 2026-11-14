/**
 * Contratos zod da base de análise: ficha e registro de marcos normativos.
 *
 * O zod é a fonte única. `schemas/ficha.schema.json` e `schemas/marcos-normativos.schema.json` são
 * gerados daqui (`revisar_ppc.ts gerar-schemas`), conferidos por `gerar-schemas --check` e por
 * `validar-base`, e servem de documentação e de entrada para o ajv, que dá as mensagens de erro no
 * formato do validador (`$.campo[0]: ...`). Por isso os esquemas não usam refinamentos: tudo o que
 * eles exigem cabe no JSON Schema. As checagens que dependem da base (ID existente, norma revogada,
 * marco) ficam em `validacao-base.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonIndentado, type ObjetoJson } from "@simplifica-if/kb/json";
import { RE_ID_ATO, RE_ID_DISPOSITIVO, RE_REFERENCIA } from "@simplifica-if/kb/normas/ids";
import { PAPEIS_REFERENCIA } from "@simplifica-if/kb/normas/referencia-estruturada";
import { escreverTexto } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

/**
 * Referência normativa estruturada (`{ ref, dispositivo?, papel, nota? }`), para o JSON Schema da
 * ficha: cópia zod temporária do esquema do kb; o C3 passa a skill a Effect Schema e volta a
 * importar do kb (`esquemaReferenciaNormativa` em `@simplifica-if/kb/normas/referencia-estruturada`,
 * que `referencias-fichas.ts` já usa para validar as referências).
 */
export const esquemaReferenciaNormativa = z.strictObject({
  ref: z
    .string()
    .regex(RE_REFERENCIA)
    .describe("ID canônico: ato sem variante (br/..., ifpr/...), stub, externo:... ou cnct:..."),
  dispositivo: z
    .string()
    .regex(RE_ID_DISPOSITIVO)
    .optional()
    .describe("Um dispositivo do ato, como #art28-vii, #art28-par1-iv ou #art24-parunico"),
  papel: z
    .enum(PAPEIS_REFERENCIA)
    .describe("fundamento: a ficha aplica a regra; complementar: a ficha só remete à referência"),
  nota: z.string().min(1).optional().describe("Detalhe da citação que não cabe em ref e dispositivo"),
});

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
      linha: z
        .array(idAto)
        .min(1)
        .describe(
          "IDs dos atos do tema, do mais antigo ao mais recente conhecido; vigente, substituídas, antecessoras e dispositivos revogados são derivados de base-conhecimento/relacoes.yaml",
        ),
      aplica_a: z.string(),
      fichas_responsaveis: z.array(z.string()),
      fichas_base_legal: z.array(z.string()),
      transicao: z.string(),
      orientacao_analise: z.string(),
    }),
  ),
});
export type MarcosNormativos = z.output<typeof esquemaMarcosNormativos>;
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
    $id: `https://simplifica-if.local/revisar-ppc/${nome}`,
    title: titulo,
    description: `Gerado de .agents/skills/revisar-ppc/scripts/esquemas.ts (zod) por \`revisar_ppc.ts gerar-schemas\`; não edite à mão.`,
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
