// @effect-diagnostics nodeBuiltinImport:off -- gerador síncrono de arquivos da skill, chamado pela CLI e por validar_base.ts
/**
 * Contratos da base de análise em Effect Schema: ficha, registro de marcos normativos, validação
 * cruzada, resultado de lote dos sub-agentes e alertas transversais.
 *
 * O Effect Schema é a fonte única: `validar-base` decodifica os arquivos com ele
 * (`decodificarContrato`), e os arquivos de `schemas/` são gerados daqui (`revisar_ppc.ts
 * gerar-schemas`, `Schema.toJsonSchemaDocument`, draft 2020-12), como documentação, conferidos por
 * `gerar-schemas --check` e por `validar-base`. Os esquemas não usam refinamentos que o JSON Schema
 * não exprime, para que o documento gerado diga tudo o que se exige. As checagens que dependem da
 * base (ID existente, norma revogada, marco) ficam em `validacao-base.ts`.
 *
 * A ficha e os marcos são estritos (chave a mais é erro, `additionalProperties: false`); a validação
 * cruzada, o resultado de lote e os alertas aceitam chaves a mais, como sempre aceitaram.
 *
 * As descrições são lidas pelos sub-agentes da revisão: mudar o texto muda a revisão.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { problemas } from "@simplifica-if/kb/esquema/mensagens";
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

/** Estados de uma ficha ou validação cruzada. */
export const ESTADOS = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;
export type Estado = (typeof ESTADOS)[number];

export const CRITICIDADES = ["BLOQ", "OBRIG", "REC"] as const;
export type Criticidade = (typeof CRITICIDADES)[number];

/** Modo de execução da ficha na revisão do app (M1.11, classificação da proposta C). */
export const MODOS_EXECUCAO = ["D", "S", "J"] as const;
export type ModoExecucao = (typeof MODOS_EXECUCAO)[number];

const execucao = Schema.Struct({
  modo: Schema.Literals(MODOS_EXECUCAO).annotate({
    description:
      "D: o código decide com a base (verificador em packages/ppc, sem IA); S: o código acha o trecho e a IA confirma em resposta curta; J: julgamento da IA sobre as seções",
  }),
  justificativa: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Por que a ficha está nesse modo: o que o código usa e o que sobra para a IA",
  }),
}).annotate({
  description:
    "Como a ficha é executada na revisão do app; uma ficha D precisa de verificador registrado em packages/ppc/src/verificadores",
});
const textos = Schema.Array(Schema.String);

export const esquemaFicha = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  dominio: Schema.Literals(["identidade", "curriculo", "suporte", "transversal"]),
  criticidade: Schema.Literals(CRITICIDADES),
  execucao,
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

/** Seções do PPC que uma validação cruzada relaciona. */
const SECOES_VALIDACAO = [
  "identificacao_curso",
  "justificativa_objetivos",
  "concepcao_metodologia",
  "perfil_egresso",
  "organizacao_curricular",
  "avaliacao_aprendizagem",
  "atendimento_estudante",
  "corpo_docente_gestao",
  "infraestrutura",
  "avaliacao_ppc_egressos",
  "referencias_normativas",
] as const;

export const esquemaValidacaoCruzada = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  dominio: Schema.Literal("validacao_cruzada"),
  criticidade: Schema.Literals(CRITICIDADES),
  tipo: Schema.String,
  secoes_relacionadas: Schema.Array(Schema.Literals(SECOES_VALIDACAO)),
  condicionais_relacionadas: Schema.optionalKey(textos),
  pergunta: Schema.String,
  rubrica: Schema.String,
  boa_evidencia: Schema.String,
  ma_evidencia: Schema.String,
  evidencia_minima: inteiroPositivo,
  estados_permitidos: Schema.Array(Schema.Literals(ESTADOS)),
});

/**
 * Campo opcional dos sub-agentes em que `null` vale como ausente (`"artefato": null` é comum nas
 * rodadas): a decodificação tira a chave, e o resto do código nunca vê `null`. No JSON Schema, o
 * campo aceita o tipo ou `null`.
 */
function opcional<S extends Schema.Top>(esquema: S) {
  return Schema.optionalKey(Schema.NullOr(esquema)).pipe(
    Schema.decodeTo(
      Schema.optionalKey(Schema.toType(esquema)),
      SchemaTransformation.transformOptional<S["Type"], S["Type"] | null>({
        decode: Option.filter(Predicate.isNotNull),
        encode: (valor) => valor,
      }),
    ),
  );
}

/** Âncora de uma evidência no relatório: o bloco do PPC e o trecho a destacar. */
const ancoraEvidencia = Schema.Struct({
  block_id: opcional(Schema.String),
  quote: opcional(Schema.String),
});

/**
 * Evidência de um resultado de ficha: texto solto ou objeto. O objeto precisa de algo para conferir
 * (trecho, seção, localizador, artefato, âncora ou outra fonte), o que `resultados.ts` confere.
 */
export const esquemaEvidenciaResultado = Schema.Union([
  Schema.String,
  Schema.Struct({
    trecho: opcional(Schema.String),
    secao: opcional(Schema.String),
    localizador: opcional(Schema.String),
    fonte: opcional(Schema.String),
    artefato: opcional(Schema.String),
    anchor: opcional(ancoraEvidencia),
  }),
]);

/** Situação de uma afirmação normativa do PPC conferida pelo sub-agente. */
export const STATUS_FUNDAMENTACAO_NORMATIVA = [
  "CONFIRMADA",
  "CONFIRMADA_COM_RESSALVA",
  "IMPRECISA",
  "SEM_SUPORTE_NA_FONTE",
  "CONTRADITORIA",
  "FONTE_AUSENTE_OU_NAO_CONSULTADA",
  "NAO_NORMATIVA",
] as const;

