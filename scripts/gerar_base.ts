#!/usr/bin/env node
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml), manifest.json e o índice dos campi
 * (institucional/ifpr/campi/index.json, lido pela revisar-ppc).
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { manifestJson, montarManifest } from "./base/front-matter.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { indiceCampiGerado } from "./dados/indices.ts";
import { carregarDadosInstitucionais } from "./dados/institucional.ts";
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

    const institucional = yield* Effect.sync(() => carregarDadosInstitucionais());
    if (institucional.erros.length) {
      for (const erro of institucional.erros) yield* Console.error(`ERRO: ${erro}`);
      return yield* sairCom(1);
    }
    const opcoes = { modo: check ? "verificar" : "gravar", raiz: caminhos.raiz } as const;
    const normas = yield* Effect.sync(() => normasComCamposGerados(caminhos.raizProjeto));
    // O manifest lê o front matter das normas: gravando, ele sai das normas já regravadas.
    const divergencias = yield* aplicarGerados(
      normas.map((norma) => ({ caminho: norma.arquivo, texto: norma.esperado })),
      opcoes,
    );
    const manifest = yield* Effect.sync(() => montarManifest(caminhos));
    divergencias.push(
      ...(yield* aplicarGerados(
        [{ caminho: caminhos.manifest, texto: manifestJson(manifest) }, indiceCampiGerado(institucional.dados)],
        opcoes,
      )),
    );

    if (check) {
      if (divergencias.length) {
        for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_base.ts")) {
          yield* Console.error(`ERRO: ${erro}`);
        }
        return yield* sairCom(1);
      }
      yield* Console.log(`Base atualizada: ${manifest.length} normas publicadas.`);
      return;
    }
    const regravados = divergencias.map((divergencia) => divergencia.arquivo);
    yield* Console.log(
      `Base gerada: ${manifest.length} normas publicadas` +
        (regravados.length ? `; gerados regravados: ${regravados.join(", ")}.` : "."),
    );
  }),
).pipe(
  Command.withDescription(
    "Gera os campos derivados do front matter das normas (relações e status de vigência) e manifest.json a " +
      "partir de normas/*.md, relacoes.yaml e config/vigencia.yaml, e o índice dos campi a partir dos registros " +
      "de institucional/ifpr/campi/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("gerar_base", Command.run(comando, { version: "1.0.0" }));
}
