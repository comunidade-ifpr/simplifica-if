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
export type SecaoTexto = {
  titulo: string;
  linhaInicio: number;
  linhaFim: number;
  texto: string;
  /** O tipo de seção do `kb` (taxonomia `tecnico`), quando se sabe. */
  tipo?: string | undefined;
  /** A seção veio pelo tópico da ficha (`topicos-secoes.yaml`), não só pela busca. */
  doTopico?: boolean | undefined;
};

/**
 * Teto do recorte de uma ficha S. Era 3 mil, por parágrafos com termos; o diagnóstico do teste real
 * mostrou que trazer a seção certa inteira vale mais (veja `recorteDaFicha`).
 */
export const LIMITE_RECORTE_S = 4500;
export const LIMITE_SECOES_J = 30_000;
const LIMITE_PARAGRAFO = 2500;

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

/** A triagem retirou texto dirigido a IA deste Markdown (a revisão humana fica obrigatória). */
export const teveTextoParaIa = (markdown: string) => markdown.includes(MARCA_RETIRADA);

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

function paragrafos(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.length > LIMITE_PARAGRAFO ? `${p.slice(0, LIMITE_PARAGRAFO)} […]` : p));
}

const contar = (termos: readonly string[], texto: string) => {
  const dobrado = ` ${dobrar(texto)} `;
  return termos.filter((t) => dobrado.includes(` ${t}`)).length;
};

