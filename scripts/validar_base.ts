#!/usr/bin/env bun
/** Valida a base pública de conhecimento. */
import { criarCaminhos } from "./base/caminhos.ts";
import { validarBase } from "./base/validacao.ts";
import { validarBaseAnalise } from "../.agents/skills/analise-ppc/scripts/validacao-base.ts";
import { lerArgumentos } from "./cli.ts";
import { validarDadosInstitucionais } from "./dados/validacao.ts";

const USO = `uso: bun run scripts/validar_base.ts [--check-ppc-artifacts]

Valida a base pública de conhecimento, os dados institucionais de origem (dados/institucional/)
e a base de análise da skill analise-ppc (.agents/skills/analise-ppc/base-analise/).

  --check-ppc-artifacts  também acusa artefatos conhecidos de conversão nos PPCs em Markdown
  -h, --help             mostra esta ajuda`;

function main(): number {
  const args = lerArgumentos(process.argv.slice(2), { "check-ppc-artifacts": { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const { erros, totalNormas } = validarBase(criarCaminhos(), {
    artefatosPpc: args.values["check-ppc-artifacts"] ?? false,
  });
  const dados = validarDadosInstitucionais();
  erros.push(...dados.erros);
  erros.push(...validarBaseAnalise().map((erro) => `analise-ppc: ${erro}`));
  if (erros.length) {
    for (const erro of erros) console.error(`ERRO: ${erro}`);
    return 1;
  }
  console.log(
    `Base válida: ${totalNormas} normas publicadas, metadados institucionais e catálogos conferidos; ` +
      `${dados.total} registros em dados/institucional/; base de análise da analise-ppc conferida.`,
  );
  return 0;
}

process.exitCode = main();
