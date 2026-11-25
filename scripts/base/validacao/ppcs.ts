// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base), lê os PPCs e os índices com node:fs
/** Validação do índice de PPCs e das seções indexadas. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ehDiretorio, listarDiretorio, naBase } from "../caminhos.ts";
import { resumoProveniencia, taxonomiasPublicadas, TIPOS_SECAO_INDEXADOS, VERSAO_INDICE } from "../indice-ppcs.ts";
import { ehObjeto, type ObjetoJson, valoresIguais } from "@simplifica-if/kb/json";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { analisarPpc, conferirEvidenciaAno } from "@simplifica-if/kb/ppcs/front-matter";
import { caminhoPpc, chavePpc, compararVersoesPpc, idPpc, partesDoCaminhoPpc } from "@simplifica-if/kb/ppcs/ids";
import { MINIMO_CARACTERES_SECAO, TAXONOMIAS } from "@simplifica-if/kb/ppcs/secoes";
import { validarJsonSchema } from "@simplifica-if/kb/schema";
import type { IndicePpcsJson, SecaoPpcJson } from "../tipos-schemas.ts";
import { aparar, lerTexto, linhasDeArquivo, ordenarCaminhos, ordenarTextos } from "@simplifica-if/kb/texto";
import { type Contexto, ehRecebido, type Recebido } from "./contexto.ts";

type ItemIndicePpcs = IndicePpcsJson["items"][number];

const TIPOS_POR_TAXONOMIA = new Map(
  Object.entries(TAXONOMIAS).map(([nome, taxonomia]) => [nome, new Set(taxonomia.tipos.map((d) => d.tipo))]),
);

/** PPC vigente de cada curso: `campus/curso` → caminho do Markdown existente (`ppc.markdown_path`). */
function ppcsVigentesDosCursos(ctx: Contexto): Map<string, string> {
  const ppcs = new Map<string, string>();
  // Registro inválido fica de fora; a validação dos registros institucionais o acusa.
  const { dados } = ctx.dadosInstitucionais();
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

  const vigentesDosCursos = ppcsVigentesDosCursos(ctx);
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
    const versao = item.versao;
    if (typeof campusId !== "string" || typeof cursoSlug !== "string" || typeof versao !== "string") continue;
    if (ppcId !== chavePpc(campusId, cursoSlug, versao)) {
      erros.push(`${rIndice}: id diverge de campus_id/curso_slug/versao: ${ppcId}`);
    }
    if (typeof valorPath !== "string") {
      erros.push(`${rIndice}: path ausente em ${ppcId}`);
      continue;
    }
    if (valorPath !== caminhoPpc(campusId, cursoSlug, versao)) {
      erros.push(`${rIndice}: path diverge do id em ${ppcId}: ${valorPath}`);
    }
    if (!NodeFS.existsSync(naBase(ctx.c, valorPath)))
      erros.push(`${rIndice}: path inexistente em ${ppcId}: ${valorPath}`);
    const vigenteDoCurso = vigentesDosCursos.get(`${campusId}/${cursoSlug}`);
    if (item.vigente !== (valorPath === vigenteDoCurso)) {
      erros.push(
        `${rIndice}: vigente de ${ppcId} diverge do ppc.markdown_path do curso (${vigenteDoCurso ?? "nenhum"})`,
      );
    }
    erros.push(...validarProvenienciaItem(ctx, item, ppcId, valorPath));
  }

  erros.push(
    ...validarVersoesPpc(
      ctx,
      itens.filter((i) => ehRecebido<ItemIndicePpcs>(i)),
      vigentesDosCursos,
    ),
  );

  erros.push(...validarSecoesPpc(ctx, itensPorId));
  return erros;
}

/**
 * Todo PPC da base fica no índice, e cada curso tem um PPC vigente, a versão mais recente: os
 * Markdown em `ppcs/<campus>/<curso>/<versao>.md` são exatamente os itens do índice, cada curso com
 * `ppc.markdown_path` tem um item vigente, e nenhuma versão substituída é mais nova que ele. Arquivo
 * fora desse caminho (ou de curso sem registro) é erro: PPC não sai da base, mas também não fica solto.
 */
