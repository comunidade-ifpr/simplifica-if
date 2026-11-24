/**
 * Contratos da base da revisão de PPC em Effect Schema: a ficha e o registro de marcos normativos.
 *
 * O Effect Schema é a fonte única: a validação decodifica os arquivos com ele (`decodificarContrato`).
 * As checagens que dependem da base (ID existente, norma revogada, marco) ficam em `validacao.ts`.
 *
 * A ficha e os marcos são estritos: chave a mais é erro (`onExcessProperty: "error"`).
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { problemas } from "@simplifica-if/kb/esquema/mensagens";
import { RE_ID_NORMA } from "@simplifica-if/kb/normas/ids";
import { esquemaReferenciaNormativa } from "@simplifica-if/kb/normas/referencia-estruturada";

/** Inteiro (seguro, como o `z.int()`) maior ou igual a 1. */
const inteiroPositivo = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

/** Estados de uma ficha. */
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
    Schema.Array(esquemaReferenciaNormativa).annotate({
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
      linha: Schema.Array(Schema.String.check(Schema.isPattern(RE_ID_NORMA)))
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
  /** Atos da linha ainda não vigentes (aguardando publicação). */
  aguardando: string[];
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

/** Contratos da base da revisão de PPC. */
const CONTRATOS = {
  "ficha.schema.json": esquemaFicha,
  "marcos-normativos.schema.json": esquemaMarcosNormativos,
} as const;
export type NomeSchemaGerado = keyof typeof CONTRATOS;

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
  const esquema = CONTRATOS[nome];
  const resultado = Schema.decodeUnknownResult(esquema as Schema.Codec<unknown>)(valor, {
    errors: "all",
    onExcessProperty: "error",
  });
  if (Result.isSuccess(resultado)) return [];
  return problemas(resultado.failure.issue).map((problema) => ({
    caminho: caminhoJson(problema.caminho),
    // Todo problema é de entrada inválida: o prefixo do formatador do kb não diz nada aqui.
    mensagem: problema.mensagem.replace(/^Entrada inválida: /, ""),
  }));
}
