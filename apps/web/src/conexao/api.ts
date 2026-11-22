/**
 * A ponte entre a `Conexao` (Effect) e a interface (React, promessas e callbacks): chamar um método do
 * RPC, acompanhar um stream e observar o estado da conexão. Os erros tipados do servidor chegam como o
 * próprio valor do erro (`FalhaProvider`, `PastaTrabalhoInvalida`…), com `message` em português, e
 * todo erro leva o código do pedido (`marcarCodigo`), que `explicarErro` mostra.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { codigoDoErro } from "@simplifica-if/contratos-app/ponte";
import { type ClienteApp, Conexao, type EstadoConexao } from "./Conexao.ts";
import { marcarCodigo } from "./erros.ts";

export interface Acompanhamento {
  /** Termina quando o stream acaba (`"concluido"`) ou é cancelado (`"cancelado"`); rejeita com o erro. */
  readonly fim: Promise<"concluido" | "cancelado">;
  readonly cancelar: () => void;
}

export interface Api {
  /** Chama o servidor com o cliente da conexão aberta (ou da próxima). */
  readonly chamar: <A, E>(chamada: (cliente: ClienteApp) => Effect.Effect<A, E>) => Promise<A>;
  /** Acompanha um stream do servidor, item a item. */
  readonly acompanhar: <A, E>(
    fluxo: (cliente: ClienteApp) => Stream.Stream<A, E>,
    aoItem: (item: A) => void,
  ) => Acompanhamento;
  readonly estado: {
    readonly obter: () => EstadoConexao;
    /** Avisa a cada mudança; devolve a função que para de avisar. */
    readonly observar: (aviso: () => void) => () => void;
  };
  readonly reconectarAgora: () => void;
}

/** O erro de uma saída com falha: o erro tipado, se houver, ou o defeito. */
export function erroDaCausa<E>(causa: Cause.Cause<E>): unknown {
  const erro = Cause.findError(causa);
  return Result.isSuccess(erro) ? erro.success : Cause.squash(causa);
}

/**
 * O valor da chamada, ou o erro dela com o código do pedido. Só interrupção (o runtime encerrando) não é
 * erro do pedido: sai sem código.
 */
export function valorDaSaida<A, E>(saida: Exit.Exit<A, E>, codigo: string): A {
  if (Exit.isSuccess(saida)) return saida.value;
  if (Cause.hasInterruptsOnly(saida.cause)) throw erroDaCausa(saida.cause);
  throw marcarCodigo(erroDaCausa(saida.cause), codigo);
}

/**
 * Roda a chamada num span da interface e devolve a saída com o código do pedido (`codigoDoErro`): o span
 * do `RpcClient` é filho deste, e o do handler no servidor é filho dele, todos com o mesmo `traceId`.
 */
const comCodigo = <A, E>(efeito: Effect.Effect<A, E>) =>
  Effect.withSpan(
    Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
      Effect.map(Effect.exit(efeito), (saida) => ({ saida, codigo: codigoDoErro(span.traceId) })),
    ),
    "interface.chamar",
  );

export const criarApi = (runtime: ManagedRuntime.ManagedRuntime<Conexao, never>): Promise<Api> =>
  runtime.runPromise(Effect.service(Conexao)).then((conexao): Api => {
    const chamar = <A, E>(chamada: (cliente: ClienteApp) => Effect.Effect<A, E>) =>
      runtime
        .runPromise(comCodigo(Effect.flatMap(conexao.cliente, chamada)))
        .then(({ saida, codigo }) => valorDaSaida(saida, codigo));

    const acompanhar = <A, E>(fluxo: (cliente: ClienteApp) => Stream.Stream<A, E>, aoItem: (item: A) => void) => {
      const fibra = runtime.runFork(
        comCodigo(
          Effect.flatMap(conexao.cliente, (cliente) =>
            Stream.runForEach(fluxo(cliente), (item) => Effect.sync(() => aoItem(item))),
          ),
        ),
      );
      const fim = runtime.runPromise(Fiber.await(fibra)).then((resultado) => {
        if (Exit.isFailure(resultado)) {
          if (Cause.hasInterruptsOnly(resultado.cause)) return "cancelado" as const;
          throw erroDaCausa(resultado.cause);
        }
        const { saida, codigo } = resultado.value;
        if (Exit.isSuccess(saida)) return "concluido" as const;
        if (Cause.hasInterruptsOnly(saida.cause)) return "cancelado" as const;
        throw marcarCodigo(erroDaCausa(saida.cause), codigo);
      });
      return { fim, cancelar: () => void runtime.runFork(Fiber.interrupt(fibra)) };
    };

    const observar = (aviso: () => void) => {
      const fibra = runtime.runFork(
        Stream.runForEach(SubscriptionRef.changes(conexao.estado), () => Effect.sync(aviso)),
      );
      return () => void runtime.runFork(Fiber.interrupt(fibra));
    };

    return {
      chamar,
      acompanhar,
      estado: { obter: () => SubscriptionRef.getUnsafe(conexao.estado), observar },
      reconectarAgora: () => void runtime.runFork(conexao.reconectarAgora),
    };
  });
