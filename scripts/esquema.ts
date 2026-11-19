/**
 * Peças comuns de Effect Schema dos scripts: validação de JSON com mensagem em português e os
 * equivalentes dos objetos do zod.
 *
 * - `z.strictObject` → `Schema.Struct`, decodificado com `ESTRITO` (chave a mais é erro);
 * - `z.looseObject` → `solto(campos)`, que deixa as chaves a mais na saída (assinatura de índice,
 *   que o `ESTRITO` aceita);
 * - `z.object` (descarta as chaves a mais) → `Schema.Struct`, decodificado com `TODOS_OS_ERROS`.
 *
 * O `onExcessProperty` do Effect vale para a decodificação inteira, e não por objeto: dentro de um
 * schema estrito, um objeto que aceite chaves a mais tem de ser `solto`.
 *
 * As mensagens saem do formatador único do kb (`@simplifica-if/kb/esquema/mensagens`), uma linha
 * por problema, `<caminho>: <mensagem>`.
 */
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import { formatarErro } from "@simplifica-if/kb/esquema/mensagens";

/** Todos os problemas, não só o primeiro, e chave a mais é erro (o `z.strictObject`). */
export const ESTRITO = { errors: "all", onExcessProperty: "error" } as const satisfies SchemaAST.ParseOptions;

/** Todos os problemas; chaves a mais são descartadas (o `z.object`). */
export const TODOS_OS_ERROS = { errors: "all" } as const satisfies SchemaAST.ParseOptions;

const RESTO_SOLTO = [Schema.Record(Schema.String, Schema.Unknown)] as const;

/** Objeto que exige os campos dados e mantém os demais na saída, como o `z.looseObject`. */
export const solto = <Campos extends Schema.Struct.Fields>(campos: Campos) =>
  Schema.StructWithRest(Schema.Struct(campos), RESTO_SOLTO);

/** Schema que decodifica de forma síncrona, sem serviços. */
export type EsquemaSincrono<T> = Schema.Decoder<T, never>;

/**
 * Decodifica `valor` ou lança um `Error` com `cabecalho` e a lista de problemas, um por linha. Por
 * padrão, decodifica com `ESTRITO`.
 */
function validarOuFalhar<T>(
  esquema: EsquemaSincrono<T>,
  valor: unknown,
  cabecalho: string,
  opcoes: SchemaAST.ParseOptions = ESTRITO,
): T {
  const resultado = Schema.decodeUnknownExit(esquema)(valor, opcoes);
  if (Exit.isSuccess(resultado)) return resultado.value;
  const erro = Exit.findErrorOption(resultado);
  throw new Error(erro._tag === "Some" ? `${cabecalho}\n${formatarErro(erro.value)}` : cabecalho);
}

/**
 * Valida um valor lido de JSON e devolve o dado tipado. O erro informa a origem (caminho do
 * arquivo, linha do JSONL) e a lista de problemas, um por linha.
 */
export function validarJson<T>(
  esquema: EsquemaSincrono<T>,
  valor: unknown,
  origem: string,
  opcoes: SchemaAST.ParseOptions = ESTRITO,
): T {
  return validarOuFalhar(esquema, valor, `${origem} não tem o formato esperado:`, opcoes);
}

/** O dado decodificado, ou `undefined` se o valor não tem o formato (o `safeParse` do zod). */
export function decodificarOuNada<T>(
  esquema: EsquemaSincrono<T>,
  valor: unknown,
  opcoes: SchemaAST.ParseOptions = ESTRITO,
): T | undefined {
  const resultado = Schema.decodeUnknownExit(esquema)(valor, opcoes);
  return Exit.isSuccess(resultado) ? resultado.value : undefined;
}
