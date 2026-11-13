/** Tabela de normas do README da base, gerada a partir do manifest. */
import { existsSync, writeFileSync } from "node:fs";
import type { CaminhosBase } from "./caminhos.ts";
import { type ItemManifest, manifestJson } from "./front-matter.ts";
import { textoDe } from "@simplifica-if/kb/json";
import { lerTexto } from "@simplifica-if/kb/texto";

const CABECALHO_TABELA = "| Documento | Tipo | Ano | Assunto |";
const FIM_TABELA = "\n\n## Manutenção";

export function tabelaReadme(manifest: ItemManifest[]): string {
  const linhas = manifest
    .map(
      (item) =>
        `| [${textoDe(item.title)}](${textoDe(item.path)}) | ${textoDe(item.tipo_documento)} | ${textoDe(item.ano)} | ${textoDe(item.ementa)} |`,
    )
    .join("\n");
  return [CABECALHO_TABELA, "|-----------|------|-----|---------|", linhas].join("\n");
}

/** Substitui a tabela de normas do README, preservando o restante do texto. */
export function substituirTabela(texto: string, manifest: ItemManifest[]): string {
  const inicio = texto.indexOf(CABECALHO_TABELA);
  if (inicio === -1) throw new Error(`README.md sem a tabela de normas (${CABECALHO_TABELA})`);
  const fim = texto.indexOf(FIM_TABELA, inicio);
  if (fim === -1) throw new Error("README.md sem a seção ## Manutenção após a tabela de normas");
  return texto.slice(0, inicio) + tabelaReadme(manifest) + texto.slice(fim);
}

export function textoReadme(caminhos: CaminhosBase, manifest: ItemManifest[]): string {
  return substituirTabela(lerTexto(caminhos.readme), manifest);
}

/** Erros de `gerar_base --check`: arquivos gerados que divergem do esperado. */
export function verificarBase(caminhos: CaminhosBase, manifest: ItemManifest[]): string[] {
  const erros: string[] = [];
  if (lerTexto(caminhos.manifest) !== manifestJson(manifest)) erros.push("manifest.json está desatualizado");
  if (lerTexto(caminhos.readme) !== textoReadme(caminhos, manifest)) erros.push("README.md está desatualizado");
  return erros;
}

export function gravarBase(caminhos: CaminhosBase, manifest: ItemManifest[]): void {
  writeFileSync(caminhos.manifest, manifestJson(manifest), "utf-8");
  writeFileSync(caminhos.readme, textoReadme(caminhos, manifest), "utf-8");
}

export function normasExistem(caminhos: CaminhosBase): boolean {
  return existsSync(caminhos.normas);
}
