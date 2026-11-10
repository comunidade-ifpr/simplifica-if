#!/usr/bin/env bun
/** Valida a base pública de conhecimento. */
import { criarCaminhos } from "./base/caminhos.ts";
import { interpretarArgs } from "./base/cli.ts";
import { validarBase } from "./base/validacao.ts";

function main(): number {
  const args = interpretarArgs(
    process.argv.slice(2),
    [{ nome: "check-ppc-artifacts", ajuda: "Também acusa artefatos conhecidos de conversão nos PPCs em Markdown." }],
    { descricao: "Valida a base pública de conhecimento." },
  );
  if ("codigo" in args) return args.codigo;

  const { erros, totalNormas } = validarBase(criarCaminhos(), { artefatosPpc: args.flags["check-ppc-artifacts"] });
  if (erros.length) {
    for (const erro of erros) console.error(`ERRO: ${erro}`);
    return 1;
  }
  console.log(`Base válida: ${totalNormas} normas publicadas, metadados institucionais e catálogos conferidos.`);
  return 0;
}

process.exitCode = main();
