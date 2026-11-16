// @effect-diagnostics nodeBuiltinImport:off -- a pasta vazia de cada sessão de julgamento
/**
 * O julgamento de um bloco (M1.11, etapa 4): uma sessão curta do motor, sem MCP e sem ferramentas,
 * numa pasta vazia, com o pedido pronto; a resposta conferida em código; uma nova tentativa com os
 * problemas; e, se falhar de novo, a ficha "a conferir" com o motivo.
 *
 * Limite de taxa, cota esgotada, provider caído ou turno longo demais viram `PausaRevisao` (a revisão
 * pausa e retoma depois), nunca um resultado: o bloco só se grava inteiro e conferido.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { UsoRevisaoIa } from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import {
  alvoDosTrechos,
  type Conferencia,
  conferirResposta,
  motivoLegivel,
  pedidoDeCorrecao,
  type ResultadoIa,
} from "@simplifica-if/ppc/revisao-ia/conferencia";
import { instrucoesJulgador } from "@simplifica-if/ppc/revisao-ia/pedido";
import type { Bloco, FichaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import type { ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";

/** A revisão para; os blocos sem resultado voltam na retomada. */
export class PausaRevisao extends Schema.TaggedError<PausaRevisao>()("PausaRevisao", {
  motivo: Schema.String,
  /** Limite de taxa ou cota: a pessoa espera a janela e retoma. */
  limite: Schema.Boolean,
}) {}

/** O resultado gravado de um bloco (`blocos_ia.resultado`). */
export type ResultadoBloco = { resultados: ResultadoFichaIa[]; resumo: string | null; tentativas: number };

export const NOME_PROVIDER: Record<Motor.Provider, string> = {
  claude: "Claude",
  codex: "ChatGPT (Codex)",
  antigravity: "Gemini (Antigravity)",
};

/** Mensagens de limite de taxa e de cota dos três providers (em inglês, como chegam). */
const LIMITE =
  /rate.?limit|429|too many requests|usage limit|limit reached|hit your limit|quota|resource.?exhausted|overloaded|529|exceeded your|try again (at|in)/i;

export const ehLimite = (mensagem: string) => LIMITE.test(mensagem);

export function pausaDoErro(provider: Motor.Provider, mensagem: string): PausaRevisao {
  const nome = NOME_PROVIDER[provider];
  return ehLimite(mensagem)
    ? new PausaRevisao({
        limite: true,
        motivo: `O ${nome} avisou que o limite de uso do seu plano foi atingido por agora. O que já foi revisado está guardado; retome quando a janela do plano renovar.`,
      })
    : new PausaRevisao({
        limite: false,
        motivo: `O ${nome} parou de responder (${mensagem.slice(0, 160)}). O que já foi revisado está guardado; retome quando quiser.`,
      });
}

export interface EntradaJulgamento {
  readonly provider: Motor.Provider;
  readonly modelo: string | null;
  readonly nonce: string;
  readonly bloco: Bloco;
  readonly fichas: readonly FichaIa[];
  readonly pedido: string;
  /** O PPC normalizado para conferir os trechos (`alvoDosTrechos`). */
  readonly alvo: string;
  readonly fontes: ReadonlySet<string>;
  /** Tempo máximo de um turno. */
  readonly tempoTurno: Duration.Duration;
}

const usoVazio = (): { -readonly [K in keyof UsoRevisaoIa]: UsoRevisaoIa[K] } => ({
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  custoUsd: 0,
});

/** Converte o resultado conferido no do contrato da revisão prévia. */
const paraResultado = (r: ResultadoIa): ResultadoFichaIa => ({
  ficha: r.ficha_id,
  estado: r.estado,
  confianca: r.confianca,
  justificativa: r.justificativa,
  lacunas: [...r.lacunas],
  oQueFazer: r.o_que_fazer ?? "",
  trechos: r.evidencias.map((e) => e.trecho).filter((t) => t.trim().length > 0),
  fontes: [...(r.fontes ?? [])],
  revisaoHumana: r.revisao_humana_obrigatoria,
});

export { alvoDosTrechos };

