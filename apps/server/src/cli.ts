/**
 * A CLI do servidor local (`effect/cli`), carregada pelo `bin.ts` fora do caminho rápido da ponte MCP.
 *
 *   node apps/server/src/bin.ts --banco tmp/kb.sqlite [--porta 0] [--porta-mcp 0] [--pasta-estado <dir>]
 *        [--origem app://simplifica]… [--canal dev|beta|estavel] [--pasta-skills <dir>] [--pasta-trabalhos <dir>]
 *        [--pasta-atualizacao <dir>] [--feed-atualizacao <url>] [--chave-atualizacao <base64>] [--versao-app 0.2.0]
 *
 * Com `--pasta-atualizacao` (M1.10), antes de abrir a base, o servidor atende a troca pendente na pasta
 * (`prepararAbertura`) e abre a base mais nova entre a baixada e a do `--banco` (a empacotada); depois,
 * confere o feed da política na abertura e a cada 24 h.
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
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { lerEstado, prepararAbertura } from "@simplifica-if/atualizacao/local";
import { layerHttp, opcoesDaPolitica } from "@simplifica-if/atualizacao/remoto";
import { LinhaPartida, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
import { CANAIS } from "@simplifica-if/kb/canal";
import { POLITICA_FABRICA } from "@simplifica-if/motor/politica";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import { expandHomePath, fixPath } from "@simplifica-if/motor/t3/os-jank";
import { SUBCOMANDO_PONTE } from "./constantes.ts";
import * as Partida from "./partida.ts";
import { comandoPonte } from "./ponte.ts";
import * as Banco from "./persistencia/Banco.ts";
import * as Servidor from "./servidor.ts";
import { awaitLauncherLoss } from "./t3/launcherWatch.ts";

const VERSAO = "0.2.0";

const codificarLinha = Schema.encodeEffect(Schema.fromJsonString(LinhaPartida));

/** A pasta de estado padrão: a do app em cada sistema. Não pode ficar num repositório (guarda o login do Antigravity). */
const pastaEstadoPadrao = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  return (yield* HostProcess.Platform) === "darwin"
    ? path.join(home, "Library", "Application Support", "simplifica-if")
    : path.join(home, ".simplifica-if");
});

/**
 * A pasta de skills quando nem `--pasta-skills` nem `SIMPLIFICA_SKILLS` a dão: no desenvolvimento
 * (este módulo rodando do código-fonte, `apps/server/src/cli.ts`), o `.agents/skills` do checkout; no
 * bundle do app, nenhuma (o desktop passa `<Resources>/skills`).
 */
const pastaSkillsPadrao = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const aqui = import.meta.filename;
  if (aqui === undefined || path.basename(aqui) !== "cli.ts") return undefined;
  const pasta = path.resolve(path.dirname(aqui), "..", "..", "..", ".agents", "skills");
  return (yield* fs.exists(pasta).pipe(Effect.orElseSucceed(() => false))) ? pasta : undefined;
});

