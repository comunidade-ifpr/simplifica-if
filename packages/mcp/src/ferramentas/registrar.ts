/**
 * Registro das ferramentas num `McpServer` do `effect/ai`, sobre `addTool`, como o
 * `registerImageTool` do T3, e não pelo `McpServer.registerToolkit`, por dois motivos:
 *
 * - o `content` da resposta é o texto Markdown compacto para a IA (especificação M0.1, "Texto para a
 *   IA"); o `registerToolkit` põe ali o JSON do resultado;
 * - a entrada inválida volta como resultado `isError`, com a mensagem em português de `validacao.ts`,
 *   para a IA corrigir a chamada; o `registerToolkit` responde com o erro `InvalidParams` do JSON-RPC.
 *
 * A chamada passa pelo Toolkit (`FerramentasIfpr`, com os handlers do ambiente), que confere a
 * entrada de novo e codifica a resposta pelo `outputSchema`. O `structuredContent` é a `Resposta`
 * como o handler a montou (a mesma ordem de chaves do servidor anterior), e o `content`, o texto.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/ai";
import { ehEntradaInvalida, ehFalhaNaBase, type Resposta } from "../contratos.ts";
import { jsonSchema } from "../esquema.ts";
import { decodificadorDeEntrada, OPCOES_ENTRADA } from "../validacao.ts";
import { FERRAMENTAS, FerramentasIfpr } from "./toolkit.ts";

/**
 * As anotações do `tools/list`. O `McpSchema` do Effect sempre escreve `destructiveHint` (o padrão do
 * MCP é `true`); por isso ele vai explícito, `false`, como a anotação `Tool.Destructive` do Toolkit. O
 * servidor anterior (SDK 2.x) o omitia: é a única diferença das anotações em relação ao gabarito do C0.
 */
const anotacoes = (titulo: string) =>
  ({
    title: titulo,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }) as const;

/** Resultado de erro com o texto para a IA, sem `structuredContent`. */
function resultadoDeErro(texto: string): McpSchema.CallToolResult {
  return new McpSchema.CallToolResult({ content: [{ type: "text", text: texto }], isError: true });
}

/** O texto de uma falha: a mensagem do erro tipado, ou uma mensagem fixa para um defeito. */
function textoDaFalha(causa: Cause.Cause<unknown>): string {
  const erro = Cause.findErrorOption(causa);
  if (Option.isSome(erro) && (ehEntradaInvalida(erro.value) || ehFalhaNaBase(erro.value))) return erro.value.message;
  return "erro interno do simplifica-mcp ao montar a resposta; tente de novo ou avise a curadoria";
}

/** Registra as ferramentas de `FERRAMENTAS` no `McpServer` do ambiente. */
export const registrarFerramentas = Effect.gen(function* () {
  const servidor = yield* McpServer.McpServer;
  const kit = yield* FerramentasIfpr;
  for (const ferramenta of FERRAMENTAS) {
    const decodificar = decodificadorDeEntrada(ferramenta.nome, ferramenta.entrada);
    const textoCompleto = ferramenta.textoCompleto as (resposta: Resposta<unknown>) => string;
    yield* servidor.addTool({
      tool: new McpSchema.Tool({
        name: ferramenta.nome,
        title: ferramenta.titulo,
        description: ferramenta.descricao,
        inputSchema: jsonSchema(ferramenta.entrada),
        outputSchema: jsonSchema(ferramenta.saida),
        annotations: anotacoes(ferramenta.titulo),
      }),
      annotations: ferramenta.tool.annotations,
      handle: (argumentos: unknown) =>
        decodificar(argumentos).pipe(
          Effect.andThen(kit.handle(ferramenta.nome, (argumentos ?? {}) as never, undefined, OPCOES_ENTRADA)),
          Effect.flatMap((saida) => Stream.run(saida, Sink.last())),
          Effect.flatMap(Effect.fromOption),
          Effect.map(({ result }) => {
            const resposta = result as Resposta<unknown>;
            return new McpSchema.CallToolResult({
              content: [{ type: "text", text: textoCompleto(resposta) }],
              structuredContent: resposta,
            });
          }),
          Effect.catchCause((causa) =>
            Cause.hasInterruptsOnly(causa) ? Effect.interrupt : Effect.succeed(resultadoDeErro(textoDaFalha(causa))),
          ),
        ),
    });
  }
});
