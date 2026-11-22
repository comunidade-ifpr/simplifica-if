/**
 * A busca da paleta do Explorar na memória: as coleções pequenas (normas pelos metadados, cursos, PPCs,
 * campi, CNCT, fichas e o Consepe) são poucas centenas de itens, e a paleta busca a cada tecla. Cada
 * termo da consulta precisa começar alguma palavra do item ("enferm" acha "Enfermagem"), sem acento e
 * sem maiúsculas; a pontuação soma o peso do campo em que o termo aparece (título vale mais) e dá um
 * bônus à palavra inteira e à consulta inteira no título.
 *
 * Funções puras, sem banco: `leitura/explorar.ts` monta os itens a partir do `kb.sqlite`.
 */
import { PALAVRAS_VAZIAS, semDiacriticos } from "@simplifica-if/kb/busca/tokens";
import { partesDispositivo, textoDispositivos } from "@simplifica-if/kb/normas/texto-dispositivos";
import type { ResultadoBusca, TipoResultado } from "../explorar.ts";

const RE_PALAVRA = /[\p{L}\p{N}]+/gu;

/** Texto sem acento e em minúsculas, para comparar. */
export function normalizar(texto: string): string {
  return semDiacriticos(texto.toLowerCase());
}

/** As palavras do texto, normalizadas, na ordem. */
export function palavras(texto: string): string[] {
  return [...normalizar(texto).matchAll(RE_PALAVRA)].map((m) => m[0]);
}

/**
 * Os termos da consulta: as palavras sem as vazias ("de", "em"…); se só houver vazias, elas mesmas.
 * Repetidos saem.
 */
export function termosDaConsulta(consulta: string): string[] {
  const todas = palavras(consulta);
  const uteis = todas.filter((p) => !PALAVRAS_VAZIAS.has(p));
  return [...new Set(uteis.length ? uteis : todas)];
}

export interface CampoBuscavel {
  readonly palavras: ReadonlySet<string>;
  readonly peso: number;
}

/** Um item da busca na memória: o resultado pronto e os campos onde procurar. */
export interface ItemBuscavel {
  readonly resultado: ResultadoBusca;
  readonly campos: ReadonlyArray<CampoBuscavel>;
  /** O título normalizado, para o bônus da consulta inteira. */
  readonly tituloNormalizado: string;
}

export function campo(textos: ReadonlyArray<string | null | undefined>, peso: number): CampoBuscavel {
  const conjunto = new Set<string>();
  for (const texto of textos) if (texto) for (const p of palavras(texto)) conjunto.add(p);
  return { palavras: conjunto, peso };
}

export function item(
  resultado: Omit<ResultadoBusca, "trecho" | "reuniao"> & Partial<Pick<ResultadoBusca, "trecho" | "reuniao">>,
  campos: ReadonlyArray<CampoBuscavel>,
): ItemBuscavel {
  return {
    resultado: { trecho: null, reuniao: null, ...resultado },
    campos: campos.filter((c) => c.palavras.size > 0),
    tituloNormalizado: normalizar(resultado.titulo),
  };
}

/** A pontuação do item para os termos; 0 se algum termo não aparece em nenhum campo. */
export function pontuar(alvo: ItemBuscavel, termos: ReadonlyArray<string>, consultaNormalizada: string): number {
  let total = 0;
  for (const termo of termos) {
    let melhor = 0;
    for (const c of alvo.campos) {
      if (c.peso <= melhor) continue;
      if (c.palavras.has(termo)) {
        melhor = c.peso * 1.5;
        continue;
      }
      for (const p of c.palavras) {
        if (p.startsWith(termo)) {
          melhor = Math.max(melhor, c.peso);
          break;
        }
      }
    }
    if (melhor === 0) return 0;
    total += melhor;
  }
  if (consultaNormalizada.length >= 3 && alvo.tituloNormalizado.includes(consultaNormalizada)) total += 2;
  return total;
}

/** Os itens que respondem à consulta, mais pontuados primeiro (empate: título mais curto, depois alfabético). */
export function buscarNaMemoria(
  itens: ReadonlyArray<ItemBuscavel>,
  consulta: string,
  limite: number,
): ResultadoBusca[] {
  const termos = termosDaConsulta(consulta);
  if (termos.length === 0) return [];
  const consultaNormalizada = palavras(consulta).join(" ");
  const pontuados: { item: ItemBuscavel; pontos: number }[] = [];
  for (const alvo of itens) {
    const pontos = pontuar(alvo, termos, consultaNormalizada);
    if (pontos > 0) pontuados.push({ item: alvo, pontos });
  }
  pontuados.sort(
    (a, b) =>
      b.pontos - a.pontos ||
      a.item.resultado.titulo.length - b.item.resultado.titulo.length ||
      a.item.resultado.titulo.localeCompare(b.item.resultado.titulo, "pt-BR"),
  );
  return pontuados.slice(0, limite).map((p) => p.item.resultado);
}

/**
 * Um trecho de cerca de `largura` caracteres do texto em volta da primeira palavra que começa por um
 * dos termos, com "…" nas pontas cortadas; sem achado, o começo do texto.
 */
export function trechoEmVolta(texto: string, termos: ReadonlyArray<string>, largura = 180): string {
  const compacto = texto.replace(/\s+/g, " ").trim();
  let inicio = 0;
  for (const m of compacto.matchAll(RE_PALAVRA)) {
    const p = normalizar(m[0]);
    if (termos.some((t) => p.startsWith(t))) {
      inicio = Math.max(0, m.index - Math.floor(largura / 3));
      break;
    }
  }
  if (inicio > 0) {
    const espaco = compacto.indexOf(" ", inicio);
    if (espaco !== -1 && espaco - inicio < 20) inicio = espaco + 1;
  }
  let fim = Math.min(compacto.length, inicio + largura);
  if (fim < compacto.length) {
    const espaco = compacto.lastIndexOf(" ", fim);
    if (espaco > inicio + largura / 2) fim = espaco;
  }
  return `${inicio > 0 ? "…" : ""}${compacto.slice(inicio, fim)}${fim < compacto.length ? "…" : ""}`;
}

/** A ordem dos grupos na paleta; a citação resolvida (tipo `dispositivo`) sobe para o topo. */
export const ORDEM_GRUPOS: ReadonlyArray<TipoResultado> = [
  "curso",
  "norma",
  "ppc",
  "campus",
  "cnct",
  "consepe",
  "dispositivo",
  "secao",
];

/**
 * O título de um dispositivo na paleta: a norma e o caminho inteiro do dispositivo, como nas fichas
 * ("Resolução CNE/CP nº 2/2026, art. 28, XVIII"; "…, Anexo 1, art. 21, § 1º"), e não só o rótulo
 * ("XVIII"). Um ID fora do formato fica com o rótulo.
 */
export function tituloDoDispositivo(tituloNorma: string, id: string, rotulo: string): string {
  const fragmento = id.split("#")[1];
  const caminho =
    fragmento !== undefined && partesDispositivo(`#${fragmento}`) !== null
      ? textoDispositivos([`#${fragmento}`])
      : rotulo;
  return `${tituloNorma}, ${caminho}`;
}
