// @effect-diagnostics nodeBuiltinImport:off -- o servidor HTTP do Node (`createServer`) é a borda deste módulo
/**
 * `@simplifica-if/server`: o servidor local do app numa só aplicação Effect.
 *
 * - **RPC** (`GrupoApp` de `@simplifica-if/contratos-app`) por WebSocket em `ws://127.0.0.1:<porta>/rpc`,
 *   com um servidor `effect/rpc` para todas as conexões, como a rota `/ws` do T3 (`ws.ts`):
 *   `RpcServer.makeProtocolWithHttpEffectWebsocket` e a autenticação antes do upgrade
 *   (`Autenticacao.ts`).
 * - **MCP** `ifpr` por HTTP (`@simplifica-if/mcp/http`), numa porta própria; cada conversa recebe uma
 *   sessão com token próprio (`Conversas.ts`).
 * - **Motor** (`@simplifica-if/motor`) sobre os `Drivers` do ambiente: os reais (`Drivers.layerNode`,
 *   na CLI) ou drivers de teste.
 * - **Leitura** (`GrupoLeitura`) sobre o `kb.sqlite`, só leitura.
 *
 * Tudo vive no escopo da layer: fechá-lo derruba o RPC, encerra as conversas (o processo de cada
 * provider morre) e fecha o servidor MCP.
 */
import * as NodeHttp from "node:http";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { CAMINHO_RPC, GrupoApp } from "@simplifica-if/contratos-app";
import type { Canal } from "@simplifica-if/mcp/contratos";
import * as McpHttp from "@simplifica-if/mcp/http";
import { layerLeitura } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Autenticacao from "./Autenticacao.ts";
import * as Conversas from "./Conversas.ts";
import * as Handlers from "./handlers.ts";

export interface Opcoes {
  /** O `kb.sqlite` servido pelo MCP e pela leitura. */
  readonly banco: string;
  /** O token do RPC, gerado pelo processo pai. */
  readonly token: Redacted.Redacted<string>;
  /** A porta do RPC; sem ela (ou com 0), a que o sistema escolher. */
  readonly porta?: number;
  /** A porta do MCP; sem ela (ou com 0), a que o sistema escolher. */
  readonly portaMcp?: number;
  /** As origens de navegador aceitas no WebSocket (ver `Autenticacao.ts`). */
  readonly origens?: ReadonlyArray<string>;
  /** O canal da base quando o banco não registra um (padrão: `dev`, como a CLI do MCP). */
  readonly canal?: Canal;
}

/** O servidor do RPC não abriu: porta ocupada, sem permissão ou interface indisponível. */
export class ServidorNaoAbriu extends Schema.TaggedError<ServidorNaoAbriu>()("ServidorNaoAbriu", {
  porta: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.porta === 0
      ? "não foi possível abrir o servidor do Simplifica IF em 127.0.0.1"
      : `não foi possível abrir o servidor do Simplifica IF em 127.0.0.1:${this.porta} (a porta pode estar em uso)`;
  }
}

export class ServidorApp extends Context.Service<
  ServidorApp,
  {
    /** A porta do RPC. */
    readonly porta: number;
    /** `ws://127.0.0.1:<porta>/rpc` */
    readonly urlRpc: string;
    /** `http://127.0.0.1:<porta MCP>/mcp` */
    readonly urlMcp: string;
  }
>()("@simplifica-if/server/servidor/ServidorApp") {}

/** O servidor `effect/rpc` do `GrupoApp`, atrás da autenticação, na rota GET `/rpc`. */
const layerRotaRpc = Layer.unwrap(
  Effect.gen(function* () {
    const autenticacao = yield* Autenticacao.Autenticacao;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    // Como o T3 (`WS_RPC_SERVER_OPTIONS`): um defeito num handler não derruba as outras chamadas.
    yield* RpcServer.make(GrupoApp, { disableTracing: true, disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
    );
    return HttpRouter.add(
      "GET",
      CAMINHO_RPC,
      Effect.gen(function* () {
        const requisicao = yield* HttpServerRequest.HttpServerRequest;
        const recusa = yield* autenticacao.conferir(requisicao);
        return Option.isSome(recusa) ? recusa.value : yield* httpEffect;
      }),
    );
  }),
);

const makeServidorApp = Effect.gen(function* () {
  const endereco = (yield* HttpServer.HttpServer).address;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const porta = NetAddress.isInetAddress(endereco) ? endereco.port : 0;
  return ServidorApp.of({ porta, urlRpc: `ws://127.0.0.1:${porta}${CAMINHO_RPC}`, urlMcp: mcp.url });
});

/**
 * O servidor local inteiro. Pede os `Drivers` do motor (os reais, `Drivers.layerNode`, ou de teste) e
 * os serviços do Node (`NodeServices.layer`).
 */
export const layer = (opcoes: Opcoes) => {
  const porta = opcoes.porta ?? 0;
  const canal = opcoes.canal ?? "dev";
  const mcp = McpHttp.layer({ banco: opcoes.banco, canal, ...(opcoes.portaMcp ? { porta: opcoes.portaMcp } : {}) });
  const nucleo = Conversas.layer.pipe(Layer.provideMerge(Motor.layer), Layer.provideMerge(mcp));
  const handlers = Handlers.layer.pipe(
    Layer.provide(layerLeitura({ banco: opcoes.banco, canal })),
    Layer.provide(nucleo),
  );
  const servir = HttpRouter.serve(layerRotaRpc, { disableLogger: true, disableListenLog: true });
  // Sem o fechamento preventivo: ele espera as conexões abertas antes de interromper os fibers que as
  // fecham, e um WebSocket conectado segurava o encerramento pelos 20 s do prazo. Assim, as conexões
  // fecham (1001) e o servidor fecha logo depois.
  const node = Layer.effect(
    HttpServer.HttpServer,
    NodeHttpServer.make(() => NodeHttp.createServer(), {
      host: "127.0.0.1",
      port: porta,
      disablePreemptiveShutdown: true,
    }).pipe(Effect.mapError((erro) => new ServidorNaoAbriu({ porta, cause: erro }))),
  );
  return Layer.effect(ServidorApp, makeServidorApp).pipe(
    Layer.provide(servir),
    Layer.provide(Autenticacao.layer({ token: opcoes.token, origens: opcoes.origens ?? [] })),
    Layer.provide(Layer.mergeAll(handlers, RpcSerialization.layerJson)),
    Layer.provide(nucleo),
    Layer.provide(node),
    Layer.provide(Layer.mergeAll(NodeHttpServer.layerHttpServices, NodeCrypto.layerDigest)),
  );
};
