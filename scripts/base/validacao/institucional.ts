/** Validação do institucional_manifest.json e das coleções institucionais. */
import { ehObjeto, valoresIguais } from "../json.ts";
import { validarCampi } from "./campi.ts";
import type { Contexto } from "./contexto.ts";
import { validarPpcps, validarPpcs } from "./ppcs.ts";
import { validarProcessosSeletivos } from "./processos.ts";

function validarManifestInstitucional(ctx: Contexto, manifest: unknown): string[] {
  if (!ehObjeto(manifest)) return ["institucional_manifest.json deve conter um objeto JSON"];
  const erros = ctx.validarComSchema(manifest, ctx.c.schemas.manifestInstitucional, "institucional_manifest.json");
  const colecoes = manifest.colecoes;
  if (!Array.isArray(colecoes) || !colecoes.length) {
    erros.push("institucional_manifest.json: colecoes deve ser lista não vazia");
    return erros;
  }
  const campi = ctx.colecao(manifest, "colecoes", "campi-ifpr");
  if (!campi) erros.push("institucional_manifest.json: coleção campi-ifpr ausente");
  else if (!valoresIguais(campi.path, ctx.rel(ctx.c.indiceCampi))) {
    erros.push("institucional_manifest.json: path da coleção campi-ifpr diverge do índice");
  }
  const caminhosDosIndices: Array<[string, string]> = [
    ["processos-seletivos-ifpr", ctx.c.indiceProcessosSeletivos],
    ["ppcs-ifpr", ctx.c.indicePpcs],
    ["ppcps-rede-certifica-ifpr", ctx.c.indicePpcps],
  ];
  for (const [id, caminho] of caminhosDosIndices) {
    const colecao = ctx.colecao(manifest, "colecoes", id);
    if (colecao && !valoresIguais(colecao.path, ctx.rel(caminho))) {
      erros.push(`institucional_manifest.json: path da coleção ${id} diverge do índice`);
    }
  }
  return erros;
}

export function validarInstitucional(ctx: Contexto): string[] {
  const carregadoManifest = ctx.carregarJson(ctx.c.manifestInstitucional, "institucional_manifest.json");
  const carregadoIndice = ctx.carregarJson(ctx.c.indiceCampi, "índice de campi");
  if (!carregadoManifest.ok || !carregadoIndice.ok) {
    return [
      ...(carregadoManifest.ok ? [] : carregadoManifest.erros),
      ...(carregadoIndice.ok ? [] : carregadoIndice.erros),
    ];
  }
  const manifest = carregadoManifest.valor;
  const indice = carregadoIndice.valor;
  const erros = validarManifestInstitucional(ctx, manifest);

  const rIndice = ctx.rel(ctx.c.indiceCampi);
  if (!ehObjeto(indice)) {
    erros.push(`${rIndice} deve conter um objeto JSON`);
    return erros;
  }
  erros.push(...ctx.validarComSchema(indice, ctx.c.schemas.indiceCampi, rIndice));

  const itens = indice.items;
  if (!Array.isArray(itens) || !itens.length) {
    erros.push(`${rIndice}: items deve ser lista não vazia`);
    return erros;
  }

  const campi = ctx.colecao(manifest, "colecoes", "campi-ifpr");
  if (campi && !valoresIguais(campi.total_itens, itens.length)) {
    erros.push("institucional_manifest.json: total_itens diverge do index.json");
  }

  erros.push(...validarCampi(ctx, rIndice, itens));
  erros.push(...validarPpcs(ctx, manifest));
  erros.push(...validarPpcps(ctx, manifest));
  erros.push(...validarProcessosSeletivos(ctx, manifest));
  return erros;
}
