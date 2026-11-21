// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base), lê os PPCs e os índices com node:fs
/** Validação do índice de PPCs, das seções indexadas e dos artefatos de conversão. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ehDiretorio, listarDiretorio, naBase } from "../caminhos.ts";
import { resumoProveniencia, taxonomiasPublicadas, TIPOS_SECAO_INDEXADOS, VERSAO_INDICE } from "../indice-ppcs.ts";
import { ehObjeto, type ObjetoJson, valoresIguais } from "@simplifica-if/kb/json";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { analisarPpc, idPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { MINIMO_CARACTERES_SECAO, TAXONOMIAS } from "@simplifica-if/kb/ppcs/secoes";
import { validarJsonSchema } from "@simplifica-if/kb/schema";
import type { IndicePpcsJson, SecaoPpcJson } from "../tipos-schemas.ts";
import { aparar, ESPACOS, lerTexto, linhasDeArquivo, ordenarCaminhos, ordenarTextos } from "@simplifica-if/kb/texto";
import { carregarDadosInstitucionais } from "../../dados/institucional.ts";
import { type Contexto, ehRecebido, listaOrdenada, mesmosElementos, type Recebido } from "./contexto.ts";

type ItemIndicePpcs = IndicePpcsJson["items"][number];

const ARTEFATOS_CONVERSAO_PPC: Array<[string, RegExp]> = [
  ["placeholder de imagem omitida", /picture \[[0-9]+ x [0-9]+\] intentionally omitted/],
  ["marcador de início/fim de texto de imagem", /Start of picture text|End of picture text/],
  ["OCR residual isolado", new RegExp(`^[${ESPACOS}]*eme<br>[${ESPACOS}]*$`, "m")],
  ["rodapé PROENS de conversão", /INSTITUTO FEDERAL DO PARANÁ[^\n]*Pró-Reitoria de Ensino - \*\*PROENS\*\*/],
];
const TIPOS_POR_TAXONOMIA = new Map(
  Object.entries(TAXONOMIAS).map(([nome, taxonomia]) => [nome, new Set(taxonomia.tipos.map((d) => d.tipo))]),
);

/** PPCs convertidos declarados nos cursos: `campus/curso` → caminho do Markdown existente. */
function ppcsConvertidosDosCursos(ctx: Contexto): Map<string, string> {
  const ppcs = new Map<string, string>();
  // Registro inválido fica de fora; a validação dos registros institucionais o acusa.
  const { dados } = carregarDadosInstitucionais(NodePath.join(ctx.c.institucional, "ifpr"));
  for (const curso of dados.cursos) {
    const caminhoMarkdown = curso.ppc?.markdown_path;
    if (curso.ppc?.url && caminhoMarkdown && NodeFS.existsSync(naBase(ctx.c, caminhoMarkdown))) {
      ppcs.set(`${curso.campus_id}/${curso.curso_slug}`, caminhoMarkdown);
    }
  }
  return ppcs;
}

/** Erros de uma linha de secoes/<tipo>.jsonl (schema ppcs_secao e coerência com o índice). */
function validarLinhaSecao(
  linhaBruta: string,
  prefixo: string,
  tipoEsperado: string,
  schema: ObjetoJson,
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
  const erros = validarJsonSchema(item, schema, prefixo);
  if (erros.length) return erros;
  const secao = item as unknown as SecaoPpcJson;

  if (idsVistos.has(secao.id)) erros.push(`${prefixo}: id duplicado: ${secao.id}`);
  idsVistos.add(secao.id);
  if (!secao.id.startsWith(`${secao.ppc_id}#${secao.section_kind}-`)) {
    erros.push(`${prefixo}: id não deriva de ppc_id e section_kind: ${secao.id}`);
  }
  const itemPpc = itensIndicePorId.get(secao.ppc_id);
  if (itemPpc === undefined) {
    erros.push(`${prefixo}: ppc_id inexistente no índice: ${secao.ppc_id}`);
    return erros;
  }
  for (const campo of ["campus_id", "curso_slug", "curso_nome", "nivel", "taxonomia", "path"] as const) {
    if (!valoresIguais(secao[campo], itemPpc[campo])) {
      erros.push(`${prefixo}: campo ${campo} diverge do índice para ${secao.ppc_id}`);
    }
  }
  if (secao.section_kind !== tipoEsperado)
    erros.push(`${prefixo}: section_kind diverge do arquivo: ${secao.section_kind}`);
  if (!TIPOS_POR_TAXONOMIA.get(secao.taxonomia)?.has(secao.section_kind)) {
    erros.push(`${prefixo}: section_kind ${secao.section_kind} fora da taxonomia ${secao.taxonomia}`);
  }
  if (secao.linha_fim < secao.linha_inicio) erros.push(`${prefixo}: linha_fim antes de linha_inicio`);
  return erros;
}

