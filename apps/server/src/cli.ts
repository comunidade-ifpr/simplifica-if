/**
 * A CLI do servidor local (`effect/cli`), carregada pelo `bin.ts` fora do caminho rápido da ponte MCP.
 *
 *   node apps/server/src/bin.ts --banco tmp/kb.sqlite [--porta 0] [--porta-mcp 0] [--pasta-estado <dir>]
 *        [--origem app://simplifica]… [--canal dev|beta|estavel]
 *
 * O token chega por `SIMPLIFICA_SERVIDOR_TOKEN` ou pelo envelope no stdin (`partida.ts`). Pronto o
 * servidor, a única linha do stdout é a `LinhaPartida` em JSON; os logs vão para o stderr.
 *
 * Encerramento: SIGTERM ou SIGINT (o `NodeRuntime.runMain` interrompe o programa) ou, com o token pelo
 * stdin, o stdin fechado ou o processo pai trocado. Em todos os casos o escopo fecha: o RPC para, as
 * conversas se encerram (o processo de cada provider morre) e o servidor MCP fecha. Depois disso o
 * processo sai, mesmo que sobre algum handle aberto.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { LinhaPartida, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import { expandHomePath, fixPath } from "@simplifica-if/motor/t3/os-jank";
import { SUBCOMANDO_PONTE } from "./constantes.ts";
import * as Partida from "./partida.ts";
import * as Servidor from "./servidor.ts";
import { awaitLauncherLoss } from "./t3/launcherWatch.ts";

const VERSAO = "0.1.0";

const codificarLinha = Schema.encodeEffect(Schema.fromJsonString(LinhaPartida));

/** A pasta de estado padrão: a do app em cada sistema. Não pode ficar num repositório (guarda o login do Antigravity). */
const pastaEstadoPadrao = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  return (yield* HostProcess.Platform) === "darwin"
    ? path.join(home, "Library", "Application Support", "simplifica-if")
    : path.join(home, ".simplifica-if");
});

const servidor = Command.make(
  "simplifica-servidor",
  {
    banco: Flag.String("banco").pipe(
      Flag.withDescription("kb.sqlite servido pelo MCP e pela leitura (ou SIMPLIFICA_KB)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_KB")),
    ),
    porta: Flag.Int("porta").pipe(Flag.withDescription("porta do RPC; 0 escolhe uma livre"), Flag.withDefault(0)),
    portaMcp: Flag.Int("porta-mcp").pipe(
      Flag.withDescription("porta do MCP HTTP; 0 escolhe uma livre"),
      Flag.withDefault(0),
    ),
    pastaEstado: Flag.String("pasta-estado").pipe(
      Flag.withDescription("pasta do app: CLIs gerenciadas e perfil do Antigravity (ou SIMPLIFICA_ESTADO)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ESTADO")),
      Flag.optional,
    ),
    origens: Flag.String("origem").pipe(
      Flag.withDescription("origem de navegador aceita no WebSocket (repetível)"),
      Flag.atLeast(0),
    ),
    canal: Flag.Literals("canal", ["dev", "beta", "estavel"]).pipe(
      Flag.withDescription("canal da base quando o banco não registra um"),
      Flag.withDefault("dev"),
    ),
  },
  (opcoes) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const ambiente = yield* HostProcess.Environment;
      const viaAmbiente = (ambiente[VARIAVEL_TOKEN] ?? "") !== "";
      const cordao = viaAmbiente ? undefined : yield* Partida.abrirCordao(process.stdin);
      const partida = yield* Partida.lerPartida(ambiente, cordao ?? semCordao);
      // O token não passa aos processos dos providers, que herdam o ambiente.
      delete ambiente[VARIAVEL_TOKEN];

      // Como o servidor do T3 (`os-jank.ts`): um app aberto pelo Finder herda um PATH mínimo.
      yield* fixPath();
      const pastaEstado = yield* expandHomePath(
        Option.getOrUndefined(opcoes.pastaEstado) ?? (yield* pastaEstadoPadrao),
      );
      const banco = path.resolve(yield* expandHomePath(opcoes.banco));
      const bin = yield* path.fromFileUrl(new URL("./bin.ts", import.meta.url));
      const drivers = Drivers.layerNode({
        ambiente,
        pastaEstado,
        // A ponte do Antigravity é este mesmo executável, como o `acp-mcp-bridge` do T3.
        ponteMcp: { comando: process.execPath, argumentos: [bin, SUBCOMANDO_PONTE] },
      });
      const contexto = yield* Layer.build(
        Servidor.layer({
          banco,
          token: partida.token,
          porta: opcoes.porta,
          portaMcp: opcoes.portaMcp,
          origens: [...opcoes.origens, ...partida.origens],
          canal: opcoes.canal,
        }).pipe(Layer.provide(drivers)),
      );
      const app = Context.get(contexto, Servidor.ServidorApp);
      const linha = yield* codificarLinha({
        servidor: "simplifica-if",
        pid: process.pid,
        porta: app.porta,
        rpc: app.urlRpc,
        mcp: app.urlMcp,
      });
      yield* Console.log(linha);
      yield* Effect.logInfo(`servidor pronto: RPC ${app.urlRpc}, MCP ${app.urlMcp}, estado em ${pastaEstado}`);

      if (cordao !== undefined) {
        yield* Effect.raceFirst(
          cordao.fim.pipe(Effect.andThen(Effect.logInfo("o stdin do processo pai fechou; encerrando"))),
          awaitLauncherLoss(),
        );
      } else {
        return yield* Effect.never;
      }
    }).pipe(Effect.scoped),
).pipe(
  Command.withDescription(`servidor local do Simplifica IF; \`${SUBCOMANDO_PONTE}\` roda a ponte MCP stdio → HTTP`),
);

/** Sem cordão (token pelo ambiente): não há envelope a ler nem fim a esperar. */
const semCordao: Partida.Cordao = { primeiraLinha: Effect.succeedNone, fim: Effect.never };

/**
 * Roda a CLI. Os erros vão para o stderr, como os logs: o stdout é só da `LinhaPartida`. Termina o
 * processo quando o programa termina, mesmo com algum handle aberto.
 */
export function executar(): void {
  Command.run(servidor, { version: VERSAO }).pipe(
    Effect.tapCause((causa) => (Cause.hasInterruptsOnly(causa) ? Effect.void : Effect.logError(causa))),
    Effect.provide(Layer.mergeAll(NodeServices.layer, Layer.succeed(Logger.LogToStderr, true))),
    NodeRuntime.runMain({
      disableErrorReporting: true,
      teardown: (saida, aoSair) =>
        Runtime.defaultTeardown(saida, (codigo) => {
          aoSair(codigo);
          process.exit(codigo);
        }),
    }),
  );
}
