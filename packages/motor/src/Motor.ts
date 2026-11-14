/**
 * O motor de conversa do Simplifica IF: sessões com Claude, Codex (ChatGPT) ou Antigravity (Gemini),
 * com o `simplifica-mcp` entregue por sessão e eventos iguais para os três.
 *
 * Cada sessão vive num `Scope` próprio; `encerrar` o fecha, e o processo do provider morre junto.
 * Ao fim da layer, as sessões abertas se encerram. Com `resultados` num servidor MCP HTTP, o resumo
 * vazio das ferramentas dele é completado com o que o servidor viu (`resultados.ts`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  type AprovacaoDesconhecida,
  type ConfigSessao,
  type Decisao,
  Drivers,
  type EstadoInstalacao,
  type EstadoLogin,
  type EstadoProvider,
  type FalhaProvider,
  OperacaoNaoSuportada,
  type SessaoDriver,
  type TurnoEmAndamento,
} from "./Driver.ts";
import { SessaoDesconhecida } from "./erros.ts";
import type { Evento, Provider } from "./eventos.ts";
import * as Resultados from "./resultados.ts";

export * from "./Driver.ts";
export * from "./eventos.ts";

export class Motor extends Context.Service<
  Motor,
  {
    readonly detectar: (provider: Provider) => Effect.Effect<EstadoProvider>;
    readonly iniciarSessao: (config: ConfigSessao) => Effect.Effect<string, FalhaProvider>;
    readonly enviarMensagem: (
      sessao: string,
      texto: string,
    ) => Stream.Stream<Evento, FalhaProvider | TurnoEmAndamento | SessaoDesconhecida>;
    readonly responderAprovacao: (
      sessao: string,
      idAprovacao: string,
      decisao: Decisao,
    ) => Effect.Effect<void, SessaoDesconhecida | AprovacaoDesconhecida>;
    readonly interromper: (sessao: string) => Effect.Effect<void, SessaoDesconhecida | FalhaProvider>;
    readonly encerrar: (sessao: string) => Effect.Effect<void, SessaoDesconhecida>;
    /** Instala ou atualiza a CLI gerenciada (Codex, Antigravity); termina numa fase final. */
    readonly instalar: (provider: Provider) => Stream.Stream<EstadoInstalacao, FalhaProvider | OperacaoNaoSuportada>;
    /**
     * Login dentro do app (Antigravity, no perfil próprio). Em `aguardando`, o estado traz a `url`
     * que o app abre no navegador; termina numa fase final.
     */
    readonly entrar: (provider: Provider) => Stream.Stream<EstadoLogin, FalhaProvider | OperacaoNaoSuportada>;
  }
>()("@simplifica-if/motor/Motor") {}

interface SessaoAberta {
  readonly driver: SessaoDriver;
  readonly escopo: Scope.Closeable;
  /** Completa o resumo das ferramentas MCP com o que o servidor do app viu (`resultados.ts`). */
  readonly completar: Resultados.Completar;
}

const make = Effect.gen(function* () {
  const drivers = yield* Drivers;
  const sessoes = new Map<string, SessaoAberta>();
  let sequencia = 0;

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...sessoes.values()], (sessao) => Scope.close(sessao.escopo, Exit.void), { discard: true }),
  );

  const buscar = (id: string) =>
    Effect.suspend(() => {
      const sessao = sessoes.get(id);
      return sessao === undefined ? Effect.fail(new SessaoDesconhecida({ id })) : Effect.succeed(sessao);
    });

  const iniciarSessao = Effect.fn("Motor.iniciarSessao")(function* (config: ConfigSessao) {
    const escopo = yield* Scope.make();
    const driver = yield* drivers[config.provider].iniciar(config).pipe(
      Scope.provide(escopo),
      Effect.onError(() => Scope.close(escopo, Exit.void)),
    );
    const completar = yield* Resultados.completador(config).pipe(Scope.provide(escopo));
    const id = `${config.provider}-${++sequencia}`;
    sessoes.set(id, { driver, escopo, completar });
    return id;
  });

  const encerrar = Effect.fn("Motor.encerrar")(function* (id: string) {
    const sessao = yield* buscar(id);
    sessoes.delete(id);
    yield* Scope.close(sessao.escopo, Exit.void);
  });

  const detectar = Effect.fn("Motor.detectar")(function* (provider: Provider) {
    const driver = drivers[provider];
    const deteccao = yield* driver.detectar;
    return {
      ...deteccao,
      podeInstalar: driver.instalar !== undefined,
      podeEntrar: driver.entrar !== undefined,
    } satisfies EstadoProvider;
  });

  const responderAprovacao = Effect.fn("Motor.responderAprovacao")(function* (
    id: string,
    idAprovacao: string,
    decisao: Decisao,
  ) {
    const sessao = yield* buscar(id);
    yield* sessao.driver.responder(idAprovacao, decisao);
  });

  const interromper = Effect.fn("Motor.interromper")(function* (id: string) {
    const sessao = yield* buscar(id);
    yield* sessao.driver.interromper;
  });

  return Motor.of({
    detectar,
    iniciarSessao,
    enviarMensagem: (id, texto) =>
      Stream.unwrap(Effect.map(buscar(id), (sessao) => sessao.completar(sessao.driver.enviar(texto)))),
    responderAprovacao,
    interromper,
    encerrar,
    instalar: (provider) =>
      drivers[provider].instalar ?? Stream.fail(new OperacaoNaoSuportada({ provider, operacao: "instalação" })),
    entrar: (provider) =>
      drivers[provider].entrar ?? Stream.fail(new OperacaoNaoSuportada({ provider, operacao: "login" })),
  });
});

/** O motor sobre os drivers do ambiente (`Drivers.layerNode` ou drivers de teste). */
export const layer = Layer.effect(Motor, make);
