/**
 * Os textos da revisão com IA (M1.11, etapa 4) como a pessoa os lê: a estimativa antes de começar, o
 * andamento por tema (os blocos de cada tema ficando prontos) e a cobertura do resultado.
 */
import type { EstadoRevisaoIa, EstimativaRevisaoIa, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import { dolares } from "../lib/formato.ts";

/**
 * "Estimativa aproximada: cerca de 14% de uma janela de 5 horas do plano Pro (referência provisória)…".
 * Os tokens por critério são medidos; a janela, não (os providers não publicam o tamanho dela). A
 * contagem de tokens fica fora do texto (M1.14: a tela não fala em tokens); o tempo e a fração da
 * janela dizem o mesmo em termos da pessoa.
 */
export function textoEstimativa(e: EstimativaRevisaoIa): string {
  const custo = e.custoUsd === null ? "" : ` Pago por uso, isso custaria cerca de ${dolares(e.custoUsd)}.`;
  return `${e.fichas} critérios em ${e.blocos} etapas. Estimativa aproximada: cerca de ${e.minutos} min e algo como ${e.percentualJanela}% de ${e.nomeJanela} (referência provisória: as empresas de IA não publicam o tamanho da janela).${custo}`;
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

/** "34 de 80 critérios conferidos: 12 pelo código e 22 pela IA…; 13 ficaram para conferir…" */
export function textoCobertura(r: ResultadoRevisaoPpc): string {
  if (r.conferidosIa + r.paraConferirIa === 0)
    return r.totalCriterios > r.conferidos
      ? `${r.conferidos} de ${r.totalCriterios} critérios conferidos automaticamente; os demais exigem leitura.`
      : `${r.conferidos} critérios conferidos automaticamente; os demais exigem leitura.`;
  const paraConferir = r.paraConferirIa
    ? ` ${r.paraConferirIa} ${r.paraConferirIa === 1 ? "foi à IA e ficou" : "foram à IA e ficaram"} para conferir na leitura.`
    : "";
  const fora = r.foraDaRevisao.length
    ? ` ${r.foraDaRevisao.length} ficaram de fora (modo rápido) e exigem leitura.`
    : r.conferidos + r.conferidosIa + r.paraConferirIa < r.totalCriterios
      ? " Os demais exigem leitura."
      : "";
  return `${r.conferidos + r.conferidosIa} de ${r.totalCriterios} critérios conferidos: ${r.conferidos} pelo código e ${r.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app.${paraConferir}${fora}`;
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
