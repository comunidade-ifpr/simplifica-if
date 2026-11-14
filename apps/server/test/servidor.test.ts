/**
 * O servidor local de verdade, em portas efêmeras de `127.0.0.1`, com drivers falsos no motor e o banco
 * de fixture: a autenticação do WebSocket (token, `Host`, `Origin`), o cliente `effect/rpc` (o mesmo
 * que a interface vai usar) nos três grupos, a conversa com pedido de aprovação respondido pelo RPC, e
 * o MCP HTTP ligado a cada sessão com token próprio, revogado ao encerrar.
 *
 * Sem os serviços de teste (`excludeTestServices`), como o teste HTTP do MCP: o cliente sobre
 * WebSocket usa o relógio (prazo de abertura e ping), que no `TestClock` não anda.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { CAMINHO_INGRESSO, Ingresso, PARAMETRO_INGRESSO } from "@simplifica-if/contratos-app";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  DCN_2021,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  pedirHttp,
  pedirUpgrade,
  postarInitialize,
  type Registro,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const ORIGEM = "app://simplifica";
const registro: Registro = { configs: [], encerradas: 0 };
const pasta = diretorioTemporario("simplifica-servidor-");

/** Curta, para o teste da conexão que cai; a do app é `Conversas.TOLERANCIA_ORFA`. */
const TOLERANCIA_ORFA = Duration.millis(200);

const camada = Servidor.layer({
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  origens: [ORIGEM],
  toleranciaOrfa: TOLERANCIA_ORFA,
}).pipe(Layer.provide(layerDriversFalsos(registro)), Layer.provide(NodeServices.layer));

const decodificarIngresso = Schema.decodeEffect(Schema.fromJsonString(Ingresso));

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

