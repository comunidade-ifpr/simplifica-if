/**
 * Revisão com IA (M1.11, etapa 4): o plano da revisão, em código e sem IA.
 *
 * Depois da pré-conferência (as 12 fichas D, sem IA), as fichas S e J vão à IA em **blocos**, cada um
 * numa sessão curta do motor, sem ferramentas, com o contexto já pronto:
 *
 * - **S** (o código acha o trecho, a IA confirma): lotes de até `TAMANHO_LOTE_S` fichas do mesmo tema;
 *   cada ficha leva o recorte do PPC (1 a 3 mil caracteres) que o código achou pelos termos dela;
 * - **J** (julgamento sobre a seção): uma sessão por tema, com só as seções do PPC dos tópicos das
 *   fichas do tema (sem as achadas por busca), até `LIMITE_SECOES_J` caracteres;
 * - **T** (transversais, `tipo_escopo: transversal`): uma sessão no fim, sobre os **resumos** que os
 *   temas J devolvem e os resultados já conferidos, nunca sobre o PPC inteiro.
 *
 * Os temas seguem a ordem do parecer da PROENS (`TEMAS` de `revisao-previa.ts`). O modo **rápido** leva
 * as fichas que bloqueiam a submissão (`BLOQ`) e as dos temas que mais fazem a PROENS devolver PPC
 * (`TEMAS_RAPIDO`); o **completo**, todas as S e J.
 *
 * Tudo aqui é função pura sobre dados planos: o servidor busca as fichas, as seções e o contexto
 * normativo no `kb.sqlite` e grava o plano, para que a revisão retome sem refazê-lo.
 */
import { TEMAS } from "../revisao-previa.ts";

/** O que a revisão com IA usa de uma ficha da `revisar-ppc` (o JSON canônico, campos lidos). */
export type FichaIa = {
  id: string;
  titulo: string;
  criticidade: string;
  modo: "D" | "S" | "J";
  tipo_escopo: string;
  topicos: string[];
  pergunta: string;
  rubrica: string;
  boa_evidencia?: string | undefined;
  ma_evidencia?: string | undefined;
  escalonar_quando?: string | undefined;
  estados_permitidos: string[];
  /** Termos de busca (`consultas` e `ancoras_semanticas` da ficha), para achar o trecho. */
  termos: string[];
};

/** Lê uma ficha do JSON canônico (o `dados_json` da tabela `fichas` do `kb.sqlite`). */
export function fichaIa(json: Record<string, unknown>): FichaIa {
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const execucao = (json["execucao"] ?? {}) as { modo?: unknown };
  const modo = execucao.modo === "D" || execucao.modo === "S" || execucao.modo === "J" ? execucao.modo : "J";
  return {
    id: texto(json["id"]),
    titulo: texto(json["titulo"]),
    criticidade: texto(json["criticidade"]),
    modo,
    tipo_escopo: texto(json["tipo_escopo"]),
    topicos: lista(json["topicos_tematicos"]),
    pergunta: texto(json["pergunta"]),
    rubrica: texto(json["rubrica"]),
    boa_evidencia: texto(json["boa_evidencia"]) || undefined,
    ma_evidencia: texto(json["ma_evidencia"]) || undefined,
    escalonar_quando: texto(json["escalonar_quando"]) || undefined,
    estados_permitidos: lista(json["estados_permitidos"]).length
      ? lista(json["estados_permitidos"])
      : ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"],
    termos: [...new Set([...lista(json["consultas"]), ...lista(json["ancoras_semanticas"])])],
  };
}

export type ModoRevisaoIa = "rapido" | "completo";
export type TipoBloco = "S" | "J" | "T";

export type Bloco = {
  /** `s-02-1` (tema 2, primeiro lote S), `j-02` (tema 2), `t` (transversais). */
  id: string;
  tipo: TipoBloco;
  tema: string;
  ordemTema: number;
  fichas: string[];
};

/** Temas do modo rápido: os que mais fazem a PROENS devolver PPC (contagem dos pareceres, proposta B). */
export const TEMAS_RAPIDO: readonly string[] = [
  "Identificação e oferta",
  "Matriz e estrutura curricular",
  "Ementário e referências",
];

export const TAMANHO_LOTE_S = 6;

/** O tema (índice em `TEMAS`) de uma ficha: o do primeiro tópico dela que algum tema cobre. */
export function ordemDoTema(topicos: readonly string[]): number {
  const indice = TEMAS.findIndex((tema) => tema.topicos.some((t) => topicos.includes(t)));
  return indice >= 0 ? indice : TEMAS.length - 1;
}

/** As fichas que a IA avalia no modo: nunca as D; no rápido, as `BLOQ` e as dos `TEMAS_RAPIDO`. */
export function fichasDoModo(fichas: readonly FichaIa[], modo: ModoRevisaoIa): FichaIa[] {
  return fichas.filter((f) => {
    if (f.modo === "D") return false;
    if (modo === "completo") return true;
    return f.criticidade === "BLOQ" || TEMAS_RAPIDO.includes(TEMAS[ordemDoTema(f.topicos)]!.titulo);
  });
}

const ehTransversal = (f: FichaIa) => f.tipo_escopo === "transversal";

