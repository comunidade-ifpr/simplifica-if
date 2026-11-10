#!/usr/bin/env bun
/** Gera a saída publicável em site/ a partir de base-conhecimento/. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarCaminhos } from "./base/caminhos.ts";
import { interpretarArgs } from "./base/cli.ts";
import { compararDiretorios, renderizarSite } from "./base/site.ts";

function verificarSite(raizBase: string, site: string): string[] {
  if (!existsSync(site)) return ["site/ não existe; gere com bun run scripts/gerar_site.ts"];
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
  const args = interpretarArgs(process.argv.slice(2), [{ nome: "check", ajuda: "verifica se site/ está atualizado" }]);
  if ("codigo" in args) return args.codigo;

  const caminhos = criarCaminhos();
  const nomeBase = path.basename(caminhos.raiz);
  if (args.flags.check) {
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