layer(camada, { excludeTestServices: true })("servidor local", (it) => {
  it.effect("sobe em portas efêmeras e informa as URLs do RPC e do MCP", () =>
    Effect.gen(function* () {
      const app = yield* Servidor.ServidorApp;
      assert.isAbove(app.porta, 0);
      assert.strictEqual(app.urlRpc, `ws://127.0.0.1:${app.porta}/rpc`);
      assert.match(app.urlMcp, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      assert.notStrictEqual(app.urlMcp, `http://127.0.0.1:${app.porta}/mcp`);
    }),
  );

  it.effect("recusa o upgrade sem credencial, com credencial errada, com Host ou Origin de fora", () =>
    Effect.gen(function* () {
      const { urlRpc, porta } = yield* Servidor.ServidorApp;
      assert.strictEqual(yield* pedirUpgrade(urlRpc, {}), 401);
      assert.strictEqual(yield* pedirUpgrade(urlRpc, { authorization: `Bearer ${TOKEN}x` }), 401);
      assert.strictEqual(yield* pedirUpgrade(`${urlRpc}?${PARAMETRO_INGRESSO}=errado`, {}), 401);
      // O token nunca vale na URL: o navegador usa o ingresso.
      assert.strictEqual(yield* pedirUpgrade(`${urlRpc}?token=${TOKEN}`, { origin: ORIGEM }), 401);
      assert.strictEqual(yield* pedirUpgrade(urlRpc, { ...AUTORIZACAO, host: `rebinding.example:${porta}` }), 403);
      assert.strictEqual(yield* pedirUpgrade(urlRpc, { ...AUTORIZACAO, origin: "https://site.example" }), 403);
      // O que passa: o cabeçalho, com ou sem a origem do app; `localhost` também.
      assert.strictEqual(yield* pedirUpgrade(urlRpc, AUTORIZACAO), 101);
      assert.strictEqual(yield* pedirUpgrade(urlRpc, { ...AUTORIZACAO, origin: ORIGEM }), 101);
      assert.strictEqual(yield* pedirUpgrade(urlRpc, { ...AUTORIZACAO, host: `localhost:${porta}` }), 101);
    }),
  );

  it.effect("ingresso: o token compra um ingresso, que abre uma conexão só", () =>
    Effect.gen(function* () {
      const { urlRpc, porta } = yield* Servidor.ServidorApp;
      const urlIngresso = `http://127.0.0.1:${porta}${CAMINHO_INGRESSO}`;
      const comprar = (cabecalhos: Record<string, string>) => pedirHttp(urlIngresso, { metodo: "POST", cabecalhos });

      // Sem token, com token errado, de outra origem ou outro Host: nada de ingresso.
      assert.strictEqual((yield* comprar({ origin: ORIGEM })).status, 401);
      assert.strictEqual((yield* comprar({ authorization: "Bearer errado" })).status, 401);
      assert.strictEqual((yield* comprar({ ...AUTORIZACAO, origin: "https://site.example" })).status, 403);
      assert.strictEqual((yield* comprar({ ...AUTORIZACAO, host: `rebinding.example:${porta}` })).status, 403);

      // O CORS do navegador: o preflight só responde à origem do app.
      const preflight = yield* pedirHttp(urlIngresso, { metodo: "OPTIONS", cabecalhos: { origin: ORIGEM } });
      assert.strictEqual(preflight.status, 204);
      assert.strictEqual(preflight.cabecalhos["access-control-allow-origin"], ORIGEM);
      assert.include(String(preflight.cabecalhos["access-control-allow-headers"]), "authorization");
      // O HttpClient do Effect na interface manda o `traceparent` (e o `b3`) no POST.
      assert.include(String(preflight.cabecalhos["access-control-allow-headers"]), "traceparent");
      const alheio = yield* pedirHttp(urlIngresso, {
        metodo: "OPTIONS",
        cabecalhos: { origin: "https://site.example" },
      });
      assert.strictEqual(alheio.status, 403);

      const resposta = yield* comprar({ ...AUTORIZACAO, origin: ORIGEM });
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.cabecalhos["access-control-allow-origin"], ORIGEM);
      const { ingresso } = yield* decodificarIngresso(resposta.corpo);
      assert.notInclude(ingresso, TOKEN);
      const comIngresso = `${urlRpc}?${PARAMETRO_INGRESSO}=${encodeURIComponent(ingresso)}`;
      assert.strictEqual(yield* pedirUpgrade(comIngresso, { origin: "https://site.example" }), 403);
      assert.strictEqual(yield* pedirUpgrade(comIngresso, { origin: ORIGEM }), 101);
      // Gasto: não abre a segunda conexão.
      assert.strictEqual(yield* pedirUpgrade(comIngresso, { origin: ORIGEM }), 401);

      // O cliente RPC do navegador, com um ingresso novo.
      const novo = yield* comprar({ ...AUTORIZACAO, origin: ORIGEM });
      const segundo = yield* decodificarIngresso(novo.corpo);
      const c = yield* cliente(`${urlRpc}?${PARAMETRO_INGRESSO}=${encodeURIComponent(segundo.ingresso)}`, {
        origin: ORIGEM,
      });
      assert.strictEqual((yield* c["providers.detectar"]({ provider: "claude" })).provider, "claude");
    }).pipe(Effect.scoped),
  );

  it.effect("o cliente RPC sem token ou com token errado não chega a chamar", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      for (const cabecalhos of [undefined, { authorization: "Bearer errado" }]) {
        const saida = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const c = yield* cliente(urlRpc, cabecalhos);
              return yield* c["providers.detectar"]({ provider: "claude" });
            }),
          ),
        );
        assert.isTrue(Exit.isFailure(saida));
      }
    }),
  );

  it.effect("providers.detectar responde pelo RPC", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const c = yield* cliente(urlRpc, AUTORIZACAO);
      const estado = yield* c["providers.detectar"]({ provider: "antigravity" });
      assert.deepStrictEqual(estado, {
        provider: "antigravity",
        instalado: true,
        autenticado: true,
        versao: "0.0.0-teste",
        plano: "teste",
      });
      // O driver falso não tem instalação gerenciada: o erro tipado chega ao cliente.
      const instalar = yield* Effect.exit(Stream.runCollect(c["providers.instalar"]({ provider: "claude" })));
      assert.isTrue(Exit.isFailure(instalar));
      assert.include(JSON.stringify(instalar), "OperacaoNaoSuportada");
    }).pipe(Effect.scoped),
  );

  it.effect("conversa: inicia com o MCP ifpr, recebe os eventos e responde à aprovação pelo RPC", () =>
    Effect.gen(function* () {
      const { urlRpc, urlMcp } = yield* Servidor.ServidorApp;
      const c = yield* cliente(urlRpc, AUTORIZACAO);
      const { sessao } = yield* c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta });

      // A sessão recebeu um ServidorMcp HTTP do servidor, com token próprio, que o MCP aceita.
      const config = registro.configs.at(-1);
      assert.isDefined(config);
      assert.strictEqual(config?.servidoresMcp.length, 1);
      const mcp = config?.servidoresMcp[0];
      assert.strictEqual(mcp?.tipo, "http");
      if (mcp?.tipo !== "http") return;
      assert.strictEqual(mcp.nome, "ifpr");
      assert.strictEqual(mcp.url, urlMcp);
      assert.isTrue(mcp.preAprovado);
      assert.isDefined(mcp.resultados);
      assert.match(mcp.cabecalhos?.Authorization ?? "", /^Bearer \S{32,}$/);
      assert.notInclude(mcp.cabecalhos?.Authorization ?? "", TOKEN);
      assert.strictEqual(yield* postarInitialize(mcp.url, mcp.cabecalhos ?? {}), 200);
      assert.strictEqual(yield* postarInitialize(mcp.url, {}), 401);

      const eventos = yield* c["conversa.enviar"]({ sessao, texto: "olá" }).pipe(
        Stream.tap((evento) =>
          evento._tag === "PedidoAprovacao"
            ? c["conversa.responderAprovacao"]({ sessao, aprovacao: evento.id, decisao: "permitir" })
            : Effect.void,
        ),
        Stream.runCollect,
      );
      assert.deepStrictEqual(
        eventos.map((evento) => evento._tag),
        ["TextoParcial", "FerramentaIniciada", "PedidoAprovacao", "FerramentaConcluida", "TextoFinal", "FimTurno"],
      );
      assert.deepInclude(eventos[3], { falhou: false, resumo: "permitir" });

      // Aprovação que não existe: erro tipado.
      const desconhecida = yield* Effect.exit(
        c["conversa.responderAprovacao"]({ sessao, aprovacao: "nada", decisao: "negar" }),
      );
      assert.include(JSON.stringify(desconhecida), "AprovacaoDesconhecida");

      yield* c["conversa.interromper"]({ sessao });
      const antes = registro.encerradas;
      yield* c["conversa.encerrar"]({ sessao });
      assert.strictEqual(registro.encerradas, antes + 1);
      // Encerrada a sessão, o token do MCP deixa de valer, e a sessão não existe mais.
      assert.strictEqual(yield* postarInitialize(mcp.url, mcp.cabecalhos ?? {}), 401);
      const depois = yield* Effect.exit(c["conversa.encerrar"]({ sessao }));
      assert.include(JSON.stringify(depois), "SessaoDesconhecida");
    }).pipe(Effect.scoped),
  );

  it.effect("conversa: quando a conexão cai, a conversa se encerra depois da tolerância", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const antes = registro.encerradas;
      const encerrou = Effect.callback<void>((resume) => {
        registro.aoEncerrar = () => resume(Effect.void);
        return Effect.sync(() => (registro.aoEncerrar = undefined));
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const c = yield* cliente(urlRpc, AUTORIZACAO);
          yield* c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta });
        }),
      );
      // O cliente fechou o WebSocket: o `onDisconnect` do servidor deixa a conversa órfã.
      assert.strictEqual(registro.encerradas, antes);
      yield* encerrou.pipe(Effect.timeout(Duration.seconds(5)));
      assert.strictEqual(registro.encerradas, antes + 1);
    }),
  );

  it.effect("conversa: recusa a pasta inválida e entrega a falha do provider sem o cause", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const c = yield* cliente(urlRpc, AUTORIZACAO);
      for (const pastaTrabalho of ["relativa", `${pasta}/nao-existe`]) {
        const saida = yield* Effect.flip(c["conversa.iniciar"]({ provider: "claude", pastaTrabalho }));
        assert.strictEqual(saida._tag, "PastaTrabalhoInvalida");
      }
      const falha = yield* Effect.flip(c["conversa.iniciar"]({ provider: "codex", pastaTrabalho: pasta }));
      assert.strictEqual(falha._tag, "FalhaProvider");
      if (falha._tag !== "FalhaProvider") return;
      assert.strictEqual(falha.detalhe, "falha de teste");
      assert.isUndefined(falha.cause);
    }).pipe(Effect.scoped),
  );

  it.effect("leitura: o GrupoLeitura responde pelo mesmo RPC, com os links ifpr://", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const c = yield* cliente(urlRpc, AUTORIZACAO);
      const ficha = yield* c.fichaNorma({ id: DCN_2021 });
      assert.include(JSON.stringify(ficha), `ifpr://norma/${DCN_2021}`);
      // O leitor `ifpr://` da interface: um link qualquer, resolvido como o `resources/read` do MCP.
      const lido = yield* c.lerLink({ link: `ifpr://norma/${DCN_2021}` });
      assert.strictEqual(lido.tipo, "norma");
      assert.include(lido.texto, DCN_2021);
      const invalido = yield* Effect.flip(c.lerLink({ link: "https://exemplo" }));
      assert.strictEqual(invalido._tag, "EntradaInvalida");
      assert.isDefined(yield* c.sobreABase({}));
    }).pipe(Effect.scoped),
  );
});
