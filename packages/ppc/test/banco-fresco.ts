// @effect-diagnostics nodeBuiltinImport:off -- o globalSetup do vitest só precisa da raiz do checkout, antes de haver Effect
/**
 * `globalSetup` dos testes do pacote (no `vite.config.ts` dele): garante o `tmp/kb.sqlite` do
 * checkout fresco uma vez, antes dos arquivos de teste. Sem ele, os arquivos que leem a base
 * (`carregarBaseRevisao`) rodam em paralelo, cada um num processo, e num checkout desatualizado cada
 * um recompilaria o banco. A garantia é a da `layerBancoDoCheckout` que eles usam (mesmo caminho,
 * `KB_SQLITE` e `KB_RECOMPILAR`): construída aqui, ela recompila se preciso; nos arquivos, acha o
 * banco fresco.
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Layers from "@simplifica-if/kb/layers";

const raiz = NodePath.resolve(import.meta.dirname, "../../..");

export default function garantirBancoFresco(): Promise<void> {
  return Effect.runPromise(
    Layer.build(Layers.layerBancoDoCheckout({ raiz })).pipe(
      Effect.scoped,
      Effect.asVoid,
      Effect.provide(NodeServices.layer),
      Effect.withSpan("testes.ppc.bancoFresco"),
    ),
  );
}
