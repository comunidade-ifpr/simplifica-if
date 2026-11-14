/**
 * Consultas ao `kb.sqlite`: SQL direto com `bun:sqlite`, e cada linha lida validada por zod na
 * fronteira (Princípio 3). Toda resposta traz texto literal (seção, dispositivo de norma, trecho de fato,
 * linha do SUAP) e a proveniência: `path` relativo à raiz do repositório e linha(s).
 */
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { expandirConsulta, type Sinonimos } from "../busca/sinonimos.ts";
import { radicais, termoFts, termos } from "../busca/tokens.ts";
import { RESULTADOS_DIVERGENTES } from "../fatos/divergencias.ts";
import { idDoAto } from "../normas/ids.ts";
import type { Registro } from "../normas/registro.ts";
import { resolverCitacao, registroPadrao } from "../normas/resolver.ts";
import { compararTexto } from "../texto.ts";
import {
  dataReferenciaBanco,
  dispositivoOuAncestral,
  obterDispositivoBanco,
  paraTrecho,
  sqlForaDeVigencia,
  type TrechoDispositivo,
} from "./consultas-normas.ts";

const texto = z.string();
const textoNulo = z.string().nullable();
const inteiroNulo = z.number().int().nullable();

function linhas<T>(esquema: z.ZodType<T>, valores: unknown[]): T[] {
  return valores.map((v) => esquema.parse(v));
}

type Parametro = string | number | null;

/* ================================================================ busca textual */

/** Modo da busca: sem stemmer nem sinônimos, só radicais, ou radicais + léxico de sinônimos. */
export type ModoBusca = "simples" | "radicais" | "completo";

interface Conceito {
  /** Alternativas do conceito (cada uma é uma sequência de termos; mais de um termo vira frase). */
  alternativas: string[][];
}

/**
 * Conceitos da consulta: cada termo vira um conceito; com `completo`, um grupo de sinônimos cujo
 * termo aparece na consulta junta os termos dele num conceito só, com as alternativas do grupo.
 */
export function conceitosDaConsulta(consulta: string, modo: ModoBusca, lexico?: Sinonimos): Conceito[] {
  if (modo === "simples") return [...new Set(termos(consulta))].map((t) => ({ alternativas: [[t]] }));
  const r = [...new Set(radicais(consulta))];
  if (modo === "radicais" || !lexico) return r.map((t) => ({ alternativas: [[t]] }));
  const conceitos: Conceito[] = [];
  const cobertos = new Set<string>();
  for (const grupo of lexico.grupos) {
    const termosGrupo = grupo.map((termo) => radicais(termo)).filter((x) => x.length > 0);
    const presentes = termosGrupo.filter((x) => x.every((radical) => r.includes(radical)));
    if (!presentes.length) continue;
    for (const p of presentes) for (const radical of p) cobertos.add(radical);
    conceitos.push({ alternativas: [...presentes, ...expandirConsulta({ tipos: {}, grupos: [grupo] }, r)] });
  }
  for (const t of r) if (!cobertos.has(t)) conceitos.push({ alternativas: [[t]] });
  return conceitos;
}

function alternativaFts(alternativa: string[]): string {
  return alternativa.length === 1 ? termoFts(alternativa[0]!) : termoFts(alternativa.join(" "));
}

/** Expressão FTS5: conceitos ligados por AND ou por OR, restrita às colunas do modo. */
export function expressaoFts(conceitos: Conceito[], colunas: string[], operador: "AND" | "OR"): string | null {
  if (!conceitos.length) return null;
  const partes = conceitos.map((c) => {
    const alternativas = c.alternativas.map(alternativaFts);
    return alternativas.length === 1 ? alternativas[0]! : `(${alternativas.join(" OR ")})`;
  });
  return `{${colunas.join(" ")}} : (${partes.join(` ${operador} `)})`;
}