/** Julga um bloco. Devolve o resultado (uma entrada por ficha), o uso somado e os segundos. */
export const julgarBloco = Effect.fn("RevisaoIa.julgarBloco")(function* (entrada: EntradaJulgamento) {
  const motor = yield* Motor.Motor;
  const inicio = yield* Clock.currentTimeMillis;
  const uso = usoVazio();
  const pasta = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "simplifica-julgamento-"))).pipe(
      Effect.flatMap((p) => Effect.promise(() => NodeFSP.realpath(p))),
    ),
    (p) => Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })),
  );
  const sessao = yield* Effect.acquireRelease(
    motor
      .iniciarSessao({
        provider: entrada.provider,
        pastaTrabalho: pasta,
        servidoresMcp: [],
        instrucoes: instrucoesJulgador(entrada.nonce),
        semFerramentas: true,
        ...(entrada.modelo ? { modelo: entrada.modelo } : {}),
      })
      .pipe(Effect.mapError((erro) => pausaDoErro(entrada.provider, erro.detalhe))),
    (id) => motor.encerrar(id).pipe(Effect.ignore),
  );

  const turno = Effect.fn("RevisaoIa.turno")(function* (texto: string) {
    const textos: string[] = [];
    const erros: string[] = [];
    yield* motor.enviarMensagem(sessao, texto).pipe(
      Stream.runForEach((evento) =>
        Effect.gen(function* () {
          switch (evento._tag) {
            case "TextoFinal":
              textos.push(evento.texto);
              break;
            case "UsoTokens":
              uso.entrada += evento.entrada;
              uso.saida += evento.saida;
              uso.cacheLeitura += evento.cacheLeitura ?? 0;
              uso.cacheEscrita += evento.cacheEscrita ?? 0;
              uso.custoUsd += evento.custoUsd ?? 0;
              break;
            case "Erro":
              erros.push(evento.mensagem);
              break;
            case "PedidoAprovacao":
              // A política de julgamento já nega sem perguntar; se algo chegar, nega também.
              yield* motor.responderAprovacao(sessao, evento.id, "negar").pipe(Effect.ignore);
              break;
          }
        }),
      ),
      Effect.mapError((erro) =>
        pausaDoErro(entrada.provider, erro._tag === "FalhaProvider" ? erro.detalhe : erro.message),
      ),
      Effect.timeoutOrElse({
        duration: entrada.tempoTurno,
        orElse: () =>
          Effect.fail(
            new PausaRevisao({
              limite: false,
              motivo: `O ${NOME_PROVIDER[entrada.provider]} demorou demais para responder um bloco. O que já foi revisado está guardado; retome quando quiser.`,
            }),
          ),
      }),
    );
    if (erros.length) return yield* pausaDoErro(entrada.provider, erros.join("; "));
    return textos.join("\n");
  });

  const conferir = (texto: string): Conferencia =>
    conferirResposta(texto, entrada.bloco, entrada.fichas, { alvo: entrada.alvo, fontes: entrada.fontes });

  let tentativas = 1;
  const primeira = conferir(yield* turno(entrada.pedido));
  let validos = primeira.validos;
  let resumo = primeira.resumo;
  let problemas = primeira.problemas;
  if (problemas.size > 0) {
    tentativas = 2;
    const segunda = conferir(yield* turno(pedidoDeCorrecao(primeira)));
    // A segunda resposta vale onde passou; o que só passou na primeira continua valendo.
    validos = new Map([...primeira.validos, ...segunda.validos]);
    resumo = segunda.resumo ?? primeira.resumo;
    problemas = segunda.problemas;
  }
  const resultados: ResultadoFichaIa[] = entrada.fichas.map((ficha) => {
    const valido = validos.get(ficha.id);
    if (valido) return paraResultado(valido);
    const erros = problemas.get(ficha.id) ?? problemas.get("*") ?? ["sem resultado"];
    return {
      ficha: ficha.id,
      estado: "FALHOU",
      confianca: 0,
      justificativa: "",
      lacunas: [],
      oQueFazer: "",
      trechos: [],
      fontes: [],
      revisaoHumana: true,
      motivoFalha: motivoLegivel(erros),
    };
  });
  const resultado: ResultadoBloco = { resultados, resumo, tentativas };
  return { resultado, uso: { ...uso }, segundos: Math.round(((yield* Clock.currentTimeMillis) - inicio) / 100) / 10 };
}, Effect.scoped);
