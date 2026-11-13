/**
 * Pontuação determinística de uma resposta contra o gabarito: critérios `deve_conter` presentes,
 * `nao_deve_conter` ausentes e, nas perguntas de conjunto, precisão e recall sobre os itens do
 * universo reconhecidos na resposta.
 *
 * Nota composta (0 a 1): média entre a cobertura de `deve_conter` e o F1 do conjunto (quando há
 * cada um), menos 0,25 por critério proibido encontrado, com piso em 0.
 */
import { compilarPadrao, normalizarTexto } from "./normalizar.ts";
import type { Criterio, GabaritoConjunto, Pergunta, Universos } from "./esquema.ts";
import { detectarItens } from "./universos.ts";

export const PENALIDADE_PROIBIDO = 0.25;

export interface ResultadoConjunto {
  esperados: number;
  encontrados: string[];
  verdadeiros_positivos: string[];
  falsos_positivos: string[];
  faltantes: string[];
  precisao: number | null;
  recall: number;
  f1: number;
}

export interface Pontuacao {
  deve_conter: { presentes: string[]; ausentes: string[]; cobertura: number | null };
  nao_deve_conter: { encontrados: string[] };
  conjunto: ResultadoConjunto | null;
  nota: number;
}

function casaCriterio(criterio: Criterio, texto: string): boolean {
  return criterio.padroes.some((fonte) => compilarPadrao(fonte).test(texto));
}

function arredondar(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

export function pontuarConjunto(resposta: string, gabarito: GabaritoConjunto, universos: Universos): ResultadoConjunto {
  const esperado = new Set(gabarito.esperado);
  const encontrados = [...detectarItens(resposta, gabarito.universo, universos)].sort();
  const verdadeiros = encontrados.filter((id) => esperado.has(id));
  const falsos = encontrados.filter((id) => !esperado.has(id));
  const faltantes = gabarito.esperado.filter((id) => !encontrados.includes(id));
  const recall = esperado.size === 0 ? 1 : verdadeiros.length / esperado.size;
  let precisao: number | null = null;
  if (gabarito.avaliar_precisao) {
    precisao = encontrados.length === 0 ? (esperado.size === 0 ? 1 : 0) : verdadeiros.length / encontrados.length;
  }
  const p = precisao ?? 1;
  const f1 = p + recall === 0 ? 0 : (2 * p * recall) / (p + recall);
  return {
    esperados: esperado.size,
    encontrados,
    verdadeiros_positivos: verdadeiros,
    falsos_positivos: gabarito.avaliar_precisao ? falsos : [],
    faltantes,
    precisao: precisao === null ? null : arredondar(precisao),
    recall: arredondar(recall),
    f1: arredondar(f1),
  };
}

export function pontuarResposta(
  pergunta: Pergunta,
  resposta: string,
  contexto: { conjunto?: GabaritoConjunto | undefined; universos?: Universos | undefined } = {},
): Pontuacao {
  const texto = normalizarTexto(resposta);
  const { deve_conter, nao_deve_conter } = pergunta.gabarito;
  const presentes = deve_conter.filter((criterio) => casaCriterio(criterio, texto)).map((criterio) => criterio.id);
  const ausentes = deve_conter.filter((criterio) => !presentes.includes(criterio.id)).map((criterio) => criterio.id);
  const proibidos = nao_deve_conter.filter((criterio) => casaCriterio(criterio, texto)).map((criterio) => criterio.id);
  const cobertura = deve_conter.length === 0 ? null : presentes.length / deve_conter.length;

  let conjunto: ResultadoConjunto | null = null;
  if (pergunta.gabarito.conjunto) {
    if (!contexto.conjunto || !contexto.universos) {
      throw new Error(`${pergunta.id}: gabarito de conjunto ou universos não carregados`);
    }
    conjunto = pontuarConjunto(resposta, contexto.conjunto, contexto.universos);
  }

  const componentes = [cobertura, conjunto?.f1 ?? null].filter((valor): valor is number => valor !== null);
  const base = componentes.length === 0 ? 0 : componentes.reduce((soma, valor) => soma + valor, 0) / componentes.length;
  const nota = Math.max(0, base - PENALIDADE_PROIBIDO * proibidos.length);
  return {
    deve_conter: { presentes, ausentes, cobertura: cobertura === null ? null : arredondar(cobertura) },
    nao_deve_conter: { encontrados: proibidos },
    conjunto,
    nota: arredondar(nota),
  };
}
