/**
 * O que toda conferência de resposta da IA compartilha: os estados de uma ficha, os ajudantes do
 * contrato e a extração do objeto JSON do texto da resposta.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** Os estados de uma ficha da `revisar-ppc`, na ordem em que o pedido os lista. */
export const ESTADOS_IA = ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"] as const;

export const EstadoIa = Schema.Literals(ESTADOS_IA);
export type EstadoIa = typeof EstadoIa.Type;

export const Texto = Schema.String;
export const ate = (n: number) => Texto.check(Schema.isMaxLength(n));

/** Por que a resposta não deu um objeto JSON: nunca a mensagem do `JSON.parse`, que repete a resposta. */
export type FalhaExtracao = "longa-demais" | "sem-objeto" | "json-invalido";

/** O objeto JSON da resposta: do primeiro `{` ao último `}` (com ou sem cerca de código). */
export function extrairJson(texto: string, limite: number): Result.Result<unknown, FalhaExtracao> {
  if (texto.length > limite) return Result.fail("longa-demais");
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return Result.fail("sem-objeto");
  try {
    return Result.succeed(JSON.parse(texto.slice(inicio, fim + 1)));
  } catch {
    return Result.fail("json-invalido");
  }
}
