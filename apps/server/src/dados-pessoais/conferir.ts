// @effect-diagnostics nodeBuiltinImport:off -- borda com o `worker_threads`
/**
 * O aviso ao anexar (M1.13): roda o detector de dados pessoais sobre um arquivo num `Worker`, como a
 * revisão prévia (`revisao-ppc/AnalisePpc.ts`): a leitura do `.docx` é síncrona e mantém o XML na
 * memória, e o laço de eventos do servidor não pode parar. Estouro de memória, de tempo ou defeito
 * viram "não conferido", com o motivo em português: o aviso nunca impede o anexo.
 *
 * No app empacotado, o Worker é o `trabalhador-dados.mjs` do bundle, ao lado do `bin.mjs`
 * (`apps/desktop/scripts/construir.ts`); no desenvolvimento, o `trabalhador.ts` desta pasta.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { PedidoConferencia, RespostaConferencia } from "./trabalhador.ts";

export interface LimitesConferencia {
  /** `resourceLimits.maxOldGenerationSizeMb` do Worker (o leitor do `.docx` cabe em 512 MB no pior caso honesto). */
  readonly memoriaMb: number;
  /** Tempo máximo, em milissegundos. */
  readonly tempoMs: number;
}

export const LIMITES_CONFERENCIA: LimitesConferencia = { memoriaMb: 512, tempoMs: 30_000 };

/** O script do Worker: o `.ts` ao lado deste no desenvolvimento, o `trabalhador-dados.mjs` no bundle. */
export const URL_TRABALHADOR_DADOS = import.meta.url.endsWith(".ts")
  ? new URL("./trabalhador.ts", import.meta.url)
  : new URL("./trabalhador-dados.mjs", import.meta.url);

const naoConferido = (motivo: string): RespostaConferencia => ({ situacao: "nao-conferido", motivo });

/** Confere os bytes de um arquivo no Worker; nunca falha (o defeito vira "não conferido"). */
export function conferirNoTrabalhador(
  pedido: PedidoConferencia,
  limites: LimitesConferencia = LIMITES_CONFERENCIA,
  url: URL = URL_TRABALHADOR_DADOS,
): Effect.Effect<RespostaConferencia> {
  const rodar = Effect.callback<RespostaConferencia>((resume) => {
    const trabalhador = new NodeWorkerThreads.Worker(url, {
      resourceLimits: { maxOldGenerationSizeMb: Math.max(64, limites.memoriaMb) },
      stdout: true,
      stderr: false,
    });
    let terminou = false;
    const terminar = (efeito: Effect.Effect<RespostaConferencia>) => {
      if (terminou) return;
      terminou = true;
      void trabalhador.terminate();
      resume(efeito);
    };
    trabalhador.once("message", (resposta: RespostaConferencia) => terminar(Effect.succeed(resposta)));
    trabalhador.once("error", (erro: Error & { code?: string }) =>
      terminar(
        Effect.logWarning("aviso ao anexar: o Worker falhou", erro).pipe(
          Effect.as(
            naoConferido(
              erro.code === "ERR_WORKER_OUT_OF_MEMORY"
                ? "O arquivo é grande demais para o app procurar dados pessoais nele."
                : "O app não conseguiu ler este arquivo para procurar dados pessoais.",
            ),
          ),
        ),
      ),
    );
    trabalhador.once("exit", () =>
      terminar(Effect.succeed(naoConferido("O app não conseguiu ler este arquivo para procurar dados pessoais."))),
    );
    trabalhador.postMessage(pedido, [pedido.bytes.buffer as ArrayBuffer]);
    return Effect.sync(() => {
      terminou = true;
      void trabalhador.terminate();
    });
  });
  return rodar.pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(limites.tempoMs),
      orElse: () =>
        Effect.succeed(naoConferido("A procura por dados pessoais passou do tempo máximo e foi interrompida.")),
    }),
  );
}
