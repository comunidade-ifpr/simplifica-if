#!/usr/bin/env node
/**
 * O servidor MCP por HTTP local (`src/http.ts`), para teste manual: sobe o servidor em 127.0.0.1,
 * abre uma sessão e imprime no stdout a URL e o cabeçalho `Authorization` dela; no stderr, cada
 * chamada de ferramenta.
 *
 *   node packages/mcp/scripts/servir-http.ts --banco tmp/kb.sqlite [--porta 8765] [--pasta-trabalho .]
 *
 * Fica fora de `src/cli.ts` de propósito: o servidor HTTP do Node traz o `ws`, que o executável SEA
 * do stdio não resolve, e o executável continua igual.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Http from "../src/http.ts";
import { VERSAO_PACOTE } from "../src/servidor.ts";

const comando = Command.make(
  "servir-http",
  {
    banco: Flag.String("banco").pipe(Flag.withDescription("caminho do kb.sqlite")),
    porta: Flag.Int("porta").pipe(
      Flag.withDescription("a porta (padrão: uma livre, escolhida pelo sistema)"),
      Flag.optional,
    ),
    pastaTrabalho: Flag.String("pasta-trabalho").pipe(
      Flag.withDescription("pasta de onde a sessão lê arquivos (padrão: nenhuma)"),
      Flag.optional,
    ),
  },
  Effect.fn("servir-http")(function* ({ banco, porta, pastaTrabalho }) {
    const path = yield* Path.Path;
    const servicos = yield* Layer.build(
      Http.layer({ banco: path.resolve(banco), ...(Option.isSome(porta) ? { porta: porta.value } : {}) }),
    );
    const servidor = Context.get(servicos, Http.ServidorMcpHttp);
    yield* servidor.chamadas.pipe(
      Stream.runForEach((c) =>
        Console.error(`${c.sessao}: ${c.ferramenta} (${c.duracaoMs} ms${c.falhou ? ", com erro" : ""})`),
      ),
      Effect.forkScoped,
    );
    const sessao = yield* servidor.abrirSessao({
      rotulo: "manual",
      ...(Option.isSome(pastaTrabalho) ? { pastaTrabalho: path.resolve(pastaTrabalho.value) } : {}),
    });
    yield* Console.error(`simplifica-mcp ${VERSAO_PACOTE}: servidor HTTP em ${sessao.url}`);
    yield* Console.log(sessao.url);
    for (const [nome, valor] of Object.entries(sessao.cabecalhos)) yield* Console.log(`${nome}: ${valor}`);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(Command.withDescription("Servidor MCP do Simplifica IF por HTTP local, com uma sessão (teste manual)."));

NodeRuntime.runMain(Command.run(comando, { version: VERSAO_PACOTE }).pipe(Effect.provide(NodeServices.layer)));
