/**
 * A conexão da interface com o `apps/server` de verdade (drivers de demonstração): o ingresso, o
 * cliente RPC sobre WebSocket, as recusas e a reconexão automática com um ingresso novo quando o
 * servidor cai e volta na mesma porta.
 *
 * Sem os serviços de teste: o WebSocket e o `fetch` usam o relógio de verdade (prazo de abertura, ping).
 */
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Socket from "effect/socket/Socket";
import * as Servidor from "@simplifica-if/server";
import * as Conexao from "../src/conexao/Conexao.ts";
import { comprarIngresso, PRAZO_INGRESSO, urlRpc } from "../src/conexao/ingresso.ts";
import { layerServidor, limparTemporarios, TOKEN, urlServidor } from "./apoio.ts";

afterAll(limparTemporarios);

const PRAZO = Duration.seconds(10);

/** Espera a conexão chegar à fase dada. */
const esperarFase = (conexao: Conexao.Conexao["Service"], fase: Conexao.EstadoConexao["fase"]) =>
  SubscriptionRef.changes(conexao.estado).pipe(
    Stream.filter((estado) => estado.fase === fase),
    Stream.runHead,
    Effect.timeout(PRAZO),
  );

describe("comprarIngresso", () => {
  it.effect("sem resposta no prazo, falha como indisponível (e o laço tenta de novo)", () =>
    Effect.gen(function* () {
      const compra = yield* Effect.forkChild(
        Effect.flip(comprarIngresso({ urlServidor: "http://127.0.0.1:1", token: TOKEN })),
      );
      yield* TestClock.adjust(PRAZO_INGRESSO);
      const falha = yield* Fiber.join(compra);
      assert.strictEqual(falha.motivo, "indisponivel");
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.never),
        ),
      ),
    ),
  );
});

describe("urlRpc", () => {
  it("monta o WebSocket do RPC com o ingresso na URL", () => {
    assert.strictEqual(urlRpc("http://127.0.0.1:4321", "a+b/c"), "ws://127.0.0.1:4321/rpc?ingresso=a%2Bb%2Fc");
    assert.strictEqual(urlRpc("https://exemplo:8443", "x"), "wss://exemplo:8443/rpc?ingresso=x");
  });
});

layer(layerServidor(), { excludeTestServices: true })("com o servidor local", (it) => {
  it.effect("o token compra um ingresso; um token errado é recusado", () =>
    Effect.gen(function* () {
      const { porta } = yield* Servidor.ServidorApp;
      const { ingresso, expiraEm } = yield* comprarIngresso({ urlServidor: urlServidor(porta), token: TOKEN });
      assert.isAbove(ingresso.length, 20);
      assert.isAbove(expiraEm, 0);
      const recusa = yield* Effect.flip(comprarIngresso({ urlServidor: urlServidor(porta), token: `${TOKEN}x` }));
      assert.strictEqual(recusa.motivo, "token-recusado");
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.effect("conecta pelo ingresso e chama os três grupos do RPC", () =>
    Effect.gen(function* () {
      const { porta } = yield* Servidor.ServidorApp;
      const conexao = yield* Conexao.Conexao;
      yield* esperarFase(conexao, "conectada");
      const cliente = yield* conexao.cliente;
      const claude = yield* cliente["providers.detectar"]({ provider: "claude" });
      assert.deepInclude(claude, { provider: "claude", instalado: true, autenticado: true, plano: "max" });
      const lido = yield* cliente.lerLink({ link: "ifpr://norma/br/cne-cp/res/2021/1" });
      assert.strictEqual(lido.tipo, "norma");
      assert.isAbove(porta, 0);
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.map(Effect.service(Servidor.ServidorApp), ({ porta }) =>
            Conexao.layerGlobal({
              tipo: "navegador",
              fonte: "url",
              credenciais: { urlServidor: urlServidor(porta), token: TOKEN },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("com o token errado, fica tentando e mostra o motivo", () =>
    Effect.gen(function* () {
      const conexao = yield* Conexao.Conexao;
      yield* esperarFase(conexao, "reconectando");
      const atual = yield* SubscriptionRef.get(conexao.estado);
      assert.strictEqual(atual.fase === "reconectando" ? atual.motivo : atual.fase, "token-recusado");
    }).pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.map(Effect.service(Servidor.ServidorApp), ({ porta }) =>
            Conexao.layerGlobal(
              { tipo: "navegador", fonte: "url", credenciais: { urlServidor: urlServidor(porta), token: "errado" } },
              { atraso: () => 60_000 },
            ),
          ),
        ),
      ),
    ),
  );
});

describe("reconexão", () => {
  it.live("quando o servidor cai e volta na mesma porta, reconecta com um ingresso novo", () =>
    Effect.gen(function* () {
      // O primeiro servidor, num escopo que o teste fecha para derrubá-lo.
      const escopoServidor = yield* Scope.make();
      const servidor = yield* Layer.buildWithScope(layerServidor(), escopoServidor);
      const { porta } = Context.get(servidor, Servidor.ServidorApp);

      const conexao = yield* Conexao.make(
        { tipo: "navegador", fonte: "url", credenciais: { urlServidor: urlServidor(porta), token: TOKEN } },
        { atraso: () => 50 },
      );
      yield* esperarFase(conexao, "conectada");
      const primeiro = yield* conexao.cliente;
      assert.strictEqual((yield* primeiro["providers.detectar"]({ provider: "codex" })).instalado, false);

      // O servidor cai: o estado mostra a queda e o cliente some.
      yield* Scope.close(escopoServidor, Exit.void);
      const caiu = yield* esperarFase(conexao, "reconectando");
      assert.isTrue(caiu._tag === "Some");

      // Volta na mesma porta: a conexão se refaz sozinha, com outro ingresso (o primeiro já foi gasto).
      yield* Layer.build(layerServidor({ porta }));
      yield* esperarFase(conexao, "conectada");
      const segundo = yield* conexao.cliente;
      assert.notStrictEqual(segundo, primeiro);
      assert.strictEqual((yield* segundo["providers.detectar"]({ provider: "claude" })).autenticado, true);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal)),
    ),
  );

  it.effect("sem origem, fica em sem-servidor", () =>
    Effect.gen(function* () {
      const conexao = yield* Conexao.make({ tipo: "ausente" });
      assert.deepStrictEqual(yield* SubscriptionRef.get(conexao.estado), { fase: "sem-servidor" });
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal)),
    ),
  );
});
