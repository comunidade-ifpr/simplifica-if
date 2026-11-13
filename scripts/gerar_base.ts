#!/usr/bin/env bun
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml), manifest.json e a tabela do README.
 */
import { writeFileSync } from "node:fs";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { montarManifest } from "./base/front-matter.ts";
import { lerArgumentos } from "./cli.ts";
import { gravarBase, normasExistem, verificarBase } from "./base/readme.ts";

const USO = `uso: bun run scripts/gerar_base.ts [--check]

Gera os campos derivados do front matter das normas (relações e status de vigência),
manifest.json e a tabela do README a partir de normas/*.md, relacoes.yaml e config/vigencia.yaml.

  --check     verifica se os arquivos gerados estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

function main(): number {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  if (!normasExistem(caminhos)) {
    console.error(`Diretório de normas não encontrado: ${caminhos.normas}`);
    return 1;
  }

  const normas = normasComCamposGerados(caminhos.raizProjeto);
  if (args.values.check) {
    const erros = normas
      .filter((norma) => norma.atual !== norma.esperado)
      .map((norma) => `${norma.path}: campos gerados do front matter desatualizados (relações ou status de vigência)`);
    const manifest = montarManifest(caminhos);
    erros.push(...verificarBase(caminhos, manifest));
    if (erros.length) {
      for (const erro of erros) console.error(`ERRO: ${erro}`);
      return 1;
    }
    console.log(`Base atualizada: ${manifest.length} normas publicadas.`);
    return 0;
  }

  for (const norma of normas) if (norma.atual !== norma.esperado) writeFileSync(norma.arquivo, norma.esperado, "utf-8");
  const manifest = montarManifest(caminhos);
  gravarBase(caminhos, manifest);
  console.log(`Base gerada: ${manifest.length} normas publicadas.`);
  return 0;
}

process.exitCode = main();
