/**
 * As expressões do FTS5 e o recorte das linhas que casam, puros: os conceitos de uma consulta (termos,
 * radicais ou grupos de sinônimos), a expressão por conceitos (`expressaoFts`, da busca de seções e de
 * normas), a expressão por prefixo (`expressaoFtsPrefixo`, da paleta do Explorar) e as linhas mais
 * relevantes de um texto.
 */
import { expandirConsulta, type Sinonimos } from "./sinonimos.ts";
import { radicais, termoFts, termos } from "./tokens.ts";

/** Modo da busca: sem stemmer nem sinônimos, só radicais, ou radicais + léxico de sinônimos. */
export type ModoBusca = "simples" | "radicais" | "completo";

export interface Conceito {
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

/** A expressão FTS5 restrita às colunas: `{colunas} : (partes)`, com as partes ligadas por `juntor`. */
function naColunas(colunas: ReadonlyArray<string>, partes: ReadonlyArray<string>, juntor: string): string {
  return `{${colunas.join(" ")}} : (${partes.join(juntor)})`;
}

/** Expressão FTS5: conceitos ligados por AND ou por OR, restrita às colunas do modo. */
export function expressaoFts(conceitos: Conceito[], colunas: string[], operador: "AND" | "OR"): string | null {
  if (!conceitos.length) return null;
  const partes = conceitos.map((c) => {
    const alternativas = c.alternativas.map(alternativaFts);
    return alternativas.length === 1 ? alternativas[0]! : `(${alternativas.join(" OR ")})`;
  });
  return naColunas(colunas, partes, ` ${operador} `);
}

/**
 * A expressão FTS5 para os termos nas colunas dadas: todos os termos (E implícito), o último como
 * prefixo quando tem três letras ou mais (a paleta do Explorar busca enquanto se digita).
 */
export function expressaoFtsPrefixo(termos: ReadonlyArray<string>, colunas: ReadonlyArray<string>): string | null {
  const validos = termos.filter((t) => t.length > 0);
  if (validos.length === 0) return null;
  const partes = validos.map((t, i) => (i === validos.length - 1 && t.length >= 3 ? `${termoFts(t)}*` : termoFts(t)));
  return naColunas(colunas, partes, " ");
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
export function trechoOuInicio(textoSecao: string, linhaInicial: number, conceitos: Conceito[], modo: ModoBusca) {
  const relevantes = linhasRelevantes(textoSecao, linhaInicial, conceitos, modo);
  if (relevantes.length) return relevantes;
  return textoSecao
    .split("\n")
    .map((t, i) => ({ linha: linhaInicial + i, texto: t }))
    .filter((l) => l.texto.trim())
    .slice(0, 2);
}
