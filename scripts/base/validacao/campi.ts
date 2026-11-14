// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base), lê os JSONs com node:fs
/** Validação dos JSONs de campi (institucional/ifpr/campi/). */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { naBase } from "../caminhos.ts";
import { itensDe, textoDe, valoresIguais } from "@simplifica-if/kb/json";
import type { CampusJson, IndiceCampiJson } from "../tipos-schemas.ts";
import { type Contexto, ehRecebido, listaOrdenada, mesmosElementos, RE_SLUG, type Recebido } from "./contexto.ts";

export type CursoCampus = CampusJson["cursos"][number];
export type PpcCurso = NonNullable<CursoCampus["ppc"]>;
type ProgramaCampus = NonNullable<CampusJson["programas"]>[number];
type ItemIndiceCampi = IndiceCampiJson["items"][number];

/** Erros do `ppc` de um curso do campus `r`. */
function validarPpcDoCurso(
  ctx: Contexto,
  r: string,
  ppc: Recebido<PpcCurso>,
  campusId: unknown,
  cursoSlug: unknown,
): string[] {
  const erros = ctx.validarUrlHttps(ppc.url, `${r}: cursos[].ppc.url`);

  const caminhoMarkdown = ppc.markdown_path;
  const conversao = ppc.conversao;
  const statusConversao = ehRecebido<PpcCurso["conversao"]>(conversao) ? conversao.status : "";
  if (statusConversao === "convertido" && typeof caminhoMarkdown !== "string") {
    erros.push(`${r}: cursos[].ppc.markdown_path deve ser texto quando conversao.status=convertido`);
  } else if (
    typeof caminhoMarkdown === "string" &&
    (!caminhoMarkdown.startsWith("institucional/ifpr/ppcs/") || !caminhoMarkdown.endsWith(".md"))
  ) {
    erros.push(`${r}: cursos[].ppc.markdown_path deve apontar para institucional/ifpr/ppcs/*.md`);
  } else if (typeof campusId === "string" && typeof cursoSlug === "string") {
    const esperado = `institucional/ifpr/ppcs/${campusId}/${cursoSlug}.md`;
    if (typeof caminhoMarkdown === "string" && caminhoMarkdown !== esperado) {
      erros.push(`${r}: cursos[].ppc.markdown_path esperado para ${cursoSlug}: ${esperado}`);
    }
  }

  if (!ehRecebido<PpcCurso["conversao"]>(conversao)) {
    erros.push(`${r}: cursos[].ppc.conversao deve ser objeto`);
  } else if (conversao.status === "convertido") {
    if (typeof caminhoMarkdown === "string" && !NodeFS.existsSync(naBase(ctx.c, caminhoMarkdown))) {
      erros.push(`${r}: markdown convertido inexistente: ${caminhoMarkdown}`);
    }
  }

  const metadados = ppc.metadados;
  if (ehRecebido<NonNullable<PpcCurso["metadados"]>>(metadados)) {
    const vagas = metadados.vagas;
    if (vagas !== undefined && vagas !== null && !ehRecebido<NonNullable<PpcCurso["metadados"]>["vagas"]>(vagas)) {
      erros.push(`${r}: cursos[].ppc.metadados.vagas deve ser objeto contextual`);
    }
  }
  return erros;
}