/** Linhas do texto com mais termos da consulta (literal, com o número da linha no arquivo). */
export function linhasRelevantes(
  textoSecao: string,
  linhaInicial: number,
  conceitos: Conceito[],
  modo: ModoBusca,
  maximo = 3,
): { linha: number; texto: string }[] {
  const alvo = conceitos.map((c) => new Set(c.alternativas.flat()));
  const pontuadas = textoSecao.split("\n").map((linha, i) => {
    const presentes = new Set(modo === "simples" ? termos(linha) : radicais(linha));
    const pontos = alvo.filter((a) => [...a].some((t) => presentes.has(t))).length;
    return { linha: linhaInicial + i, texto: linha, pontos };
  });
  return pontuadas
    .filter((l) => l.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.linha - b.linha)
    .slice(0, maximo)
    .sort((a, b) => a.linha - b.linha)
    .map(({ linha, texto: t }) => ({ linha, texto: t }));
}

/** Linhas relevantes; se a seção casou só pelo título ou pelo tipo, as primeiras linhas do texto. */
function trechoOuInicio(textoSecao: string, linhaInicial: number, conceitos: Conceito[], modo: ModoBusca) {
  const relevantes = linhasRelevantes(textoSecao, linhaInicial, conceitos, modo);
  if (relevantes.length) return relevantes;
  return textoSecao
    .split("\n")
    .map((t, i) => ({ linha: linhaInicial + i, texto: t }))
    .filter((l) => l.texto.trim())
    .slice(0, 2);
}

/* ================================================================== seções */

export interface FiltrosSecoes {
  tipo?: string[] | undefined;
  nivel?: string | undefined;
  campus?: string | undefined;
  cnct?: string | undefined;
  forma?: string | undefined;
  ppc?: string | undefined;
}

const esquemaLinhaSecao = z.strictObject({
  rowid: z.number().int(),
  id: texto,
  ppc_id: texto,
  tipo: texto,
  titulo: texto,
  numeracao: textoNulo,
  path: texto,
  linha_inicio: z.number().int(),
  linha_fim: z.number().int(),
  linha_texto: z.number().int(),
  texto: texto,
  curso_nome: texto,
  campus_nome: texto,
  nivel: texto,
  tipo_oferta: texto,
  cnct_id: textoNulo,
  pontuacao: z.number(),
});

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

const PESOS_SECOES = "bm25(secoes_fts, 6.0, 1.0, 6.0, 1.0, 2.0)";

function normalizarCnct(valor: string): string {
  return valor.startsWith("cnct:") ? valor : `cnct:${valor}`;
}

function normalizarPpc(valor: string): string {
  return valor.startsWith("ppc:") ? valor : `ppc:${valor}`;
}

/**
 * Busca de seções de PPC. A ordem: primeiro as seções com todos os conceitos da consulta (AND),
 * depois as que têm algum (OR), cada grupo por BM25 com peso maior para o título.
 */
