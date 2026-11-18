#!/usr/bin/env node
// @effect-diagnostics globalConsole:off -- script de execução única do pipeline da base, com a casca de scripts/cli.ts: imprime no console e roda o programa Effect na borda
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml), manifest.json, a tabela do README e o
 * index.json de cada coleção institucional (campi, cursos, processos seletivos, editais, ofertas,
 * conselhos) e os JSON Schemas públicos dos registros (schemas/registros/).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { montarManifest } from "./base/front-matter.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { lerArgumentos } from "./cli.ts";
import { arquivosManifest } from "./base/readme.ts";
import { carregarConselhos } from "./dados/conselhos.ts";
import { geradosInstitucionais } from "./dados/indices.ts";
import { carregarDadosInstitucionais } from "./dados/institucional.ts";

const USO = `uso: node scripts/gerar_base.ts [--check]

Gera os campos derivados do front matter das normas (relações e status de vigência),
manifest.json e a tabela do README a partir de normas/*.md, relacoes.yaml e config/vigencia.yaml,
e o index.json de cada coleção institucional a partir dos registros de institucional/ifpr/.

  --check     verifica se os arquivos gerados estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

const COMANDO = "node scripts/gerar_base.ts";

const programa = Effect.fn("gerar_base")(function* (check: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const caminhos = criarCaminhos();
  if (!(yield* fs.exists(caminhos.normas))) {
    yield* Console.error(`Diretório de normas não encontrado: ${caminhos.normas}`);
    return 1;
  }

  const institucional = carregarDadosInstitucionais();
  const conselhos = carregarConselhos();
  if (institucional.erros.length || conselhos.erros.length) {
    for (const erro of [...institucional.erros, ...conselhos.erros]) yield* Console.error(`ERRO: ${erro}`);
    return 1;
  }
  const modo = check ? "verificar" : "gravar";
  const opcoes = { modo, raiz: caminhos.raiz } as const;
  const normas = normasComCamposGerados(caminhos.raizProjeto).map((norma) => ({
    caminho: norma.arquivo,
    texto: norma.esperado,
  }));
  // O manifest lê o front matter das normas: gravando, ele sai das normas já regravadas.
  const divergencias = yield* aplicarGerados(normas, opcoes);
  const manifest = montarManifest(caminhos);
  const registros = geradosInstitucionais(institucional.dados, conselhos.dados);
  divergencias.push(
    ...(yield* aplicarGerados([...arquivosManifest(caminhos, manifest), ...registros.arquivos], {
      ...opcoes,
      extrasEm: registros.extrasEm,
    })),
  );

  if (check) {
    if (divergencias.length) {
      for (const erro of mensagensDivergencias(divergencias, COMANDO)) yield* Console.error(`ERRO: ${erro}`);
      return 1;
    }
    yield* Console.log(`Base atualizada: ${manifest.length} normas publicadas.`);
    return 0;
  }
  const regravados = divergencias.map((divergencia) => divergencia.arquivo);
  yield* Console.log(
    `Base gerada: ${manifest.length} normas publicadas` +
      (regravados.length ? `; gerados regravados: ${regravados.join(", ")}.` : "."),
  );
  return 0;
});

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;
  return Effect.runPromise(programa(args.values.check ?? false).pipe(Effect.provide(NodeServices.layer)));
}

process.exitCode = await main();
