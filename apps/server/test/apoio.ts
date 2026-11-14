// @effect-diagnostics nodeBuiltinImport:off -- apoio de teste: upgrade HTTP cru e POST ao MCP pelo node:http
/**
 * Apoio dos testes do servidor: o banco de fixture (o mesmo do `simplifica-mcp`), um driver falso do
 * motor, o cliente RPC (o `effect/rpc` sobre WebSocket, como a interface vai usar) e requisições cruas
 * para conferir as recusas.
 */
import * as NodeHttp from "node:http";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { GrupoApp } from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import * as Canal from "@simplifica-if/motor/Canal";
import { criarBancoFixture } from "../../../packages/mcp/test/fixture.ts";
import { inserirNormas } from "../../../packages/mcp/test/fixture-normas.ts";

export { diretorioTemporario, limparTemporarios } from "../../../packages/mcp/test/fixture.ts";
export { DCN_2021 } from "../../../packages/mcp/test/fixture-normas.ts";

/** Um token de teste com o tamanho mínimo de sobra. */
export const TOKEN = "token-de-teste-do-servidor-local-0123456789";

/** O `kb.sqlite` de fixture, com as normas (não depende do `tmp/kb.sqlite`). */
export function bancoFixture(): string {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  return banco;
}

/** O que o driver falso viu: a configuração de cada sessão aberta e quantas se encerraram. */
export interface Registro {
  readonly configs: Array<Motor.ConfigSessao>;
  encerradas: number;
  /** Chamado a cada sessão encerrada, para o teste esperar pelo encerramento sem relógio. */
  aoEncerrar?: (() => void) | undefined;
}

/**
 * Driver falso: pede aprovação para "escrever" e conclui conforme a decisão. O Codex falso falha ao
 * iniciar, com um `cause` que não pode chegar à interface.
 */
export const driverFalso = (registro: Registro, provider: Motor.Provider): Motor.Driver => ({
  detectar: Effect.succeed({ provider, instalado: true, autenticado: true, versao: "0.0.0-teste", plano: "teste" }),
  iniciar: (config) =>
    Effect.gen(function* () {
      if (provider === "codex") {
        return yield* new Motor.FalhaProvider({
          provider,
          operacao: "iniciar sessão",
          detalhe: "falha de teste",
          cause: new Error("/Users/alguem/segredo"),
        });
      }
      registro.configs.push(config);
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          registro.encerradas++;
          registro.aoEncerrar?.();
        }),
      );
      const responder = (texto: string) =>
        Effect.gen(function* () {
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Vou " });
          yield* canal.emitir({ _tag: "FerramentaIniciada", id: "f1", nome: "escrever", entrada: { texto } });
          const decisao = yield* canal.pedirAprovacao({
            id: "f1",
            ferramenta: "escrever",
            descricao: "escrever um arquivo",
            entrada: { texto },
          });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: "f1",
            nome: "escrever",
            resumo: decisao,
            falhou: decisao === "negar",
          });
          yield* canal.emitir({ _tag: "TextoFinal", texto: `Vou ${decisao}` });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "end_turn" });
        });
      return {
        enviar: (texto) => canal.turno(Effect.asVoid(Effect.forkIn(responder(texto), escopo))),
        responder: canal.responder,
        interromper: Effect.void,
      } satisfies Motor.SessaoDriver;
    }),
});

export const layerDriversFalsos = (registro: Registro) =>
  Layer.succeed(
    Motor.Drivers,
    Motor.Drivers.of({
      claude: driverFalso(registro, "claude"),
      codex: driverFalso(registro, "codex"),
      antigravity: driverFalso(registro, "antigravity"),
    }),
  );

/**
 * O cliente do `GrupoApp` em `url`, com os cabeçalhos dados; fecha com o escopo. Sem nova tentativa:
 * uma conexão recusada falha as chamadas.
 */
export const cliente = (url: string, cabecalhos?: Record<string, string>) =>
  Effect.gen(function* () {
    // O protocolo vive no escopo de quem chama: com `Effect.provide`, o socket fecharia ao fim do `make`.
    const protocolo = yield* Layer.build(
      RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
        Layer.provide(Socket.layerWebSocket(url, cabecalhos === undefined ? {} : { headers: cabecalhos })),
        Layer.provide(NodeSocket.layerWebSocketConstructor),
        Layer.provide(RpcSerialization.layerJson),
      ),
    );
    return yield* RpcClient.make(GrupoApp).pipe(Effect.provide(protocolo));
  });

/** Um pedido de upgrade WebSocket cru: o status da resposta (101 se o servidor aceitou). */
export const pedirUpgrade = (url: string, cabecalhos: Record<string, string>) =>
  Effect.callback<number>((resume) => {
    const requisicao = NodeHttp.request(url.replace(/^ws:/, "http:"), {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...cabecalhos,
      },
    });
    requisicao.on("upgrade", (_resposta, socket) => {
      socket.destroy();
      resume(Effect.succeed(101));
    });
    requisicao.on("response", (resposta) => {
      resposta.resume();
      resume(Effect.succeed(resposta.statusCode ?? 0));
    });
    requisicao.on("error", (erro) => resume(Effect.die(erro)));
    requisicao.end();
    return Effect.sync(() => requisicao.destroy());
  });

const CORPO_INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "0" } },
});

/** Um `initialize` MCP por POST: o status da resposta. */
export const postarInitialize = (url: string, cabecalhos: Readonly<Record<string, string>>) =>
  Effect.callback<number>((resume) => {
    const requisicao = NodeHttp.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...cabecalhos,
      },
    });
    requisicao.on("response", (resposta) => {
      resposta.resume();
      resume(Effect.succeed(resposta.statusCode ?? 0));
    });
    requisicao.on("error", (erro) => resume(Effect.die(erro)));
    requisicao.end(CORPO_INITIALIZE);
    return Effect.sync(() => requisicao.destroy());
  });
