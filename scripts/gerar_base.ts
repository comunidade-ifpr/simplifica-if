#!/usr/bin/env node
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml), manifest.json, a tabela do README e o
 * index.json de cada coleção institucional (campi, cursos, processos seletivos, editais, ofertas,
 * conselhos) e os JSON Schemas públicos dos registros (schemas/registros/).
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { montarManifest } from "./base/front-matter.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { arquivosManifest } from "./base/readme.ts";
import { carregarConselhos } from "./dados/conselhos.ts";
import { geradosInstitucionais } from "./dados/indices.ts";
import { carregarDadosInstitucionais } from "./dados/institucional.ts";
import { executarPrincipal, sairCom } from "./principal.ts";

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
    const conselhos = yield* Effect.sync(() => carregarConselhos());
    if (institucional.erros.length || conselhos.erros.length) {
      for (const erro of [...institucional.erros, ...conselhos.erros]) yield* Console.error(`ERRO: ${erro}`);
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
    const registros = geradosInstitucionais(institucional.dados, conselhos.dados);
    divergencias.push(
      ...(yield* aplicarGerados([...arquivosManifest(caminhos, manifest), ...registros.arquivos], {
        ...opcoes,
        extrasEm: registros.extrasEm,
      })),
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
    "Gera os campos derivados do front matter das normas (relações e status de vigência), manifest.json e a " +
      "tabela do README a partir de normas/*.md, relacoes.yaml e config/vigencia.yaml, e o index.json de cada " +
      "coleção institucional e os JSON Schemas públicos a partir dos registros de institucional/ifpr/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("gerar_base", Command.run(comando, { version: "1.0.0" }));
}
