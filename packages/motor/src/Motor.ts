/**
 * O motor de conversa do Simplifica IF: sessões com Claude, Codex (ChatGPT) ou Antigravity (Gemini),
 * com o `simplifica-mcp` entregue por sessão e eventos iguais para os três.
 *
 * Cada sessão vive num `Scope` próprio; `encerrar` o fecha, e o processo do provider morre junto.
 * A política (`politica.ts`, a de fábrica por padrão) vale para todas as sessões: os providers
 * permitidos, a busca web e as aprovações por tipo de ferramenta, que os drivers aplicam pelo `Canal`.
 * As skills da sessão se gravam na pasta de trabalho e entram nas instruções (`skills.ts`).
 * Ao fim da layer, as sessões abertas se encerram. Com `resultados` num servidor MCP HTTP, o resumo
 * vazio das ferramentas dele é completado com o que o servidor viu (`resultados.ts`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
  FalhaProvider,
  OperacaoNaoSuportada,
  type SessaoDriver,
  type TurnoEmAndamento,
} from "./Driver.ts";
import { SessaoDesconhecida } from "./erros.ts";
import type { Evento, Provider } from "./eventos.ts";
import { buscaWebLigada, type Politica, POLITICA_FABRICA } from "./politica.ts";
import * as Resultados from "./resultados.ts";
import * as Skills from "./skills.ts";

export * from "./Driver.ts";
export * from "./eventos.ts";
export * from "./politica.ts";

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

const make = Effect.fnUntraced(function* (politica: Politica) {
  const drivers = yield* Drivers;
  // Só as sessões com skills gravam arquivos: sem `FileSystem` na layer, elas falham com mensagem clara.
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
  const path = yield* Effect.serviceOption(Path.Path);
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

  const iniciarSessao = Effect.fn("Motor.iniciarSessao")(function* (pedida: ConfigSessao) {
    if (!politica.providers.includes(pedida.provider)) {
      return yield* new FalhaProvider({
        provider: pedida.provider,
        operacao: "iniciar",
        detalhe: "a política do app não permite este provider",
      });
    }
    let pastaSkills = "";
    if (pedida.skills !== undefined && pedida.skills.length > 0) {
      if (Option.isNone(fs) || Option.isNone(path)) {
        return yield* new FalhaProvider({
          provider: pedida.provider,
          operacao: "skills",
          detalhe: "o motor não tem acesso ao sistema de arquivos para gravar as skills",
        });
      }
      pastaSkills = yield* Skills.gravarSkills(pedida).pipe(
        Effect.provideService(FileSystem.FileSystem, fs.value),
        Effect.provideService(Path.Path, path.value),
      );
    }
    const separador = Option.isSome(path) ? path.value.sep : "/";
    const instrucoes = Skills.instrucoesSessao(pedida, pastaSkills, separador);
    const config: ConfigSessao = {
      ...pedida,
      buscaWeb: buscaWebLigada(politica, pedida.buscaWeb),
      ...(instrucoes === undefined ? {} : { instrucoes }),
    };
    const escopo = yield* Scope.make();
    const driver = yield* drivers[config.provider].iniciar(config, politica).pipe(
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

/** O motor sobre os drivers do ambiente (`Drivers.layerNode` ou drivers de teste), com a política de fábrica. */
export const layer = Layer.effect(Motor, make(POLITICA_FABRICA));

/** O motor com outra política (testes; no futuro, a da máquina, que só restringe a de fábrica). */
export const layerComPolitica = (politica: Politica) => Layer.effect(Motor, make(politica));
