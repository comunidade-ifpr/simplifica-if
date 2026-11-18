/** Tabela de normas do README da base, gerada a partir do manifest. */
import type { CaminhosBase } from "./caminhos.ts";
import type { ArquivoGerado } from "./gerados.ts";
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

/** `manifest.json` e o README com a tabela de normas, como `gerar_base` os grava. */
export function arquivosManifest(caminhos: CaminhosBase, manifest: ItemManifest[]): ArquivoGerado[] {
  return [
    { caminho: caminhos.manifest, texto: manifestJson(manifest) },
    { caminho: caminhos.readme, texto: textoReadme(caminhos, manifest) },
  ];
}
