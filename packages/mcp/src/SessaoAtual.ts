/**
 * `SessaoAtual`: a sessão que faz a chamada de ferramenta, como o `McpInvocationContext` do T3. O
 * servidor HTTP (`http.ts`) a fornece por requisição, depois de conferir o token; no stdio ela não
 * existe, e as ferramentas rodam como antes.
 *
 * O registro das ferramentas (`ferramentas/registrar.ts`) a lê em cada chamada e, se ela existir,
 * informa a ferramenta, o início, a duração e se a chamada falhou (`registrarChamada`).
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

/** Uma chamada de ferramenta concluída, sem a sessão (quem registra já a conhece). */
export interface ChamadaConcluida {
  readonly ferramenta: string;
  /** Milissegundos do `Clock` no início da chamada. */
  readonly inicio: number;
  readonly duracaoMs: number;
  /** A chamada terminou em erro: resultado `isError`, falha ou interrupção. */
  readonly falhou: boolean;
}

export class SessaoAtual extends Context.Service<
  SessaoAtual,
  {
    /** O rótulo dado pelo app ao abrir a sessão. */
    readonly rotulo: string;
    readonly registrarChamada: (chamada: ChamadaConcluida) => Effect.Effect<void>;
  }
>()("@simplifica-if/mcp/SessaoAtual") {}

/**
 * Mede `efeito` (a chamada da ferramenta `ferramenta`) e a registra na `SessaoAtual`, se houver uma;
 * sem sessão, devolve `efeito` como está. `falhou` diz se o resultado é de erro.
 */
export const observarChamada = <A, E, R>(
  ferramenta: string,
  falhou: (resultado: A) => boolean,
  efeito: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(SessaoAtual), (sessao) => {
    if (Option.isNone(sessao)) return efeito;
    return Effect.flatMap(Clock.currentTimeMillis, (inicio) =>
      Effect.onExit(efeito, (saida) =>
        Effect.flatMap(Clock.currentTimeMillis, (fim) =>
          sessao.value.registrarChamada({
            ferramenta,
            inicio,
            duracaoMs: fim - inicio,
            falhou: Exit.isFailure(saida) || falhou(saida.value),
          }),
        ),
      ),
    );
  });
