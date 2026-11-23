/**
 * Front matter das normas e geração de `manifest.json`. O parser (YAML `failsafe` + Effect Schema) fica em
 * `@simplifica-if/kb/normas/front-matter`.
 */
import { type CaminhosBase, listarRecursivo, relativo } from "./caminhos.ts";
import { jsonIndentado, textoDe } from "@simplifica-if/kb/json";
import {
  analisarFrontMatter,
  ehErroFrontMatter,
  ErroFrontMatter,
  type FrontMatter,
  type ValorFrontMatter,
} from "@simplifica-if/kb/normas/front-matter";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import { compararTexto, lerTexto, ordenarCaminhos } from "@simplifica-if/kb/texto";

export { analisarFrontMatter, ehErroFrontMatter, ErroFrontMatter, type FrontMatter, type ValorFrontMatter };

export const CAMPOS_OBRIGATORIOS = [
  "id",
  "title",
  "tipo_documento",
  "numero",
  "ano",
  "data_publicacao",
  "assinada_em",
  "publicada_em",
  "vigente_de",
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
  "assinada_em",
  "publicada_em",
  "vigente_de",
  "orgao",
  "jurisdicao",
  "ementa",
  "status_vigencia",
  "keywords",
  "aliases",
] as const;

/** Campos do front matter que vão para o `manifest.json` quando existem (a fonte oficial). */
export const CAMPOS_MANIFEST_OPCIONAIS = ["fonte_url", "fonte_referencia"] as const;

/** Diretório esperado por `jurisdicao|tipo_documento`. */
export const DIRETORIOS_POR_TIPO: Record<string, string> = {
  "BR|Lei": "normas/br/leis",
  "BR|Decreto-Lei": "normas/br/decretos-lei",
  "BR|Portaria": "normas/br/portarias",
  "BR|Resolução": "normas/br/resolucoes",
  "BR|Parecer": "normas/br/pareceres",
  "IFPR|Resolução": "normas/ifpr/resolucoes",
  "IFPR|Portaria": "normas/ifpr/portarias",
  "IFPR|Nota Técnica": "normas/ifpr/notas-tecnicas",
};

export type ItemManifest = Record<string, ValorFrontMatter | RelacaoManifest[]>;

/** Relação de `relacoes.yaml` em que a norma é origem ou alvo, como vai para o `manifest.json`. */
export type RelacaoManifest = Record<string, string>;

export function lerFrontMatter(caminhos: CaminhosBase, caminho: string) {
  return analisarFrontMatter(lerTexto(caminho), relativo(caminhos, caminho));
}

export function itemManifest(caminhos: CaminhosBase, caminho: string): ItemManifest {
  const { meta } = lerFrontMatter(caminhos, caminho);
  const ausentes = CAMPOS_MANIFEST.filter((campo) => !(campo in meta));
  if (ausentes.length) {
    throw new ErroFrontMatter({
      rotulo: relativo(caminhos, caminho),
      detalhe: `campos ausentes para manifest.json: ${ausentes.join(", ")}`,
    });
  }
  const item: ItemManifest = {};
  for (const campo of CAMPOS_MANIFEST) item[campo] = meta[campo]!;
  for (const campo of CAMPOS_MANIFEST_OPCIONAIS) if (campo in meta) item[campo] = meta[campo]!;
  item.path = relativo(caminhos, caminho);
  if (typeof meta.vigencia_a_confirmar === "string") item.vigencia_a_confirmar = meta.vigencia_a_confirmar;
  const relacoes = relacoesManifest(textoDe(meta.id), caminhos.raizProjeto);
  if (relacoes.length) item.relacoes = relacoes;
  return item;
}

/** Relações (origem ou alvo) do ato, de `relacoes.yaml`, com os campos que existirem. */
export function relacoesManifest(id: string, raizProjeto: string): RelacaoManifest[] {
  return carregarRelacoes(raizProjeto)
    .filter((relacao) => relacao.origem === id || relacao.alvo === id)
    .map((relacao) => {
      const item: RelacaoManifest = { tipo: relacao.tipo, origem: relacao.origem };
      if (relacao.operador) item.operador = relacao.operador;
      item.alvo = relacao.alvo;
      if (relacao.alvo_dispositivo) item.alvo_dispositivo = relacao.alvo_dispositivo;
      if (relacao.alcance) item.alcance = relacao.alcance;
      item.efeito_de = relacao.efeito_de;
      return item;
    });
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
