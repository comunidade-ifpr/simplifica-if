#!/usr/bin/env bun
/** Valida a base pública de conhecimento. */
import { criarCaminhos } from "./base/caminhos.ts";
import { validarBase } from "./base/validacao.ts";
import { lerArgumentos } from "./cli.ts";

const USO = `uso: bun run scripts/validar_base.ts [--check-ppc-artifacts]

Valida a base pública de conhecimento.

  --check-ppc-artifacts  também acusa artefatos conhecidos de conversão nos PPCs em Markdown
  -h, --help             mostra esta ajuda`;

function main(): number {
  const args = lerArgumentos(process.argv.slice(2), { "check-ppc-artifacts": { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const { erros, totalNormas } = validarBase(criarCaminhos(), {
    artefatosPpc: args.values["check-ppc-artifacts"] ?? false,
  });
  if (erros.length) {
    for (const erro of erros) console.error(`ERRO: ${erro}`);
    return 1;
  }
  console.log(`Base válida: ${totalNormas} normas publicadas, metadados institucionais e catálogos conferidos.`);
  return 0;
}

process.exitCode = main();
