#!/usr/bin/env node
// @effect-diagnostics globalConsole:off -- script de execução única do pipeline da base, com a casca de scripts/cli.ts: imprime no console e roda o programa Effect na borda
/** Gera índices globais dos PPCs convertidos para Markdown. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { criarCaminhos } from "./base/caminhos.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { arquivosIndices, dataIndiceAtual, gerarIndices } from "./base/indice-ppcs.ts";
import { lerArgumentos } from "./cli.ts";
import { dataLocalIso } from "./datas.ts";

const USO = `uso: node scripts/gerar_indice_ppcs.ts [--check]

Gera índices globais dos PPCs convertidos para Markdown.

  --check     verifica se os índices de PPCs estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

const programa = Effect.fn("gerar_indice_ppcs")(function* (check: boolean) {
  const caminhos = criarCaminhos();
  const hoje = dataLocalIso();
  const conferir = (indices: ReturnType<typeof gerarIndices>) => {
    const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
    return aplicarGerados(arquivos, { modo: "verificar", raiz: caminhos.raiz, ...pastas });
  };
  // A data só avança quando o conteúdo muda: regenerar sem mudança não deixa diferença no git.
  let indices = gerarIndices(caminhos, dataIndiceAtual(caminhos, hoje));
  const divergencias = yield* conferir(indices);
  const resumo = () => `${indices.itensPpc.length} PPCs, ${indices.itensSecao.length} seções.`;

  if (check) {
    if (divergencias.length) {
      for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_indice_ppcs.ts")) {
        yield* Console.error(`ERRO: ${erro}`);
      }
      return 1;
    }
    yield* Console.log(`Índices de PPCs atualizados: ${resumo()}`);
    return 0;
  }

  if (divergencias.length) {
    indices = gerarIndices(caminhos, hoje);
    const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
    yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, ...pastas });
  }
  yield* Console.log(`Índices de PPCs gerados: ${resumo()}`);
  return 0;
});

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;
  return Effect.runPromise(programa(args.values.check ?? false).pipe(Effect.provide(NodeServices.layer)));
}

process.exitCode = await main();
