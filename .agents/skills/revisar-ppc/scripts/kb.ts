/**
 * Ponte temporária do C1 entre a skill e os serviços Effect do kb (o C3 a tira, quando a skill
 * passar a Effect).
 *
 * - `garantirBancoFresco(raiz)`: no ponto de entrada (CLI `revisar_ppc.ts`, `beforeAll` dos testes),
 *   recompila o `tmp/kb.sqlite` se ele estiver ausente ou mais velho que as fontes, pelo
 *   `Compilador` do kb (`Effect.runPromise`).
 * - `abrirKb(caminho)`: monta `layerSomenteLeitura` uma vez e devolve `kb(efeito)`, que roda um
 *   efeito dos serviços com `Effect.runSync` (as consultas sobre o `node:sqlite` são síncronas), para
 *   as funções da skill, que ainda são síncronas.
 */
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Compilador from "@simplifica-if/kb/Compilador";
import * as Layers from "@simplifica-if/kb/layers";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as Scope from "effect/Scope";

/** O `kb.sqlite` do checkout em `raiz`: `KB_SQLITE` ou `<raiz>/tmp/kb.sqlite`, como na CLI `kb`. */
export function caminhoDoBanco(raiz: string): string {
  return process.env.KB_SQLITE ? path.resolve(process.env.KB_SQLITE) : path.join(raiz, "tmp", "kb.sqlite");
}

/** Recompila o banco do checkout se preciso (`KB_RECOMPILAR` como na CLI `kb`). */
export async function garantirBancoFresco(raiz: string): Promise<string> {
  const caminho = caminhoDoBanco(raiz);
  const politica =
    process.env.KB_RECOMPILAR === "nunca" || process.env.KB_RECOMPILAR === "sempre"
      ? process.env.KB_RECOMPILAR
      : "auto";
  await Effect.runPromise(
    Compilador.Compilador.use((c) => c.garantirFresco({ raiz, caminho, politica })).pipe(
      Effect.provide(Compilador.layer),
      Effect.provide(NodeServices.layer),
    ),
  );
  return caminho;
}

/** Roda um efeito dos serviços do kb e devolve o valor. */
export type Kb = <A, E>(efeito: Effect.Effect<A, E, Layers.ServicosConsulta>) => A;

/** Os serviços do kb sobre o banco em `caminho`, só leitura; `fechar` libera o banco. */
export function abrirKb(caminho: string): { kb: Kb; fechar: () => void } {
  const escopo = Effect.runSync(Scope.make());
  // sem as cessões cooperativas do agendador, um efeito síncrono longo (decodificar milhares de
  // linhas) não vira uma fronteira assíncrona, que o Effect.runSync recusaria
  const sincrono = <A, E>(efeito: Effect.Effect<A, E>) =>
    Effect.runSync(Effect.provideService(efeito, Scheduler.PreventSchedulerYield, true));
  const contexto = sincrono(Layer.buildWithScope(Layers.layerSomenteLeitura({ caminho }), escopo));
  return {
    kb: (efeito) => sincrono(Effect.provide(efeito, contexto)),
    fechar: () => Effect.runSync(Scope.close(escopo, Exit.void)),
  };
}
