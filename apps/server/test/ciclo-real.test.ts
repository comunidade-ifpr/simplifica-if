// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste real: acha e mata o processo do provider pelo `ps`
/**
 * O ciclo de vida da conversa com os providers de verdade, pela assinatura do usuário. Só roda com
 * `SIMPLIFICA_POC_REAL=1` (e `tmp/kb.sqlite` compilado); `SIMPLIFICA_PROVIDER` escolhe um provider
 * (padrão: os três):
 *
 *   SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test ciclo-real
 *
 * As `Conversas` do servidor, no próprio processo, sobre os drivers reais e um banco das conversas
 * temporário, numa pasta de trabalho temporária:
 *
 * 1. **três turnos seguidos** (duas palavras para lembrar e uma ferramenta `ifpr`);
 * 2. **política de fábrica**: um pedido para escrever fora da pasta de trabalho; a política o nega sem
 *    perguntar (nenhum `PedidoAprovacao` chega à conversa) e o arquivo não existe;
 * 3. **interromper no meio do turno**, depois da primeira ferramenta, e um turno novo em seguida;
 * 4. **retomada depois de fechar**: a layer se encerra (o processo do provider morre) e outra, com o
 *    mesmo banco, retoma a conversa, que precisa lembrar a primeira palavra;
 * 5. **queda do processo do provider**: no meio de um turno, o processo (e os filhos dele) leva
 *    SIGKILL; o turno termina com `Erro` e `FimTurno`, a conversa fica `caiu`, e a próxima mensagem a
 *    reabre pela retomada, lembrando a segunda palavra.
 *
 * Os drivers são embrulhados para registrar cada abertura de sessão (nova, retomada ou retomada que
 * falhou), e o teste imprime no stderr os tempos e se a retomada foi a do provider ou o recomeço com
 * o histórico como contexto. A pasta de estado é a do harness do motor (`SIMPLIFICA_ESTADO` ou
 * `~/Library/Application Support/simplifica-if-poc`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { Provider } from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import * as Drivers from "@simplifica-if/motor/drivers";
import * as Conversas from "../src/Conversas.ts";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Historico from "../src/persistencia/Historico.ts";

const REAL = process.env.SIMPLIFICA_POC_REAL === "1";
const PROVIDERS = process.env.SIMPLIFICA_PROVIDER
  ? [Schema.decodeUnknownSync(Provider)(process.env.SIMPLIFICA_PROVIDER)]
  : (["claude", "codex", "antigravity"] as const);
const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const KB = NodePath.join(RAIZ, "tmp/kb.sqlite");
const PASTA_ESTADO =
  process.env.SIMPLIFICA_ESTADO ??
  NodePath.join(
    NodeOS.homedir(),
    process.platform === "darwin" ? "Library/Application Support/simplifica-if-poc" : ".simplifica-if-poc",
  );
const PONTE_MCP = {
  comando: process.execPath,
  argumentos: [NodePath.join(RAIZ, "packages/motor/scripts/ponte-mcp.ts")],
};

/** O nome do executável de cada provider, para achar o processo no `ps`. */
const EXECUTAVEL: Record<Motor.Provider, RegExp> = {
  claude: /(^|\/)claude(\s|$)/,
  codex: /(^|\/)codex(\s|$)|codex.*app-server/,
  antigravity: /(^|\/)(agy|antigravity)(\s|$)/,
};

const PEDIDO_LONGO =
  "Chame a ferramenta sobre_a_base do servidor ifpr. Depois, sem chamar mais ferramentas, escreva um texto " +
  "de umas 1.500 palavras sobre a história da educação profissional no Brasil, em parágrafos.";

/** As aberturas de sessão que os drivers viram. */
interface Abertura {
  readonly retomar: string | undefined;
  readonly resultado: "ok" | "falhou";
  readonly detalhe?: string;
}

