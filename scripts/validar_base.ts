#!/usr/bin/env node
// @effect-diagnostics globalConsole:off -- script de execução única do pipeline da base, síncrono, com a casca de scripts/cli.ts: imprime no console
/** Valida a base pública de conhecimento. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { criarCaminhos } from "./base/caminhos.ts";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { validarBase } from "./base/validacao.ts";
import { validarBaseAnalise } from "../.agents/skills/revisar-ppc/scripts/validacao-base.ts";
import { lerArgumentos } from "./cli.ts";
import { validarDadosInstitucionais } from "./dados/validacao.ts";
import { validarSkillsDoApp } from "./base/skills.ts";

const USO = `uso: node scripts/validar_base.ts [--check-ppc-artifacts]

Valida a base pública de conhecimento, os registros institucionais (institucional/ifpr/: campi, cursos, ingresso, processos SEI)
a base de análise da skill revisar-ppc (.agents/skills/revisar-ppc/base-analise/) e o bloco
simplifica: das skills do app (.agents/skills/*/SKILL.md).

  --check-ppc-artifacts  também acusa artefatos conhecidos de conversão nos PPCs em Markdown
  -h, --help             mostra esta ajuda`;

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { "check-ppc-artifacts": { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  const { erros, totalNormas } = validarBase(caminhos, {
    artefatosPpc: args.values["check-ppc-artifacts"] ?? false,
  });
  const dados = validarDadosInstitucionais();
  erros.push(...dados.erros);
  if (dados.gerados) {
    const { arquivos, extrasEm } = dados.gerados;
    const divergencias = await Effect.runPromise(
      aplicarGerados(arquivos, { modo: "verificar", raiz: caminhos.raiz, extrasEm }).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    erros.push(...mensagensDivergencias(divergencias, "node scripts/gerar_base.ts"));
  }
  erros.push(...validarBaseAnalise().map((erro) => `revisar-ppc: ${erro}`));
  const skills = await validarSkillsDoApp();
  erros.push(...skills.erros);
  if (erros.length) {
    for (const erro of erros) console.error(`ERRO: ${erro}`);
    return 1;
  }
  console.log(
    `Base válida: ${totalNormas} normas publicadas, metadados institucionais e catálogos conferidos; ` +
      `${dados.total} registros institucionais; base de análise da revisar-ppc conferida; ` +
      `${skills.doApp.length} skills do app (${skills.doApp.join(", ")}).`,
  );
  return 0;
}

process.exitCode = await main();
