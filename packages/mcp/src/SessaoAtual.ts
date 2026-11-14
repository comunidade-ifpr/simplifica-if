/**
 * `SessaoAtual`: a sessão que faz a chamada de ferramenta ou a leitura de recurso, como o
 * `McpInvocationContext` do T3. O servidor HTTP (`http.ts`) a fornece por requisição, depois de
 * conferir o token; no stdio ela não existe, e as ferramentas e os recursos rodam como antes.
 *
 * O registro das ferramentas (`ferramentas/registrar.ts`) e o dos recursos (`recursos/recursos.ts`) a
 * leem em cada chamada e, se ela existir, informam o nome (a ferramenta, ou o URI do recurso), o
 * início, a duração, se a chamada falhou e o começo do resultado (`registrarChamada`).
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type { McpSchema } from "effect/ai";

/**
 * O que a sessão chamou: uma ferramenta (`tools/call`) ou a leitura de um recurso (`resources/read`).
 * Ausente, é `ferramenta`.
 */
export type TipoChamada = "ferramenta" | "recurso";

/** Uma chamada concluída, sem a sessão (quem registra já a conhece). */
export interface ChamadaConcluida {
  /** O nome da ferramenta; numa leitura de recurso, o URI pedido (`ifpr://cnct/tecnico-em-enfermagem`). */
  readonly ferramenta: string;
  /** `recurso` numa leitura de recurso; ausente numa chamada de ferramenta. */
  readonly tipo?: TipoChamada;
  /** Milissegundos do `Clock` no início da chamada. */
  readonly inicio: number;
  readonly duracaoMs: number;
  /** A chamada terminou em erro: resultado `isError`, falha ou interrupção. */
  readonly falhou: boolean;
  /** O começo do texto do resultado (ou da mensagem de erro), numa linha, até `LIMITE_RESUMO` caracteres. */
  readonly resumo?: string;
}

/** Tamanho máximo do `resumo` de uma chamada (o mesmo do motor do app). */
export const LIMITE_RESUMO = 300;

/** Um texto numa linha, até `LIMITE_RESUMO` caracteres. */
export function resumoDoTexto(texto: string): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length <= LIMITE_RESUMO ? linha : `${linha.slice(0, LIMITE_RESUMO - 1)}…`;
}

/** O começo do texto de um resultado MCP: os blocos de texto do `content`, numa linha, até `LIMITE_RESUMO`. */
export function resumoDoResultado(resultado: McpSchema.CallToolResult): string {
  return resumoDoTexto(resultado.content.map((bloco) => (bloco.type === "text" ? bloco.text : "")).join(" "));
}

/** O começo do texto de um recurso lido: os `contents` de texto, numa linha, até `LIMITE_RESUMO`. */
export function resumoDaLeitura(resultado: McpSchema.ReadResourceResult): string {
  return resumoDoTexto(resultado.contents.map((conteudo) => ("text" in conteudo ? conteudo.text : "")).join(" "));
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
 * Mede `efeito` (a chamada da ferramenta, ou a leitura do recurso, de `alvo`) e a registra na
 * `SessaoAtual`, se houver uma; sem sessão, devolve `efeito` como está.
 *
 * - `falhou`: se o resultado é de erro (a falha do efeito sempre é);
 * - `resumir`: o `resumo` do resultado;
 * - `resumirErro`: o `resumo` de uma falha do efeito (a leitura de recurso falha com o erro do MCP).
 */
export const observarChamada = <A, E, R>(
  alvo: { readonly ferramenta: string; readonly tipo?: TipoChamada },
  efeito: Effect.Effect<A, E, R>,
  opcoes: {
    readonly falhou: (resultado: A) => boolean;
    readonly resumir?: (resultado: A) => string;
    readonly resumirErro?: (erro: E) => string;
  },
): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(SessaoAtual), (sessao) => {
    if (Option.isNone(sessao)) return efeito;
    const resumo = (saida: Exit.Exit<A, E>): string | undefined => {
      if (Exit.isSuccess(saida)) return opcoes.resumir?.(saida.value);
      const erro = Cause.findErrorOption(saida.cause);
      return opcoes.resumirErro !== undefined && Option.isSome(erro) ? opcoes.resumirErro(erro.value) : undefined;
    };
    return Effect.flatMap(Clock.currentTimeMillis, (inicio) =>
      Effect.onExit(efeito, (saida) =>
        Effect.flatMap(Clock.currentTimeMillis, (fim) => {
          const texto = resumo(saida);
          return sessao.value.registrarChamada({
            ferramenta: alvo.ferramenta,
            ...(alvo.tipo !== undefined ? { tipo: alvo.tipo } : {}),
            inicio,
            duracaoMs: fim - inicio,
            falhou: Exit.isFailure(saida) || opcoes.falhou(saida.value),
            ...(texto !== undefined ? { resumo: texto } : {}),
          });
        }),
      ),
    );
  });
