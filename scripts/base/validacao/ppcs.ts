/** Validação do índice de PPCs, das seções indexadas, dos PPCPs e dos artefatos de conversão. */
import { existsSync } from "node:fs";
import path from "node:path";
import { ehDiretorio, listarDiretorio, naBase } from "../caminhos.ts";
import { LIMITE_PREVIEW_SECAO, TIPOS_SECAO_INDEXADOS } from "../indice-ppcs.ts";
import { ehObjeto, itensDe, textoDe, valoresIguais } from "../json.ts";
import type { IndicePpcpsJson, IndicePpcsJson } from "../tipos-schemas.ts";
import {
  aparar,
  contarCaracteres,
  ESPACOS,
  lerTexto,
  linhasDeArquivo,
  ordenarCaminhos,
  ordenarTextos,
} from "../texto.ts";
import { campiLegiveis, type CursoCampus, type PpcCurso } from "./campi.ts";
import { type Contexto, ehRecebido, listaOrdenada, mesmosElementos, type Recebido } from "./contexto.ts";

type ItemIndicePpcs = IndicePpcsJson["items"][number];

const ARTEFATOS_CONVERSAO_PPC: Array<[string, RegExp]> = [
  ["placeholder de imagem omitida", /picture \[[0-9]+ x [0-9]+\] intentionally omitted/],
  ["marcador de início/fim de texto de imagem", /Start of picture text|End of picture text/],
  ["OCR residual isolado", new RegExp(`^[${ESPACOS}]*eme<br>[${ESPACOS}]*$`, "m")],
  ["rodapé PROENS de conversão", /INSTITUTO FEDERAL DO PARANÁ[^\n]*Pró-Reitoria de Ensino - \*\*PROENS\*\*/],
];
const TIPOS_SECAO = new Set(TIPOS_SECAO_INDEXADOS);
const CAMPOS_SECAO = [
  "id",
  "ppc_id",
  "campus_id",
  "curso_slug",
  "curso_nome",
  "section_kind",
  "heading",
  "path",
  "preview",
];

/** PPCs convertidos declarados nos campi: `campus/curso` → caminho do Markdown existente. */
function ppcsConvertidosDosCampi(ctx: Contexto): Map<string, string> {
  const ppcs = new Map<string, string>();
  for (const [campusId, dados] of campiLegiveis(ctx)) {
    for (const curso of itensDe(dados.cursos)) {
      if (!ehRecebido<CursoCampus>(curso)) continue;
      const cursoSlug = curso.curso_slug;
      const ppc = curso.ppc;
      if (typeof cursoSlug !== "string" || !ehRecebido<PpcCurso>(ppc)) continue;
      const caminhoMarkdown = ppc.markdown_path;
      if (
        ehRecebido<PpcCurso["conversao"]>(ppc.conversao) &&
        ppc.conversao.status === "convertido" &&
        typeof caminhoMarkdown === "string" &&
        existsSync(naBase(ctx.c, caminhoMarkdown))
      ) {
        ppcs.set(`${campusId}/${cursoSlug}`, caminhoMarkdown);
      }
    }
  }
  return ppcs;
}

/** Erros de uma linha de secoes/<tipo>.jsonl. */
function validarLinhaSecao(
  linhaBruta: string,
  prefixo: string,
  tipoEsperado: string,
  idsVistos: Set<string>,
  itensIndicePorId: Map<string, Recebido<ItemIndicePpcs>>,
): string[] {
  const linha = aparar(linhaBruta);
  if (!linha) return [`${prefixo}: linha vazia`];
  let item: unknown;
  try {
    item = JSON.parse(linha);
  } catch (erro) {
    return [`${prefixo}: JSON inválido: ${(erro as Error).message}`];
  }
  if (!ehObjeto(item)) return [`${prefixo}: item deve ser objeto`];
  const ausentes = ordenarTextos(CAMPOS_SECAO.filter((campo) => !Object.hasOwn(item, campo)));
  if (ausentes.length) return [`${prefixo}: campos ausentes: ${ausentes.join(", ")}`];
  const secaoId = item.id;
  const ppcId = item.ppc_id;
  if (typeof secaoId !== "string" || typeof ppcId !== "string") return [`${prefixo}: id e ppc_id devem ser texto`];

  const erros: string[] = [];
  if (idsVistos.has(secaoId)) erros.push(`${prefixo}: id duplicado: ${secaoId}`);
  idsVistos.add(secaoId);
  if (!secaoId.startsWith(`${ppcId}#`)) erros.push(`${prefixo}: id não deriva de ppc_id: ${secaoId}`);
  const itemPpc = itensIndicePorId.get(ppcId);
  if (itemPpc === undefined) {
    erros.push(`${prefixo}: ppc_id inexistente no índice: ${ppcId}`);
    return erros;
  }
  for (const campo of ["campus_id", "curso_slug", "curso_nome", "path"] as const) {
    if (!valoresIguais(item[campo], itemPpc[campo])) {
      erros.push(`${prefixo}: campo ${campo} diverge do índice para ${ppcId}`);
    }
  }
  const tipo = item.section_kind;
  if (typeof tipo !== "string" || !TIPOS_SECAO.has(tipo)) {
    erros.push(`${prefixo}: section_kind inválido: ${textoDe(tipo)}`);
  } else if (tipo !== tipoEsperado) erros.push(`${prefixo}: section_kind diverge do arquivo: ${tipo}`);
  for (const campo of ["heading", "preview"]) {
    const valor = item[campo];
    if (typeof valor !== "string" || !aparar(valor)) erros.push(`${prefixo}: ${campo} deve ser texto não vazio`);
  }
  const preview = item.preview;
  if (typeof preview === "string" && contarCaracteres(preview) > LIMITE_PREVIEW_SECAO) {
    erros.push(`${prefixo}: preview excede ${LIMITE_PREVIEW_SECAO} caracteres`);
  }
  return erros;
}

