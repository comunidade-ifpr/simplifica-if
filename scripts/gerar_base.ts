#!/usr/bin/env bun
/** Gera manifest.json e a tabela do README a partir de normas/*.md. */
import { criarCaminhos } from "./base/caminhos.ts";
import { interpretarArgs } from "./base/cli.ts";
import { montarManifest } from "./base/front-matter.ts";
import { gravarBase, normasExistem, verificarBase } from "./base/readme.ts";

function main(): number {
  const args = interpretarArgs(process.argv.slice(2), [
    { nome: "check", ajuda: "verifica se os arquivos gerados estão atualizados" },
  ]);
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  if (!normasExistem(caminhos)) {
    console.error(`Diretório de normas não encontrado: ${caminhos.normas}`);
    return 1;
  }

  const manifest = montarManifest(caminhos);
  if (args.flags.check) {
    const erros = verificarBase(caminhos, manifest);
    if (erros.length) {
      for (const erro of erros) console.error(`ERRO: ${erro}`);
      return 1;
    }
    console.log(`Base atualizada: ${manifest.length} normas publicadas.`);
    return 0;
  }

  gravarBase(caminhos, manifest);
  console.log(`Base gerada: ${manifest.length} normas publicadas.`);
  return 0;
}

process.exitCode = main();
