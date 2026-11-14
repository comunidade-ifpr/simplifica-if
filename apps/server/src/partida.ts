// @effect-diagnostics nodeBuiltinImport:off -- lê o stdin do processo pai linha a linha (node:readline)
/**
 * A partida do servidor: de onde vem o token do RPC e quando o processo pai sumiu.
 *
 * - **Token:** pela variável `SIMPLIFICA_SERVIDOR_TOKEN` ou pela primeira linha do stdin, um
 *   `EnvelopePartida` em JSON (`{ "token": "…", "origens": […] }`), como o `DesktopBackendBootstrap` que
 *   o desktop do T3 escreve no fd 3 ou no stdin do servidor. Nunca pela linha de comando, que outros
 *   processos da máquina leem (`ps`).
 * - **Cordão:** com o token pelo stdin, o stdin fica aberto e é o cordão do pai: quando ele fecha (o
 *   pai fechou o pipe ou morreu), o servidor se encerra. Junto, como o T3 (`launcherWatch.ts`), o
 *   servidor se encerra se o processo pai mudar (o desktop morreu e o servidor foi adotado).
 */
import * as NodeReadline from "node:readline";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { EnvelopePartida, TAMANHO_MINIMO_TOKEN, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";

/** Quanto o servidor espera pelo envelope no stdin. */
export const PRAZO_ENVELOPE = "5 seconds";

export class PartidaInvalida extends Schema.TaggedError<PartidaInvalida>()("PartidaInvalida", {
  motivo: Schema.String,
}) {
  override get message(): string {
    return `partida do servidor: ${this.motivo}`;
  }
}

export interface Partida {
  readonly token: Redacted.Redacted<string>;
  readonly origens: ReadonlyArray<string>;
  /** `stdin`: o token veio no envelope, e o stdin é o cordão do pai. */
  readonly via: "ambiente" | "stdin";
}

/** O stdin lido linha a linha: a primeira linha (ou nada, se ele fechar antes) e o fim dele. */
export interface Cordao {
  readonly primeiraLinha: Effect.Effect<Option.Option<string>>;
  readonly fim: Effect.Effect<void>;
}

/** Abre o `Cordao` sobre `entrada`; ele fecha com o escopo. */
export const abrirCordao = Effect.fn("partida.abrirCordao")(function* (entrada: NodeJS.ReadableStream) {
  const primeira = Deferred.makeUnsafe<Option.Option<string>>();
  const fim = Deferred.makeUnsafe<void>();
  const fechou = () => {
    Deferred.doneUnsafe(primeira, Effect.succeedNone);
    Deferred.doneUnsafe(fim, Effect.void);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const linhas = NodeReadline.createInterface({ input: entrada, crlfDelay: Infinity });
      // As linhas depois da primeira se descartam: só o fim do stdin importa.
      linhas.on("line", (linha) => Deferred.doneUnsafe(primeira, Effect.succeedSome(linha)));
      linhas.on("close", fechou);
      entrada.on("error", fechou);
      return linhas;
    }),
    (linhas) => Effect.sync(() => linhas.close()),
  );
  return { primeiraLinha: Deferred.await(primeira), fim: Deferred.await(fim) } satisfies Cordao;
});

const decodificarEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(EnvelopePartida));

/**
 * O token e as origens: do `ambiente` (`SIMPLIFICA_SERVIDOR_TOKEN`) ou, sem ele, do envelope na
 * primeira linha do `cordao`. As mensagens de erro nunca trazem o que veio.
 */
export const lerPartida = Effect.fn("partida.lerPartida")(function* (
  ambiente: Readonly<Record<string, string | undefined>>,
  cordao: Cordao,
) {
  const doAmbiente = ambiente[VARIAVEL_TOKEN];
  if (doAmbiente !== undefined && doAmbiente !== "") {
    if (doAmbiente.length < TAMANHO_MINIMO_TOKEN) {
      return yield* new PartidaInvalida({
        motivo: `o token de ${VARIAVEL_TOKEN} precisa de pelo menos ${TAMANHO_MINIMO_TOKEN} caracteres`,
      });
    }
    return { token: Redacted.make(doAmbiente), origens: [], via: "ambiente" } satisfies Partida;
  }
  const linha = yield* cordao.primeiraLinha.pipe(
    Effect.timeoutOrElse({ duration: PRAZO_ENVELOPE, orElse: () => Effect.succeedNone }),
  );
  if (Option.isNone(linha)) {
    return yield* new PartidaInvalida({
      motivo: `sem token: passe ${VARIAVEL_TOKEN} no ambiente ou o envelope JSON na primeira linha do stdin`,
    });
  }
  const envelope = yield* decodificarEnvelope(linha.value).pipe(
    Effect.mapError(
      () =>
        new PartidaInvalida({
          motivo: `a primeira linha do stdin não é um envelope válido ({"token": "<${TAMANHO_MINIMO_TOKEN}+ caracteres>", "origens": […]})`,
        }),
    ),
  );
  return { token: Redacted.make(envelope.token), origens: envelope.origens ?? [], via: "stdin" } satisfies Partida;
});