function validarCursos(ctx: Contexto, r: string, cursos: unknown[], campusId: unknown): string[] {
  const erros: string[] = [];
  const slugsVistos = new Set<string>();
  for (const curso of cursos) {
    if (!ehRecebido<CursoCampus>(curso)) continue;
    const cursoSlug = curso.curso_slug;
    if (typeof cursoSlug === "string") {
      if (slugsVistos.has(cursoSlug)) erros.push(`${r}: curso duplicado: ${cursoSlug}`);
      slugsVistos.add(cursoSlug);
    }
    if (Object.hasOwn(curso, "url")) erros.push(...ctx.validarUrlHttps(curso.url, `${r}: cursos[].url`));
    if (Object.hasOwn(curso, "ppc_url")) erros.push(`${r}: cursos[].ppc_url foi substituído por cursos[].ppc.url`);
    const cnctId = curso.cnct_id;
    if (typeof cnctId === "string" && cnctId.startsWith("cnct:")) {
      if (!NodeFS.existsSync(naBase(ctx.c, `catalogos/cnct/cursos/${cnctId.slice("cnct:".length)}.json`))) {
        erros.push(`${r}: cursos[].cnct_id não existe no CNCT: ${cnctId}`);
      }
    }
    const ppc = curso.ppc;
    if (ppc === undefined || ppc === null) continue;
    if (!ehRecebido<PpcCurso>(ppc)) {
      erros.push(`${r}: cursos[].ppc deve ser objeto`);
      continue;
    }
    erros.push(...validarPpcDoCurso(ctx, r, ppc, campusId, cursoSlug));
  }
  return erros;
}

function validarProgramas(ctx: Contexto, r: string, programas: unknown[]): string[] {
  const erros: string[] = [];
  const programasVistos = new Set<string>();
  for (const programa of programas) {
    if (!ehRecebido<ProgramaCampus>(programa)) continue;
    const programaId = programa.id;
    if (typeof programaId === "string") {
      if (programasVistos.has(programaId)) erros.push(`${r}: programa duplicado: ${programaId}`);
      programasVistos.add(programaId);
    }
    if (Object.hasOwn(programa, "url")) erros.push(...ctx.validarUrlHttps(programa.url, `${r}: programas[].url`));

    const ofertas = programa.ofertas;
    if (!Array.isArray(ofertas)) {
      erros.push(`${r}: programas[].ofertas deve ser array`);
      continue;
    }
    const ofertasVistas = new Set<string>();
    for (const oferta of ofertas) {
      if (!ehRecebido<ProgramaCampus["ofertas"][number]>(oferta)) continue;
      const ofertaId = oferta.id;
      if (typeof ofertaId === "string") {
        if (ofertasVistas.has(ofertaId)) {
          erros.push(`${r}: oferta duplicada em programa ${textoDe(programaId)}: ${ofertaId}`);
        }
        ofertasVistas.add(ofertaId);
      }
      if (Object.hasOwn(oferta, "url")) {
        erros.push(...ctx.validarUrlHttps(oferta.url, `${r}: programas[].ofertas[].url`));
      }
    }
  }
  return erros;
}

/** Arquivo de um campus, conferido contra o seu item em campi/index.json. */
export function validarArquivoCampus(ctx: Contexto, caminho: string, itemIndice: Recebido<ItemIndiceCampi>): string[] {
  const r = ctx.rel(caminho);
  const carregado = ctx.carregarJson(caminho, `arquivo de campus ${r}`);
  if (!carregado.ok) return carregado.erros;
  const dados = carregado.valor;
  if (!ehRecebido<CampusJson>(dados)) return [`${r} deve conter um objeto JSON`];
  const { erros } = ctx.conferirSchema(dados, "campus", r);

  for (const campo of ["id", "nome", "links", "cursos"] satisfies Array<keyof CampusJson>) {
    if (!Object.hasOwn(dados, campo)) erros.push(`${r}: campo obrigatório ausente: ${campo}`);
  }

  const campusId = dados.id;
  if (typeof campusId !== "string" || !RE_SLUG.test(campusId)) erros.push(`${r}: id deve ser slug ASCII minúsculo`);
  else if (NodePath.basename(caminho) !== `${campusId}.json`) erros.push(`${r}: nome do arquivo diverge do id`);

  for (const campo of ["id", "nome"] as const) {
    if (!valoresIguais(dados[campo], itemIndice[campo])) erros.push(`${r}: campo ${campo} diverge do index.json`);
  }

  const links = dados.links;
  if (!ehRecebido<CampusJson["links"]>(links)) {
    erros.push(`${r}: links deve ser objeto`);
  } else {
    for (const campo of ["site", "calendario_academico"] satisfies Array<keyof CampusJson["links"]>) {
      if (!Object.hasOwn(links, campo)) erros.push(`${r}: links.${campo} ausente`);
      else erros.push(...ctx.validarUrlHttps(links[campo], `${r}: links.${campo}`));
    }
  }

  const cursos = dados.cursos;
  if (!Array.isArray(cursos)) erros.push(`${r}: cursos deve ser array`);
  else erros.push(...validarCursos(ctx, r, cursos, campusId));

  const programas = dados.programas === undefined ? [] : dados.programas;
  if (!Array.isArray(programas)) erros.push(`${r}: programas deve ser array`);
  else erros.push(...validarProgramas(ctx, r, programas));
  return erros;
}