export function buscarSecoes(
  db: Database,
  consulta: string,
  filtros: FiltrosSecoes = {},
  opcoes: { limite?: number; modo?: ModoBusca; lexico?: Sinonimos; integral?: boolean; somenteTodos?: boolean } = {},
): ResultadoSecao[] {
  const limite = opcoes.limite ?? 10;
  const modo = opcoes.modo ?? "completo";
  const conceitos = conceitosDaConsulta(consulta, modo, opcoes.lexico);
  const colunas =
    modo === "simples"
      ? ["titulo", "texto"]
      : modo === "radicais"
        ? ["titulo_radicais", "radicais"]
        : ["titulo_radicais", "radicais", "expansao"];
  const condicoes: string[] = [];
  const parametros: Parametro[] = [];
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
    parametros.push(normalizarCnct(filtros.cnct));
  }
  if (filtros.forma) {
    condicoes.push("p.tipo_oferta = ?");
    parametros.push(filtros.forma);
  }
  if (filtros.ppc) {
    condicoes.push("p.id = ?");
    parametros.push(normalizarPpc(filtros.ppc));
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
  const achados: z.output<typeof esquemaLinhaSecao>[] = [];
  for (const operador of ["AND", "OR"] as const) {
    if (achados.length >= limite) break;
    if (operador === "OR" && (conceitos.length < 2 || opcoes.somenteTodos)) break;
    const expressao = expressaoFts(conceitos, colunas, operador);
    if (!expressao) break;
    const encontrados = linhas(esquemaLinhaSecao, db.query(sql).all(expressao, ...parametros, limite + vistos.size));
    for (const linha of encontrados) {
      if (vistos.has(linha.rowid) || achados.length >= limite) continue;
      vistos.add(linha.rowid);
      achados.push(linha);
    }
  }
  return achados.map((s) => ({
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
}

/** Seções de um PPC por tipo, na ordem do documento (texto integral). */
export function secoesDoPpc(
  db: Database,
  ppc: string,
  tipos: readonly string[],
): {
  id: string;
  tipo: string;
  titulo: string;
  path: string;
  linha_inicio: number;
  linha_fim: number;
  texto: string;
}[] {
  if (!tipos.length) return [];
  const esquema = z.strictObject({
    id: texto,
    tipo: texto,
    titulo: texto,
    path: texto,
    linha_inicio: z.number().int(),
    linha_fim: z.number().int(),
    texto: texto,
  });
  return linhas(
    esquema,
    db
      .query(
        `SELECT id, tipo, titulo, path, linha_inicio, linha_fim, texto FROM secoes
         WHERE ppc_id = ? AND tipo IN (${tipos.map(() => "?").join(", ")}) ORDER BY linha_inicio`,
      )
      .all(normalizarPpc(ppc), ...tipos),
  );
}

/* =================================================================== normas */

const esquemaNorma = z.strictObject({
  id: texto,
  situacao: texto,
  titulo: texto,
  status_vigencia: textoNulo,
  data_publicacao: textoNulo,
  ementa: textoNulo,
  path: textoNulo,
});
export type NormaResumo = z.output<typeof esquemaNorma>;

export function obterNorma(db: Database, id: string): NormaResumo | null {
  const linha = db
    .query("SELECT id, situacao, titulo, status_vigencia, data_publicacao, ementa, path FROM normas WHERE id = ?")
    .get(id);
  if (linha) return esquemaNorma.parse(linha);
  const ato = idDoAto(id);
  return ato !== id ? obterNorma(db, ato) : null;
}

export interface ResultadoNorma {
  norma: NormaResumo;
  /** Dispositivo (ID canônico, caput herdado, texto literal, arquivo e linhas), quando o achado é um dispositivo. */
  dispositivo: TrechoDispositivo | null;
  /** Dispositivo citado que não está no texto da base, quando `dispositivo` é o ancestral mais próximo. */
  pedido: string | null;
  /** Metadados da norma (título, aliases, palavras-chave, ementa), quando o achado é a própria norma. */
  metadados: { texto: string; path: string; linha: number } | null;
  pontuacao: number | null;
  origem: "citacao-resolvida" | "busca-textual";
}

const esquemaMetadados = z.strictObject({
  rowid: z.number().int(),
  norma_id: texto,
  texto: texto,
  path: texto,
  linha: z.number().int(),
});

function metadadosDaNorma(db: Database, normaId: string): ResultadoNorma["metadados"] {
  const linha = db
    .query("SELECT rowid, norma_id, texto, path, linha FROM normas_metadados WHERE norma_id = ?")
    .get(normaId);
  if (!linha) return null;
  const m = esquemaMetadados.parse(linha);
  return { texto: m.texto, path: m.path, linha: m.linha };
}

/**
 * Busca de normas.
 *
 * - Citação ("Res. CNE/CP 2/2026, art. 28, VII") ou ID (`br/cne-cp/res/2026/2#art28-vii`): o
 *   resolvedor da fase 2 identifica a norma e os dispositivos, e a resposta é cada dispositivo da
 *   tabela `dispositivos` (ID canônico, caput herdado, texto com os subordinados, arquivo e linhas);
 *   dispositivo fora do texto da base cai no ancestral mais próximo (`pedido` guarda o citado).
 *   Norma sem dispositivo citado (ou stub sem texto): os metadados, e a busca textual continua.
 * - Termos: FTS5 por radicais em duas fontes, sem misturar as pontuações (BM25 de tabelas
 *   diferentes não se comparam): com todos os conceitos (AND), primeiro os metadados das normas
 *   (a consulta nomeia a norma), depois os dispositivos (`texto_com_caput`); com algum conceito
 *   (OR), primeiro os dispositivos, depois os metadados.
 * - `vigentes`: tira atos revogados ou ainda não vigentes na data `em` (padrão: `data_referencia`),
 *   pelos intervalos de `vigencias`, e dispositivos revogados.
 * - `situacao` e `vigentes` valem também para a citação resolvida: a norma ou o dispositivo citado
 *   que eles excluem não volta, e a resposta fica vazia com um aviso explicando por quê (a busca
 *   textual não substitui a norma que a consulta nomeou).
 * - ID com a forma de norma (`br/…`, `ifpr/…`) que não está na base: resposta vazia com aviso de ID
 *   desconhecido, sem busca textual.
 */
export function buscarNorma(
  db: Database,
  consulta: string,
  opcoes: {
    limite?: number;
    situacao?: string;
    vigentes?: boolean;
    em?: string;
    /** Registro do resolvedor de citações (padrão: o do checkout; no modo banco, `registroBanco`). */
    registro?: Registro;
  } = {},
): ResultadoNorma[] {
  return buscarNormaDetalhada(db, consulta, opcoes).resultados;
}

/** `buscarNorma` com os avisos (ID desconhecido, citação excluída pelos filtros). */
export function buscarNormaDetalhada(
  db: Database,
  consulta: string,
  opcoes: {
    limite?: number;
    situacao?: string;
    vigentes?: boolean;
    em?: string;
    /** Registro do resolvedor de citações (padrão: o do checkout; no modo banco, `registroBanco`). */
    registro?: Registro;
  } = {},
): { resultados: ResultadoNorma[]; avisos: string[] } {
  const limite = opcoes.limite ?? 10;
  const saida: ResultadoNorma[] = [];
  const avisos: string[] = [];
  const data = opcoes.em ?? dataReferenciaBanco(db);
  const ehId = /^[a-z]+(\/[\w~-]+)+(#[\w-]+)?$/.test(consulta.trim());
  const resolucao: { id: string | null; dispositivoId?: string | undefined; dispositivos?: string[] | undefined } = ehId
    ? {
        id: consulta.trim().split("#")[0]!,
        dispositivoId: consulta.includes("#") ? `#${consulta.split("#")[1]}` : undefined,
      }
    : resolverCitacao(consulta, opcoes.registro ?? registroPadrao());
  if (resolucao.id) {
    const norma = obterNorma(db, resolucao.id);
    if (!norma && ehId && /^(br|ifpr)\//.test(resolucao.id)) {
      avisos.push(`ID desconhecido: ${resolucao.id} não está entre as normas da base`);
      return { resultados: [], avisos };
    }
    if (norma) {
      if (opcoes.situacao && norma.situacao !== opcoes.situacao) {
        avisos.push(
          `${norma.id} (citada) tem situação ${norma.situacao}, fora do filtro --situacao ${opcoes.situacao}`,
        );
        return { resultados: [], avisos };
      }
      if (opcoes.vigentes && atoForaDeVigencia(db, norma.id, data)) {
        avisos.push(
          `${norma.id} (citada) não está vigente em ${data} (${norma.status_vigencia ?? "sem status"}); ` +
            `sem --vigentes ela volta, e \`kb vigencia ${norma.id}\` mostra as regras de transição`,
        );
        return { resultados: [], avisos };
      }
      const pedidos = resolucao.dispositivos ?? (resolucao.dispositivoId ? [resolucao.dispositivoId] : []);
      const vistos = new Set<string>();
      for (const pedido of pedidos) {
        const achado = dispositivoOuAncestral(db, `${norma.id}${pedido}`);
        if (!achado || vistos.has(achado.disp.id)) continue;
        vistos.add(achado.disp.id);
        const trecho = paraTrecho(db, achado, { subordinados: true });
        if (opcoes.vigentes && trecho.revogado) {
          avisos.push(`${trecho.id} (citado) está revogado; sem --vigentes ele volta`);
          continue;
        }
        saida.push({
          norma,
          dispositivo: trecho,
          pedido: achado.disp.dispositivo === pedido ? null : `${idDoAto(norma.id)}${pedido}`,
          metadados: null,
          pontuacao: null,
          origem: "citacao-resolvida",
        });
      }
      if (saida.length) return { resultados: saida, avisos };
      if (avisos.length) return { resultados: [], avisos };
      const metadados = metadadosDaNorma(db, norma.id);
      if (metadados) {
        saida.push({ norma, dispositivo: null, pedido: null, metadados, pontuacao: null, origem: "citacao-resolvida" });
      }
    }
  }

  const conceitos = conceitosDaConsulta(consulta, "radicais");
  const filtros = (colunaNorma: string) => {
    const condicoes: string[] = [];
    const parametros: Parametro[] = [];
    if (opcoes.situacao) {
      condicoes.push("n.situacao = ?");
      parametros.push(opcoes.situacao);
    }
    if (opcoes.vigentes) {
      condicoes.push(`NOT ${sqlForaDeVigencia(colunaNorma)}`);
      parametros.push(data, data);
    }
    return { sql: condicoes.map((c) => ` AND ${c}`).join(""), parametros };
  };
  const vistosMeta = new Set<number>();
  const vistosDisp = new Set<number>();
  const metadados = (expressao: string) => {
    const f = filtros("m.norma_id");
    const linhasMeta = linhas(
      esquemaMetadados.extend({ pontuacao: z.number() }),
      db
        .query(
          `SELECT m.rowid AS rowid, m.norma_id, m.texto, m.path, m.linha, bm25(normas_fts, 4.0, 1.0, 1.0) AS pontuacao
           FROM normas_fts JOIN normas_metadados m ON m.rowid = normas_fts.rowid JOIN normas n ON n.id = m.norma_id
           WHERE normas_fts MATCH ?${f.sql} ORDER BY pontuacao, m.rowid LIMIT ?`,
        )
        .all(expressao, ...f.parametros, limite + vistosMeta.size),
    );
    for (const m of linhasMeta) {
      if (saida.length >= limite || vistosMeta.has(m.rowid)) continue;
      if (saida.some((r) => r.metadados && r.norma.id === m.norma_id)) continue;
      vistosMeta.add(m.rowid);
      saida.push({
        norma: obterNorma(db, m.norma_id)!,
        dispositivo: null,
        pedido: null,
        metadados: { texto: m.texto, path: m.path, linha: m.linha },
        pontuacao: Math.round(m.pontuacao * 1000) / 1000,
        origem: "busca-textual",
      });
    }
  };
  const dispositivos = (expressao: string) => {
    const f = filtros("d.ato_id");
    const achados = linhas(
      z.strictObject({ rowid: z.number().int(), id: texto, norma_id: texto, pontuacao: z.number() }),
      db
        .query(
          `SELECT d.rowid AS rowid, d.id, d.norma_id, bm25(dispositivos_fts, 1.0, 1.0) AS pontuacao
           FROM dispositivos_fts JOIN dispositivos d ON d.rowid = dispositivos_fts.rowid JOIN normas n ON n.id = d.norma_id
           WHERE dispositivos_fts MATCH ?${f.sql}${opcoes.vigentes ? " AND d.revogado = 0" : ""}
           ORDER BY pontuacao, d.rowid LIMIT ?`,
        )
        .all(expressao, ...f.parametros, limite + vistosDisp.size),
    );
    for (const a of achados) {
      if (saida.length >= limite || vistosDisp.has(a.rowid)) continue;
      vistosDisp.add(a.rowid);
      const d = obterDispositivoBanco(db, a.id)!;
      saida.push({
        norma: obterNorma(db, a.norma_id)!,
        dispositivo: paraTrecho(db, d),
        pedido: null,
        metadados: null,
        pontuacao: Math.round(a.pontuacao * 1000) / 1000,
        origem: "busca-textual",
      });
    }
  };
  for (const operador of ["AND", "OR"] as const) {
    if (saida.length >= limite) break;
    if (operador === "OR" && conceitos.length < 2) break;
    const expressaoMeta = expressaoFts(conceitos, ["radicais"], operador);
    if (!expressaoMeta) break;
    const ordem = operador === "AND" ? [metadados, dispositivos] : [dispositivos, metadados];
    for (const etapa of ordem) etapa(expressaoMeta);
  }
  return { resultados: saida, avisos };
}

/** O ato está revogado ou ainda não vigente na data (intervalos de `vigencias`). */
function atoForaDeVigencia(db: Database, normaId: string, data: string): boolean {
  return (
    db
      .query(`SELECT 1 AS fora FROM normas n WHERE n.id = ? AND ${sqlForaDeVigencia("n.id")}`)
      .get(normaId, data, data) !== null
  );
}

/* =================================================================== cursos */

export interface FiltrosCursos {
  eixo?: string | undefined;
  turno?: string | undefined;
  campus?: string | undefined;
  nivel?: string | undefined;
  forma?: string | undefined;
  situacao?: string | undefined;
  cnct?: string | undefined;
  processo?: string | undefined;
}

const esquemaCurso = z.strictObject({
  id: texto,
  nome: texto,
  campus_id: texto,
  campus_nome: textoNulo,
  nivel: textoNulo,
  forma_oferta: textoNulo,
  modalidade: textoNulo,
  situacao: textoNulo,
  cnct_id: textoNulo,
  cnct_denominacao: textoNulo,
  eixo_tecnologico: textoNulo,
  carga_horaria_minima_h: inteiroNulo,
  ppc_id: textoNulo,
  ppc_markdown_path: textoNulo,
  ppc_ano_documento: inteiroNulo,
  path: texto,
});

const esquemaOferta = z.strictObject({
  curso_id: texto,
  id: texto,
  tipo_oferta: texto,
  vagas: inteiroNulo,
  turno: textoNulo,
  turno_original: textoNulo,
  turno_nota: textoNulo,
  status_curadoria: textoNulo,
  trecho_fonte: textoNulo,
  url_fonte: texto,
  path: texto,
  linha_turno: z.number().int(),
  processos: texto,
});

export interface ResultadoCurso {
  id: string;
  nome: string;
  campus: { id: string; nome: string | null };
  nivel: string | null;
  forma_oferta: string | null;
  modalidade: string | null;
  situacao: string | null;
  cnct: {
    id: string;
    denominacao: string | null;
    eixo_tecnologico: string | null;
    carga_horaria_minima_h: number | null;
  } | null;
  ppc: { id: string; path: string | null; ano_documento: number | null } | null;
  ofertas: {
    id: string;
    processos: string[];
    tipo_oferta: string;
    vagas: number | null;
    turno: string | null;
    turno_original: string | null;
    turno_nota: string | null;
    status_curadoria: string | null;
    trecho_fonte: string | null;
    url_fonte: string;
    path: string;
    linha: number;
  }[];
  path: string;
}

export function listarCursos(db: Database, filtros: FiltrosCursos = {}): ResultadoCurso[] {
  const condicoes: string[] = [];
  const parametros: Parametro[] = [];
  const add = (sql: string, valor: string | undefined) => {
    if (valor === undefined) return;
    condicoes.push(sql);
    parametros.push(valor);
  };
  add("k.eixo_tecnologico = ?", filtros.eixo);
  add("c.campus_id = ?", filtros.campus);
  add("c.nivel = ?", filtros.nivel);
  add("c.forma_oferta = ?", filtros.forma);
  add("c.situacao = ?", filtros.situacao);
  add("c.cnct_id = ?", filtros.cnct ? normalizarCnct(filtros.cnct) : undefined);
  const cursos = linhas(
    esquemaCurso,
    db
      .query(
        `SELECT c.id, c.nome, c.campus_id, ca.nome AS campus_nome, c.nivel, c.forma_oferta, c.modalidade, c.situacao,
                c.cnct_id, k.denominacao AS cnct_denominacao, k.eixo_tecnologico, k.carga_horaria_minima_h,
                c.ppc_id, c.ppc_markdown_path, c.ppc_ano_documento, c.path
         FROM cursos c LEFT JOIN cnct k ON k.id = c.cnct_id LEFT JOIN campi ca ON ca.campus_id = c.campus_id
         ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""}
         ORDER BY c.id`,
      )
      .all(...parametros),
  );
  const ofertas = linhas(
    esquemaOferta,
    db
      .query(
        `SELECT oc.curso_id, o.id, o.tipo_oferta, o.vagas, o.turno, o.turno_original, o.turno_nota, o.status_curadoria,
                o.trecho_fonte, o.url_fonte, o.path, o.linha_turno,
                (SELECT group_concat(processo_id, ',') FROM (SELECT processo_id FROM ofertas_processos op WHERE op.oferta_id = o.id ORDER BY processo_id)) AS processos
         FROM ofertas_cursos oc JOIN ofertas o ON o.id = oc.oferta_id ORDER BY oc.curso_id, o.id`,
      )
      .all(),
  );
  const porCurso = new Map<string, z.output<typeof esquemaOferta>[]>();
  for (const o of ofertas) porCurso.set(o.curso_id, [...(porCurso.get(o.curso_id) ?? []), o]);
  const saida: ResultadoCurso[] = [];
  for (const c of cursos) {
    const lista = (porCurso.get(c.id) ?? []).filter(
      (o) =>
        (!filtros.turno || o.turno === filtros.turno) &&
        (!filtros.processo || o.processos.split(",").includes(filtros.processo)),
    );
    if ((filtros.turno || filtros.processo) && !lista.length) continue;
    saida.push({
      id: c.id,
      nome: c.nome,
      campus: { id: c.campus_id, nome: c.campus_nome },
      nivel: c.nivel,
      forma_oferta: c.forma_oferta,
      modalidade: c.modalidade,
      situacao: c.situacao,
      cnct: c.cnct_id
        ? {
            id: c.cnct_id,
            denominacao: c.cnct_denominacao,
            eixo_tecnologico: c.eixo_tecnologico,
            carga_horaria_minima_h: c.carga_horaria_minima_h,
          }
        : null,
      ppc: c.ppc_id
        ? {
            id: c.ppc_id,
            path: c.ppc_markdown_path ? `base-conhecimento/${c.ppc_markdown_path}` : null,
            ano_documento: c.ppc_ano_documento,
          }
        : null,
      ofertas: lista.map((o) => ({
        id: o.id,
        processos: o.processos ? o.processos.split(",") : [],
        tipo_oferta: o.tipo_oferta,
        vagas: o.vagas,
        turno: o.turno,
        turno_original: o.turno_original,
        turno_nota: o.turno_nota,
        status_curadoria: o.status_curadoria,
        trecho_fonte: o.trecho_fonte,
        url_fonte: o.url_fonte,
        path: o.path,
        linha: o.linha_turno,
      })),
      path: c.path,
    });
  }
  return saida;
}

/* ================================================================ fatos PPC */

const esquemaFato = z.strictObject({
  ppc_id: texto,
  fato: texto,
  valor: texto,
  valor_num: inteiroNulo,
  unidade: textoNulo,
  status_curadoria: texto,
  regra: texto,
  trecho_fonte: texto,
  path: texto,
  linha: z.number().int(),
  alternativas_json: texto,
});

const esquemaCruzamento = z.strictObject({
  ppc_id: texto,
  aspecto: texto,
  resultado: texto,
  valor_ppc: textoNulo,
  valor_suap: textoNulo,
  explicacao: texto,
});

const esquemaMatriz = z.strictObject({
  curso_id: texto,
  matriz_id: z.number().int(),
  ano: inteiroNulo,
  ch_exibida_h: z.number().int(),
  estagio_exigido: z.number().int(),
  ch_estagio_h: inteiroNulo,
  trecho: texto,
  path: texto,
  linha: z.number().int(),
});

const esquemaPpcCurso = z.strictObject({
  id: texto,
  curso_nome: texto,
  campus_nome: texto,
  nivel: texto,
  tipo_oferta: texto,
  path: texto,
  curso_id: textoNulo,
  suap_matrizes_situacao: textoNulo,
  suap_ch_comum_h: inteiroNulo,
});

export interface FatosDoPpc {
  ppc: string;
  curso: string | null;
  nome: string;
  campus: string;
  nivel: string;
  forma: string;
  path: string;
  fatos: (Omit<z.output<typeof esquemaFato>, "ppc_id" | "alternativas_json"> & { alternativas: unknown })[];
  suap: {
    situacao: string | null;
    carga_horaria_comum_h: number | null;
    matrizes: (Omit<z.output<typeof esquemaMatriz>, "curso_id" | "estagio_exigido"> & { estagio_exigido: boolean })[];
  };
  cruzamento: Omit<z.output<typeof esquemaCruzamento>, "ppc_id">[];
}

/** Fatos e cruzamento com o SUAP de um PPC, ou de todos (filtro opcional por nível). */
export function fatosDosPpcs(db: Database, filtros: { ppc?: string; nivel?: string } = {}): FatosDoPpc[] {
  const condicoes: string[] = [];
  const parametros: Parametro[] = [];
  if (filtros.ppc) {
    condicoes.push("p.id = ?");
    parametros.push(normalizarPpc(filtros.ppc));
  }
  if (filtros.nivel) {
    condicoes.push("p.nivel = ?");
    parametros.push(filtros.nivel);
  }
  const ppcs = linhas(
    esquemaPpcCurso,
    db
      .query(
        `SELECT p.id, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, p.path, p.curso_id,
                c.suap_matrizes_situacao, c.suap_ch_comum_h
         FROM ppcs p LEFT JOIN cursos c ON c.id = p.curso_id
         ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""} ORDER BY p.id`,
      )
      .all(...parametros),
  );
  const fatos = linhas(esquemaFato, db.query("SELECT * FROM ppc_fatos ORDER BY ppc_id, fato").all());
  const cruz = linhas(esquemaCruzamento, db.query("SELECT * FROM ppc_suap ORDER BY ppc_id, aspecto").all());
  const matrizes = linhas(
    esquemaMatriz,
    db
      .query(
        "SELECT curso_id, matriz_id, ano, ch_exibida_h, estagio_exigido, ch_estagio_h, trecho, path, linha FROM suap_matrizes ORDER BY curso_id, ordem",
      )
      .all(),
  );
  const agrupar = <T, K>(lista: T[], chave: (x: T) => K) => {
    const m = new Map<K, T[]>();
    for (const x of lista) m.set(chave(x), [...(m.get(chave(x)) ?? []), x]);
    return m;
  };
  const fatosPor = agrupar(fatos, (f) => f.ppc_id);
  const cruzPor = agrupar(cruz, (c) => c.ppc_id);
  const matrizesPor = agrupar(matrizes, (m) => m.curso_id);
  return ppcs.map((p) => ({
    ppc: p.id,
    curso: p.curso_id,
    nome: p.curso_nome,
    campus: p.campus_nome,
    nivel: p.nivel,
    forma: p.tipo_oferta,
    path: p.path,
    fatos: (fatosPor.get(p.id) ?? []).map(({ ppc_id: _p, alternativas_json, ...f }) => ({
      ...f,
      alternativas: JSON.parse(alternativas_json) as unknown,
    })),
    suap: {
      situacao: p.suap_matrizes_situacao,
      carga_horaria_comum_h: p.suap_ch_comum_h,
      matrizes: (p.curso_id ? (matrizesPor.get(p.curso_id) ?? []) : []).map(
        ({ curso_id: _c, estagio_exigido, ...m }) => ({
          ...m,
          estagio_exigido: estagio_exigido === 1,
        }),
      ),
    },
    cruzamento: (cruzPor.get(p.id) ?? []).map(({ ppc_id: _p, ...c }) => c),
  }));
}

/** Só os PPCs com alguma divergência PPC × SUAP, e só as linhas divergentes do cruzamento. */
export function divergenciasPpcSuap(
  db: Database,
  filtros: { nivel?: string } = {},
): {
  totais: Record<string, Record<string, number>>;
  ppcs: FatosDoPpc[];
} {
  const todos = fatosDosPpcs(db, filtros);
  const totais: Record<string, Record<string, number>> = {};
  for (const p of todos) {
    for (const c of p.cruzamento) {
      totais[c.aspecto] ??= {};
      totais[c.aspecto]![c.resultado] = (totais[c.aspecto]![c.resultado] ?? 0) + 1;
    }
  }
  const ordenado: Record<string, Record<string, number>> = {};
  for (const aspecto of Object.keys(totais).sort(compararTexto)) {
    ordenado[aspecto] = Object.fromEntries(Object.entries(totais[aspecto]!).sort(([a], [b]) => compararTexto(a, b)));
  }
  const ppcs = todos
    .map((p) => ({ ...p, cruzamento: p.cruzamento.filter((c) => RESULTADOS_DIVERGENTES.has(c.resultado)) }))
    .filter((p) => p.cruzamento.length > 0);
  return { totais: ordenado, ppcs };
}