/** Os drivers reais, embrulhados para registrar cada abertura de sessão. */
const driversRegistrados = (aberturas: Array<Abertura>) =>
  Layer.effect(
    Motor.Drivers,
    Effect.gen(function* () {
      const reais = yield* Motor.Drivers;
      const embrulhar = (driver: Motor.Driver): Motor.Driver => ({
        ...driver,
        iniciar: (config, politica) =>
          driver.iniciar(config, politica).pipe(
            Effect.tap(() => Effect.sync(() => aberturas.push({ retomar: config.retomar, resultado: "ok" }))),
            Effect.tapError((falha) =>
              Effect.sync(() =>
                aberturas.push({ retomar: config.retomar, resultado: "falhou", detalhe: falha.detalhe }),
              ),
            ),
          ),
      });
      return Motor.Drivers.of({
        claude: embrulhar(reais.claude),
        codex: embrulhar(reais.codex),
        antigravity: embrulhar(reais.antigravity),
      });
    }),
  ).pipe(Layer.provide(Drivers.layerNode({ ambiente: process.env, pastaEstado: PASTA_ESTADO, ponteMcp: PONTE_MCP })));

const camada = (arquivo: string, aberturas: Array<Abertura>) =>
  Conversas.layer().pipe(
    Layer.provideMerge(Motor.layer),
    Layer.provideMerge(Historico.layer),
    Layer.provide(Banco.layerArquivo(arquivo)),
    Layer.provide(McpHttp.layer({ banco: KB })),
    Layer.provide(driversRegistrados(aberturas)),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const abrir = (arquivo: string, aberturas: Array<Abertura>) =>
  Effect.gen(function* () {
    const escopo = yield* Scope.make();
    const contexto = yield* Layer.buildWithScope(camada(arquivo, aberturas), escopo);
    return {
      conversas: Context.get(contexto, Conversas.Conversas),
      motor: Context.get(contexto, Motor.Motor),
      fechar: Scope.close(escopo, Exit.void),
    };
  });

const log = (provider: string, linha: string) => Effect.sync(() => process.stderr.write(`[${provider}] ${linha}\n`));

const textoFinal = (eventos: ReadonlyArray<Motor.Evento>) =>
  eventos.flatMap((evento) => (evento._tag === "TextoFinal" ? [evento.texto] : [])).join("\n");

const erros = (eventos: ReadonlyArray<Motor.Evento>) =>
  eventos.flatMap((evento) => (evento._tag === "Erro" ? [evento.mensagem] : []));

/** Os processos descendentes deste, pelo `ps`: `[pid, ppid, comando]`. */
function descendentes(): Array<{ pid: number; ppid: number; comando: string }> {
  const linhas = NodeChildProcess.execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((linha) => {
      const partes = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(linha);
      return partes ? [{ pid: Number(partes[1]), ppid: Number(partes[2]), comando: partes[3]! }] : [];
    });
  const saida: typeof linhas = [];
  const fila = [process.pid];
  while (fila.length > 0) {
    const pai = fila.shift()!;
    for (const filho of linhas.filter((linha) => linha.ppid === pai)) {
      saida.push(filho);
      fila.push(filho.pid);
    }
  }
  return saida;
}

/** Mata com SIGKILL o processo do provider (o mais alto que casa com o executável) e os filhos dele. */
function matarProvider(provider: Motor.Provider): string {
  const todos = descendentes();
  const alvo = todos.find((processo) => EXECUTAVEL[provider].test(processo.comando));
  if (alvo === undefined) throw new Error(`processo do ${provider} não encontrado entre os filhos do teste`);
  const subarvore = [alvo.pid];
  for (let i = 0; i < subarvore.length; i++) {
    for (const filho of todos.filter((processo) => processo.ppid === subarvore[i])) subarvore.push(filho.pid);
  }
  for (const pid of subarvore) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // já saiu
    }
  }
  return `${alvo.comando.slice(0, 80)} (pid ${alvo.pid}, ${subarvore.length} processo(s))`;
}