function validarSecoesPpc(ctx: Contexto, itensIndicePorId: Map<string, Recebido<ItemIndicePpcs>>): string[] {
  const raizSecoes = ctx.c.secoesPpcs;
  const rSecoes = ctx.rel(raizSecoes);
  if (!ehDiretorio(raizSecoes)) return [`${rSecoes} não encontrado`];

  const erros: string[] = [];
  const idsVistos = new Set<string>();
  const arquivosEsperados = new Set(TIPOS_SECAO_INDEXADOS.map((tipo) => `${tipo}.jsonl`));
  const arquivos = listarDiretorio(raizSecoes, ".jsonl");
  const arquivosAtuais = new Set(arquivos.map((caminho) => path.basename(caminho)));
  for (const nome of ordenarTextos([...arquivosEsperados].filter((nome) => !arquivosAtuais.has(nome)))) {
    erros.push(`${ctx.rel(path.join(raizSecoes, nome))} não encontrado`);
  }
  for (const nome of ordenarTextos([...arquivosAtuais].filter((nome) => !arquivosEsperados.has(nome)))) {
    erros.push(`${ctx.rel(path.join(raizSecoes, nome))} não esperado`);
  }

  for (const caminho of ordenarCaminhos(arquivos)) {
    const tipoEsperado = path.basename(caminho).replace(/\.[^.]*$/, "");
    const r = ctx.rel(caminho);
    for (const [indice, linha] of linhasDeArquivo(lerTexto(caminho)).entries()) {
      erros.push(...validarLinhaSecao(linha, `${r}:${indice + 1}`, tipoEsperado, idsVistos, itensIndicePorId));
    }
  }

  const legado = path.join(path.dirname(raizSecoes), "secoes.jsonl");
  if (existsSync(legado)) {
    erros.push(`${ctx.rel(legado)} não deve mais ser versionado; use arquivos por seção em ${rSecoes}`);
  }
  if (!idsVistos.size) erros.push(`${rSecoes}: deve conter ao menos uma seção`);
  return erros;
}