function validarVersoesPpc(
  ctx: Contexto,
  itens: Array<Recebido<ItemIndicePpcs>>,
  vigentesDosCursos: Map<string, string>,
): string[] {
  const erros: string[] = [];
  const noIndice = new Set(itens.map((item) => item.path).filter((p): p is string => typeof p === "string"));
  const noDisco = new Set(
    listarDiretorio(ctx.c.ppcs)
      .flatMap((pasta) =>
        ehDiretorio(pasta) && NodePath.basename(pasta) !== "secoes"
          ? [
              ...listarDiretorio(pasta, ".md"),
              ...listarDiretorio(pasta).flatMap((sub) => (ehDiretorio(sub) ? listarDiretorio(sub, ".md") : [])),
            ]
          : [],
      )
      .map((caminho) => ctx.rel(caminho)),
  );
  for (const caminho of ordenarCaminhos([...noDisco])) {
    if (!partesDoCaminhoPpc(caminho)) erros.push(`${caminho}: PPC fora do caminho ppcs/<campus>/<curso>/<versao>.md`);
    else if (!noIndice.has(caminho)) erros.push(`${caminho}: PPC sem item no índice (curso sem registro?)`);
  }
  const vigentesNoIndice = new Map<string, Recebido<ItemIndicePpcs>>();
  const ultimaVersao = new Map<string, string>();
  for (const item of itens) {
    if (typeof item.campus_id !== "string" || typeof item.curso_slug !== "string" || typeof item.versao !== "string")
      continue;
    const curso = `${item.campus_id}/${item.curso_slug}`;
    if (item.vigente === true) vigentesNoIndice.set(curso, item);
    const ultima = ultimaVersao.get(curso);
    if (ultima === undefined || compararVersoesPpc(item.versao, ultima) > 0) ultimaVersao.set(curso, item.versao);
  }
  for (const curso of ordenarTextos([...vigentesDosCursos.keys()])) {
    const vigente = vigentesNoIndice.get(curso);
    if (!vigente) {
      erros.push(`índice de PPCs: curso ${curso} sem PPC vigente no índice`);
    } else if (vigente.versao !== ultimaVersao.get(curso)) {
      erros.push(
        `índice de PPCs: o PPC vigente de ${curso} (${String(vigente.versao)}) não é a versão mais recente (${ultimaVersao.get(curso)})`,
      );
    }
  }
  return erros;
}

/**
 * Proveniência do PPC: front matter válido, `id` = `ppc:<campus_id>/<curso_slug>/<versao>`,
 * `fonte_url` igual à fonte do índice (no vigente, o `ppc.url` do curso: URL nova é PPC novo, que
 * entra como versão nova) e o resumo do índice igual ao front matter.
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
  let corpo;
  try {
    ({ proveniencia, corpo } = analisarPpc(lerTexto(caminho, { ignorarErros: true }), valorPath));
  } catch (erro) {
    if (ehErroFrontMatter(erro)) return [erro.message];
    throw erro;
  }
  const erros: string[] = [];
  const [campusId, cursoSlug, versao] = ppcId.split("/") as [string, string, string];
  if (proveniencia.id !== idPpc(campusId, cursoSlug, versao)) {
    erros.push(`${valorPath}: id do front matter deve ser ${idPpc(campusId, cursoSlug, versao)}`);
  }
  if (typeof item.fonte_pdf === "string" && proveniencia.fonte_url !== item.fonte_pdf) {
    erros.push(
      `${valorPath}: fonte_url do front matter difere do ppc.url vigente (${item.fonte_pdf}); o PPC mudou e a versão nova entra pelo node scripts/importar_ppc_docx.ts, ou ppc.url está errado`,
    );
  }
  if (!valoresIguais(item.proveniencia, resumoProveniencia(proveniencia))) {
    erros.push(`índice de PPCs: proveniencia de ${ppcId} diverge do front matter`);
  }
  const problemaEvidencia = conferirEvidenciaAno(proveniencia, corpo);
  if (problemaEvidencia) erros.push(`${valorPath}: ${problemaEvidencia}`);
  if (
    item.ano_documento !== Number(proveniencia.ano_documento) ||
    item.ano_evidencia !== proveniencia.ano_evidencia ||
    item.ano_fonte !== proveniencia.ano_fonte
  ) {
    erros.push(`índice de PPCs: ano de ${ppcId} diverge do front matter`);
  }
  return erros;
}
