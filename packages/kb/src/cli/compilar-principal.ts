#!/usr/bin/env node
/**
 * O `kb compilar` como executável à parte, só com o `packages/kb`: é o que a fábrica roda na árvore
 * extraída do commit (`scripts/fabrica_atualizacao.ts`), que não tem o `packages/mcp` da CLI `kb`.
 *
 *   node packages/kb/src/cli/compilar-principal.ts --destino <kb.sqlite> --versao 2026.11.20 --commit <sha>
 *
 * A raiz é a do checkout onde este arquivo está (`raizRepositorio()`), não o diretório atual.
 */
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import { raizRepositorio } from "../caminhos.ts";
import { executarPrincipal } from "../principal.ts";
import { compilar } from "./compilar.ts";
import { Checkout } from "./comum.ts";

executarPrincipal(
  "kb compilar",
  Command.run(compilar, { version: "0.1.0" }).pipe(
    Effect.provideService(Checkout, Checkout.of({ raiz: raizRepositorio() })),
  ),
);