/** Os blocos na ordem do parecer: em cada tema, os lotes S e depois o J; as transversais no fim. */
export function planejarBlocos(fichas: readonly FichaIa[], modo: ModoRevisaoIa, tamanhoLote = TAMANHO_LOTE_S) {
  const doModo = fichasDoModo(fichas, modo);
  const blocos: Bloco[] = [];
  const dois = (n: number) => String(n).padStart(2, "0");
  TEMAS.forEach((tema, ordemTema) => {
    const doTema = doModo.filter((f) => !ehTransversal(f) && ordemDoTema(f.topicos) === ordemTema);
    const s = doTema.filter((f) => f.modo === "S").map((f) => f.id);
    for (let i = 0; i * tamanhoLote < s.length; i++)
      blocos.push({
        id: `s-${dois(ordemTema)}-${i + 1}`,
        tipo: "S",
        tema: tema.titulo,
        ordemTema,
        fichas: s.slice(i * tamanhoLote, (i + 1) * tamanhoLote),
      });
    const j = doTema.filter((f) => f.modo === "J").map((f) => f.id);
    if (j.length) blocos.push({ id: `j-${dois(ordemTema)}`, tipo: "J", tema: tema.titulo, ordemTema, fichas: j });
  });
  const transversais = doModo.filter(ehTransversal).map((f) => f.id);
  if (transversais.length)
    blocos.push({
      id: "t",
      tipo: "T",
      tema: TEMAS.at(-1)!.titulo,
      ordemTema: TEMAS.length - 1,
      fichas: transversais,
    });
  return blocos;
}

/** As fichas S e J que o modo deixa de fora (para o aviso do título). */
export function fichasForaDoModo(fichas: readonly FichaIa[], modo: ModoRevisaoIa): FichaIa[] {
  const dentro = new Set(fichasDoModo(fichas, modo).map((f) => f.id));
  return fichas.filter((f) => f.modo !== "D" && !dentro.has(f.id));
}

/* ============================================================ recortes */

/** Uma seção do PPC, com o texto e as linhas (1-based) no Markdown. */
export type SecaoTexto = { titulo: string; linhaInicio: number; linhaFim: number; texto: string };

export const LIMITE_RECORTE_S = 3000;
export const LIMITE_SECOES_J = 30_000;
const LIMITE_PARAGRAFO = 1200;

/** Minúsculas, sem acento e sem marcação, com espaços simples. */
export const dobrar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[*_`|#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const MARCA_RETIRADA = "[trecho retirado pelo Simplifica IF: texto dirigido a sistemas de IA]";

/**
 * O Markdown com as linhas de texto dirigido a IA (a triagem da pré-conferência) trocadas por uma
 * marca. As linhas não mudam de número: a seção e a conferência dos trechos continuam valendo.
 */
export function retirarTextoParaIa(markdown: string, linhas: readonly number[]): string {
  if (!linhas.length) return markdown;
  const alvo = new Set(linhas);
  return markdown
    .split("\n")
    .map((linha, i) => (alvo.has(i + 1) ? MARCA_RETIRADA : linha))
    .join("\n");
}

type Paragrafo = { secao: SecaoTexto; ordem: number; texto: string; pontos: number };

function paragrafos(secao: SecaoTexto): string[] {
  return secao.texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.length > LIMITE_PARAGRAFO ? `${p.slice(0, LIMITE_PARAGRAFO)} […]` : p));
}

/**
 * O recorte de uma ficha S: os parágrafos das seções dadas com mais termos da ficha, na ordem do
 * documento, até `limite` caracteres, sob o título da seção. Sem termo achado, o começo da primeira
 * seção (`achou: false`: a IA é avisada de que o código não localizou o trecho).
 */
export function recorteDaFicha(ficha: FichaIa, secoes: readonly SecaoTexto[], limite = LIMITE_RECORTE_S) {
  const termos = [...new Set(ficha.termos.map(dobrar).filter((t) => t.length >= 4))];
  const candidatos: Paragrafo[] = [];
  let ordem = 0;
  for (const secao of secoes)
    for (const texto of paragrafos(secao)) {
      const dobrado = ` ${dobrar(texto)} `;
      const pontos = termos.filter((t) => dobrado.includes(` ${t}`)).length;
      candidatos.push({ secao, ordem: ordem++, texto, pontos });
    }
  const comTermo = candidatos.filter((p) => p.pontos > 0).sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem);
  const escolhidos: Paragrafo[] = [];
  let tamanho = 0;
  for (const p of comTermo) {
    if (tamanho + p.texto.length > limite && escolhidos.length) continue;
    escolhidos.push(p);
    tamanho += p.texto.length;
  }
  const achou = escolhidos.length > 0;
  if (!achou && secoes[0]) {
    const primeira = secoes[0];
    return {
      achou,
      texto: `### ${primeira.titulo} (linhas ${primeira.linhaInicio}–${primeira.linhaFim})\n${primeira.texto.slice(0, Math.floor(limite / 2))}`,
    };
  }
  escolhidos.sort((a, b) => a.ordem - b.ordem);
  const partes: string[] = [];
  let secaoAtual: SecaoTexto | null = null;
  for (const p of escolhidos) {
    if (p.secao !== secaoAtual) {
      partes.push(`### ${p.secao.titulo} (linhas ${p.secao.linhaInicio}–${p.secao.linhaFim})`);
      secaoAtual = p.secao;
    }
    partes.push(p.texto);
  }
  return { achou, texto: partes.join("\n\n") };
}

/** As seções de um tema J, inteiras até `limite`; acima disso, cada uma encurtada na proporção. */
export function secoesDoTema(secoes: readonly SecaoTexto[], limite = LIMITE_SECOES_J): string {
  const total = secoes.reduce((t, s) => t + s.texto.length, 0);
  const fator = total > limite ? limite / total : 1;
  return secoes
    .map((s) => {
      const corte = Math.floor(s.texto.length * fator);
      const texto =
        corte < s.texto.length ? `${s.texto.slice(0, corte)}\n[… seção encurtada pelo Simplifica IF …]` : s.texto;
      return `### ${s.titulo} (linhas ${s.linhaInicio}–${s.linhaFim})\n${texto}`;
    })
    .join("\n\n");
}
