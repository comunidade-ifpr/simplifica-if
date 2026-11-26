/**
 * O motor de conversa do Simplifica IF: sessões com Claude, Codex (ChatGPT) ou Antigravity (Gemini),
 * com o `simplifica-mcp` entregue por sessão e eventos iguais para os três.
 *
 * Cada sessão vive num `Scope` próprio; `encerrar` o fecha, e o processo do provider morre junto.
 * A política (`politica.ts`, a de fábrica por padrão) vale para todas as sessões: os providers
 * permitidos, a busca web e as aprovações por tipo de ferramenta, que os drivers aplicam pelo `Canal`.
 * Uma sessão pode restringi-la (`ConfigSessao.semFerramentas`, `semWeb`), nunca alargá-la.
 * As skills da sessão se gravam na pasta de trabalho e entram nas instruções (`skills.ts`).
 * Ao fim da layer, as sessões abertas se encerram. Com `resultados` num servidor MCP HTTP, o resumo
 * vazio das ferramentas dele é completado com o que o servidor viu (`resultados.ts`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Driver from "./Driver.ts";
import {
  type AprovacaoDesconhecida,
  type ConfigSessao,
  type Decisao,
  type EstadoInstalacao,
  type EstadoLogin,
  type EstadoProvider,
  FalhaProvider,
  OperacaoNaoSuportada,
  type ResultadoAtualizacaoHarness,
  type SessaoDriver,
  type TurnoEmAndamento,
} from "./Driver.ts";
import { SessaoDesconhecida } from "./erros.ts";
import type { Evento, Provider } from "./eventos.ts";
import { buscaWebLigada, type Politica, POLITICA_FABRICA, POLITICA_JULGAMENTO, politicaSemWeb } from "./politica.ts";
import * as Resultados from "./resultados.ts";
import * as Skills from "./skills.ts";

export * from "./Driver.ts";
export * from "./eventos.ts";
export * from "./falhas.ts";
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
    /**
     * O que a sessão tem para durar além do processo: o id nativo para a retomada
     * (`ConfigSessao.retomar`) e a queda do processo do provider (`queda` termina com o motivo; não
     * termina se a sessão se encerra por `encerrar`).
     */
    readonly infoSessao: (sessao: string) => Effect.Effect<InfoSessao, SessaoDesconhecida>;
    /** Instala ou atualiza a CLI gerenciada (Codex, Antigravity); termina numa fase final. */
    readonly instalar: (provider: Provider) => Stream.Stream<EstadoInstalacao, FalhaProvider | OperacaoNaoSuportada>;
    /**
     * Login dentro do app (Antigravity, no perfil próprio). Em `aguardando`, o estado traz a `url`
     * que o app abre no navegador; termina numa fase final.
     */
    readonly entrar: (provider: Provider) => Stream.Stream<EstadoLogin, FalhaProvider | OperacaoNaoSuportada>;
    /** Confere e aplica atualização silenciosa da CLI gerenciada (Codex, Antigravity). */
    readonly atualizarHarness: (provider: Provider) => Effect.Effect<ResultadoAtualizacaoHarness>;
    /**
     * Remove versões antigas da CLI gerenciada em disco (mantendo a ativa e a anterior). Não remove
     * nada enquanto houver sessão aberta desse provider neste motor.
     */
    readonly limparVersoesAntigasHarness: (provider: Provider) => Effect.Effect<number>;
    /**
     * Apaga o que o provider guarda neste computador da conversa `idNativo` (`Driver.esquecer`). Recusa
     * (devolve `false`) se alguma sessão aberta neste motor é dessa conversa. Nunca falha: o motivo vai
     * para o log.
     */
    readonly esquecer: (provider: Provider, idNativo: string, pastaTrabalho: string) => Effect.Effect<boolean>;
  }
>()("@simplifica-if/motor/Motor") {}

/** Ver `Motor.infoSessao`. */
export interface InfoSessao {
  readonly provider: Provider;
  readonly idNativo: string | undefined;
  readonly queda: Effect.Effect<FalhaProvider>;
}

interface SessaoAberta {
  readonly provider: Provider;
  readonly driver: SessaoDriver;
  readonly escopo: Scope.Closeable;
  /** Completa o resumo das ferramentas MCP com o que o servidor do app viu (`resultados.ts`). */
  readonly completar: Resultados.Completar;
}

