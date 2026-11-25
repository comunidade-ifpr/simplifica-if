/**
 * Validação da entrada das ferramentas e a mensagem de entrada inválida que a IA lê para corrigir a
 * chamada:
 *
 *   Entrada inválida para a ferramenta etapa: id: deve ter pelo menos 1 caractere
 *
 * Usa o formatador compartilhado de `@simplifica-if/kb/esquema/mensagens` (`problemasDeEntrada`).
 */
import { caminhoTexto, chavesInvalidas, type Problema, problemasDeEntrada } from "@simplifica-if/kb/esquema/mensagens";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";
import { EntradaInvalida } from "./contratos.ts";

/** Problema já formatado: caminho e mensagem. */
export type ProblemaDeEntrada = Problema;

export { problemasDeEntrada };

/** Opções de decodificação da entrada: objetos fechados, todos os problemas, com o valor recebido. */
export const OPCOES_ENTRADA: SchemaAST.ParseOptions = {
  onExcessProperty: "error",
  errors: "all",
  reportInput: true,
};

/** `<caminho>: <mensagem>` (só `<mensagem>` na raiz). */
export function linhaDoProblema(problema: ProblemaDeEntrada): string {
  if (problema.caminho.length === 0) return problema.mensagem;
  return `${caminhoTexto(problema.caminho)}: ${problema.mensagem}`;
}

/** A mensagem de entrada inválida de uma ferramenta: o nome dela e os problemas. */
export function mensagemDeEntradaInvalida(ferramenta: string, issue: SchemaIssue.Issue): string {
  return comPrefixo(ferramenta, problemasDeEntrada(issue).map(linhaDoProblema).join(", "));
}

const comPrefixo = (ferramenta: string, problemas: string) =>
  `Entrada inválida para a ferramenta ${ferramenta}: ${problemas}`;

/**
 * Decodificador da entrada de uma ferramenta: os argumentos da chamada (ausentes, porque o protocolo
 * os deixa opcionais, viram `{}`) contra o schema, com objetos fechados; entrada inválida é
 * `EntradaInvalida` com a mensagem acima.
 */
export function decodificadorDeEntrada<S extends Schema.Decoder<unknown>>(ferramenta: string, schema: S) {
  const decodificar = Schema.decodeUnknownEffect(schema);
  // `Schema.Struct({})` aceita qualquer objeto, sem acusar chave a mais: a entrada sem campos confere aqui
  const semCampos =
    SchemaAST.isObjects(schema.ast) &&
    schema.ast.propertySignatures.length === 0 &&
    schema.ast.indexSignatures.length === 0;
  return (args: unknown): Effect.Effect<S["Type"], EntradaInvalida, S["DecodingServices"]> => {
    const valor = args ?? {};
    if (semCampos && typeof valor === "object" && !Array.isArray(valor) && Object.keys(valor).length > 0) {
      return Effect.fail(
        new EntradaInvalida({ mensagem: comPrefixo(ferramenta, chavesInvalidas(Object.keys(valor))) }),
      );
    }
    return decodificar(valor, OPCOES_ENTRADA).pipe(
      Effect.catchTags({
        SchemaError: (erro) =>
          Effect.fail(new EntradaInvalida({ mensagem: mensagemDeEntradaInvalida(ferramenta, erro.issue) })),
      }),
    );
  };
}
