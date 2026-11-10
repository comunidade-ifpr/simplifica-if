import { z } from "zod";

/**
 * Valida um valor lido de JSON e devolve o dado tipado. O erro informa a origem (caminho do
 * arquivo, linha do JSONL) e a lista de problemas encontrados, um por linha. É o mesmo helper do
 * sei-cli (`validarJson`), repetido aqui para que os módulos que não falam com o SEI não dependam
 * do pacote sei-cli.
 */
export function validarJson<T extends z.ZodType>(esquema: T, valor: unknown, origem: string): z.output<T> {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    throw new Error(`${origem} não tem o formato esperado:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}