/** Itens de campi/index.json e seus arquivos de campus. */
export function validarCampi(ctx: Contexto, rIndice: string, itens: unknown[]): string[] {
  const erros: string[] = [];
  const idsVistos = new Set<string>();
  const pathsIndice = new Set<string>();
  for (const item of itens) {
    if (!ehRecebido<ItemIndiceCampi>(item)) {
      erros.push(`${rIndice}: item deve ser objeto`);
      continue;
    }
    const campusId = item.id;
    const valorPath = item.path;
    if (typeof campusId !== "string" || !RE_SLUG.test(campusId)) {
      erros.push(`${rIndice}: id inválido: ${textoDe(campusId)}`);
    } else if (idsVistos.has(campusId)) erros.push(`${rIndice}: id duplicado: ${campusId}`);
    else idsVistos.add(campusId);
    const nome = item.nome;
    if (typeof nome !== "string" || !nome) erros.push(`${rIndice}: nome ausente em ${textoDe(campusId)}`);
    if (typeof valorPath !== "string") {
      erros.push(`${rIndice}: path ausente em ${textoDe(campusId)}`);
      continue;
    }
    if (!valorPath.startsWith("institucional/ifpr/campi/") || !valorPath.endsWith(".json")) {
      erros.push(`${rIndice}: path inválido em ${textoDe(campusId)}: ${valorPath}`);
      continue;
    }
    pathsIndice.add(valorPath);
    erros.push(...validarArquivoCampus(ctx, naBase(ctx.c, valorPath), item));
  }
  return erros.concat(coberturaCampi(ctx, pathsIndice));
}

function coberturaCampi(ctx: Contexto, pathsIndice: Set<string>): string[] {
  const pathsCampi = new Set(ctx.arquivosCampi().map((caminho) => ctx.rel(caminho)));
  if (mesmosElementos(pathsIndice, pathsCampi)) return [];
  return [
    `index.json não cobre exatamente os arquivos de campi: index=${listaOrdenada(pathsIndice)} arquivos=${listaOrdenada(pathsCampi)}`,
  ];
}

/** Campus JSON legíveis com `id` textual, em ordem de caminho. */
export function* campiLegiveis(ctx: Contexto): Generator<[string, Recebido<CampusJson>]> {
  for (const caminho of ctx.arquivosCampi()) {
    const carregado = ctx.carregarJson(caminho, `campus ${ctx.rel(caminho)}`);
    if (!carregado.ok || !ehRecebido<CampusJson>(carregado.valor)) continue;
    const campusId = carregado.valor.id;
    if (typeof campusId !== "string") continue;
    yield [campusId, carregado.valor];
  }
}

/** Slugs de curso de cada campus legível. */
export function cursosPorCampus(ctx: Contexto): Map<string, Set<string>> {
  const resultado = new Map<string, Set<string>>();
  for (const [campusId, dados] of campiLegiveis(ctx)) {
    const cursos = new Set<string>();
    for (const curso of itensDe(dados.cursos)) {
      if (ehRecebido<CursoCampus>(curso) && typeof curso.curso_slug === "string") cursos.add(curso.curso_slug);
    }
    resultado.set(campusId, cursos);
  }
  return resultado;
}