describe.skipIf(!REAL)("ciclo de vida da conversa com providers reais", () => {
  for (const provider of PROVIDERS) {
    it.live(
      `${provider}: três turnos, interromper, retomada depois de fechar e queda do processo`,
      () =>
        Effect.gen(function* () {
          assert.isTrue(NodeFS.existsSync(KB), "falta tmp/kb.sqlite: rode pnpm kb:compilar");
          const pasta = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-ciclo-")));
          const arquivo = NodePath.join(pasta, ".estado", "conversas.sqlite");
          const aberturas: Array<Abertura> = [];
          const cronometro = Effect.map(Clock.currentTimeMillis, (inicio) =>
            Effect.map(Clock.currentTimeMillis, (agora) => ((agora - inicio) / 1000).toFixed(1)),
          );

          /** Os pedidos de aprovação que chegaram à conversa (todos negados pelo teste). */
          const pedidos: Array<string> = [];

          /** Um turno inteiro, com o tempo; um pedido de aprovação que chegue é negado. */
          const turno = (conversas: Conversas.Conversas["Service"], id: string, texto: string, rotulo: string) =>
            Effect.gen(function* () {
              const tempo = yield* cronometro;
              const eventos = [
                ...(yield* Stream.runCollect(
                  conversas
                    .enviar(id, texto)
                    .pipe(
                      Stream.tap((evento) =>
                        evento._tag === "PedidoAprovacao"
                          ? Effect.sync(() => pedidos.push(evento.ferramenta)).pipe(
                              Effect.andThen(conversas.responderAprovacao(id, evento.id, "negar")),
                              Effect.ignore,
                            )
                          : Effect.void,
                      ),
                    ),
                )),
              ];
              const fim = eventos.at(-1);
              yield* log(
                provider,
                `${rotulo}: ${yield* tempo} s, ${eventos.length} eventos, fim ${fim?._tag === "FimTurno" ? fim.motivo : "?"}` +
                  `${erros(eventos).length ? `, erros: ${erros(eventos).join(" | ")}` : ""}; resposta: ${textoFinal(eventos).replace(/\s+/g, " ").slice(0, 100)}`,
              );
              return eventos;
            });

          /** Um turno longo, com `acao` depois da primeira ferramenta concluída. */
          const turnoComAcao = (
            conversas: Conversas.Conversas["Service"],
            id: string,
            rotulo: string,
            acao: Effect.Effect<void, Motor.SessaoDesconhecida | Motor.FalhaProvider>,
          ) =>
            Effect.gen(function* () {
              const tempo = yield* cronometro;
              const marco = yield* Deferred.make<void>();
              const fibra = yield* conversas.enviar(id, PEDIDO_LONGO).pipe(
                Stream.tap((evento) =>
                  evento._tag === "FerramentaConcluida" || evento._tag === "TextoParcial"
                    ? Deferred.succeed(marco, undefined)
                    : Effect.void,
                ),
                Stream.runCollect,
                Effect.forkChild,
              );
              yield* Deferred.await(marco);
              const tempoAcao = yield* tempo;
              const depoisDaAcao = yield* cronometro;
              yield* acao;
              const eventos = [...(yield* Fiber.join(fibra))];
              const fim = eventos.at(-1);
              yield* log(
                provider,
                `${rotulo}: ação aos ${tempoAcao} s, turno fechado ${yield* depoisDaAcao} s depois, fim ${fim?._tag === "FimTurno" ? fim.motivo : "?"}` +
                  `${erros(eventos).length ? `, erros: ${erros(eventos).join(" | ")}` : ""}`,
              );
              return eventos;
            });

          // 1. Três turnos seguidos.
          const primeiro = yield* abrir(arquivo, aberturas);
          const tempoInicio = yield* cronometro;
          const id = yield* primeiro.conversas.iniciar({ provider, pastaTrabalho: pasta });
          yield* log(provider, `sessão aberta em ${yield* tempoInicio} s`);
          for (const [palavra, rotulo] of [
            ["abacaxi", "turno 1"],
            ["laranja", "turno 2"],
          ] as const) {
            const eventos = yield* turno(
              primeiro.conversas,
              id,
              `Responda apenas com a palavra ${palavra}, sem usar ferramentas.`,
              rotulo,
            );
            assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
            assert.deepStrictEqual(erros(eventos), []);
            assert.match(textoFinal(eventos).toLowerCase(), new RegExp(palavra));
          }
          const terceiro = yield* turno(
            primeiro.conversas,
            id,
            "Chame a ferramenta sobre_a_base do servidor ifpr e diga só a data de referência da base.",
            "turno 3 (ferramenta ifpr)",
          );
          assert.isTrue(terceiro.some((e) => e._tag === "FerramentaIniciada" && e.nome.startsWith("ifpr.")));
          assert.strictEqual(terceiro.at(-1)?._tag, "FimTurno");

          // 2. A política nega sem perguntar a escrita fora da pasta de trabalho.
          const fora = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-fora-")));
          const alvo = NodePath.join(fora, "fora.txt");
          const negado = yield* turno(
            primeiro.conversas,
            id,
            `Crie o arquivo ${alvo} com o conteúdo ok, usando a sua ferramenta de escrever arquivos. ` +
              "Se não for possível, diga em uma frase por quê, sem tentar outro caminho.",
            "escrita fora da pasta (política)",
          );
          assert.strictEqual(negado.at(-1)?._tag, "FimTurno");
          assert.isFalse(NodeFS.existsSync(alvo), "o arquivo fora da pasta não pode existir");
          assert.deepStrictEqual(pedidos, [], "a política nega sem perguntar");

          // 3. Interromper no meio do turno; a conversa aceita o turno seguinte.
          const interrompido = yield* turnoComAcao(
            primeiro.conversas,
            id,
            "interromper",
            primeiro.conversas.interromper(id),
          );
          assert.strictEqual(interrompido.at(-1)?._tag, "FimTurno");
          const depoisDeInterromper = yield* turno(
            primeiro.conversas,
            id,
            "Responda apenas com a palavra ok.",
            "turno depois de interromper",
          );
          assert.strictEqual(depoisDeInterromper.at(-1)?._tag, "FimTurno");
          assert.deepStrictEqual(erros(depoisDeInterromper), []);

          // 4. Retomada depois de fechar: outra layer, o mesmo banco.
          yield* primeiro.fechar;
          const segundo = yield* abrir(arquivo, aberturas);
          const lembrou = yield* turno(
            segundo.conversas,
            id,
            "Qual foi a primeira palavra que eu pedi para você responder nesta conversa? Responda só a palavra.",
            "retomada depois de fechar",
          );
          const nativa = aberturas.at(-1)?.retomar !== undefined;
          yield* log(
            provider,
            `retomada depois de fechar: ${nativa ? "nativa (id do provider)" : `recomeço com o histórico (${aberturas.at(-2)?.detalhe ?? "sem id"})`}`,
          );
          assert.match(textoFinal(lembrou).toLowerCase(), /abacaxi/);

          // 5. Queda do processo do provider no meio do turno.
          let morto = "";
          const caido = yield* turnoComAcao(
            segundo.conversas,
            id,
            "queda",
            Effect.sync(() => {
              morto = matarProvider(provider);
            }),
          );
          yield* log(provider, `processo morto: ${morto}`);
          assert.deepStrictEqual(caido.at(-1), { _tag: "FimTurno", motivo: "falha" });
          assert.isAbove(erros(caido).length, 0);
          const estado = (yield* segundo.conversas.listar).find((conversa) => conversa.id === id)?.estado;
          assert.strictEqual(estado, "caiu");
          const reaberta = yield* turno(
            segundo.conversas,
            id,
            "Qual foi a segunda palavra que eu pedi para você responder nesta conversa? Responda só a palavra.",
            "depois da queda",
          );
          const nativaQueda = aberturas.at(-1)?.retomar !== undefined;
          yield* log(provider, `retomada depois da queda: ${nativaQueda ? "nativa" : "recomeço com o histórico"}`);
          assert.match(textoFinal(reaberta).toLowerCase(), /laranja/);
          yield* segundo.fechar;
          yield* log(provider, `aberturas: ${JSON.stringify(aberturas)}`);
          if (provider !== "antigravity") {
            assert.isTrue(nativa && nativaQueda, "a retomada do provider deveria ter funcionado");
          }
        }),
      900_000,
    );
  }
});