export function validarPpcs(ctx: Contexto, manifest: unknown): string[] {
  const rIndice = ctx.rel(ctx.c.indicePpcs);
  const carregado = ctx.carregarJson(ctx.c.indicePpcs, "índice de PPCs");
  if (!carregado.ok) return carregado.erros;
  const indice = carregado.valor;
  if (!ehRecebido<IndicePpcsJson>(indice)) return [`${rIndice} deve conter um objeto JSON`];

  const { erros } = ctx.conferirSchema(indice, "indicePpcs", rIndice);
  const secoes = indice.secoes;
  if (!ehRecebido<IndicePpcsJson["secoes"]>(secoes)) {
    erros.push(`${rIndice}: secoes deve ser objeto`);
  } else {
    if (!valoresIguais(secoes.preview_limite, LIMITE_PREVIEW_SECAO)) {
      erros.push(`${rIndice}: secoes.preview_limite deve ser ${LIMITE_PREVIEW_SECAO}`);
    }
    const esperados = Object.fromEntries(
      TIPOS_SECAO_INDEXADOS.map((tipo) => [tipo, ctx.rel(path.join(ctx.c.secoesPpcs, `${tipo}.jsonl`))]),
    );
    if (!valoresIguais(secoes.paths, esperados)) erros.push(`${rIndice}: secoes.paths diverge dos caminhos esperados`);
  }

  const itens = indice.items;
  if (!Array.isArray(itens) || !itens.length) {
    erros.push(`${rIndice}: items deve ser lista não vazia`);
    return erros;
  }
  if (!valoresIguais(indice.total_itens, itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

  const colecao = ctx.colecao(manifest, "colecoes", "ppcs-ifpr");
  if (colecao === null) erros.push("institucional_manifest.json: coleção ppcs-ifpr ausente");
  else if (colecao && !valoresIguais(colecao.total_itens, itens.length)) {
    erros.push("institucional_manifest.json: total_itens de ppcs-ifpr diverge do index.json");
  }

  const ppcsEsperados = ppcsConvertidosDosCampi(ctx);
  const idsVistos = new Set<string>();
  const itensPorId = new Map<string, Recebido<ItemIndicePpcs>>();
  for (const item of itens) {
    if (!ehRecebido<ItemIndicePpcs>(item)) {
      erros.push(`${rIndice}: item deve ser objeto`);
      continue;
    }
    const { id: ppcId, campus_id: campusId, curso_slug: cursoSlug, path: valorPath } = item;
    if (typeof ppcId !== "string") {
      erros.push(`${rIndice}: item sem id textual`);
      continue;
    }
    if (idsVistos.has(ppcId)) erros.push(`${rIndice}: id duplicado: ${ppcId}`);
    idsVistos.add(ppcId);
    itensPorId.set(ppcId, item);
    if (typeof campusId === "string" && typeof cursoSlug === "string" && ppcId !== `${campusId}/${cursoSlug}`) {
      erros.push(`${rIndice}: id diverge de campus_id/curso_slug: ${ppcId}`);
    }
    if (typeof valorPath !== "string") {
      erros.push(`${rIndice}: path ausente em ${ppcId}`);
      continue;
    }
    if (!existsSync(naBase(ctx.c, valorPath))) erros.push(`${rIndice}: path inexistente em ${ppcId}: ${valorPath}`);
    const esperado = ppcsEsperados.get(ppcId);
    if (esperado !== undefined && valorPath !== esperado) {
      erros.push(`${rIndice}: path diverge do campus JSON em ${ppcId}: ${valorPath}`);
    }
  }

  const idsEsperados = new Set(ppcsEsperados.keys());
  if (!mesmosElementos(idsVistos, idsEsperados)) {
    erros.push(
      `índice de PPCs não cobre exatamente os PPCs convertidos dos campi: index=${listaOrdenada(idsVistos)} campi=${listaOrdenada(idsEsperados)}`,
    );
  }

  erros.push(...validarSecoesPpc(ctx, itensPorId));
  return erros;
}

export function validarPpcps(ctx: Contexto, manifest: unknown): string[] {
  const rIndice = ctx.rel(ctx.c.indicePpcps);
  const carregado = ctx.carregarJson(ctx.c.indicePpcps, "índice de PPCPs");
  if (!carregado.ok) return carregado.erros;
  const indice = carregado.valor;
  if (!ehRecebido<IndicePpcpsJson>(indice)) return [];

  const { erros } = ctx.conferirSchema(indice, "indicePpcps", rIndice);
  const itens = indice.items;
  if (!Array.isArray(itens) || !itens.length) return erros;
  if (!valoresIguais(indice.total_itens, itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

  const colecao = ctx.colecao(manifest, "colecoes", "ppcps-rede-certifica-ifpr");
  if (colecao === null) erros.push("institucional_manifest.json: coleção ppcps-rede-certifica-ifpr ausente");
  else if (colecao && !valoresIguais(colecao.total_itens, itens.length)) {
    erros.push("institucional_manifest.json: total_itens de ppcps-rede-certifica-ifpr diverge do index.json");
  }

  const idsVistos = new Set<string>();
  const pathsIndice = new Set<string>();
  for (const item of itens) {
    if (!ehRecebido<IndicePpcpsJson["items"][number]>(item)) continue;
    const { id: itemId, path: valorPath } = item;
    if (typeof itemId === "string") {
      if (idsVistos.has(itemId)) erros.push(`${rIndice}: id duplicado: ${itemId}`);
      idsVistos.add(itemId);
    }
    if (typeof valorPath !== "string") continue;
    if (pathsIndice.has(valorPath)) erros.push(`${rIndice}: path duplicado: ${valorPath}`);
    pathsIndice.add(valorPath);
    const caminho = naBase(ctx.c, valorPath);
    if (!existsSync(caminho)) {
      erros.push(`${rIndice}: path inexistente: ${valorPath}`);
      continue;
    }
    erros.push(...ctx.validarLinks(caminho, lerTexto(caminho)));
  }

  const pathsMarkdown = new Set(listarDiretorio(ctx.c.ppcps, ".md").map((caminho) => ctx.rel(caminho)));
  if (!mesmosElementos(pathsIndice, pathsMarkdown)) {
    erros.push(
      `índice de PPCPs não cobre exatamente os Markdown da coleção: index=${listaOrdenada(pathsIndice)} arquivos=${listaOrdenada(pathsMarkdown)}`,
    );
  }
  return erros;
}

/** Artefatos conhecidos da conversão PDF → Markdown nos PPCs (opcional, `--check-ppc-artifacts`). */
export function validarArtefatosConversaoPpc(ctx: Contexto): string[] {
  const erros: string[] = [];
  const markdowns = listarDiretorio(ctx.c.ppcs)
    .filter(ehDiretorio)
    .flatMap((diretorio) => listarDiretorio(diretorio, ".md"));
  for (const caminho of markdowns) {
    const texto = lerTexto(caminho, { ignorarErros: true });
    for (const [rotulo, padrao] of ARTEFATOS_CONVERSAO_PPC) {
      if (padrao.test(texto)) erros.push(`${ctx.rel(caminho)}: contém artefato de conversão: ${rotulo}`);
    }
  }
  return erros;
}
