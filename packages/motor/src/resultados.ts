/**
 * Completa o `resumo` das ferramentas MCP com o que o servidor do app viu.
 *
 * O `agy` 1.5.x não manda o resultado das ferramentas pelo ACP: o `tool_call_update` com `completed`
 * vem sem `rawOutput` e sem `content`, e o `FerramentaConcluida` do Antigravity sai com `resumo`
 * vazio. Com o MCP por HTTP local, o servidor do app vê cada chamada; o `ServidorMcp` da sessão
 * traz essas chamadas em `resultados`, e o `Motor` passa os eventos de cada turno por aqui.
 *
 * A correspondência é pela ordem e pelo nome da ferramenta, dentro da sessão: cada
 * `FerramentaConcluida` de `<servidor>.<ferramenta>` consome a próxima chamada de `<ferramenta>`
 * daquele servidor (com resumo ou não, para não desalinhar a fila) e, se o resumo veio vazio, fica
 * com o da chamada.
 *
 * A leitura de recurso do Antigravity é a ferramenta `read_resource` dele, sem o prefixo do servidor;
 * o servidor e o URI estão na entrada (`{ ServerName, Uri }`) do `FerramentaIniciada`. O servidor do
 * app registra a leitura com o URI no lugar do nome da ferramenta, e o `FerramentaConcluida` dela
 * consome a próxima chamada desse URI no servidor `ServerName`, como uma ferramenta de nome `Uri`.
 *
 * A chamada chega antes do evento, porque o servidor a publica antes de responder
 * ao provider; se não chegar em `ESPERA_RESULTADO` (o provider falhou a chamada sem chegar ao
 * servidor, por exemplo), o evento segue como veio. No início de cada turno, o que sobrou do anterior
 * é descartado.
 *
 * A normalização dos drivers continua pura e não muda: isto só age sobre o stream de eventos.
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { ConfigSessao, ResultadoFerramenta } from "./Driver.ts";
import type { Evento } from "./eventos.ts";

/** Quanto um `FerramentaConcluida` espera pela chamada correspondente. */
export const ESPERA_RESULTADO = "1 second";

/** A ferramenta com que o Antigravity lê um recurso MCP (`resources/read`). */
export const LER_RECURSO_ANTIGRAVITY = "read_resource";

/** O servidor e o URI de um `read_resource`, pela entrada dele; `undefined` se faltar um dos dois. */
function leituraDeRecurso(entrada: unknown): { readonly servidor: string; readonly uri: string } | undefined {
  if (typeof entrada !== "object" || entrada === null) return undefined;
  const { ServerName: servidor, Uri: uri } = entrada as Record<string, unknown>;
  return typeof servidor === "string" && typeof uri === "string" ? { servidor, uri } : undefined;
}

/** Transforma os eventos de um turno, completando os resumos vazios. */
export type Completar = <E>(eventos: Stream.Stream<Evento, E>) => Stream.Stream<Evento, E>;

/** As chamadas de um servidor ainda não consumidas: a fila, na ordem, e as já lidas de outro nome. */
interface Fonte {
  readonly servidor: string;
  readonly fila: Queue.Queue<ResultadoFerramenta>;
  readonly guardadas: Map<string, Array<ResultadoFerramenta>>;
}

/**
 * O completador da sessão `config`: assina, no `Scope` da sessão, os `resultados` dos servidores
 * HTTP que os têm. Sem nenhum, devolve os eventos como estão.
 */
export const completador = Effect.fn("Resultados.completador")(function* (config: ConfigSessao) {
  const fontes: Array<Fonte> = [];
  for (const servidor of config.servidoresMcp) {
    if (servidor.resultados === undefined) continue;
    const fila = yield* Queue.unbounded<ResultadoFerramenta>();
    yield* servidor.resultados.pipe(
      Stream.runForEach((resultado) => Queue.offer(fila, resultado)),
      Effect.forkScoped({ startImmediately: true }),
    );
    fontes.push({ servidor: servidor.nome, fila, guardadas: new Map() });
  }
  if (fontes.length === 0) return ((eventos) => eventos) satisfies Completar as Completar;

  /** As leituras de recurso iniciadas e ainda não concluídas, pelo id da ferramenta. */
  const leituras = new Map<string, { readonly servidor: string; readonly uri: string }>();

  /** A próxima chamada de `ferramenta`; as de outro nome lidas no caminho ficam guardadas, na ordem. */
  const proxima = (fonte: Fonte, ferramenta: string): Effect.Effect<ResultadoFerramenta> =>
    Effect.suspend(() => {
      const guardada = fonte.guardadas.get(ferramenta)?.shift();
      if (guardada !== undefined) return Effect.succeed(guardada);
      return Effect.flatMap(Queue.take(fonte.fila), (resultado) => {
        if (resultado.ferramenta === ferramenta) return Effect.succeed(resultado);
        const lista = fonte.guardadas.get(resultado.ferramenta) ?? [];
        lista.push(resultado);
        fonte.guardadas.set(resultado.ferramenta, lista);
        return proxima(fonte, ferramenta);
      });
    });

  /** A fonte do evento e o nome da chamada que ele consome nela. */
  const alvo = (evento: Extract<Evento, { readonly _tag: "FerramentaConcluida" }>) => {
    const leitura = leituras.get(evento.id);
    if (leitura !== undefined) {
      leituras.delete(evento.id);
      const fonte = fontes.find((candidata) => candidata.servidor === leitura.servidor);
      return fonte === undefined ? undefined : { fonte, ferramenta: leitura.uri };
    }
    const fonte = fontes.find((candidata) => evento.nome.startsWith(`${candidata.servidor}.`));
    return fonte === undefined ? undefined : { fonte, ferramenta: evento.nome.slice(fonte.servidor.length + 1) };
  };

  const completar = (evento: Evento): Effect.Effect<Evento> => {
    if (evento._tag === "FerramentaIniciada" && evento.nome === LER_RECURSO_ANTIGRAVITY) {
      const leitura = leituraDeRecurso(evento.entrada);
      if (leitura !== undefined) leituras.set(evento.id, leitura);
    }
    if (evento._tag !== "FerramentaConcluida") return Effect.succeed(evento);
    const encontrado = alvo(evento);
    if (encontrado === undefined) return Effect.succeed(evento);
    return proxima(encontrado.fonte, encontrado.ferramenta).pipe(
      Effect.timeoutOption(ESPERA_RESULTADO),
      Effect.map((resultado) =>
        Option.isSome(resultado) && evento.resumo === "" ? { ...evento, resumo: resultado.value.resumo } : evento,
      ),
    );
  };

  /** O que sobrou do turno anterior: chamadas que o provider não informou. */
  const descartarSobras = Effect.forEach(
    fontes,
    (fonte) =>
      Effect.andThen(
        Queue.clear(fonte.fila),
        Effect.sync(() => fonte.guardadas.clear()),
      ),
    { discard: true },
  ).pipe(Effect.andThen(Effect.sync(() => leituras.clear())));

  const completarTurno: Completar = (eventos) =>
    Stream.unwrap(Effect.as(descartarSobras, Stream.mapEffect(eventos, completar)));
  return completarTurno;
}) satisfies (config: ConfigSessao) => Effect.Effect<Completar, never, Scope.Scope>;