/** A raiz das pastas de tarefa: `Documentos/Simplifica IF` (o desktop passa a do sistema). */
const pastaTrabalhosPadrao = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* HostProcess.HomeDirectory, "Documents", "Simplifica IF");
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
      Flag.withDescription(
        "pasta do app: conversas (conversas.sqlite), CLIs gerenciadas e perfil do Antigravity (ou SIMPLIFICA_ESTADO)",
      ),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ESTADO")),
      Flag.optional,
    ),
    origens: Flag.String("origem").pipe(
      Flag.withDescription("origem de navegador aceita no WebSocket (repetível)"),
      Flag.atLeast(0),
    ),
    canal: Flag.Literals("canal", CANAIS).pipe(
      Flag.withDescription("canal da base quando o banco não registra um"),
      Flag.withDefault("dev"),
    ),
    pastaSkills: Flag.String("pasta-skills").pipe(
      Flag.withDescription(
        "pasta das skills do app (as com bloco simplifica: no SKILL.md); padrão no desenvolvimento: .agents/skills do checkout (ou SIMPLIFICA_SKILLS)",
      ),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_SKILLS")),
      Flag.optional,
    ),
    pastaTrabalhos: Flag.String("pasta-trabalhos").pipe(
      Flag.withDescription(
        "raiz das pastas de tarefa; padrão: Documents/Simplifica IF na pasta pessoal (ou SIMPLIFICA_TRABALHOS)",
      ),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_TRABALHOS")),
      Flag.optional,
    ),
    pastaAtualizacao: Flag.String("pasta-atualizacao").pipe(
      Flag.withDescription(
        "liga a atualização da base e das skills, gravando nesta pasta (a do app); sem ela, a base é só a do --banco (ou SIMPLIFICA_ATUALIZACAO_PASTA)",
      ),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_PASTA")),
      Flag.optional,
    ),
    feedAtualizacao: Flag.String("feed-atualizacao").pipe(
      Flag.withDescription("feed no lugar do da política, com {canal} (ou SIMPLIFICA_ATUALIZACAO_FEED)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_FEED")),
      Flag.optional,
    ),
    chaveAtualizacao: Flag.String("chave-atualizacao").pipe(
      Flag.withDescription(
        "chave pública minisign no lugar da da política, a linha base64 (ou SIMPLIFICA_ATUALIZACAO_CHAVE)",
      ),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_CHAVE")),
      Flag.optional,
    ),
    versaoApp: Flag.String("versao-app").pipe(
      Flag.withDescription("versão do app, comparada ao app_minimo do manifesto"),
      Flag.withDefault(VERSAO),
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
      const bancoDado = path.resolve(yield* expandHomePath(opcoes.banco));
      const pastaAtualizacao = Option.getOrUndefined(opcoes.pastaAtualizacao);
      const atualizacao =
        pastaAtualizacao === undefined
          ? undefined
          : yield* montarAtualizacao({
              pasta: path.resolve(yield* expandHomePath(pastaAtualizacao)),
              bancoEmpacotado: bancoDado,
              feed: Option.getOrUndefined(opcoes.feedAtualizacao),
              chave: Option.getOrUndefined(opcoes.chaveAtualizacao),
              versaoApp: opcoes.versaoApp,
            });
      if (atualizacao !== undefined) {
        for (const evento of atualizacao.abertura.eventos) yield* Effect.logInfo(`atualização: ${evento}`);
        if (atualizacao.desligada !== null) yield* Effect.logInfo(`atualização desligada: ${atualizacao.desligada}`);
      }
      const banco = atualizacao?.abertura.banco ?? bancoDado;
      const pastaSkillsDada = Option.getOrUndefined(opcoes.pastaSkills);
      const pastaSkills =
        pastaSkillsDada === undefined ? yield* pastaSkillsPadrao : path.resolve(yield* expandHomePath(pastaSkillsDada));
      const pastaTrabalhos = path.resolve(
        yield* expandHomePath(Option.getOrUndefined(opcoes.pastaTrabalhos) ?? (yield* pastaTrabalhosPadrao)),
      );
      const httpProxy = ambiente.HTTP_PROXY ?? ambiente.http_proxy;
      const httpsProxy = ambiente.HTTPS_PROXY ?? ambiente.https_proxy;
      const noProxy = ambiente.NO_PROXY ?? ambiente.no_proxy;
      const proxyAmbiente = {
        ...(httpProxy ? { httpProxy } : {}),
        ...(httpsProxy ? { httpsProxy } : {}),
        ...(noProxy ? { noProxy } : {}),
      };
      const drivers = Drivers.layerNode({
        ambiente,
        pastaEstado,
        // A ponte do Antigravity é este mesmo executável, como o `acp-mcp-bridge` do T3: no app
        // empacotado, o Electron (como Node) e o bundle do servidor.
        ponteMcp: yield* comandoPonte(),
        // Respeita a proxy do ambiente (a que o desktop resolve e passa ao servidor).
        http: layerHttp(proxyAmbiente),
      });
      const contexto = yield* Layer.build(
        Servidor.layer({
          banco,
          token: partida.token,
          ...(partida.tokenDesktop === undefined ? {} : { tokenDesktop: partida.tokenDesktop }),
          porta: opcoes.porta,
          portaMcp: opcoes.portaMcp,
          origens: [...opcoes.origens, ...partida.origens],
          // A base da fábrica não grava canal (o canal é do manifesto): com a atualização ligada, o
          // carimbo das respostas usa o canal escolhido em "Atualizações".
          canal:
            atualizacao === undefined || opcoes.canal !== "dev"
              ? opcoes.canal
              : ((yield* lerEstado(atualizacao.pasta)).canal ?? atualizacao.canalPadrao),
          bancoConversas: path.join(pastaEstado, Banco.ARQUIVO_BANCO),
          pastaTrabalhos,
          ...(pastaSkills === undefined ? {} : { pastaSkills }),
          ...(atualizacao === undefined ? {} : { atualizacao }),
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

/**
 * As opções da atualização: a troca pendente atendida agora (antes de abrir a base), o feed e a chave da
 * política ou dos argumentos, e o motivo quando falta um deles.
 */
const montarAtualizacao = Effect.fn("cli.montarAtualizacao")(function* (entrada: {
  readonly pasta: string;
  readonly bancoEmpacotado: string;
  readonly feed: string | undefined;
  readonly chave: string | undefined;
  readonly versaoApp: string;
}) {
  const politica = POLITICA_FABRICA.atualizacao;
  const abertura = yield* prepararAbertura({ pasta: entrada.pasta, bancoEmpacotado: entrada.bancoEmpacotado });
  const { desligada, feed, chave } = opcoesDaPolitica({
    feed: entrada.feed ?? politica.feed,
    chave: entrada.chave ?? politica.chavePublica,
  });
  return {
    desligada,
    feed,
    chave,
    canalPadrao: politica.canal,
    pasta: entrada.pasta,
    bancoEmpacotado: entrada.bancoEmpacotado,
    versaoApp: entrada.versaoApp,
    abertura,
  } satisfies Servidor.OpcoesAtualizacao;
});

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
