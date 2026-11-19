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
 *
 * Com uma `SessaoAtual` no contexto (o servidor HTTP), cada chamada é medida e registrada nela, com o
 * começo do texto do resultado.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/ai";
import { EntradaInvalida, ehEntradaInvalida, ehFalhaNaBase, type Resposta } from "../contratos.ts";
import { jsonSchema } from "../esquema.ts";
import { observarChamada, resumoDoResultado } from "../SessaoAtual.ts";
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

/** O decodificador da entrada de cada ferramenta, pelo nome. */
const DECODIFICADORES: ReadonlyMap<string, (argumentos: unknown) => Effect.Effect<unknown, EntradaInvalida>> = new Map(
  FERRAMENTAS.map((ferramenta) => [ferramenta.nome, decodificadorDeEntrada(ferramenta.nome, ferramenta.entrada)]),
);

/**
 * Uma chamada de ferramenta, como o servidor a faz: a entrada conferida com a mensagem de `validacao.ts`
 * e o `handle` do Toolkit, que a confere de novo e codifica a resposta pelo `outputSchema`. A
 * `Resposta` é o `structuredContent` do servidor; o `simplifica-mcp consultar` a imprime.
 *
 * Falha com `EntradaInvalida` (nome desconhecido, entrada inválida, ID que não está na base) ou
 * `FalhaNaBase`; uma resposta que não confere com o `outputSchema` é defeito.
 */
export const chamarFerramenta = Effect.fn("simplifica-mcp.chamarFerramenta")(
  function* (nome: string, argumentos: unknown) {
    const decodificar = DECODIFICADORES.get(nome);
    if (decodificar === undefined) {
      return yield* new EntradaInvalida({
        mensagem: `ferramenta desconhecida: ${nome}. As ferramentas são: ${FERRAMENTAS.map((f) => f.nome).join(", ")}`,
      });
    }
    const kit = yield* FerramentasIfpr;
    yield* decodificar(argumentos);
    const saida = yield* kit.handle(
      nome as keyof typeof FerramentasIfpr.tools,
      (argumentos ?? {}) as never,
      undefined,
      OPCOES_ENTRADA,
    );
    const ultimo = yield* Stream.run(saida, Sink.last());
    if (Option.isNone(ultimo)) return yield* Effect.die(`a ferramenta ${nome} terminou sem resposta`);
    return ultimo.value.result as Resposta<unknown>;
  },
  Effect.catchTags({ AiError: (erro) => Effect.die(erro) }),
);

/** Registra as ferramentas de `FERRAMENTAS` no `McpServer` do ambiente. */
export const registrarFerramentas = Effect.gen(function* () {
  const servidor = yield* McpServer.McpServer;
  // o Toolkit e os handlers do ambiente, para as chamadas, que rodam no contexto do servidor
  const contexto = yield* Effect.context<Effect.Services<ReturnType<typeof chamarFerramenta>>>();
  for (const ferramenta of FERRAMENTAS) {
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
        observarChamada(
          { ferramenta: ferramenta.nome },
          chamarFerramenta(ferramenta.nome, argumentos).pipe(
            Effect.provideContext(contexto),
            Effect.map(
              (resposta) =>
                new McpSchema.CallToolResult({
                  content: [{ type: "text", text: textoCompleto(resposta) }],
                  structuredContent: resposta,
                }),
            ),
            Effect.catchCause((causa) =>
              Cause.hasInterruptsOnly(causa) ? Effect.interrupt : Effect.succeed(resultadoDeErro(textoDaFalha(causa))),
            ),
          ),
          { falhou: (resultado) => resultado.isError === true, resumir: resumoDoResultado },
        ),
    });
  }
});
