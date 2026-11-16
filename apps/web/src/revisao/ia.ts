/**
 * Os textos da revisão com IA (M1.11, etapa 4) como a pessoa os lê: a estimativa antes de começar, o
 * andamento por tema (os blocos de cada tema ficando prontos) e a cobertura do resultado.
 */
import type { EstadoRevisaoIa, EstimativaRevisaoIa, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";

const milhares = (n: number) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString("pt-BR")} mil` : String(n));

/** "Deve usar cerca de 4% de uma janela de 5 horas do plano Pro (≈ 60 mil tokens), em uns 3 min." */
export function textoEstimativa(e: EstimativaRevisaoIa): string {
  const custo =
    e.custoUsd === null ? "" : ` Na API, isso custaria cerca de US$ ${e.custoUsd.toFixed(2).replace(".", ",")}.`;
  return `${e.fichas} critérios em ${e.blocos} etapas. Deve usar cerca de ${e.percentualJanela}% de ${e.nomeJanela} (uns ${milhares(e.tokensEntrada + e.tokensSaida)} tokens) e levar uns ${e.minutos} min.${custo}`;
}

export interface TemaAndamento {
  readonly tema: string;
  readonly ordem: number;
  readonly prontos: number;
  readonly total: number;
  readonly emAndamento: boolean;
  readonly naoConferidas: number;
}

/** Os blocos agrupados por tema, na ordem do parecer. */
export function andamentoPorTema(estado: EstadoRevisaoIa): ReadonlyArray<TemaAndamento> {
  const temas = new Map<
    number,
    { tema: string; prontos: number; total: number; emAndamento: boolean; naoConferidas: number }
  >();
  for (const b of estado.blocos) {
    const t = temas.get(b.ordemTema) ?? { tema: b.tema, prontos: 0, total: 0, emAndamento: false, naoConferidas: 0 };
    t.total += 1;
    if (b.estado === "pronto") t.prontos += 1;
    if (b.estado === "em_andamento") t.emAndamento = true;
    t.naoConferidas += b.naoConferidas;
    temas.set(b.ordemTema, t);
  }
  return [...temas.entries()].sort(([a], [b]) => a - b).map(([ordem, t]) => ({ ordem, ...t }));
}

/** "12 critérios conferidos pelo código e 20 pela IA; 48 ficaram de fora (modo rápido)." */
export function textoCobertura(r: ResultadoRevisaoPpc): string {
  if (r.conferidosIa === 0)
    return r.totalCriterios > r.conferidos
      ? `${r.conferidos} de ${r.totalCriterios} critérios conferidos automaticamente; os demais exigem leitura.`
      : `${r.conferidos} critérios conferidos automaticamente; os demais exigem leitura.`;
  const fora = r.foraDaRevisao.length
    ? ` ${r.foraDaRevisao.length} ficaram de fora (modo rápido) e exigem leitura.`
    : r.conferidos + r.conferidosIa < r.totalCriterios
      ? " Os demais exigem leitura."
      : "";
  return `${r.conferidos + r.conferidosIa} de ${r.totalCriterios} critérios conferidos: ${r.conferidos} pelo código e ${r.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app.${fora}`;
}

export const ROTULO_SITUACAO: Record<EstadoRevisaoIa["situacao"], string> = {
  preparada: "Pronta para começar",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  concluida: "Concluída",
  falhou: "Não concluída",
};

/**
 * A revisão com IA a reencontrar depois de recarregar a tela: a mais recente que ainda não terminou
 * (em andamento, pausada ou preparada; `revisaoPpc.listarIa` vem da mais recente para a mais antiga).
 */
export function revisaoParaRetomar(lista: ReadonlyArray<EstadoRevisaoIa>): EstadoRevisaoIa | undefined {
  return lista.find((e) => e.situacao === "em_andamento" || e.situacao === "pausada" || e.situacao === "preparada");
}