const make = Effect.fn("Motor.make")(function* (politica: Politica) {
  const drivers = yield* Driver.Drivers;
  // As sessões com skills gravam os arquivos delas na pasta de trabalho.
  const arquivos = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const path = yield* Path.Path;
  const sessoes = new Map<string, SessaoAberta>();
  /** Operações que executam ou instalam a CLI do provider fora de `sessoes` (`iniciarSessao`, `detectar`, `instalar`, `entrar`, `atualizarHarness`). */
  const operacoesAtivas = new Map<Provider, number>();
  let sequencia = 0;

  const entrarOperacao = (provider: Provider) =>
    Effect.sync(() => {
      operacoesAtivas.set(provider, (operacoesAtivas.get(provider) ?? 0) + 1);
    });
  const sairOperacao = (provider: Provider) =>
    Effect.sync(() => {
      const restante = (operacoesAtivas.get(provider) ?? 1) - 1;
      if (restante > 0) operacoesAtivas.set(provider, restante);
      else operacoesAtivas.delete(provider);
    });
  const comOperacaoAtiva = <A, E, R>(provider: Provider, efeito: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      entrarOperacao(provider),
      () => efeito,
      () => sairOperacao(provider),
    );
  const comStreamOperacaoAtiva = <A, E, R>(provider: Provider, stream: Stream.Stream<A, E, R>) =>
    Stream.unwrap(
      Effect.acquireRelease(entrarOperacao(provider), () => sairOperacao(provider)).pipe(Effect.as(stream)),
    );

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
      // A política do app não permite este provider.
      return yield* new FalhaProvider({ provider: pedida.provider, operacao: "iniciar", tipo: "desconhecido" });
    }
    if (pedida.semFerramentas === true && (pedida.servidoresMcp.length > 0 || (pedida.skills?.length ?? 0) > 0)) {
      // Uma sessão sem ferramentas não recebe MCP nem skills.
      return yield* new FalhaProvider({ provider: pedida.provider, operacao: "iniciar", tipo: "mcp" });
    }
    // A sessão só restringe a política do app: a de julgamento nega tudo, e `semWeb` desliga a web.
    const politicaSessao =
      pedida.semFerramentas === true
        ? POLITICA_JULGAMENTO
        : pedida.semWeb === true
          ? politicaSemWeb(politica)
          : politica;
    if ((pedida.skillsRetiradas?.length ?? 0) > 0) {
      yield* Skills.apagarSkillsRetiradas(pedida).pipe(Effect.provideContext(arquivos));
    }
    let pastaSkills = "";
    if (pedida.skills !== undefined && pedida.skills.length > 0) {
      pastaSkills = yield* Skills.gravarSkills(pedida).pipe(Effect.provideContext(arquivos));
    }
    const instrucoes = Skills.instrucoesSessao(pedida, pastaSkills, path.sep, { web: buscaWebLigada(politicaSessao) });
    const config: ConfigSessao = {
      ...pedida,
      ...(instrucoes === undefined ? {} : { instrucoes }),
    };
    const escopo = yield* Scope.make();
    return yield* comOperacaoAtiva(
      config.provider,
      Effect.gen(function* () {
        const driver = yield* drivers[config.provider].iniciar(config, politicaSessao).pipe(
          Scope.provide(escopo),
          Effect.onError(() => Scope.close(escopo, Exit.void)),
        );
        const completar = yield* Resultados.completador(config).pipe(Scope.provide(escopo));
        const id = `${config.provider}-${++sequencia}`;
        sessoes.set(id, { provider: config.provider, driver, escopo, completar });
        return id;
      }),
    );
  });

  const encerrar = Effect.fn("Motor.encerrar")(function* (id: string) {
    const sessao = yield* buscar(id);
    sessoes.delete(id);
    yield* Scope.close(sessao.escopo, Exit.void);
  });

  const detectar = Effect.fn("Motor.detectar")(function* (provider: Provider) {
    const driver = drivers[provider];
    const deteccao = yield* comOperacaoAtiva(provider, driver.detectar);
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

  const infoSessao = Effect.fn("Motor.infoSessao")(function* (id: string) {
    const sessao = yield* buscar(id);
    return {
      provider: sessao.provider,
      idNativo: sessao.driver.idNativo,
      queda: sessao.driver.queda ?? Effect.never,
    } satisfies InfoSessao;
  });

  const atualizarHarness = Effect.fn("Motor.atualizarHarness")(function* (provider: Provider) {
    if (!politica.providers.includes(provider)) {
      return { status: "ignorado", motivo: "desligada" } satisfies ResultadoAtualizacaoHarness;
    }
    const atualizar = drivers[provider].atualizarHarness;
    if (atualizar === undefined) {
      return { status: "ignorado", motivo: "nao-suportado" } satisfies ResultadoAtualizacaoHarness;
    }
    return yield* comOperacaoAtiva(provider, atualizar);
  });

  const limparVersoesAntigasHarness = Effect.fn("Motor.limparVersoesAntigasHarness")(function* (provider: Provider) {
    if ((operacoesAtivas.get(provider) ?? 0) > 0) return 0;
    for (const sessao of sessoes.values()) {
      if (sessao.provider === provider) return 0;
    }
    const limpar = drivers[provider].limparVersoesAntigas;
    if (limpar === undefined) return 0;
    return yield* limpar;
  });

  const esquecer = Effect.fn("Motor.esquecer")(function* (provider: Provider, idNativo: string, pasta: string) {
    for (const sessao of sessoes.values()) {
      if (sessao.provider === provider && sessao.driver.idNativo === idNativo) return false;
    }
    const apagar = drivers[provider].esquecer;
    if (apagar === undefined) return false;
    return yield* comOperacaoAtiva(provider, apagar(idNativo, pasta));
  });

  return Motor.of({
    esquecer,
    detectar,
    infoSessao,
    iniciarSessao,
    enviarMensagem: (id, texto) =>
      Stream.unwrap(Effect.map(buscar(id), (sessao) => sessao.completar(sessao.driver.enviar(texto)))),
    responderAprovacao,
    interromper,
    encerrar,
    instalar: (provider) => {
      const instalar = drivers[provider].instalar;
      return instalar === undefined
        ? Stream.fail(new OperacaoNaoSuportada({ provider, operacao: "instalação" }))
        : comStreamOperacaoAtiva(provider, instalar);
    },
    entrar: (provider) => {
      const entrar = drivers[provider].entrar;
      return entrar === undefined
        ? Stream.fail(new OperacaoNaoSuportada({ provider, operacao: "login" }))
        : comStreamOperacaoAtiva(provider, entrar);
    },
    atualizarHarness,
    limparVersoesAntigasHarness,
  });
});

/**
 * O motor sobre os drivers do ambiente (`Drivers.layerNode` ou drivers de teste), com a política de
 * fábrica. Pede também o `FileSystem` e o `Path` (as skills gravadas na pasta de trabalho).
 */
export const layer = Layer.effect(Motor, make(POLITICA_FABRICA));

/** O motor com outra política (testes; no futuro, a da máquina, que só restringe a de fábrica). */
export const layerComPolitica = (politica: Politica) => Layer.effect(Motor, make(politica));
