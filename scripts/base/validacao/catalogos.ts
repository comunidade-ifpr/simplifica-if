/** Validação dos catálogos (catalogos_manifest.json e CNCT). */
import path from "node:path";
import { listarDiretorio, listarRecursivo, naBase } from "../caminhos.ts";
import { ehInteiro, ehObjeto, type ObjetoJson, textoDe, valoresIguais } from "../json.ts";
import { type Contexto, listaOrdenada, mesmosElementos, RE_SLUG } from "./contexto.ts";

export const CAMPOS_CURSO_CNCT = [
  "id",
  "indice",
  "denominacao",
  "denominacao_normalizada",
  "eixo_tecnologico",
  "area_tecnologica",
  "carga_horaria_minima_horas",
  "descricao_carga_horaria_minima",
  "perfil_profissional",
  "pre_requisitos_ingresso",
  "itinerarios_formativos",
  "campo_atuacao",
  "ocupacoes_cbo",
  "codigos_cbo",
  "infraestrutura_minima",
  "legislacao_profissional",
];
const CAMPOS_REPETIDOS_NO_INDICE = [
  "id",
  "denominacao",
  "denominacao_normalizada",
  "eixo_tecnologico",
  "area_tecnologica",
  "carga_horaria_minima_horas",
  "codigos_cbo",
];

function validarArquivoCursoCnct(ctx: Contexto, caminho: string, itemIndice: ObjetoJson): string[] {
  const r = ctx.rel(caminho);
  const carregado = ctx.carregarJson(caminho, `curso CNCT ${r}`);
  if (!carregado.ok) return carregado.erros;
  const dados = carregado.valor;
  if (!ehObjeto(dados)) return [`${r} deve conter um objeto JSON`];
  const erros = ctx.validarComSchema(dados, ctx.c.schemas.cursoCnct, r);

  const cursoId = dados.id;
  if (typeof cursoId !== "string" || !RE_SLUG.test(cursoId)) erros.push(`${r}: id deve ser slug ASCII minúsculo`);
  else if (path.basename(caminho) !== `${cursoId}.json`) erros.push(`${r}: nome do arquivo diverge do id`);

  for (const campo of CAMPOS_REPETIDOS_NO_INDICE) {
    if (!valoresIguais(dados[campo], itemIndice[campo])) erros.push(`${r}: campo ${campo} diverge do index.json`);
  }

  const codigosCbo = dados.codigos_cbo;
  if (Array.isArray(codigosCbo)) {
    const vistos = new Set<string>();
    const ocupacoes = dados.ocupacoes_cbo === undefined ? "" : textoDe(dados.ocupacoes_cbo);
    for (const codigo of codigosCbo) {
      if (typeof codigo !== "string") continue;
      if (vistos.has(codigo)) erros.push(`${r}: codigos_cbo duplicado: ${codigo}`);
      vistos.add(codigo);
      if (!ocupacoes.includes(codigo)) erros.push(`${r}: codigos_cbo não aparece em ocupacoes_cbo: ${codigo}`);
    }
  }
  return erros;
}

function validarCatalogosManifest(ctx: Contexto, manifestCatalogos: unknown, rManifestCnct: string): string[] {
  if (!ehObjeto(manifestCatalogos)) return ["catalogos_manifest.json deve conter um objeto JSON"];
  const erros = ctx.validarComSchema(manifestCatalogos, ctx.c.schemas.manifestCatalogos, "catalogos_manifest.json");
  const catalogos = manifestCatalogos.catalogos;
  if (!Array.isArray(catalogos) || !catalogos.length) {
    erros.push("catalogos_manifest.json: catalogos deve ser lista não vazia");
    return erros;
  }
  const cnct = ctx.colecao(manifestCatalogos, "catalogos", "cnct");
  if (!cnct) erros.push("catalogos_manifest.json: catálogo cnct ausente");
  else if (!valoresIguais(cnct.path, rManifestCnct)) {
    erros.push("catalogos_manifest.json: path do catálogo cnct diverge do manifesto CNCT");
  }
  return erros;
}

function validarManifestCnct(ctx: Contexto, manifestCnct: unknown, rManifestCnct: string, rIndiceCnct: string) {
  if (!ehObjeto(manifestCnct)) return [`${rManifestCnct} deve conter um objeto JSON`];
  const erros = ctx.validarComSchema(manifestCnct, ctx.c.schemas.manifestCnct, rManifestCnct);
  if (!valoresIguais(manifestCnct.index_path, rIndiceCnct))
    erros.push(`${rManifestCnct}: index_path diverge do índice CNCT`);
  if (!valoresIguais(manifestCnct.campos_curso, CAMPOS_CURSO_CNCT)) {
    erros.push(`${rManifestCnct}: campos_curso diverge do contrato esperado`);
  }
  for (const campo of ["fonte_url", "atos_normativos_url", "catalogo_pdf_url"]) {
    erros.push(...ctx.validarUrlHttps(manifestCnct[campo], `${rManifestCnct}: ${campo}`));
  }
  return erros;
}

