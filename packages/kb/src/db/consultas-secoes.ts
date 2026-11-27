/**
 * Consultas do serviço `Ppcs` aos PPCs e às seções deles no `kb.sqlite`: a busca (FTS5, radicais e
 * léxico de sinônimos, ou por prefixo, a da paleta do Explorar), as seções de um PPC por tipo, o índice
 * delas, a leitura de uma seção com as vizinhas, a lista dos PPCs e o PPC como documento.
 * Pedem o `SqlClient` do ambiente: o `kb.sqlite` ou, no PPC avulso do `PacoteRevisaoPpc`, o banco em
 * memória dele.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  conceitosDaConsulta,
  expressaoFts,
  expressaoFtsPrefixo,
  type ModoBusca,
  trechoOuInicio,
} from "../busca/fts.ts";
import type { Sinonimos } from "../busca/sinonimos.ts";
import * as FontesNormativas from "../FontesNormativas.ts";
import { idCnct, parametrosPpc, SQL_PPC } from "./chaves.ts";
import { markdownDoArquivo } from "./consultas-documentos.ts";
import * as Sql from "./sql.ts";

const Texto = Schema.String;
const TextoNulo = Schema.NullOr(Schema.String);
const Inteiro = Schema.Int;

export interface FiltrosSecoes {
  tipo?: string[] | undefined;
  nivel?: string | undefined;
  campus?: string | undefined;
  cnct?: string | undefined;
  forma?: string | undefined;
  /** PPC: a versão (`campus/curso/versao`) ou o curso (`campus/curso`, o PPC vigente). */
  ppc?: string | undefined;
  /** Inclui os PPCs substituídos; sem ele (e sem `ppc`), só os vigentes entram. */
  incluirSubstituidos?: boolean | undefined;
}

const LinhaSecao = Schema.Struct({
  rowid: Inteiro,
  id: Texto,
  ppc_id: Texto,
  tipo: Texto,
  titulo: Texto,
  numeracao: TextoNulo,
  path: Texto,
  linha_inicio: Inteiro,
  linha_fim: Inteiro,
  linha_texto: Inteiro,
  texto: Texto,
  curso_nome: Texto,
  campus_nome: Texto,
  nivel: Texto,
  tipo_oferta: Texto,
  cnct_id: TextoNulo,
  pontuacao: Schema.Number,
});
const linhasSecao = Sql.todas(LinhaSecao);

export interface ResultadoSecao {
  id: string;
  ppc: string;
  curso: string;
  campus: string;
  nivel: string;
  forma: string;
  cnct_id: string | null;
  tipo: string;
  titulo: string;
  path: string;
  linha_inicio: number;
  linha_fim: number;
  pontuacao: number;
  /** Linhas literais com mais termos da consulta. */
  trecho: { linha: number; texto: string }[];
  /** Texto integral da seção (só com `integral`). */
  texto?: string;
}

/** Opções de `buscarSecoes`. Sem `lexico`, o léxico é o de `FontesNormativas.sinonimos`. */
export interface OpcoesBuscaSecoes {
  readonly limite?: number;
  readonly modo?: ModoBusca;
  /** Léxico de sinônimos (padrão: o de `FontesNormativas`); a avaliação passa um vazio. */
  readonly lexico?: Sinonimos;
  /** Inclui o texto integral de cada seção. */
  readonly integral?: boolean;
  readonly somenteTodos?: boolean;
}

const PESOS_SECOES = "bm25(secoes_fts, 6.0, 1.0, 6.0, 1.0, 2.0)";

/**
 * Busca de seções de PPC. A ordem: primeiro as seções com todos os conceitos da consulta (AND),
 * depois as que têm algum (OR), cada grupo por BM25 com peso maior para o título. O léxico de
 * sinônimos vem de `FontesNormativas`, salvo outro em `opcoes.lexico` (a avaliação passa um léxico
 * vazio para medir a busca sem sinônimos).
 */
