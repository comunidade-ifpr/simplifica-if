#!/usr/bin/env node
/** Gera a saída publicável em site/ a partir de base-conhecimento/. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarCaminhos } from "./base/caminhos.ts";
import { compararDiretorios, renderizarSite } from "./base/site.ts";
import { lerArgumentos } from "./cli.ts";

const USO = `uso: node scripts/gerar_site.ts [--check]

Gera a saída publicável em site/ a partir de base-conhecimento/.

  --check     verifica se site/ está atualizado, sem gravar
  -h, --help  mostra esta ajuda`;

function verificarSite(raizBase: string, site: string): string[] {
  if (!existsSync(site)) return ["site/ não existe; gere com node scripts/gerar_site.ts"];
  const temporario = mkdtempSync(path.join(os.tmpdir(), "gerar-site-"));
  try {
    const esperado = path.join(temporario, "site");
    renderizarSite(raizBase, esperado);
    return compararDiretorios(esperado, site);
  } finally {
    rmSync(temporario, { recursive: true, force: true });
  }
}

function main(): number {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  const nomeBase = path.basename(caminhos.raiz);
  if (args.values.check) {
    const erros = verificarSite(caminhos.raiz, caminhos.site);
    if (erros.length) {
      for (const erro of erros) console.error(`ERRO: ${erro}`);
      return 1;
    }
    console.log(`site/ atualizado a partir de ${nomeBase}/.`);
    return 0;
  }

  renderizarSite(caminhos.raiz, caminhos.site);
  console.log(`site/ gerado a partir de ${nomeBase}/.`);
  return 0;
}

process.exitCode = main();
