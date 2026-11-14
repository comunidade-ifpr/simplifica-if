/**
 * Os três drivers reais, sobre os processos do Node. O ambiente (PATH, HOME…) vem de quem monta a
 * layer: o motor não lê `process.env`.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Drivers } from "../Driver.ts";
import type { Ambiente } from "../processo.ts";
import * as Antigravity from "./antigravity.ts";
import * as Claude from "./claude.ts";
import * as Codex from "./codex.ts";

export const layerNode = (opcoes: { readonly ambiente: Ambiente }) =>
  Layer.effect(
    Drivers,
    Effect.gen(function* () {
      return Drivers.of({
        claude: yield* Claude.make(opcoes),
        codex: yield* Codex.make(opcoes),
        antigravity: yield* Antigravity.make(opcoes),
      });
    }),
  );
