// @effect-diagnostics globalJsonInEffect:off -- harness: imprime as chamadas que o servidor HTTP recebe
/**
 * Parte HTTP do harness (`--mcp http`): sobe o servidor MCP HTTP local de `@simplifica-if/mcp/http`
 * neste processo, abre uma sessão e devolve o `ServidorMcp` que vai para o provider.
 *
 * O servidor e a sessão vivem no `Scope` de quem chama: fechá-lo derruba os dois. Falhar ao subir o
 * servidor é defeito: o harness não tem o que fazer sem ele.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { ServidorMcp } from "../src/Driver.ts";

export const servidorIfprHttp = Effect.fn("poc.servidorIfprHttp")(function* (opcoes: {
  readonly banco: string;
  readonly pastaTrabalho: string;
}) {
  const contexto = yield* Layer.build(
    McpHttp.layer({ banco: opcoes.banco }).pipe(Layer.provide(NodeServices.layer)),
  ).pipe(Effect.orDie);
  const servidor = yield* Effect.service(McpHttp.ServidorMcpHttp).pipe(Effect.provide(contexto));
  const rotulo = "motor-poc";
  const sessao = yield* servidor.abrirSessao({ rotulo, pastaTrabalho: opcoes.pastaTrabalho });
  yield* Console.log(`[mcp http] ${servidor.url}`);
  // As chamadas chegam ao processo do app: é o que o HTTP traz além do stdio.
  yield* servidor.chamadas.pipe(
    Stream.runForEach((chamada) => Console.log(`[mcp http] chamada ${JSON.stringify(chamada).slice(0, 200)}`)),
    Effect.forkScoped,
  );
  return {
    nome: "ifpr",
    url: sessao.url,
    cabecalhos: sessao.cabecalhos,
    preAprovado: true,
    // O resultado de cada chamada, para o motor completar o resumo que o `agy` não manda pelo ACP.
    resultados: servidor.chamadas.pipe(
      Stream.filter((chamada) => chamada.sessao === rotulo),
      Stream.map((chamada) => ({
        ferramenta: chamada.ferramenta,
        resumo: chamada.resumo ?? "",
        falhou: chamada.falhou,
      })),
    ),
  } satisfies ServidorMcp;
});
