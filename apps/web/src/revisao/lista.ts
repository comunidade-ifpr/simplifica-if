/**
 * A lista de pendências da revisão de PPC como a tela a lê, em funções puras: a gravidade (corrigir ou
 * conferir), o que ainda pede trabalho, as contagens da frase-resultado, a ordem da lista, os temas da
 * coluna da esquerda, os grupos da régua e as frases curtas (localização, curso, arquivo novo).
 */
import type {
  CnctDoIndice,
  CriterioRevisao,
  EstadoCriterio,
  ListaPendencias,
  PendenciaRevisao,
  PendenciaViva,
  ResultadoArquivoNovo,
  ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app";
import { normalizar } from "../explorar/normalizar.ts";

/** "1 critério", "2 critérios". */
export const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

export const nomeDoArquivo = (caminho: string): string => caminho.split(/[\\/]/).at(-1) ?? caminho;

/**
 * A versão do PPC revisado para o painel de leitura: o arquivo (`sha256`) e o conjunto das pendências,
 * de que dependem o texto e as âncoras. Muda com o arquivo novo, a leitura com IA ou outro curso, e não
 * com "Feito": o painel só lê de novo quando o que ele mostra mudou.
 */
export function versaoDoPpc(lista: Pick<ListaPendencias, "sha256" | "pendencias">): string {
  let h = 0x811c9dc5;
  for (const c of lista.pendencias
    .map((p) => p.chave)
    .sort()
    .join("|")) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${lista.sha256.slice(0, 12)}-${h.toString(16).padStart(8, "0")}`;
}

/**
 * O link do PPC revisado (`versaoDoPpc`), para "Abrir ao lado"; com `#p-<chave>`, o trecho da pendência,
 * para "Ver no PPC".
 */
export const linkDoPpc = (lista: string, versao: string): string => `ifpr://revisao/${lista}/${versao}`;

export type Gravidade = "corrigir" | "conferir";

export const gravidadeDe = (p: PendenciaRevisao): Gravidade => (p.estado === "nao_atende" ? "corrigir" : "conferir");

/** A pendência ainda pede trabalho da pessoa: aberta, ou mantida depois de ela discordar. */
export const pendente = (v: PendenciaViva): boolean => v.situacao === "aberta" || v.situacao === "contestada_mantida";

/**
 * A pendência fica no bloqueio "Qual é o curso?", fora da lista principal: depende do curso no CNCT, que
 * não foi identificado.
 */
export const noBloqueio = (resultado: ResultadoRevisaoPpc, v: PendenciaViva): boolean =>
  v.pendencia.dependeDoCurso && resultado.curso.cnct === null;

/** As pendências da lista principal (sem as do bloqueio). */
export const principais = (lista: ListaPendencias): ReadonlyArray<PendenciaViva> =>
  lista.pendencias.filter((v) => !noBloqueio(lista.resultado, v));

/** As pendências que esperam o curso. */
export const doBloqueio = (lista: ListaPendencias): ReadonlyArray<PendenciaViva> =>
  lista.pendencias.filter((v) => noBloqueio(lista.resultado, v));

export interface Contagens {
  /** Pendentes da lista principal com estado `nao_atende`. */
  readonly corrigir: number;
  /** Pendentes da lista principal com estado `a_conferir`. */
  readonly conferir: number;
  /** "Feito": as resolvidas da lista principal. */
  readonly feitas: number;
  /** As da lista principal que contam para "N de M feitas" (as retiradas ficam de fora). */
  readonly total: number;
}

export function contagens(lista: ListaPendencias): Contagens {
  const lidas = principais(lista);
  const abertas = lidas.filter(pendente);
  const corrigir = abertas.filter((v) => v.pendencia.estado === "nao_atende").length;
  return {
    corrigir,
    conferir: abertas.length - corrigir,
    feitas: lidas.filter((v) => v.situacao === "resolvida").length,
    total: lidas.filter((v) => v.situacao !== "contestada_aceita").length,
  };
}

/** O resultado passou pela leitura com IA, inteira ou em parte (mesmo que ela tenha deixado tudo para conferir). */
export const passouPelaIa = (r: ResultadoRevisaoPpc): boolean => r.leituraIa !== "nenhuma";

/** Os critérios que ninguém leu ainda (nem o código nem a IA): o que a faixa da IA oferece ler. */
export const naoLidos = (r: ResultadoRevisaoPpc): number => r.criterios.filter((c) => c.estado === "nao_lido").length;

/** As chaves que a lista nova tem e a anterior não: as pendências que chegaram com a leitura com IA. */
export const chavesNovas = (antes: ListaPendencias, depois: ListaPendencias): ReadonlyArray<string> => {
  const conhecidas = new Set(antes.pendencias.map((v) => v.chave));
  return depois.pendencias.filter((v) => !conhecidas.has(v.chave)).map((v) => v.chave);
};

/** Quantos critérios alguém decidiu (o código ou a IA): os que não estão `nao_lido`. */
export const criteriosLidos = (r: ResultadoRevisaoPpc): number =>
  r.criterios.filter((c) => c.estado !== "nao_lido").length;

/**
 * A frase-resultado, honesta sobre a cobertura: "3 para corrigir e 8 para conferir, nos 12 critérios que
 * o app confere sozinho." Depois da IA, "… em 84 critérios" (ou "em 60 de 84", se a leitura deixou
 * critérios de fora). Sem pendências, diz que nada apareceu nos critérios lidos, sem afirmar aprovação.
 */
export function fraseResultado(lista: ListaPendencias): string {
  const r = lista.resultado;
  const c = contagens(lista);
  const lidos = criteriosLidos(r);
  const onde = !passouPelaIa(r)
    ? r.conferidos === 1
      ? "no critério que o app confere sozinho"
      : `nos ${r.conferidos} critérios que o app confere sozinho`
    : lidos < r.totalCriterios
      ? `em ${lidos} de ${r.totalCriterios} critérios`
      : `em ${plural(r.totalCriterios, "critério", "critérios")}`;
  if (c.corrigir + c.conferir === 0)
    return c.total === 0
      ? `Nada apareceu para corrigir nem para conferir ${onde}.`
      : `Nada mais para corrigir nem para conferir ${onde}.`;
  if (c.corrigir === 0) return `Nada para corrigir e ${c.conferir} para conferir, ${onde}.`;
  if (c.conferir === 0) return `${c.corrigir} para corrigir, ${onde}.`;
  return `${c.corrigir} para corrigir e ${c.conferir} para conferir, ${onde}.`;
}

/** "4 de 11 feitas". */
export const textoFeitas = (c: Contagens): string => `${c.feitas} de ${c.total} ${c.total === 1 ? "feita" : "feitas"}`;

/**
 * A ordem da lista: o que pede trabalho antes do que já foi feito ou retirado; dentro de cada parte,
 * corrigir antes de conferir, e depois a ordem do parecer.
 */
export function ordenar(pendencias: ReadonlyArray<PendenciaViva>): ReadonlyArray<PendenciaViva> {
  const chave = (v: PendenciaViva) => [
    v.situacao === "resolvida" || v.situacao === "contestada_aceita" ? 1 : 0,
    gravidadeDe(v.pendencia) === "corrigir" ? 0 : 1,
    v.pendencia.ordemTema,
  ];
  return [...pendencias].sort((a, b) => {
    const [x, y] = [chave(a), chave(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  });
}

/* ---------------------------------------------------------------- régua */

export interface GrupoRegua {
  readonly ordem: number;
  readonly tema: string;
  readonly criterios: ReadonlyArray<CriterioRevisao>;
}

/** Os critérios por tema, na ordem do parecer (a ordem dos critérios dentro do tema fica a do servidor). */
export function gruposDaRegua(criterios: ReadonlyArray<CriterioRevisao>): ReadonlyArray<GrupoRegua> {
  const grupos = new Map<number, { tema: string; criterios: CriterioRevisao[] }>();
  for (const c of criterios) {
    const g = grupos.get(c.ordemTema) ?? { tema: c.tema, criterios: [] };
    g.criterios.push(c);
    grupos.set(c.ordemTema, g);
  }
  return [...grupos].sort(([a], [b]) => a - b).map(([ordem, g]) => ({ ordem, ...g }));
}

const contar = (criterios: ReadonlyArray<CriterioRevisao>, estado: EstadoCriterio) =>
  criterios.filter((c) => c.estado === estado).length;

/** As partes de um resumo, só com as que existem: "2 para corrigir", "1 para conferir"… */
function partes(criterios: ReadonlyArray<CriterioRevisao>): string[] {
  const p: string[] = [];
  const n = (estado: EstadoCriterio, um: string, varios: string) => {
    const k = contar(criterios, estado);
    if (k) p.push(plural(k, um, varios));
  };
  n("nao_atende", "para corrigir", "para corrigir");
  n("a_conferir", "para conferir", "para conferir");
  n("atende", "em ordem", "em ordem");
  n("nao_se_aplica", "não se aplica", "não se aplicam");
  n("nao_lido", "não lido", "não lidos");
  return p;
}

/** O título de um grupo da régua: "Estágio curricular: 2 para corrigir, 1 para conferir, 5 não lidos". */
export const resumoGrupo = (g: GrupoRegua): string => `${g.tema}: ${partes(g.criterios).join(", ")}`;

/** O rótulo da régua inteira, para o leitor de tela. */
export const resumoRegua = (criterios: ReadonlyArray<CriterioRevisao>): string =>
  `${plural(criterios.length, "critério", "critérios")}: ${partes(criterios).join(", ")}.`;

/* ---------------------------------------------------------------- temas */

export interface TemaNavegacao {
  readonly ordem: number;
  readonly tema: string;
  /** As pendentes da lista principal no tema. */
  readonly abertas: number;
  /** A gravidade mais alta entre as pendentes; nula sem pendentes. */
  readonly gravidade: Gravidade | null;
  /** Ninguém leu nenhum critério do tema (e ele não tem pendência). */
  readonly naoLido: boolean;
}

/** Os temas da coluna da esquerda: os da régua e os que só têm pendência (a triagem), na ordem do parecer. */
export function temasDaNavegacao(lista: ListaPendencias): ReadonlyArray<TemaNavegacao> {
  const temas = new Map<number, { tema: string; criterios: CriterioRevisao[]; pendencias: PendenciaViva[] }>();
  const tema = (ordem: number, nome: string) => {
    let t = temas.get(ordem);
    if (t === undefined) temas.set(ordem, (t = { tema: nome, criterios: [], pendencias: [] }));
    return t;
  };
  for (const c of lista.resultado.criterios) tema(c.ordemTema, c.tema).criterios.push(c);
  for (const v of principais(lista)) tema(v.pendencia.ordemTema, v.pendencia.tema).pendencias.push(v);
  return [...temas]
    .sort(([a], [b]) => a - b)
    .map(([ordem, t]) => {
      const abertas = t.pendencias.filter(pendente);
      return {
        ordem,
        tema: t.tema,
        abertas: abertas.length,
        gravidade:
          abertas.length === 0
            ? null
            : abertas.some((v) => v.pendencia.estado === "nao_atende")
              ? "corrigir"
              : "conferir",
        naoLido: t.pendencias.length === 0 && t.criterios.every((c) => c.estado === "nao_lido"),
      };
    });
}

/* ---------------------------------------------------------------- frases */

/** "seção 4.1", "falta no documento" (o que falta fica no comentário do título) ou nada. */
export function localizacao(p: PendenciaRevisao): string | null {
  if (p.secao !== null) return `seção ${p.secao}`;
  return p.noDocumento === "no-inicio" ? "falta no documento" : null;
}

const FORMAS: Readonly<Record<string, string>> = {
  integrado: "integrado ao ensino médio",
  subsequente: "subsequente",
  concomitante: "concomitante",
  proeja: "PROEJA",
};

/** "Técnico em Agropecuária, subsequente"; nulo sem o curso no CNCT. */
export function descreverCurso(curso: ResultadoRevisaoPpc["curso"]): string | null {
  if (curso.cnct === null) return null;
  return curso.forma === null
    ? curso.cnct.denominacao
    : `${curso.cnct.denominacao}, ${FORMAS[curso.forma] ?? curso.forma}`;
}

/** "3 resolvidas, 5 continuam, 1 nova", só com o que houve. */
export function textoArquivoNovo(r: Pick<ResultadoArquivoNovo, "resolvidas" | "continuam" | "novas">): string {
  const p: string[] = [];
  if (r.resolvidas) p.push(plural(r.resolvidas, "resolvida", "resolvidas"));
  if (r.continuam) p.push(plural(r.continuam, "continua", "continuam"));
  if (r.novas) p.push(plural(r.novas, "nova", "novas"));
  return p.length === 0 ? "Nada mudou na conferência automática." : `${p.join(", ")}.`;
}

/** Os cursos do CNCT cujo nome tem todas as palavras da busca (sem acento), em ordem alfabética. */
export function buscarCnct(cnct: ReadonlyArray<CnctDoIndice>, busca: string): ReadonlyArray<CnctDoIndice> {
  const palavras = normalizar(busca).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];
  return cnct
    .filter((c) => {
      const nome = normalizar(c.denominacao);
      return palavras.every((p) => nome.includes(p));
    })
    .toSorted((a, b) => a.denominacao.localeCompare(b.denominacao, "pt-BR"));
}