export const buscarSecoes = Effect.fn("consultasSecoes.buscarSecoes")(function* (
  consulta: string,
  filtros: FiltrosSecoes = {},
  opcoes: OpcoesBuscaSecoes = {},
) {
  const lexico = opcoes.lexico ?? (yield* FontesNormativas.FontesNormativas).sinonimos;
  const limite = opcoes.limite ?? 10;
  const modo = opcoes.modo ?? "completo";
  const conceitos = conceitosDaConsulta(consulta, modo, lexico);
  const colunas =
    modo === "simples"
      ? ["titulo", "texto"]
      : modo === "radicais"
        ? ["titulo_radicais", "radicais"]
        : ["titulo_radicais", "radicais", "expansao"];
  const condicoes: string[] = [];
  const parametros: Sql.Parametro[] = [];
  if (filtros.tipo?.length) {
    condicoes.push(`s.tipo IN (${filtros.tipo.map(() => "?").join(", ")})`);
    parametros.push(...filtros.tipo);
  }
  if (filtros.nivel) {
    condicoes.push("p.nivel = ?");
    parametros.push(filtros.nivel);
  }
  if (filtros.campus) {
    condicoes.push("p.campus_id = ?");
    parametros.push(filtros.campus);
  }
  if (filtros.cnct) {
    condicoes.push("c.cnct_id = ?");
    parametros.push(idCnct(filtros.cnct));
  }
  if (filtros.forma) {
    condicoes.push("p.tipo_oferta = ?");
    parametros.push(filtros.forma);
  }
  if (filtros.ppc) {
    condicoes.push(`p.id = ${SQL_PPC}`);
    parametros.push(...parametrosPpc(filtros.ppc));
  } else if (!filtros.incluirSubstituidos) {
    condicoes.push("p.vigente = 1");
  }
  const filtroSql = condicoes.length ? ` AND ${condicoes.join(" AND ")}` : "";
  const sql = `
    SELECT s.rowid AS rowid, s.id, s.ppc_id, s.tipo, s.titulo, s.numeracao, s.path, s.linha_inicio, s.linha_fim,
           s.linha_texto, s.texto, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, c.cnct_id,
           ${PESOS_SECOES} AS pontuacao
    FROM secoes_fts
    JOIN secoes s ON s.rowid = secoes_fts.rowid
    JOIN ppcs p ON p.id = s.ppc_id
    LEFT JOIN cursos c ON c.id = p.curso_id
    WHERE secoes_fts MATCH ?${filtroSql}
    ORDER BY pontuacao, s.id
    LIMIT ?`;
  const vistos = new Set<number>();
  const achados: (typeof LinhaSecao.Type)[] = [];
  for (const operador of ["AND", "OR"] as const) {
    if (achados.length >= limite) break;
    if (operador === "OR" && (conceitos.length < 2 || opcoes.somenteTodos)) break;
    const expressao = expressaoFts(conceitos, colunas, operador);
    if (!expressao) break;
    const encontrados = yield* linhasSecao(sql, [expressao, ...parametros, limite + vistos.size]);
    for (const linha of encontrados) {
      if (vistos.has(linha.rowid) || achados.length >= limite) continue;
      vistos.add(linha.rowid);
      achados.push(linha);
    }
  }
  return achados.map((s): ResultadoSecao => ({
    id: s.id,
    ppc: s.ppc_id,
    curso: s.curso_nome,
    campus: s.campus_nome,
    nivel: s.nivel,
    forma: s.tipo_oferta,
    cnct_id: s.cnct_id,
    tipo: s.tipo,
    titulo: s.titulo,
    path: s.path,
    linha_inicio: s.linha_inicio,
    linha_fim: s.linha_fim,
    pontuacao: Math.round(s.pontuacao * 1000) / 1000,
    trecho: trechoOuInicio(s.texto, s.linha_texto, conceitos, modo),
    ...(opcoes.integral ? { texto: s.texto } : {}),
  }));
});

/** Seção de PPC com o texto integral (`secoesDoPpc`). */
export interface SecaoDoPpc {
  id: string;
  tipo: string;
  titulo: string;
  path: string;
  linha_inicio: number;
  linha_fim: number;
  texto: string;
}

const LinhaSecaoDoPpc = Schema.Struct({
  id: Texto,
  tipo: Texto,
  titulo: Texto,
  path: Texto,
  linha_inicio: Inteiro,
  linha_fim: Inteiro,
  texto: Texto,
});
const linhasSecaoDoPpc = Sql.todas(LinhaSecaoDoPpc);

/** Seções de um PPC por tipo, na ordem do documento (texto integral). */
export const secoesDoPpc = Effect.fn("consultasSecoes.secoesDoPpc")(function* (ppc: string, tipos: readonly string[]) {
  const saida: SecaoDoPpc[] = [];
  if (!tipos.length) return saida;
  const linhas = yield* linhasSecaoDoPpc(
    `SELECT id, tipo, titulo, path, linha_inicio, linha_fim, texto FROM secoes
         WHERE ppc_id = ${SQL_PPC} AND tipo IN (${tipos.map(() => "?").join(", ")}) ORDER BY linha_inicio`,
    [...parametrosPpc(ppc), ...tipos],
  );
  for (const l of linhas) saida.push(l);
  return saida;
});

