/**
 * Atualização silenciosa em segundo plano dos harnesses gerenciados pelo app (Antigravity e Codex).
 *
 * - **Quando confere:** depois de `atrasoInicial` (padrão: 15 s, fora do caminho crítico da abertura)
 *   e a cada `intervalo` (padrão: 12 h). Se a conferência for pulada porque o servidor estava ocupado,
 *   tenta novamente após `intervaloOcupado` (padrão: 10 min). Na abertura, também limpa versões
 *   antigas que tenham ficado em disco de execuções anteriores.
 * - **Quando pula:** se há revisão de PPC ou conversa em andamento (`ocupado`), se a pessoa desligou
 *   a IA em Configurações (`desligados`) ou se a CLI não é gerenciada pelo app.
 * - **Sem ruído:** falhas de rede, proxy ou validação ficam no log (`logWarning`) e não alteram a
 *   versão ativa nem interrompem conversas em curso.
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Motor from "@simplifica-if/motor";

/** Os providers cujas CLIs o app instala e mantém atualizadas. */
export const HARNESSES_GERENCIADOS = ["antigravity", "codex"] as const satisfies ReadonlyArray<Motor.Provider>;

/** Espera antes da primeira conferência automática, para não disputar com a abertura do app. */
export const ATRASO_INICIAL_PADRAO = Duration.seconds(15);

/** Intervalo entre conferências automáticas enquanto o servidor fica aberto. */
export const INTERVALO_PADRAO = Duration.hours(12);

/** Espera menor quando a rodada é pulada porque há trabalho em curso no servidor. */
export const INTERVALO_OCUPADO_PADRAO = Duration.minutes(10);

export interface Opcoes {
  /** Revisão de PPC ou conversa respondendo? (espera para não disputar banda e CPU) */
  readonly ocupado: Effect.Effect<boolean>;
  /** Providers que a pessoa escolheu não usar no app (`Preferencias.iasDesligadas`). */
  readonly desligados: Effect.Effect<ReadonlyArray<Motor.Provider>>;
  /** Espera antes da primeira conferência automática (padrão: 15 s). */
  readonly atrasoInicial?: Duration.Input;
  /** Intervalo entre conferências automáticas (padrão: 12 h). */
  readonly intervalo?: Duration.Input;
  /** Intervalo de re-tentativa quando a conferência é pulada por `ocupado` (padrão: 10 min). */
  readonly intervaloOcupado?: Duration.Input;
  /** Conferir automaticamente em segundo plano (padrão: sim). */
  readonly automatico?: boolean;
}

export type ResultadosHarnesses = Readonly<Partial<Record<Motor.Provider, Motor.ResultadoAtualizacaoHarness>>>;

export class AtualizadorHarnesses extends Context.Service<
  AtualizadorHarnesses,
  {
    /** Confere e atualiza os harnesses gerenciados agora e limpa versões antigas quando possível. */
    readonly conferirAgora: Effect.Effect<ResultadosHarnesses>;
  }
>()("@simplifica-if/server/AtualizadorHarnesses") {}

/** Mantém a interrupção viva, mas evita que um defeito derrube o laço em segundo plano. */
const semDerrubar = <A>(efeito: Effect.Effect<A>, aoDefeito: () => A, mensagem: string) =>
  efeito.pipe(
    Effect.catchCauseIf(
      (causa) => !Cause.hasInterruptsOnly(causa),
      (causa) => Effect.logWarning(mensagem, causa).pipe(Effect.as(aoDefeito())),
    ),
  );

export const make = Effect.fn("AtualizadorHarnesses.make")(function* (opcoes: Opcoes) {
  const motor = yield* Motor.Motor;
  const uma = yield* Semaphore.make(1);

  const limpar = Effect.fn("AtualizadorHarnesses.limpar")(function* (provider: Motor.Provider) {
    const removidas = yield* semDerrubar(
      motor.limparVersoesAntigasHarness(provider),
      () => 0,
      `harness ${provider}: não foi possível limpar versões antigas`,
    );
    if (removidas > 0) {
      yield* Effect.logInfo(`harness ${provider}: ${removidas} versão(ões) antiga(s) removida(s)`);
    }
  });

  const conferir = Effect.fn("AtualizadorHarnesses.conferir")(function* () {
    if (
      yield* semDerrubar(opcoes.ocupado, () => true, "harness: não foi possível conferir se o servidor está ocupado")
    ) {
      return {
        antigravity: { status: "ignorado", motivo: "ocupado" },
        codex: { status: "ignorado", motivo: "ocupado" },
      } satisfies ResultadosHarnesses;
    }
    const desligados = new Set(
      yield* semDerrubar(
        opcoes.desligados,
        (): ReadonlyArray<Motor.Provider> => [],
        "harness: não foi possível ler as IAs desligadas",
      ),
    );
    const resultados: Partial<Record<Motor.Provider, Motor.ResultadoAtualizacaoHarness>> = {};
    for (const provider of HARNESSES_GERENCIADOS) {
      if (desligados.has(provider)) {
        resultados[provider] = { status: "ignorado", motivo: "desligada" };
        continue;
      }
      const resultado = yield* semDerrubar(
        motor.atualizarHarness(provider),
        (): Motor.ResultadoAtualizacaoHarness => ({ status: "falhou", detalhe: "erro inesperado ao atualizar" }),
        `harness ${provider}: erro inesperado ao atualizar`,
      );
      resultados[provider] = resultado;
      if (resultado.status === "atualizado") {
        yield* Effect.logInfo(`harness ${provider}: atualizado de ${resultado.de} para ${resultado.para}`);
        yield* limpar(provider);
      } else if (resultado.status === "falhou") {
        yield* Effect.logWarning(`harness ${provider}: atualização silenciosa falhou (${resultado.detalhe})`);
      }
    }
    return resultados satisfies ResultadosHarnesses;
  });

  const conferirAgora = uma.withPermits(1)(conferir());

  if (opcoes.automatico ?? true) {
    const intervalo = opcoes.intervalo ?? INTERVALO_PADRAO;
    const intervaloOcupado = opcoes.intervaloOcupado ?? INTERVALO_OCUPADO_PADRAO;
    // Cada execução abre o próprio trace: o fiber nasce no span do `make`, que já terminou.
    yield* Effect.gen(function* () {
      yield* uma
        .withPermits(1)(Effect.forEach(HARNESSES_GERENCIADOS, (provider) => limpar(provider), { discard: true }))
        .pipe(Effect.withSpan("AtualizadorHarnesses.limparNaPartida", { root: true }));
      yield* Effect.sleep(opcoes.atrasoInicial ?? ATRASO_INICIAL_PADRAO);
      for (;;) {
        const resultados = yield* conferirAgora.pipe(
          Effect.withSpan("AtualizadorHarnesses.conferirPeriodico", { root: true }),
        );
        const puladoPorOcupado = HARNESSES_GERENCIADOS.every((provider) => {
          const resultado = resultados[provider];
          return resultado?.status === "ignorado" && resultado.motivo === "ocupado";
        });
        yield* Effect.sleep(puladoPorOcupado ? intervaloOcupado : intervalo);
      }
    }).pipe(Effect.forkScoped);
  }

  return AtualizadorHarnesses.of({ conferirAgora });
});

export const layer = (opcoes: Opcoes) => Layer.effect(AtualizadorHarnesses, make(opcoes));
