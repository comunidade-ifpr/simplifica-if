#!/usr/bin/env node
/**
 * Gera os arquivos derivados da base: os campos gerados do front matter das normas (relações de
 * `relacoes.yaml` e status de vigência na `data_referencia` de `config/vigencia.yaml`) e os índices de
 * PPCs (`institucional/ifpr/ppcs/index.json` e `secoes/<tipo>.jsonl`). O `validar_base` confere que
 * estão em dia.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import { criarCaminhos } from "./base/caminhos.ts";
import { aplicarGerados, arquivosGeradosDaBase } from "./base/gerados.ts";
import { executarPrincipal } from "./principal.ts";

export const comando = Command.make(
  "gerar_base",
  {},
  Effect.fn("gerar_base")(function* () {
    const caminhos = criarCaminhos();
    const { arquivos, extrasEm, totais } = yield* Effect.sync(() => arquivosGeradosDaBase(caminhos));
    const divergencias = yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, extrasEm });
    const regravados = divergencias.map((divergencia) => divergencia.arquivo);
    yield* Console.log(
      `Base gerada: ${totais.normas} normas, ${totais.ppcs} PPCs, ${totais.secoes} seções de PPC` +
        (regravados.length ? `; regravados: ${regravados.join(", ")}.` : "; nada mudou."),
    );
  }),
).pipe(
  Command.withDescription(
    "Gera os campos derivados do front matter das normas (relações e vigência) e os índices de PPCs.",
  ),
);

if (import.meta.main) {
  executarPrincipal("gerar_base", Command.run(comando, { version: "1.0.0" }));
}