/** Seção de PPC lida pelo ID (`campus/curso#secao`), com o PPC, o texto integral e as vizinhas. */
export interface SecaoLida {
  id: string;
  ppc: string;
  curso: string;
  campus: string;
  nivel: string;
  forma: string;
  tipo: string;
  titulo: string;
  numeracao: string | null;
  path: string;
  linha_inicio: number;
  linha_fim: number;
  /** Primeira linha do texto (depois do título e das linhas em branco). */
  linha_texto: number;
  texto: string;
  /** Seções vizinhas no documento (ordem de `linha_inicio`), ou `null` nas pontas. */
  anterior: string | null;
  proxima: string | null;
}

const LinhaSecaoLida = Schema.Struct({
  id: Texto,
  ppc_id: Texto,
  tipo: Texto,
  titulo: Texto,
  numeracao: TextoNulo,
  path: Texto,
  linha_inicio: Inteiro,
  linha_fim: Inteiro,
  linha_texto: Inteiro,
  texto: Texto,
  curso_nome: Texto,
  campus_nome: Texto,
  nivel: Texto,
  tipo_oferta: Texto,
});
const primeiraSecaoLida = Sql.primeira(LinhaSecaoLida);

/** Entrada do índice de seções de um PPC (`indiceSecoesDoPpc`). */
export interface EntradaIndiceSecoes {
  id: string;
  tipo: string;
  titulo: string;
  linha_inicio: number;
  linha_fim: number;
}

const LinhaIndiceSecoes = Schema.Struct({
  id: Texto,
  tipo: Texto,
  titulo: Texto,
  linha_inicio: Inteiro,
  linha_fim: Inteiro,
});
const linhasIndiceSecoes = Sql.todas(LinhaIndiceSecoes);

/** Índice das seções de um PPC, na ordem do documento (sem o texto). */
export const indiceSecoesDoPpc = Effect.fn("consultasSecoes.indiceSecoesDoPpc")(function* (ppc: string) {
  const linhas = yield* linhasIndiceSecoes(
    `SELECT id, tipo, titulo, linha_inicio, linha_fim FROM secoes WHERE ppc_id = ${SQL_PPC} ORDER BY linha_inicio, id`,
    parametrosPpc(ppc),
  );
  return linhas.map((l): EntradaIndiceSecoes => l);
});

/** Uma seção de PPC pelo ID da tabela `secoes`, com o texto integral; `null` se não existe. */
export const lerSecao = Effect.fn("consultasSecoes.lerSecao")(function* (id: string) {
  const s = yield* primeiraSecaoLida(
    `SELECT s.id, s.ppc_id, s.tipo, s.titulo, s.numeracao, s.path, s.linha_inicio, s.linha_fim, s.linha_texto, s.texto,
              p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta
       FROM secoes s JOIN ppcs p ON p.id = s.ppc_id WHERE s.id = ?`,
    [id],
  );
  if (!s) return null;
  const ids = (yield* indiceSecoesDoPpc(s.ppc_id)).map((x) => x.id);
  const i = ids.indexOf(s.id);
  const secao: SecaoLida = {
    id: s.id,
    ppc: s.ppc_id,
    curso: s.curso_nome,
    campus: s.campus_nome,
    nivel: s.nivel,
    forma: s.tipo_oferta,
    tipo: s.tipo,
    titulo: s.titulo,
    numeracao: s.numeracao,
    path: s.path,
    linha_inicio: s.linha_inicio,
    linha_fim: s.linha_fim,
    linha_texto: s.linha_texto,
    texto: s.texto,
    anterior: i > 0 ? ids[i - 1]! : null,
    proxima: i >= 0 && i < ids.length - 1 ? ids[i + 1]! : null,
  };
  return secao;
});

/* ============================================================ PPCs e documento */

const LinhaPpcListado = Schema.Struct({
  chave: Texto,
  chave_curso: Texto,
  versao: Texto,
  vigente: Inteiro,
  /** Chave da versão seguinte (só nos substituídos). */
  substituido_por: TextoNulo,
  curso_nome: Texto,
  campus_id: Texto,
  campus_nome: Texto,
  nivel: Texto,
  tipo_oferta: Texto,
  ano_documento: Schema.NullOr(Inteiro),
  curso_id: TextoNulo,
  /** O endereço público do PDF de onde veio o texto (`fonte_url`; no vigente, o `ppc.url` do curso). */
  fonte_pdf: TextoNulo,
});
const linhasPpcsListados = Sql.todas(LinhaPpcListado);

/**
 * Um PPC da base: `chave` é `campus/curso/versao`, `chave_curso` é `campus/curso`, `curso_id` o curso
 * a que ele pertence; `vigente` no PPC que o curso aponta, os demais substituídos.
 */
