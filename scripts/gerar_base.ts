#!/usr/bin/env node
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml) e, na base da revisão de PPC
 * (revisao-ppc/), os JSON Schemas da ficha e dos marcos e o mapa das fichas.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { geradosRevisaoPpc } from "./base/revisao-ppc/gerados.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

export const comando = Command.make(
  "gerar_base",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("verifica se os arquivos gerados estão atualizados, sem gravar"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("gerar_base")(function* ({ check }) {
    const fs = yield* FileSystem.FileSystem;
    const caminhos = criarCaminhos();
    if (!(yield* fs.exists(caminhos.normas))) {
      yield* Console.error(`Diretório de normas não encontrado: ${caminhos.normas}`);
      return yield* sairCom(1);
    }

    const opcoes = { modo: check ? "verificar" : "gravar", raiz: caminhos.raiz } as const;
    const normas = yield* Effect.sync(() => normasComCamposGerados(caminhos.raizProjeto));
    const divergencias = yield* aplicarGerados(
      [
        ...normas.map((norma) => ({ caminho: norma.arquivo, texto: norma.esperado })),
        ...(yield* Effect.sync(() => geradosRevisaoPpc())),
      ],
      opcoes,
    );

    if (check) {
      if (divergencias.length) {
        for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_base.ts")) {
          yield* Console.error(`ERRO: ${erro}`);
        }
        return yield* sairCom(1);
      }
      yield* Console.log(`Base atualizada: ${normas.length} normas publicadas.`);
      return;
    }
    const regravados = divergencias.map((divergencia) => divergencia.arquivo);
    yield* Console.log(
      `Base gerada: ${normas.length} normas publicadas` +
        (regravados.length ? `; gerados regravados: ${regravados.join(", ")}.` : "."),
    );
  }),
).pipe(
  Command.withDescription(
    "Gera os campos derivados do front matter das normas (relações e status de vigência) a " +
      "partir de normas/*.md, relacoes.yaml e config/vigencia.yaml e, na revisão de PPC, os JSON Schemas da " +
      "ficha e dos marcos e o mapa das fichas.",
  ),
);

if (import.meta.main) {
  executarPrincipal("gerar_base", Command.run(comando, { version: "1.0.0" }));
}
