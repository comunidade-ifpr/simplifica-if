#!/usr/bin/env bun
/** Gera índices globais dos PPCs convertidos para Markdown. */
import { criarCaminhos } from "./base/caminhos.ts";
import { interpretarArgs } from "./base/cli.ts";
import { dataIndiceAtual, gerarIndices, gravarIndices, verificarIndices } from "./base/indice-ppcs.ts";
import { dataLocalIso } from "./datas.ts";

function main(): number {
  const args = interpretarArgs(
    process.argv.slice(2),
    [{ nome: "check", ajuda: "verifica se os índices de PPCs estão atualizados" }],
    { descricao: "Gera índices globais dos PPCs convertidos para Markdown." },
  );
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  const hoje = dataLocalIso();
  const atualizadoEm = args.flags.check ? dataIndiceAtual(caminhos, hoje) : hoje;
  const indices = gerarIndices(caminhos, atualizadoEm);
  const resumo = `${indices.itensPpc.length} PPCs, ${indices.itensSecao.length} seções.`;

  if (args.flags.check) {
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
