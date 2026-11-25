/**
 * A conexão da interface com o servidor local: o cliente `effect/rpc` do `GrupoApp` sobre WebSocket, com
 * reconexão automática e o estado à vista.
 *
 * Segue o desenho da sessão RPC do T3 (`packages/client-runtime/src/rpc/session.ts`): o protocolo não
 * reabre o socket sozinho (`retryTransientErrors: false`, sem nova tentativa), os `ConnectionHooks`
 * avisam quando ele abriu e quando caiu, e quem está fora (aqui, o laço de `make`) monta uma conexão
 * nova. É preciso que seja assim porque o ingresso vale uma conexão só: cada volta do laço pede as
 * credenciais (no desktop, de novo à ponte), compra um ingresso novo e abre outro socket.
 *
 * As chamadas feitas enquanto a conexão está fora esperam a próxima (`cliente`). As que estavam em
 * andamento quando ela caiu falham com `RpcClientError`; a conversa continua gravada no servidor e
 * volta a ser acompanhada (`conversa.acompanhar`) na reconexão.
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";
import { GrupoApp } from "@simplifica-if/contratos-app";
import type { CredenciaisServidor } from "@simplifica-if/contratos-app/ponte";
import { comprarIngresso, FalhaConexao, type MotivoFalha, urlRpc } from "./ingresso.ts";
import type { OrigemConexao } from "./origem.ts";

export const criarCliente = RpcClient.make(GrupoApp);
/** O cliente do `GrupoApp`: `cliente["providers.detectar"]({ provider })`, `cliente.fichaNorma({ id })`… */
export type ClienteApp = typeof criarCliente extends Effect.Effect<infer C, infer _E, infer _R> ? C : never;

export type EstadoConexao =
  /** Abrindo a conexão; `tentativa` conta as falhas seguidas antes desta. */
  | { readonly fase: "conectando"; readonly tentativa: number }
  | { readonly fase: "conectada" }
  /** A última tentativa falhou; a próxima sai em `proximaEm` (milissegundos da época Unix). */
  | {
      readonly fase: "reconectando";
      readonly tentativa: number;
      readonly motivo: MotivoFalha;
      readonly proximaEm: number;
    }
  /** Sem credenciais: nem desktop, nem `?servidor=…&token=…`. */
  | { readonly fase: "sem-servidor" };

/** Sem quadros do servidor por este tempo, a conexão é dada como caída (o ping sai a cada 5 s). */
export const PRAZO_PING = Duration.seconds(15);
/** Quanto o WebSocket tem para abrir. */
export const PRAZO_ABERTURA = Duration.seconds(10);

/** A espera antes da tentativa `n` (1, 2, 3…): 0,5 s, 1 s, 2 s, 4 s, 8 s e depois 10 s. */
export function atrasoReconexao(tentativa: number): number {
  return Math.min(500 * 2 ** Math.max(0, tentativa - 1), 10_000);
}

export interface OpcoesConexao {
  /** A espera antes de cada nova tentativa (padrão: `atrasoReconexao`). */
  readonly atraso?: (tentativa: number) => number;
}

export class Conexao extends Context.Service<
  Conexao,
  {
    /** O estado da conexão; `SubscriptionRef.changes` dá o atual e as mudanças. */
    readonly estado: SubscriptionRef.SubscriptionRef<EstadoConexao>;
    /** O cliente da conexão aberta; sem conexão, espera a próxima. */
    readonly cliente: Effect.Effect<ClienteApp>;
    /** Antecipa a próxima tentativa, sem esperar o atraso. */
    readonly reconectarAgora: Effect.Effect<void>;
  }
>()("@simplifica-if/web/conexao/Conexao") {}

/** As credenciais da origem, a cada conexão. */
const credenciaisDe = (origem: Exclude<OrigemConexao, { tipo: "ausente" }>) =>
  origem.tipo === "navegador"
    ? Effect.succeed(origem.credenciais)
    : Effect.tryPromise({
        try: () => origem.ponte.conexao(),
        catch: (erro) => new FalhaConexao({ motivo: "ponte", detalhe: String(erro) }),
      });

/**
 * Uma conexão: compra o ingresso, abre o socket e devolve o cliente e o efeito que termina quando o
 * socket cair. Vive no escopo de quem chama; fechá-lo fecha o socket.
 */
