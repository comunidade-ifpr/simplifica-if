// @effect-diagnostics nodeBuiltinImport:off -- borda com o `worker_threads`
/**
 * Um pedido num `Worker` com teto de memória e de tempo, para o trabalho síncrono sobre arquivo da
 * pessoa (a leitura de um `.docx`, que mantém a árvore do XML na memória): o laço de eventos do
 * servidor não para, e o estouro encerra só o Worker.
 *
 * O Worker recebe um pedido e responde uma mensagem só; antes dela, pode mandar avisos de andamento
 * (`{ andamento: … }`, ver `AvisoAndamento`), que vão para `aoAndamento`. O estouro de memória, o tempo máximo, o fim
 * antes da resposta e o erro do Worker viram `FalhaWorker`; quem chama traduz para a frase da pessoa.
 * O tempo máximo e a interrupção (a conexão caiu) encerram o Worker pelo finalizador (`terminate()`).
 *
 * Quem roda o pedido é o `Executor`: no app, sempre o Worker (`rodarNoWorker`); os testes que não
 * exercitam os limites o trocam pelo trabalho no próprio processo, sem os ~200 ms de partida de cada Worker.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface LimitesWorker {
  /**
   * `resourceLimits.maxOldGenerationSizeMb`, com piso de `MEMORIA_MINIMA_MB`: com heap pequeno demais
   * (2 MB, medido no Node 26), o V8 aborta o processo inteiro em vez de encerrar o Worker.
   */
  readonly memoriaMb: number;
  /** Tempo máximo, em milissegundos. */
  readonly tempoMs: number;
}

export const MEMORIA_MINIMA_MB = 64;

/** O Worker não respondeu: estourou a memória ou o tempo, parou antes ou falhou. */
export class FalhaWorker extends Schema.TaggedError<FalhaWorker>()("FalhaWorker", {
  motivo: Schema.Literals(["memoria", "tempo", "parou", "erro"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.motivo) {
      case "memoria":
        return "o Worker passou do limite de memória";
      case "tempo":
        return "o Worker passou do tempo máximo";
      case "parou":
        return "o Worker parou antes de responder";
      case "erro":
        return "o Worker falhou";
    }
  }
}

/** Um aviso de andamento do Worker, antes da resposta. */
export interface AvisoAndamento<A> {
  readonly andamento: A;
}

const ehAvisoAndamento = (mensagem: unknown): mensagem is AvisoAndamento<unknown> =>
  typeof mensagem === "object" && mensagem !== null && "andamento" in mensagem;

/**
 * Roda `pedido` no Worker de `url` e devolve a primeira mensagem dele que não é aviso de andamento;
 * os avisos vão, na ordem, para `aoAndamento`. `transferir` vai sem cópia.
 */
export function rodarNoWorker<Resposta, Andamento = never>(
  url: URL,
  pedido: unknown,
  transferir: ReadonlyArray<ArrayBuffer>,
  limites: LimitesWorker,
  aoAndamento?: (andamento: Andamento) => void,
): Effect.Effect<Resposta, FalhaWorker> {
  const rodar = Effect.callback<Resposta, FalhaWorker>((resume) => {
    const trabalhador = new NodeWorkerThreads.Worker(url, {
      resourceLimits: { maxOldGenerationSizeMb: Math.max(MEMORIA_MINIMA_MB, limites.memoriaMb) },
      stdout: true,
      stderr: false,
    });
    let terminou = false;
    const terminar = (efeito: Effect.Effect<Resposta, FalhaWorker>) => {
      if (terminou) return;
      terminou = true;
      void trabalhador.terminate();
      resume(efeito);
    };
    trabalhador.on("message", (mensagem: Resposta | AvisoAndamento<Andamento>) => {
      if (ehAvisoAndamento(mensagem)) {
        if (!terminou) aoAndamento?.(mensagem.andamento as Andamento);
        return;
      }
      terminar(Effect.succeed(mensagem));
    });
    trabalhador.once("error", (erro: Error & { code?: string }) =>
      terminar(
        Effect.fail(
          new FalhaWorker({ motivo: erro.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memoria" : "erro", cause: erro }),
        ),
      ),
    );
    trabalhador.once("exit", () => terminar(Effect.fail(new FalhaWorker({ motivo: "parou" }))));
    trabalhador.postMessage(pedido, [...transferir]);
    return Effect.sync(() => {
      terminou = true;
      void trabalhador.terminate();
    });
  });
  return rodar.pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(limites.tempoMs),
      orElse: () => Effect.fail(new FalhaWorker({ motivo: "tempo" })),
    }),
  );
}

/** Quem roda o pedido do Worker: `rodarNoWorker`, salvo nos testes. */
export const Executor = Context.Reference<typeof rodarNoWorker>("@simplifica-if/server/WorkerLimitado/Executor", {
  defaultValue: () => rodarNoWorker,
});
