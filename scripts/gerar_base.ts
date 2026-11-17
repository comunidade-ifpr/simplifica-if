#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- script de execução única do pipeline da base, síncrono, com a casca de scripts/cli.ts: grava com node:fs e imprime no console
/**
 * Gera os campos derivados do front matter das normas (relações de relacoes.yaml e status de
 * vigência na data_referencia de config/vigencia.yaml), manifest.json, a tabela do README e o
 * index.json de cada coleção institucional (campi, cursos, processos seletivos, editais, ofertas).
 */
import * as NodeFS from "node:fs";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { criarCaminhos } from "./base/caminhos.ts";
import { montarManifest } from "./base/front-matter.ts";
import { lerArgumentos } from "./cli.ts";
import { gravarBase, normasExistem, verificarBase } from "./base/readme.ts";
import { gravarIndices, verificarIndices } from "./dados/indices.ts";
import { carregarDadosInstitucionais } from "./dados/institucional.ts";

const USO = `uso: node scripts/gerar_base.ts [--check]

Gera os campos derivados do front matter das normas (relações e status de vigência),
manifest.json e a tabela do README a partir de normas/*.md, relacoes.yaml e config/vigencia.yaml,
e o index.json de cada coleção institucional a partir dos registros de institucional/ifpr/.

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
  const institucional = carregarDadosInstitucionais();
  if (institucional.erros.length) {
    for (const erro of institucional.erros) console.error(`ERRO: ${erro}`);
    return 1;
  }
  if (args.values.check) {
    const erros = normas
      .filter((norma) => norma.atual !== norma.esperado)
      .map((norma) => `${norma.path}: campos gerados do front matter desatualizados (relações ou status de vigência)`);
    const manifest = montarManifest(caminhos);
    erros.push(...verificarBase(caminhos, manifest));
    erros.push(...verificarIndices(institucional.dados));
    if (erros.length) {
      for (const erro of erros) console.error(`ERRO: ${erro}`);
      return 1;
    }
    console.log(`Base atualizada: ${manifest.length} normas publicadas.`);
    return 0;
  }

  for (const norma of normas)
    if (norma.atual !== norma.esperado) NodeFS.writeFileSync(norma.arquivo, norma.esperado, "utf-8");
  const manifest = montarManifest(caminhos);
  gravarBase(caminhos, manifest);
  const indices = gravarIndices(institucional.dados);
  console.log(
    `Base gerada: ${manifest.length} normas publicadas` +
      (indices.length ? `; índices institucionais regravados: ${indices.join(", ")}.` : "."),
  );
  return 0;
}

process.exitCode = main();
