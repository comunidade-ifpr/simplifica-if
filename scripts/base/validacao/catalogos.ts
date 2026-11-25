/**
 * Validação do catálogo do CNCT: o formato de cada arquivo é o Effect Schema de `esquemas.ts`; aqui
 * ficam só as regras que cruzam arquivos (manifesto, índice e cursos).
 */
import { listarDiretorio, listarRecursivo, naBase } from "../caminhos.ts";
import { valoresIguais } from "@simplifica-if/kb/json";
import { conferirContrato, type CursoCnctJson, type NomeContrato } from "../esquemas.ts";
import { type Contexto, listaOrdenada, mesmosElementos } from "./contexto.ts";

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
] satisfies Array<keyof CursoCnctJson>;
const CAMPOS_REPETIDOS_NO_INDICE = [
  "denominacao",
  "denominacao_normalizada",
  "eixo_tecnologico",
  "area_tecnologica",
  "carga_horaria_minima_horas",
  "codigos_cbo",
] as const satisfies Array<keyof CursoCnctJson>;

/** O JSON em `caminho` conferido com o contrato `nome`: os erros e, sem nenhum, os dados. */
function lerContrato<N extends NomeContrato>(ctx: Contexto, nome: N, caminho: string, rotulo: string) {
  const carregado = ctx.carregarJson(caminho, rotulo);
  if (!carregado.ok) return { erros: carregado.erros, validos: null };
  return conferirContrato(nome, carregado.valor, ctx.rel(caminho));
}

/** Os códigos CBO do curso, sem repetição e todos citados em `ocupacoes_cbo`. */
function validarCbo(r: string, curso: CursoCnctJson): string[] {
  const erros: string[] = [];
  const vistos = new Set<string>();
  for (const codigo of curso.codigos_cbo) {
    if (vistos.has(codigo)) erros.push(`${r}: codigos_cbo duplicado: ${codigo}`);
    vistos.add(codigo);
    if (!curso.ocupacoes_cbo.includes(codigo)) erros.push(`${r}: codigos_cbo não aparece em ocupacoes_cbo: ${codigo}`);
  }
  return erros;
}

export function validarCatalogos(ctx: Contexto): string[] {
  const manifesto = lerContrato(ctx, "manifestCnct", ctx.c.manifestCnct, "manifesto CNCT");
  const indice = lerContrato(ctx, "indiceCnct", ctx.c.indiceCnct, "índice CNCT");
  const erros = [...manifesto.erros, ...indice.erros];
  if (!manifesto.validos || !indice.validos) return erros;

  const rManifesto = ctx.rel(ctx.c.manifestCnct);
  const rIndice = ctx.rel(ctx.c.indiceCnct);
  const itens = indice.validos.items;
  if (!valoresIguais(manifesto.validos.campos_curso, CAMPOS_CURSO_CNCT)) {
    erros.push(`${rManifesto}: campos_curso diverge do contrato esperado`);
  }
  if (manifesto.validos.total_cursos !== itens.length) erros.push(`${rManifesto}: total_cursos diverge do index.json`);
  if (indice.validos.total_cursos !== itens.length) erros.push(`${rIndice}: total_cursos diverge de items`);

  const idsVistos = new Set<string>();
  const indicesVistos = new Set<number>();
  for (const item of itens) {
    if (idsVistos.has(item.id)) erros.push(`${rIndice}: id duplicado: ${item.id}`);
    idsVistos.add(item.id);
    if (item.path !== `catalogos/cnct/cursos/${item.id}.json`) {
      erros.push(`${rIndice}: path inválido em ${item.id}: ${item.path}`);
      continue;
    }
    const caminho = naBase(ctx.c, item.path);
    const curso = lerContrato(ctx, "cursoCnct", caminho, `curso CNCT ${item.path}`);
    erros.push(...curso.erros);
    if (!curso.validos) continue;
    if (curso.validos.id !== item.id) erros.push(`${item.path}: id diverge do index.json`);
    for (const campo of CAMPOS_REPETIDOS_NO_INDICE) {
      if (!valoresIguais(curso.validos[campo], item[campo])) {
        erros.push(`${item.path}: campo ${campo} diverge do index.json`);
      }
    }
    erros.push(...validarCbo(item.path, curso.validos));
    if (indicesVistos.has(curso.validos.indice)) erros.push(`${item.path}: indice duplicado: ${curso.validos.indice}`);
    indicesVistos.add(curso.validos.indice);
  }

  const pathsIndice = new Set(itens.map((item) => item.path));
  const pathsCursos = new Set(listarDiretorio(ctx.c.cursosCnct, ".json").map((caminho) => ctx.rel(caminho)));
  if (!mesmosElementos(pathsIndice, pathsCursos)) {
    erros.push(
      `index.json não cobre exatamente os arquivos de cursos CNCT: index=${listaOrdenada(pathsIndice)} arquivos=${listaOrdenada(pathsCursos)}`,
    );
  }

  const esperados = new Set([rManifesto, rIndice, ...pathsCursos]);
  const atuais = new Set(listarRecursivo(ctx.c.catalogos, ".json").map((caminho) => ctx.rel(caminho)));
  if (!mesmosElementos(atuais, esperados)) {
    erros.push(
      `catalogos/ contém arquivos JSON fora do contrato esperado: esperado=${listaOrdenada(esperados)} arquivos=${listaOrdenada(atuais)}`,
    );
  }
  return erros;
}
