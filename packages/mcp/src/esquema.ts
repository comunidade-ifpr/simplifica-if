/**
 * Construtores de schema da entrada das ferramentas, com a mesma semântica e o mesmo JSON Schema
 * dos schemas zod que eles substituem (especificação M0.1): texto aparado com limites, inteiro e
 * número com faixa, campo com valor padrão. As mensagens de validação saem de `validacao.ts`.
 *
 * O JSON Schema de entrada e de saída sai de `jsonSchema`: o documento 2020-12 do Effect, com objetos
 * fechados (`additionalProperties: false`), como os `strictObject` do zod, e o `$schema` na raiz.
 *
 * O JSON Schema descreve o lado codificado (o que a IA envia). Num campo com transformação (o texto
 * aparado), a descrição e os limites ficam desse lado; os limites, num filtro que só existe no JSON
 * Schema (`soNoJsonSchema`), porque a conferência de verdade vem depois de aparar, como no zod.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaTransformation from "effect/SchemaTransformation";

const DIALETO = "https://json-schema.org/draft/2020-12/schema";

/** JSON Schema (2020-12) de um schema, com objetos fechados; `$defs` quando houver definições. */
export function jsonSchema(schema: Schema.Top): Record<string, unknown> {
  const documento = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
  // `Schema.Struct({})` vira "qualquer valor não nulo" no Effect; a entrada sem campos é um objeto vazio
  const vazio = SchemaAST.isObjects(schema.ast) && schema.ast.propertySignatures.length === 0 && schema.ast.indexSignatures.length === 0;
  const raiz: Record<string, unknown> = vazio
    ? { type: "object", properties: {}, additionalProperties: false }
    : { ...documento.schema };
  if (Object.keys(documento.definitions).length > 0) raiz.$defs = documento.definitions;
  return { $schema: DIALETO, ...raiz };
}

/** Filtro que não recusa nada e só acrescenta `fragmento` ao JSON Schema. */
const soNoJsonSchema = (fragmento: Record<string, unknown>) =>
  Schema.makeFilter<string>(() => true, { toJsonSchema: () => fragmento });

interface OpcoesTexto {
  readonly minimo?: number | undefined;
  readonly maximo?: number | undefined;
  /** Padrão e mensagem quando o texto não o segue. */
  /** Padrão (com a flag `u`, sem a qual o Effect não o leva ao JSON Schema) e a mensagem de erro. */
  readonly padrao?: { readonly regex: RegExp; readonly mensagem: string } | undefined;
}

const checagensDeTexto = (opcoes: OpcoesTexto): SchemaAST.Check<string>[] => [
  ...(opcoes.minimo === undefined ? [] : [Schema.isMinLength(opcoes.minimo)]),
  ...(opcoes.maximo === undefined ? [] : [Schema.isMaxLength(opcoes.maximo)]),
  ...(opcoes.padrao === undefined ? [] : [Schema.isPattern(opcoes.padrao.regex, { message: opcoes.padrao.mensagem })]),
];

/** Texto com limites e padrão opcionais, sem aparar (`z.string().min().max().regex()`). */
export const texto = (opcoes: OpcoesTexto = {}, descricao?: string) => {
  const base = descricao === undefined ? Schema.String : Schema.String.annotate({ description: descricao });
  const checagens = checagensDeTexto(opcoes);
  const [primeira, ...demais] = checagens;
  return primeira === undefined ? base : base.check(primeira, ...demais);
};

/**
 * Texto aparado nas pontas e depois conferido, como `z.string().trim().min().max().regex()`: a
 * conferência vale para o texto aparado; o JSON Schema mostra os limites e o padrão.
 */
export const textoAparado = (
  opcoes: OpcoesTexto & { readonly minimo: number; readonly maximo: number },
  descricao?: string,
) =>
  (descricao === undefined ? Schema.String : Schema.String.annotate({ description: descricao }))
    .check(
      soNoJsonSchema({
        minLength: opcoes.minimo,
        maxLength: opcoes.maximo,
        ...(opcoes.padrao ? { pattern: opcoes.padrao.regex.source } : {}),
      }),
    )
    .pipe(Schema.decodeTo(texto(opcoes), SchemaTransformation.trim()));

/** Inteiro entre `minimo` e `maximo` (sem `maximo`, até o maior inteiro seguro, como o zod). */
export const inteiro = (opcoes: { readonly minimo?: number; readonly maximo?: number } = {}) => {
  const [primeira, ...demais]: SchemaAST.Check<number>[] = [
    ...(opcoes.minimo === undefined ? [] : [Schema.isGreaterThanOrEqualTo(opcoes.minimo)]),
    ...(opcoes.maximo === undefined ? [] : [Schema.isLessThanOrEqualTo(opcoes.maximo)]),
  ];
  return primeira === undefined ? Schema.Int : Schema.Int.check(primeira, ...demais);
};

/** Número entre `minimo` e `maximo`. */
export const numero = (opcoes: { readonly minimo: number; readonly maximo: number }) =>
  Schema.Finite.check(Schema.isGreaterThanOrEqualTo(opcoes.minimo), Schema.isLessThanOrEqualTo(opcoes.maximo));

/** Campo opcional com `padrao` quando ausente, como `.default()` do zod; o JSON Schema traz o `default`. */
export function comPadrao<S extends Schema.Top>(schema: S, padrao: S["Encoded"], descricao: string) {
  const anotado = schema.pipe(Schema.annotate<S>({ description: descricao, default: padrao }));
  return anotado.pipe(Schema.withDecodingDefaultKey<S["Rebuild"]>(Effect.succeed(padrao)));
}

/** Campo opcional (a chave pode faltar), com a descrição para a IA quando ela não veio no schema. */
export function opcional<S extends Schema.Top>(schema: S, descricao?: string) {
  return Schema.optionalKey(descricao === undefined ? schema : schema.pipe(Schema.annotate<S>({ description: descricao })));
}
