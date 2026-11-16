/**
 * Revisão com IA (M1.11, etapa 4): a estimativa de tokens, tempo e cota mostrada antes de começar.
 *
 * Método: o plano já tem o texto de cada pedido (o servidor o monta antes de perguntar), então a
 * entrada é medida em caracteres e convertida pela densidade medida; a saída, o tempo por bloco e o
 * custo de sistema de cada sessão vêm das medições reais registradas no plano do app (M1.11, etapa 4).
 * A fração da janela do plano usa uma referência provisória por provider (`JANELA_REFERENCIA`), a
 * calibrar no piloto: os providers não publicam o tamanho da janela em tokens.
 */
import type { Provider } from "./tipos.ts";

export type ParametrosProvider = {
  /** Tokens de sistema e instruções por sessão (sem ferramentas). */
  sistemaPorSessao: number;
  /** Segundos fixos por sessão (abrir o processo, primeiro token). */
  segundosPorSessao: number;
  /** Tokens de saída por segundo. */
  saidaPorSegundo: number;
  /** Tokens (entrada + saída, saída pesando 5×) de uma janela de uso de referência do plano básico. */
  janelaReferencia: number;
  /** Nome da janela de referência para a pessoa. */
  nomeJanela: string;
  /** US$ por milhão de tokens de entrada e de saída (preço de API equivalente), quando conhecido. */
  precoEntrada?: number;
  precoSaida?: number;
};

/**
 * Densidade medida no teste real (Claude Sonnet, modo rápido, 16/11/2026): 164 mil caracteres de
 * pedido viraram 81 mil tokens gravados no cache, 2,0 caracteres por token (o pedido é texto, não JSON).
 */
export const CARACTERES_POR_TOKEN = 2.0;
/**
 * Saída média por critério. Primeira execução real: 690 tokens (15,1 mil para 22 critérios). Segunda,
 * com os recortes estruturados (mais evidência, justificativas mais longas): 930 nos blocos de um turno
 * só (8,4 mil para 9 critérios). Fica a segunda.
 */
export const SAIDA_POR_FICHA = 900;
/**
 * Folga para as novas tentativas. Cada uma é uma sessão nova com o pedido inteiro; nas duas execuções
 * reais, 0 de 5 e 3 de 5 blocos precisaram dela.
 */
export const FOLGA_TENTATIVAS = 1.25;

export const PARAMETROS: Record<Provider, ParametrosProvider> = {
  claude: {
    // Medido: com `tools: []` e o prompt de sistema só do app, o sistema some na conta (2 tokens fora do cache).
    sistemaPorSessao: 500,
    segundosPorSessao: 3,
    // Medido: de 120 a 155 tokens de saída por segundo nos cinco blocos.
    saidaPorSegundo: 140,
    janelaReferencia: 2_000_000,
    nomeJanela: "uma janela de 5 horas do plano Pro",
    // Sonnet: entrada gravada no cache a US$ 3,75/M (o Claude Code grava todo o pedido), saída a US$ 15/M.
    precoEntrada: 3.75,
    precoSaida: 15,
  },
  codex: {
    // Medido num lote S de 3 fichas (21,6 mil caracteres): 16,6 mil tokens de entrada, 923 de saída, 21,8 s.
    sistemaPorSessao: 6_000,
    segundosPorSessao: 4,
    saidaPorSegundo: 50,
    janelaReferencia: 2_000_000,
    nomeJanela: "uma janela de 5 horas do plano Plus",
  },
  antigravity: {
    // Medido no mesmo lote: 16,3 mil tokens de entrada, 985 de saída, 22,2 s.
    sistemaPorSessao: 5_500,
    segundosPorSessao: 3,
    saidaPorSegundo: 50,
    janelaReferencia: 3_000_000,
    nomeJanela: "a cota diária do plano gratuito",
  },
};

export type Estimativa = {
  provider: Provider;
  blocos: number;
  fichas: number;
  tokensEntrada: number;
  tokensSaida: number;
  /** Tempo de parede, com o paralelismo. */
  minutos: number;
  /** US$ equivalentes na API (só quando o preço é conhecido). */
  custoUsd: number | null;
  /** Porcentagem estimada da janela de referência (`nomeJanela`). */
  percentualJanela: number;
  nomeJanela: string;
};

export function estimar(
  blocos: readonly { caracteres: number; fichas: number }[],
  provider: Provider,
  paralelismo: number,
): Estimativa {
  const p = PARAMETROS[provider];
  const fichas = blocos.reduce((t, b) => t + b.fichas, 0);
  const entrada = Math.round(
    blocos.reduce((t, b) => t + b.caracteres / CARACTERES_POR_TOKEN + p.sistemaPorSessao, 0) * FOLGA_TENTATIVAS,
  );
  const saida = Math.round(fichas * SAIDA_POR_FICHA * FOLGA_TENTATIVAS);
  const segundos = blocos.reduce(
    (t, b) => t + p.segundosPorSessao + (b.fichas * SAIDA_POR_FICHA) / p.saidaPorSegundo,
    0,
  );
  const custo =
    p.precoEntrada !== undefined && p.precoSaida !== undefined
      ? (entrada * p.precoEntrada + saida * p.precoSaida) / 1_000_000
      : null;
  return {
    provider,
    blocos: blocos.length,
    fichas,
    tokensEntrada: entrada,
    tokensSaida: saida,
    minutos: Math.max(1, Math.round((segundos * FOLGA_TENTATIVAS) / Math.max(1, paralelismo) / 60)),
    custoUsd: custo === null ? null : Math.round(custo * 100) / 100,
    percentualJanela: Math.max(1, Math.round(((entrada + saida * 5) / p.janelaReferencia) * 100)),
    nomeJanela: p.nomeJanela,
  };
}