/** O texto da seção sem as linhas de tabela (quando a matriz vai à parte, em TSV). */
const semTabela = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("|"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export type OpcoesRecorte = {
  limite?: number;
  /** Seções (pela linha do título) que o comum do bloco já traz inteiras (o quadro): ficam de fora aqui. */
  excluirLinhas?: ReadonlySet<number>;
  /** Tira as linhas de tabela das seções destes tipos (a matriz, que vai à parte em TSV). */
  semTabelaEm?: ReadonlySet<string>;
};

const LIMITE_PRIMEIRO_PARAGRAFO = 1200;
const FIGURA_NO_TITULO = /representacao grafica|fluxograma|figura|organograma|imagem/;
const FIGURA = "(seção sem texto no documento convertido: provavelmente só uma figura, que a conversão não lê)";

/**
 * O recorte de uma ficha, guiado pela estrutura. As seções vêm pelo tópico da ficha ou pela busca e
 * são pontuadas pelos termos dela **no título** (peso 3: num quadro de identificação, o rótulo está no
 * título e o valor no corpo) e no corpo, mais 1 se vieram pelo tópico.
 *
 * 1. Cobertura: cada tipo de seção dos tópicos da ficha entra com o primeiro parágrafo da sua seção
 *    mais pontuada (uma transversal precisa de objetivos **e** perfil **e** avaliação, não de três
 *    pedaços da maior seção).
 * 2. Preenchimento: as seções entram inteiras, da mais pontuada à menos, enquanto cabem em `limite`; a
 *    que não cabe entra com o primeiro parágrafo e os de mais termos. Uma seção que não cabe não para a
 *    escolha: uma menor, mais abaixo, ainda pode caber.
 *
 * Sem nenhuma seção pontuada, o começo da primeira (`achou: false`).
 */
export function recorteDaFicha(ficha: FichaIa, secoes: readonly SecaoTexto[], opcoes: OpcoesRecorte = {}) {
  const limite = opcoes.limite ?? LIMITE_RECORTE_S;
  const termos = [...new Set(ficha.termos.map(dobrar).filter((t) => t.length >= 4))];
  const candidatas = secoes
    .filter((s) => !opcoes.excluirLinhas?.has(s.linhaInicio))
    .map((s, ordem) => {
      const texto = s.tipo && opcoes.semTabelaEm?.has(s.tipo) ? semTabela(s.texto) : s.texto;
      // Seção de figura sem corpo (a representação gráfica): entra com a nota. Outro título vazio (um
      // subtítulo da matriz) não entra: no teste real, a nota num subtítulo virou "falta o 3º semestre".
      const corpo = texto.trim() ? texto : FIGURA_NO_TITULO.test(dobrar(s.titulo)) ? FIGURA : "";
      return {
        s,
        ordem,
        texto: corpo,
        pontos: 3 * contar(termos, s.titulo) + contar(termos, texto) + (s.doTopico ? 1 : 0),
      };
    });
  const pontuadas = candidatas.filter((c) => c.pontos > 0).sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem);
  const escolhidas = new Map<number, { ordem: number; texto: string; s: SecaoTexto }>();
  let tamanho = 0;
  const por = (ordem: number, s: SecaoTexto, texto: string) => {
    tamanho += texto.length - (escolhidas.get(ordem)?.texto.length ?? 0);
    escolhidas.set(ordem, { ordem, texto, s });
  };

  const tiposVistos = new Set<string>();
  for (const c of pontuadas) {
    if (!c.s.doTopico || !c.s.tipo || tiposVistos.has(c.s.tipo)) continue;
    tiposVistos.add(c.s.tipo);
    const primeiro = paragrafos(c.texto)[0] ?? "";
    const texto =
      primeiro.length > LIMITE_PRIMEIRO_PARAGRAFO ? `${primeiro.slice(0, LIMITE_PRIMEIRO_PARAGRAFO)} […]` : primeiro;
    const final = texto.length < c.texto.length ? `${texto}\n[… seção encurtada …]` : texto;
    if (tamanho + final.length <= limite) por(c.ordem, c.s, final);
  }

  for (const c of pontuadas) {
    const atual = escolhidas.get(c.ordem)?.texto.length ?? 0;
    const sobra = limite - tamanho + atual;
    if (c.texto.length <= sobra) {
      por(c.ordem, c.s, c.texto);
      continue;
    }
    if (sobra - atual < 400) continue;
    // A seção não cabe: o primeiro parágrafo e os de mais termos, na ordem do documento.
    const ps = paragrafos(c.texto).map((texto, i) => ({
      texto,
      i,
      pontos: i === 0 ? Infinity : contar(termos, texto),
    }));
    const dentro: typeof ps = [];
    let usado = 0;
    for (const p of [...ps].sort((a, b) => b.pontos - a.pontos || a.i - b.i)) {
      if (p.pontos === 0) break;
      if (usado + p.texto.length > sobra) continue;
      dentro.push(p);
      usado += p.texto.length;
    }
    if (!dentro.length) continue;
    dentro.sort((a, b) => a.i - b.i);
    por(c.ordem, c.s, `${dentro.map((p) => p.texto).join("\n\n")}\n[… seção encurtada …]`);
  }

  const achou = escolhidas.size > 0;
  if (!achou && candidatas[0]) {
    const primeira = candidatas[0];
    return {
      achou,
      texto: `### ${primeira.s.titulo} (linhas ${primeira.s.linhaInicio}–${primeira.s.linhaFim})\n${primeira.texto.slice(0, Math.floor(limite / 2))}`,
    };
  }
  return {
    achou,
    texto: [...escolhidas.values()]
      .sort((a, b) => a.ordem - b.ordem)
      .map((e) => `### ${e.s.titulo} (linhas ${e.s.linhaInicio}–${e.s.linhaFim})\n${e.texto}`)
      .join("\n\n"),
  };
}

/** As seções de um tema J, inteiras até `limite`; acima disso, cada uma encurtada na proporção. */
export function secoesDoTema(
  secoesOriginais: readonly SecaoTexto[],
  limite = LIMITE_SECOES_J,
  semTabelaEm?: ReadonlySet<string>,
): string {
  const secoes = secoesOriginais
    .map((s) => (s.tipo && semTabelaEm?.has(s.tipo) ? { ...s, texto: semTabela(s.texto) } : s))
    .filter((s) => s.texto.length > 0);
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
