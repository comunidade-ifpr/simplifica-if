/**
 * Front matter das normas e geração de `manifest.json`. O parser (YAML `failsafe` + zod) fica em
 * `@simplifica-if/kb/normas/front-matter`.
 */
import { type CaminhosBase, listarRecursivo, relativo } from "./caminhos.ts";
import { jsonIndentado, textoDe } from "@simplifica-if/kb/json";
import {
  analisarFrontMatter,
  ErroFrontMatter,
  type FrontMatter,
  type ValorFrontMatter,
} from "@simplifica-if/kb/normas/front-matter";
import { compararTexto, lerTexto, ordenarCaminhos } from "@simplifica-if/kb/texto";

export { analisarFrontMatter, ErroFrontMatter, type FrontMatter, type ValorFrontMatter };

export const CAMPOS_OBRIGATORIOS = [
  "id",
  "title",
  "tipo_documento",
  "numero",
  "ano",
  "data_publicacao",
  "ementa",
  "status_vigencia",
  "keywords",
] as const;

export const CAMPOS_MANIFEST = [
  "id",
  "title",
  "tipo_documento",
  "numero",
  "ano",
  "data_publicacao",
  "orgao",
  "jurisdicao",
  "ementa",
  "status_vigencia",
  "keywords",
  "aliases",
  "fonte",
] as const;

/** Diretório esperado por `jurisdicao|tipo_documento`. */
export const DIRETORIOS_POR_TIPO: Record<string, string> = {
  "BR|Lei": "normas/br/leis",
  "BR|Portaria": "normas/br/portarias",
  "BR|Resolução": "normas/br/resolucoes",
  "BR|Compilação": "normas/br/compilacoes",
  "IFPR|Resolução": "normas/ifpr/resolucoes",
  "IFPR|Portaria": "normas/ifpr/portarias",
  "IFPR|Nota Técnica": "normas/ifpr/notas-tecnicas",
};

export type ItemManifest = Record<string, ValorFrontMatter>;

export function lerFrontMatter(caminhos: CaminhosBase, caminho: string) {
  return analisarFrontMatter(lerTexto(caminho), relativo(caminhos, caminho));
}

export function itemManifest(caminhos: CaminhosBase, caminho: string): ItemManifest {
  const { meta } = lerFrontMatter(caminhos, caminho);
  const ausentes = CAMPOS_MANIFEST.filter((campo) => !(campo in meta));
  if (ausentes.length) {
    throw new ErroFrontMatter(
      `${relativo(caminhos, caminho)}: campos ausentes para manifest.json: ${ausentes.join(", ")}`,
    );
  }
  const item: ItemManifest = {};
  for (const campo of CAMPOS_MANIFEST) item[campo] = meta[campo]!;
  item.path = relativo(caminhos, caminho);
  return item;
}

export function arquivosNormas(caminhos: CaminhosBase): string[] {
  return ordenarCaminhos(listarRecursivo(caminhos.normas, ".md"));
}

export function montarManifest(caminhos: CaminhosBase): ItemManifest[] {
  const manifest = arquivosNormas(caminhos).map((caminho) => itemManifest(caminhos, caminho));
  return manifest.sort(
    (a, b) =>
      compararTexto(textoDe(a.data_publicacao), textoDe(b.data_publicacao)) ||
      compararTexto(textoDe(a.title), textoDe(b.title)),
  );
}

export function manifestJson(manifest: ItemManifest[]): string {
  return jsonIndentado(manifest);
}
