/**
 * Os handlers do `GrupoApp`: casca fina sobre o `Motor` (providers), as `Conversas` (conversa), o
 * `CatalogoSkills` (skills), a `AnalisePpc` (revisão prévia de PPC) e o `Leitura` do `simplifica-mcp`
 * (leitura, os mesmos handlers de `@simplifica-if/mcp/rpc`).
 *
 * A conversa não pertence à conexão: os métodos de conversa recebem só o id dela (`sessao`), e uma
 * interface que recarrega volta à mesma conversa por `conversa.carregar` e `conversa.acompanhar`.
 *
 * O `FalhaProvider` chega à interface sem o `cause`, que pode trazer a pilha e caminhos do computador;
 * o erro inteiro vai para o log do servidor (stderr).
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { GrupoConversa, GrupoProviders, GrupoRevisaoPpc, GrupoSkills } from "@simplifica-if/contratos-app";
import { layerHandlersRpc } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import { CatalogoSkills } from "./CatalogoSkills.ts";
import * as Conversas from "./Conversas.ts";
import { AnalisePpc } from "./revisao-ppc/AnalisePpc.ts";
import { RevisaoIa } from "./revisao-ppc/RevisaoIa.ts";

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
      "conversa.iniciar": (entrada) =>
        registrarEMapear(conversas.iniciar(entrada)).pipe(Effect.map((sessao) => ({ sessao }))),
      "conversa.enviar": ({ sessao, texto }) => registrarEMapearStream(conversas.enviar(sessao, texto)),
      "conversa.responderAprovacao": ({ sessao, aprovacao, decisao }) =>
        conversas.responderAprovacao(sessao, aprovacao, decisao),
      "conversa.interromper": ({ sessao }) => registrarEMapear(conversas.interromper(sessao)),
      "conversa.encerrar": ({ sessao }) => conversas.encerrar(sessao),
      "conversa.listar": () => conversas.listar,
      "conversa.carregar": ({ sessao }) => conversas.carregar(sessao),
      "conversa.acompanhar": ({ sessao, depois }) => conversas.acompanhar(sessao, depois),
      "conversa.retomar": ({ sessao }) => registrarEMapear(conversas.retomar(sessao)),
    });
  }),
);

const layerSkills = GrupoSkills.toLayer(
  Effect.gen(function* () {
    const catalogo = yield* CatalogoSkills;
    return GrupoSkills.of({ "skills.listar": () => Effect.succeed(catalogo.resumos) });
  }),
);

const layerRevisaoPpc = GrupoRevisaoPpc.toLayer(
  Effect.gen(function* () {
    const analise = yield* AnalisePpc;
    const ia = yield* RevisaoIa;
    const registrar = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
      efeito.pipe(Effect.tapError((erro) => Effect.logWarning("revisão de PPC falhou", erro)));
    return GrupoRevisaoPpc.of({
      "revisaoPpc.analisar": (entrada) => analise.analisar(entrada).pipe(registrar),
      "revisaoPpc.prepararIa": (entrada) => ia.preparar(entrada).pipe(registrar),
      "revisaoPpc.iniciarIa": ({ revisao }) => ia.iniciar(revisao).pipe(registrar),
      "revisaoPpc.pausarIa": ({ revisao }) => ia.pausar(revisao).pipe(registrar),
      "revisaoPpc.acompanharIa": ({ revisao }) => ia.acompanhar(revisao),
      "revisaoPpc.listarIa": () => ia.listar,
      "revisaoPpc.apagarIa": ({ revisao }) => ia.apagar(revisao),
    });
  }),
);

/**
 * Os handlers dos cinco grupos; pede o `Motor`, as `Conversas`, o `CatalogoSkills`, a `AnalisePpc`, a
 * `RevisaoIa` e o `Leitura`.
 */
export const layer = Layer.mergeAll(layerProviders, layerConversa, layerSkills, layerRevisaoPpc, layerHandlersRpc);