export function validarCatalogos(ctx: Contexto): string[] {
  const carregados = [
    ctx.carregarJson(ctx.c.manifestCatalogos, "catalogos_manifest.json"),
    ctx.carregarJson(ctx.c.manifestCnct, "manifesto CNCT"),
    ctx.carregarJson(ctx.c.indiceCnct, "índice CNCT"),
  ];
  const errosLeitura = carregados.flatMap((carregado) => (carregado.ok ? [] : carregado.erros));
  if (errosLeitura.length) return errosLeitura;
  const [manifestCatalogos, manifestCnct, indiceCnct] = carregados.map((carregado) =>
    carregado.ok ? carregado.valor : null,
  );

  const rManifestCnct = ctx.rel(ctx.c.manifestCnct);
  const rIndiceCnct = ctx.rel(ctx.c.indiceCnct);
  const erros = [
    ...validarCatalogosManifest(ctx, manifestCatalogos, rManifestCnct),
    ...validarManifestCnct(ctx, manifestCnct, rManifestCnct, rIndiceCnct),
  ];

  if (!ehObjeto(indiceCnct)) {
    erros.push(`${rIndiceCnct} deve conter um objeto JSON`);
    return erros;
  }
  erros.push(...ctx.validarComSchema(indiceCnct, ctx.c.schemas.indiceCnct, rIndiceCnct));

  const itens = indiceCnct.items;
  if (!Array.isArray(itens) || !itens.length) {
    erros.push(`${rIndiceCnct}: items deve ser lista não vazia`);
    return erros;
  }

  const cnct = ctx.colecao(manifestCatalogos, "catalogos", "cnct");
  if (cnct && !valoresIguais(cnct.total_itens, itens.length)) {
    erros.push("catalogos_manifest.json: total_itens do CNCT diverge do index.json");
  }
  if (ehObjeto(manifestCnct) && !valoresIguais(manifestCnct.total_cursos, itens.length)) {
    erros.push(`${rManifestCnct}: total_cursos diverge do index.json`);
  }
  if (!valoresIguais(indiceCnct.total_cursos, itens.length))
    erros.push(`${rIndiceCnct}: total_cursos diverge de items`);

  const idsVistos = new Set<string>();
  const indicesVistos = new Set<number>();
  const pathsIndice = new Set<string>();
  for (const item of itens) {
    if (!ehObjeto(item)) {
      erros.push(`${rIndiceCnct}: item deve ser objeto`);
      continue;
    }
    const { id: cursoId, path: valorPath } = item;
    if (typeof cursoId !== "string" || !RE_SLUG.test(cursoId)) {
      erros.push(`${rIndiceCnct}: id inválido: ${textoDe(cursoId)}`);
    } else if (idsVistos.has(cursoId)) erros.push(`${rIndiceCnct}: id duplicado: ${cursoId}`);
    else idsVistos.add(cursoId);
    if (typeof valorPath !== "string") {
      erros.push(`${rIndiceCnct}: path ausente em ${textoDe(cursoId)}`);
      continue;
    }
    if (valorPath !== `catalogos/cnct/cursos/${textoDe(cursoId)}.json`) {
      erros.push(`${rIndiceCnct}: path inválido em ${textoDe(cursoId)}: ${valorPath}`);
      continue;
    }
    if (pathsIndice.has(valorPath)) erros.push(`${rIndiceCnct}: path duplicado: ${valorPath}`);
    pathsIndice.add(valorPath);

    const errosCurso = validarArquivoCursoCnct(ctx, naBase(ctx.c, valorPath), item);
    erros.push(...errosCurso);
    if (errosCurso.length) continue;
    // Só um curso sem erros entra na checagem de `indice` duplicado.
    const curso = ctx.carregarJson(naBase(ctx.c, valorPath), `curso CNCT ${valorPath}`);
    if (curso.ok && ehObjeto(curso.valor) && ehInteiro(curso.valor.indice)) {
      const indice = Number(curso.valor.indice);
      if (indicesVistos.has(indice)) erros.push(`${valorPath}: indice duplicado: ${textoDe(curso.valor.indice)}`);
      indicesVistos.add(indice);
    }
  }

  const pathsCursos = new Set(listarDiretorio(ctx.c.cursosCnct, ".json").map((caminho) => ctx.rel(caminho)));
  if (!mesmosElementos(pathsIndice, pathsCursos)) {
    erros.push(
      `index.json não cobre exatamente os arquivos de cursos CNCT: index=${listaOrdenada(pathsIndice)} arquivos=${listaOrdenada(pathsCursos)}`,
    );
  }

  const esperados = new Set([rManifestCnct, rIndiceCnct, ...pathsCursos]);
  const atuais = new Set(listarRecursivo(ctx.c.catalogos, ".json").map((caminho) => ctx.rel(caminho)));
  atuais.delete("catalogos_manifest.json");
  if (!mesmosElementos(atuais, esperados)) {
    erros.push(
      `catalogos/ contém arquivos JSON fora do contrato esperado: esperado=${listaOrdenada(esperados)} arquivos=${listaOrdenada(atuais)}`,
    );
  }
  return erros;
}