export type PpcListado = Omit<typeof LinhaPpcListado.Type, "vigente"> & { readonly vigente: boolean };

/** Todos os PPCs da base, vigentes e substituídos, por chave. */
export const listarPpcs = Effect.fn("consultasSecoes.listarPpcs")(function* () {
  const linhas = yield* linhasPpcsListados(
    `SELECT chave, chave_curso, versao, vigente, substr(substituido_por, 5) AS substituido_por, curso_nome, campus_id,
            campus_nome, nivel, tipo_oferta, ano_documento, curso_id, fonte_pdf
       FROM ppcs ORDER BY chave`,
  );
  return linhas.map((l): PpcListado => ({ ...l, vigente: l.vigente === 1 }));
});

const linhasTipos = Sql.todas(Schema.Struct({ tipo: Texto }));

/** Os tipos de seção que aparecem nos PPCs da base, em ordem de code point (colação BINARY). */
export const tiposDeSecao = Effect.fn("consultasSecoes.tiposDeSecao")(function* () {
  return (yield* linhasTipos("SELECT DISTINCT tipo FROM secoes ORDER BY tipo")).map((t) => t.tipo);
});

const primeiroPpcDoDocumento = Sql.primeira(
  Schema.Struct({ id: Texto, chave: Texto, curso_nome: Texto, campus_nome: Texto, path: Texto }),
);

/**
 * Um PPC como documento: a identificação, as seções em ordem (o índice, sem o texto) e o Markdown sem
 * o front matter (`null` se a tabela `documentos` não tem o arquivo).
 */
export interface DocumentoPpc {
  readonly id: string;
  readonly chave: string;
  readonly curso_nome: string;
  readonly campus_nome: string;
  readonly path: string;
  readonly secoes: ReadonlyArray<EntradaIndiceSecoes>;
  readonly markdown: string | null;
}

/**
 * O PPC pela chave (`campus/curso/versao`, ou `campus/curso` para o vigente), como documento; `null`
 * se ele não está na base.
 */
export const documentoDoPpc = Effect.fn("consultasSecoes.documentoDoPpc")(function* (chave: string) {
  const ppc = yield* primeiroPpcDoDocumento(
    `SELECT id, chave, curso_nome, campus_nome, path FROM ppcs WHERE id = ${SQL_PPC}`,
    parametrosPpc(chave),
  );
  if (!ppc) return null;
  const secoes = yield* indiceSecoesDoPpc(ppc.chave);
  const documento: DocumentoPpc = { ...ppc, secoes, markdown: yield* markdownDoArquivo(ppc.path) };
  return documento;
});

const LinhaSecaoPorPrefixo = Schema.Struct({
  id: Texto,
  titulo: Texto,
  texto: Texto,
  curso_nome: Texto,
  campus_nome: Texto,
});
const linhasSecoesPorPrefixo = Sql.todas(LinhaSecaoPorPrefixo);

/** Uma seção achada pela busca por prefixo, com o texto integral e o PPC. */
export type SecaoPorPrefixo = typeof LinhaSecaoPorPrefixo.Type;

/**
 * Seções cujo título ou texto tem todos os termos, o último como prefixo (`expressaoFtsPrefixo`),
 * por BM25 com peso maior para o título; sem termo, nenhuma.
 */
export const buscarSecoesPorPrefixo = Effect.fn("consultasSecoes.buscarSecoesPorPrefixo")(function* (
  termos: ReadonlyArray<string>,
  limite: number,
) {
  const expressao = expressaoFtsPrefixo(termos, ["titulo", "texto"]);
  const nenhuma: ReadonlyArray<SecaoPorPrefixo> = [];
  if (expressao === null) return nenhuma;
  const secoes: ReadonlyArray<SecaoPorPrefixo> = yield* linhasSecoesPorPrefixo(
    // ranqueia só no FTS e junta depois: juntar antes leria o texto de milhares de seções (210 ms
    // na primeira busca de "curso" na base real, contra 5 ms assim)
    `SELECT s.id, s.titulo, s.texto, p.curso_nome, p.campus_nome
       FROM (SELECT rowid, bm25(secoes_fts, 4.0, 1.0, 0.0, 0.0, 0.0) AS pontos FROM secoes_fts
              WHERE secoes_fts MATCH ? ORDER BY pontos, rowid LIMIT ?) f
       JOIN secoes s ON s.rowid = f.rowid JOIN ppcs p ON p.id = s.ppc_id
      ORDER BY f.pontos, f.rowid`,
    [expressao, limite],
  );
  return secoes;
});
