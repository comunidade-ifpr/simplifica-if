#!/usr/bin/env node
/** Gera índices globais dos PPCs convertidos para Markdown. */
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { type CaminhosBase, criarCaminhos } from "./base/caminhos.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { arquivosIndices, dataIndiceAtual, gerarIndices, type IndicesPpcs } from "./base/indice-ppcs.ts";
import { dataLocalIso } from "./datas.ts";
import { executarPrincipal, sairCom } from "./principal.ts";

const aplicar = (caminhos: CaminhosBase, indices: IndicesPpcs, modo: "gravar" | "verificar") => {
  const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
  return aplicarGerados(arquivos, { modo, raiz: caminhos.raiz, ...pastas });
};

export const comando = Command.make(
  "gerar_indice_ppcs",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("verifica se os índices de PPCs estão atualizados, sem gravar"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("gerar_indice_ppcs")(function* ({ check }) {
    const caminhos = criarCaminhos();
    const hoje = dataLocalIso(DateTime.toDateUtc(yield* DateTime.now));
    // A data só avança quando o conteúdo muda: regenerar sem mudança não deixa diferença no git.
    let indices = yield* Effect.sync(() => gerarIndices(caminhos, dataIndiceAtual(caminhos, hoje)));
    const divergencias = yield* aplicar(caminhos, indices, "verificar");

    if (check) {
      if (divergencias.length) {
        for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_indice_ppcs.ts")) {
          yield* Console.error(`ERRO: ${erro}`);
        }
        return yield* sairCom(1);
      }
      yield* Console.log(
        `Índices de PPCs atualizados: ${indices.itensPpc.length} PPCs, ${indices.itensSecao.length} seções.`,
      );
      return;
    }
    if (divergencias.length) {
      indices = yield* Effect.sync(() => gerarIndices(caminhos, hoje));
      yield* aplicar(caminhos, indices, "gravar");
    }
    yield* Console.log(
      `Índices de PPCs gerados: ${indices.itensPpc.length} PPCs, ${indices.itensSecao.length} seções.`,
    );
  }),
).pipe(Command.withDescription("Gera índices globais dos PPCs convertidos para Markdown."));

if (import.meta.main) {
  executarPrincipal("gerar_indice_ppcs", Command.run(comando, { version: "1.0.0" }));
}