export const esquemaFundamentacaoNormativa = Schema.Struct({
  status: Schema.Literals(STATUS_FUNDAMENTACAO_NORMATIVA),
  trecho_ppc: opcional(Schema.String),
  norma: opcional(Schema.String),
  fonte: opcional(Schema.String),
  dispositivo: opcional(Schema.String),
  evidencia: opcional(Schema.String),
  analise: opcional(Schema.String),
  recomendacao: opcional(Schema.String),
});

/** Confiança do sub-agente no estado, de 0 a 1. */
const confianca = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1));

export const esquemaResultadoFicha = Schema.Struct({
  ficha_id: Schema.String,
  estado: Schema.Literals(ESTADOS),
  confianca,
  justificativa: Schema.String,
  evidencias: Schema.Array(esquemaEvidenciaResultado),
  lacunas: textos,
  revisao_humana_obrigatoria: Schema.Boolean,
  fundamentacao_normativa: opcional(Schema.Array(esquemaFundamentacaoNormativa)),
  feedback_autores: opcional(Schema.String),
});

export const esquemaResultadoLote = Schema.Struct({
  grupo_id: Schema.optionalKey(Schema.String),
  batch_id: Schema.optionalKey(Schema.String),
  resultados: Schema.Array(esquemaResultadoFicha),
});

/** Evidência de um alerta transversal: texto solto ou objeto com ao menos um campo preenchido. */
const evidenciaAlerta = Schema.Union([
  Schema.String,
  Schema.Struct({
    trecho: opcional(Schema.String),
    secao: opcional(Schema.String),
    localizador: opcional(Schema.String),
    papel: opcional(Schema.String),
    fonte: opcional(Schema.String),
    anchor: opcional(ancoraEvidencia),
  }),
]);

/** Alerta da síntese transversal; sem `id`, ele é `ALERTA-<posição>`, e sem `criticidade`, `OBRIG`. */
export const esquemaAlertaTransversal = Schema.Struct({
  id: opcional(Schema.String),
  validacao_id: Schema.String,
  titulo: Schema.String,
  criticidade: opcional(Schema.Literals(CRITICIDADES)),
  descricao: Schema.String,
  fichas_relacionadas: opcional(textos),
  evidencias: opcional(Schema.Array(evidenciaAlerta)),
  revisao_humana_obrigatoria: Schema.Boolean,
});

export const esquemaAlertasTransversais = Schema.Struct({
  alertas_transversais: Schema.Array(esquemaAlertaTransversal),
});

/**
 * Esquemas gerados, pelo nome do arquivo em `schemas/`; `estrito` recusa chaves a mais na
 * decodificação e no JSON Schema.
 */
const GERADOS = {
  "alertas-transversais.schema.json": {
    esquema: esquemaAlertasTransversais,
    titulo: "Alertas transversais PPC",
    estrito: false,
  },
  "ficha.schema.json": { esquema: esquemaFicha, titulo: "Ficha de análise PPC", estrito: true },
  "marcos-normativos.schema.json": {
    esquema: esquemaMarcosNormativos,
    titulo: "Registro de marcos normativos",
    estrito: true,
  },
  "resultado-lote.schema.json": {
    esquema: esquemaResultadoLote,
    titulo: "Resultado de lote de fichas PPC",
    estrito: false,
  },
  "validacao-cruzada.schema.json": {
    esquema: esquemaValidacaoCruzada,
    titulo: "Validação cruzada PPC",
    estrito: false,
  },
} as const;
export type NomeSchemaGerado = keyof typeof GERADOS;
export const SCHEMAS_GERADOS = Object.keys(GERADOS) as NomeSchemaGerado[];

const DIALETO = "https://json-schema.org/draft/2020-12/schema";

/**
 * JSON Schema (draft 2020-12) gerado do Effect Schema, com `$id` e título estáveis. Nos esquemas
 * estritos, os objetos recusam chaves a mais (`additionalProperties: false`), como na decodificação
 * com `onExcessProperty: "error"`; as definições compartilhadas, se houver, vão em `$defs`.
 */
export function jsonSchemaGerado(nome: NomeSchemaGerado): ObjetoJson {
  const { esquema, titulo, estrito } = GERADOS[nome];
  const documento = Schema.toJsonSchemaDocument(esquema, estrito ? { onExcessProperty: "error" } : {});
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

/** Problema de um arquivo fora do contrato: caminho JSON (`$.campo[0]`) e mensagem. */
export type ProblemaDeContrato = { readonly caminho: string; readonly mensagem: string };

/** `$.referencias_normativas[0].ref`: o caminho do problema no JSON. */
function caminhoJson(caminho: ReadonlyArray<PropertyKey>): string {
  return caminho.reduce<string>(
    (texto, chave) => (typeof chave === "number" ? `${texto}[${chave}]` : `${texto}.${String(chave)}`),
    "$",
  );
}

/**
 * Decodifica `valor` com o contrato de `nome` e devolve os problemas, todos e em português (vazio
 * quando está no contrato).
 */
export function decodificarContrato(nome: NomeSchemaGerado, valor: unknown): ProblemaDeContrato[] {
  const { esquema, estrito } = GERADOS[nome];
  const resultado = Schema.decodeUnknownResult(esquema as Schema.Codec<unknown>)(valor, {
    errors: "all",
    onExcessProperty: estrito ? "error" : "ignore",
  });
  if (Result.isSuccess(resultado)) return [];
  return problemas(resultado.failure.issue).map((problema) => ({
    caminho: caminhoJson(problema.caminho),
    // Todo problema é de entrada inválida: o prefixo do formatador do kb não diz nada aqui.
    mensagem: problema.mensagem.replace(/^Entrada inválida: /, ""),
  }));
}