function validarSecoesPpc(ctx: Contexto, itensIndicePorId: Map<string, Recebido<ItemIndicePpcs>>): string[] {
  const raizSecoes = ctx.c.secoesPpcs;
  const rSecoes = ctx.rel(raizSecoes);
  if (!ehDiretorio(raizSecoes)) return [`${rSecoes} não encontrado`];

  const erros: string[] = [];
  const schema = ctx.carregarJson(ctx.c.schemas.secaoPpc, `schema ${ctx.rel(ctx.c.schemas.secaoPpc)}`);
  if (!schema.ok) return schema.erros;
  if (!ehObjeto(schema.valor)) return [`schema ${ctx.rel(ctx.c.schemas.secaoPpc)} deve conter um objeto JSON`];
  const idsVistos = new Set<string>();
  const arquivosEsperados = new Set(TIPOS_SECAO_INDEXADOS.map((tipo) => `${tipo}.jsonl`));
  const arquivos = listarDiretorio(raizSecoes, ".jsonl");
  const arquivosAtuais = new Set(arquivos.map((caminho) => NodePath.basename(caminho)));
  for (const nome of ordenarTextos([...arquivosEsperados].filter((nome) => !arquivosAtuais.has(nome)))) {
    erros.push(`${ctx.rel(NodePath.join(raizSecoes, nome))} não encontrado`);
  }
  for (const nome of ordenarTextos([...arquivosAtuais].filter((nome) => !arquivosEsperados.has(nome)))) {
    erros.push(`${ctx.rel(NodePath.join(raizSecoes, nome))} não esperado`);
  }

  for (const caminho of ordenarCaminhos(arquivos)) {
    const tipoEsperado = NodePath.basename(caminho).replace(/\.[^.]*$/, "");
    const r = ctx.rel(caminho);
    for (const [indice, linha] of linhasDeArquivo(lerTexto(caminho)).entries()) {
      erros.push(
        ...validarLinhaSecao(linha, `${r}:${indice + 1}`, tipoEsperado, schema.valor, idsVistos, itensIndicePorId),
      );
    }
  }

  const legado = NodePath.join(NodePath.dirname(raizSecoes), "secoes.jsonl");
  if (NodeFS.existsSync(legado)) {
    erros.push(`${ctx.rel(legado)} não deve mais ser versionado; use arquivos por seção em ${rSecoes}`);
  }
  if (!idsVistos.size) erros.push(`${rSecoes}: deve conter ao menos uma seção`);
  return erros;
}

export function validarPpcs(ctx: Contexto): string[] {
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
    if (!valoresIguais(indice.versao, VERSAO_INDICE)) erros.push(`${rIndice}: versao deve ser ${VERSAO_INDICE}`);
    if (!valoresIguais(secoes.minimo_caracteres, MINIMO_CARACTERES_SECAO)) {
      erros.push(`${rIndice}: secoes.minimo_caracteres deve ser ${MINIMO_CARACTERES_SECAO}`);
    }
    if (!valoresIguais(secoes.taxonomias, taxonomiasPublicadas())) {
      erros.push(`${rIndice}: secoes.taxonomias diverge da taxonomia do pipeline`);
    }
    const esperados = Object.fromEntries(
      TIPOS_SECAO_INDEXADOS.map((tipo) => [tipo, ctx.rel(NodePath.join(ctx.c.secoesPpcs, `${tipo}.jsonl`))]),
    );
    if (!valoresIguais(secoes.paths, esperados)) erros.push(`${rIndice}: secoes.paths diverge dos caminhos esperados`);
  }

  const itens = indice.items;
  if (!Array.isArray(itens) || !itens.length) {
    erros.push(`${rIndice}: items deve ser lista não vazia`);
    return erros;
  }
  if (!valoresIguais(indice.total_itens, itens.length)) erros.push(`${rIndice}: total_itens diverge de items`);

  const ppcsEsperados = ppcsConvertidosDosCursos(ctx);
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
    if (!NodeFS.existsSync(naBase(ctx.c, valorPath)))
      erros.push(`${rIndice}: path inexistente em ${ppcId}: ${valorPath}`);
    const esperado = ppcsEsperados.get(ppcId);
    if (esperado !== undefined && valorPath !== esperado) {
      erros.push(`${rIndice}: path diverge do registro do curso em ${ppcId}: ${valorPath}`);
    }
    erros.push(...validarProvenienciaItem(ctx, item, ppcId, valorPath));
  }

  const idsEsperados = new Set(ppcsEsperados.keys());
  if (!mesmosElementos(idsVistos, idsEsperados)) {
    erros.push(
      `índice de PPCs não cobre exatamente os PPCs convertidos dos cursos: index=${listaOrdenada(idsVistos)} cursos=${listaOrdenada(idsEsperados)}`,
    );
  }

  erros.push(...validarSecoesPpc(ctx, itensPorId));
  return erros;
}

/**
 * Proveniência do PPC: front matter válido, `id` = `ppc:<campus_id>/<curso_slug>`, `fonte_url` igual
 * ao `ppc.url` vigente (a base guarda só o PPC vigente; URL nova exige reconversão) e o resumo do
 * índice igual ao front matter.
 */
function validarProvenienciaItem(
  ctx: Contexto,
  item: Recebido<ItemIndicePpcs>,
  ppcId: string,
  valorPath: string,
): string[] {
  const caminho = naBase(ctx.c, valorPath);
  if (!NodeFS.existsSync(caminho)) return [];
  let proveniencia;
  try {
    ({ proveniencia } = analisarPpc(lerTexto(caminho, { ignorarErros: true }), valorPath));
  } catch (erro) {
    if (ehErroFrontMatter(erro)) return [erro.message];
    throw erro;
  }
  const erros: string[] = [];
  const [campusId, cursoSlug] = ppcId.split("/") as [string, string];
  if (proveniencia.id !== idPpc(campusId, cursoSlug)) {
    erros.push(`${valorPath}: id do front matter deve ser ${idPpc(campusId, cursoSlug)}`);
  }
  if (typeof item.fonte_pdf === "string" && proveniencia.fonte_url !== item.fonte_pdf) {
    erros.push(
      `${valorPath}: fonte_url do front matter difere do ppc.url vigente (${item.fonte_pdf}); o PPC mudou e precisa ser reimportado (node scripts/importar_ppc_docx.ts) ou ppc.url está errado`,
    );
  }
  if (!valoresIguais(item.proveniencia, resumoProveniencia(proveniencia))) {
    erros.push(`índice de PPCs: proveniencia de ${ppcId} diverge do front matter`);
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