const abrir = Effect.fn("Conexao.abrir")(function* (credenciais: CredenciaisServidor) {
  const { ingresso } = yield* comprarIngresso(credenciais);
  const abriu = yield* Deferred.make<void>();
  const caiu = yield* Deferred.make<void>();
  const ganchos = RpcClient.ConnectionHooks.of({
    onConnect: Deferred.succeed(abriu, undefined).pipe(Effect.asVoid),
    onDisconnect: Deferred.succeed(caiu, undefined).pipe(Effect.asVoid),
  });
  const protocolo = yield* Layer.build(
    Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        pingTimeout: PRAZO_PING,
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          Socket.layerWebSocket(urlRpc(credenciais.urlServidor, ingresso), { openTimeout: PRAZO_ABERTURA }),
          RpcSerialization.layerJson,
          Layer.succeed(RpcClient.ConnectionHooks, ganchos),
        ),
      ),
    ),
  );
  const cliente = yield* criarCliente.pipe(Effect.provide(protocolo));
  const aberta = yield* Deferred.await(abriu).pipe(
    Effect.as(true),
    Effect.raceFirst(Deferred.await(caiu).pipe(Effect.as(false))),
  );
  if (!aberta) return yield* new FalhaConexao({ motivo: "conexao-caiu" });
  return { cliente, caiu: Deferred.await(caiu) };
});

/** O motivo de uma volta do laço que terminou: o da `FalhaConexao` ou, num defeito, a conexão caída. */
function motivoDa(causa: Cause.Cause<FalhaConexao>): MotivoFalha {
  const erro = Cause.findError(causa);
  return Result.isSuccess(erro) ? erro.success.motivo : "conexao-caiu";
}

export const make = Effect.fn("Conexao.make")(function* (origem: OrigemConexao, opcoes: OpcoesConexao = {}) {
  const atraso = opcoes.atraso ?? atrasoReconexao;
  const estado = yield* SubscriptionRef.make<EstadoConexao>(
    origem.tipo === "ausente" ? { fase: "sem-servidor" } : { fase: "conectando", tentativa: 0 },
  );
  const atual = yield* SubscriptionRef.make<ClienteApp | undefined>(undefined);
  const acordar = yield* Ref.make(yield* Deferred.make<void>());

  const cliente: Effect.Effect<ClienteApp> = Effect.suspend(() => {
    const aberto = SubscriptionRef.getUnsafe(atual);
    if (aberto !== undefined) return Effect.succeed(aberto);
    return SubscriptionRef.changes(atual).pipe(
      Stream.filter((valor): valor is ClienteApp => valor !== undefined),
      Stream.runHead,
      Effect.flatMap((valor) => (Option.isSome(valor) ? Effect.succeed(valor.value) : Effect.never)),
    );
  });

  const reconectarAgora = Ref.get(acordar).pipe(
    Effect.flatMap((deferred) => Deferred.succeed(deferred, undefined)),
    Effect.asVoid,
  );

  if (origem.tipo !== "ausente") {
    /** Uma volta: conecta, publica o cliente e espera a queda. Só termina com falha. */
    const volta = (aoConectar: Effect.Effect<void>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { cliente: novo, caiu } = yield* abrir(yield* credenciaisDe(origem));
          yield* aoConectar;
          yield* SubscriptionRef.set(atual, novo);
          yield* SubscriptionRef.set(estado, { fase: "conectada" });
          yield* caiu;
          return yield* new FalhaConexao({ motivo: "conexao-caiu" });
        }),
      ).pipe(Effect.ensuring(SubscriptionRef.set(atual, undefined)));

    const laco = Effect.gen(function* () {
      let falhas = 0;
      while (true) {
        const motivo = yield* volta(Effect.sync(() => (falhas = 0))).pipe(
          Effect.catchCauseIf(
            (causa) => !Cause.hasInterruptsOnly(causa),
            (causa) => Effect.succeed(motivoDa(causa)),
          ),
        );
        falhas += 1;
        const espera = atraso(falhas);
        const sinal = yield* Deferred.make<void>();
        yield* Ref.set(acordar, sinal);
        const agora = yield* Clock.currentTimeMillis;
        yield* SubscriptionRef.set(estado, {
          fase: "reconectando",
          tentativa: falhas,
          motivo,
          proximaEm: agora + espera,
        });
        yield* Deferred.await(sinal).pipe(Effect.timeoutOption(Duration.millis(espera)));
        yield* SubscriptionRef.set(estado, { fase: "conectando", tentativa: falhas });
      }
    });
    yield* Effect.forkScoped(laco);
  }

  return Conexao.of({ estado, cliente, reconectarAgora });
});

/** A conexão da origem, sem as plataformas (pede `HttpClient` e `Socket.WebSocketConstructor`). */
export const layer = (origem: OrigemConexao, opcoes?: OpcoesConexao) => Layer.effect(Conexao, make(origem, opcoes));

/** A conexão com o `fetch` e o `WebSocket` globais (o navegador, o Electron e o Node). */
export const layerGlobal = (origem: OrigemConexao, opcoes?: OpcoesConexao) =>
  layer(origem, opcoes).pipe(
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, Socket.layerWebSocketConstructorGlobal)),
  );
