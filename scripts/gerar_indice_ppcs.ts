#!/usr/bin/env bun
/** Gera índices globais dos PPCs convertidos para Markdown. */
import { criarCaminhos } from "./base/caminhos.ts";
import { dataIndiceAtual, gerarIndices, gravarIndices, verificarIndices } from "./base/indice-ppcs.ts";
import { lerArgumentos } from "./cli.ts";
import { dataLocalIso } from "./datas.ts";

const USO = `uso: bun run scripts/gerar_indice_ppcs.ts [--check]

Gera índices globais dos PPCs convertidos para Markdown.

  --check     verifica se os índices de PPCs estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

function main(): number {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  const hoje = dataLocalIso();
  const atualizadoEm = args.values.check ? dataIndiceAtual(caminhos, hoje) : hoje;
  const indices = gerarIndices(caminhos, atualizadoEm);
  const resumo = `${indices.itensPpc.length} PPCs, ${indices.itensSecao.length} seções.`;

  if (args.values.check) {
    const erros = verificarIndices(caminhos, indices);
    if (erros.length) {
      for (const erro of erros) console.error(`ERRO: ${erro}`);
      return 1;
    }
    console.log(`Índices de PPCs atualizados: ${resumo}`);
    return 0;
  }

  gravarIndices(caminhos, indices);
  console.log(`Índices de PPCs gerados: ${resumo}`);
  return 0;
}

process.exitCode = main();
