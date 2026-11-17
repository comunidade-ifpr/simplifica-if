/**
 * Validação do institucional_manifest.json e das coleções institucionais. Os registros de campi,
 * cursos, processos seletivos, editais e ofertas e os processos SEI são validados à parte
 * (`scripts/dados/validacao.ts`); aqui se confere que o manifesto aponta para o índice de cada
 * coleção e que o total bate.
 */
import { ehObjeto, valoresIguais } from "@simplifica-if/kb/json";
import type { ManifestInstitucionalJson } from "../tipos-schemas.ts";
import { naBase } from "../caminhos.ts";
import { type Contexto, ehRecebido } from "./contexto.ts";
import { validarPpcps, validarPpcs } from "./ppcs.ts";

/** Coleções obrigatórias do manifesto e o índice de cada uma (relativo a `base-conhecimento/`). */
export const COLECOES_INSTITUCIONAIS: ReadonlyArray<[id: string, path: string]> = [
  ["campi-ifpr", "institucional/ifpr/campi/index.json"],
  ["cursos-ifpr", "institucional/ifpr/cursos/index.json"],
  ["processos-seletivos-ifpr", "institucional/ifpr/processos-seletivos/index.json"],
  ["editais-ingresso-ifpr", "institucional/ifpr/editais/index.json"],
  ["ofertas-ingresso-ifpr", "institucional/ifpr/ofertas/index.json"],
  ["processos-sei-cursos-ifpr", "institucional/ifpr/processos-sei/index.json"],
  ["conselhos-ifpr", "institucional/ifpr/conselhos/index.json"],
  ["referencias-ifpr", "institucional/ifpr/referencias/index.json"],
  ["ppcs-ifpr", "institucional/ifpr/ppcs/index.json"],
  ["ppcps-rede-certifica-ifpr", "institucional/ifpr/ppcps/index.json"],
];

/** Coleções cujo `total_itens` sai do próprio índice (as de PPC têm conferência própria em `ppcs.ts`). */
const TOTAL_DO_INDICE = new Set(COLECOES_INSTITUCIONAIS.map(([id]) => id).filter((id) => !id.startsWith("ppc")));

function validarColecao(ctx: Contexto, manifest: unknown, id: string, path: string): string[] {
  const colecao = ctx.colecao(manifest, "colecoes", id);
  if (colecao === undefined) return [];
  if (colecao === null) return [`institucional_manifest.json: coleção ${id} ausente`];
  if (!valoresIguais(colecao.path, path)) return [`institucional_manifest.json: path da coleção ${id} deve ser ${path}`];
  const carregado = ctx.carregarJson(naBase(ctx.c, path), `índice da coleção ${id}`);
  if (!carregado.ok) return carregado.erros;
  if (!TOTAL_DO_INDICE.has(id)) return [];
  const indice = carregado.valor;
  const itens = ehObjeto(indice) && Array.isArray(indice.items) ? indice.items : null;
  if (itens === null) return [`${path}: items deve ser lista`];
  if (!valoresIguais(colecao.total_itens, itens.length)) {
    return [`institucional_manifest.json: total_itens de ${id} diverge de ${path}`];
  }
  return [];
}

export function validarInstitucional(ctx: Contexto): string[] {
  const carregado = ctx.carregarJson(ctx.c.manifestInstitucional, "institucional_manifest.json");
  if (!carregado.ok) return carregado.erros;
  const manifest = carregado.valor;
  if (!ehRecebido<ManifestInstitucionalJson>(manifest)) return ["institucional_manifest.json deve conter um objeto JSON"];
  const { erros } = ctx.conferirSchema(manifest, "manifestInstitucional", "institucional_manifest.json");
  if (!Array.isArray(manifest.colecoes) || !manifest.colecoes.length) {
    erros.push("institucional_manifest.json: colecoes deve ser lista não vazia");
    return erros;
  }
  for (const [id, path] of COLECOES_INSTITUCIONAIS) erros.push(...validarColecao(ctx, manifest, id, path));
  erros.push(...validarPpcs(ctx, manifest));
  erros.push(...validarPpcps(ctx, manifest));
  return erros;
}
