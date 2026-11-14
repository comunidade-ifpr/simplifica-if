/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa) e o
 * `Leitura` do `simplifica-mcp` (leitura, os mesmos handlers de `@simplifica-if/mcp/rpc`).
 *
 * Os métodos de conversa passam ao `Conversas` o cliente RPC que chama (`client.id`, um por conexão):
 * é ele o dono da conversa, e a conversa de um cliente que caiu se encerra depois da tolerância.
 *
 * O `FalhaProvider` chega à interface sem o `cause`, que pode trazer a pilha e caminhos do computador;
 * o erro inteiro vai para o log do servidor (stderr).
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { GrupoConversa, GrupoProviders } from "@simplifica-if/contratos-app";
import { layerHandlersRpc } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Conversas from "./Conversas.ts";

const ehFalhaProvider = Schema.is(Motor.FalhaProvider);

/** O erro como vai à interface: o `FalhaProvider` sem o `cause`. */
const paraInterface = <E>(erro: E): E =>
  ehFalhaProvider(erro)
    ? (new Motor.FalhaProvider({ provider: erro.provider, operacao: erro.operacao, detalhe: erro.detalhe }) as E)
    : erro;

const registrarEMapear = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(
    Effect.tapError((erro) => Effect.logWarning("RPC falhou", erro)),
    Effect.mapError(paraInterface),
  );

const registrarEMapearStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.tapError((erro) => Effect.logWarning("RPC falhou", erro)),
    Stream.mapError(paraInterface),
  );

const layerProviders = GrupoProviders.toLayer(
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    return GrupoProviders.of({
      "providers.detectar": ({ provider }) => motor.detectar(provider),
      "providers.instalar": ({ provider }) => registrarEMapearStream(motor.instalar(provider)),
      "providers.entrar": ({ provider }) => registrarEMapearStream(motor.entrar(provider)),
    });
  }),
);

const layerConversa = GrupoConversa.toLayer(
  Effect.gen(function* () {
    const conversas = yield* Conversas.Conversas;
    return GrupoConversa.of({
      "conversa.iniciar": (entrada, { client }) =>
        registrarEMapear(conversas.iniciar(client.id, entrada)).pipe(Effect.map((sessao) => ({ sessao }))),
      "conversa.enviar": ({ sessao, texto }, { client }) =>
        registrarEMapearStream(conversas.enviar(client.id, sessao, texto)),
      "conversa.responderAprovacao": ({ sessao, aprovacao, decisao }, { client }) =>
        conversas.responderAprovacao(client.id, sessao, aprovacao, decisao),
      "conversa.interromper": ({ sessao }, { client }) => registrarEMapear(conversas.interromper(client.id, sessao)),
      "conversa.encerrar": ({ sessao }) => conversas.encerrar(sessao),
    });
  }),
);

/** Os handlers dos três grupos; pede o `Motor`, as `Conversas` e o `Leitura`. */
export const layer = Layer.mergeAll(layerProviders, layerConversa, layerHandlersRpc);
