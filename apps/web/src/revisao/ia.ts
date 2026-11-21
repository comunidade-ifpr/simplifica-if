/**
 * Os textos da leitura com IA como a pessoa os lê, em funções puras: a estimativa na faixa, o detalhe
 * do uso, o andamento por tema, a frase do fim e as revisões que ficaram por terminar.
 */
import type {
  EstadoRevisaoIa,
  EstimativaAcao,
  EstimativaRevisaoIa,
  ModoRevisaoIa,
  ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app";
import { dolares } from "../lib/formato.ts";
import { plural } from "./lista.ts";

/** "14 %", com o espaço rígido. */
const porcento = (n: number) => `${n} %`;

/**
 * O limite do plano como a pessoa o conhece: "do seu limite de 5 horas", "da sua cota diária". O
 * servidor dá a janela de referência ("uma janela de 5 horas do plano Pro").
 */
export function limiteDoPlano(nomeJanela: string): string {
  const horas = /janela de (\d+) horas?/.exec(nomeJanela);
  if (horas !== null) return `do seu limite de ${horas[1]} horas`;
  if (/cota diária/.test(nomeJanela)) return "da sua cota diária";
  return `de ${nomeJanela}`;
}

/**
 * A segunda frase da faixa: "O Claude lê em cerca de 6 minutos, usando perto de 14 % do seu limite de 5
 * horas." No escopo menor, diz quantos lê: "O Claude lê os 30 que mais devolvem PPC em cerca de…".
 */
export function textoEstimativa(e: EstimativaRevisaoIa, modo: ModoRevisaoIa, nomeIa: string): string {
  const quais =
    modo === "rapido" ? ` ${e.fichas === 1 ? "o que mais devolve" : `os ${e.fichas} que mais devolvem`} PPC` : "";
  return `O ${nomeIa} lê${quais} em cerca de ${plural(e.minutos, "minuto", "minutos")}, usando perto de ${porcento(e.percentualJanela)} ${limiteDoPlano(e.nomeJanela)}.`;
}

/** O detalhe do uso, no "Opções": de onde vem a estimativa e, quando se sabe, o preço pago por uso. */
export function detalheEstimativa(e: EstimativaRevisaoIa): string {
  const custo = e.custoUsd === null ? "" : ` Pago por uso, custaria cerca de ${dolares(e.custoUsd)}.`;
  return `Estimativa aproximada: o uso por critério vem de medições reais, mas as empresas de IA não publicam o tamanho do limite do plano. Dá para pausar, e o que já foi lido fica guardado.${custo}`;
}

/** "Cerca de 10 segundos." (as ações por pendência); sem IA, nada a estimar. */
export function textoEstimativaAcao(e: EstimativaAcao): string {
  if (e.tokensEntrada + e.tokensSaida === 0) return "";
  const custo = e.custoUsd === null ? "" : ` Pago por uso, cerca de ${dolares(e.custoUsd)}.`;
  return `Cerca de ${plural(Math.max(1, Math.round(e.segundos)), "segundo", "segundos")}.${custo}`;
}

export interface TemaAndamento {
  readonly tema: string;
  readonly ordem: number;
  readonly prontos: number;
  readonly total: number;
  readonly emAndamento: boolean;
}

/** Os blocos agrupados por tema, na ordem do parecer. */
export function andamentoPorTema(estado: Pick<EstadoRevisaoIa, "blocos">): ReadonlyArray<TemaAndamento> {
  const temas = new Map<number, { tema: string; prontos: number; total: number; emAndamento: boolean }>();
  for (const b of estado.blocos) {
    const t = temas.get(b.ordemTema) ?? { tema: b.tema, prontos: 0, total: 0, emAndamento: false };
    t.total += 1;
    if (b.estado === "pronto") t.prontos += 1;
    if (b.estado === "em_andamento") t.emAndamento = true;
    temas.set(b.ordemTema, t);
  }
  return [...temas].sort(([a], [b]) => a - b).map(([ordem, t]) => ({ ordem, ...t }));
}

/** Os temas cujos blocos já ficaram todos prontos (a régua os preenche). */
export const temasProntos = (estado: Pick<EstadoRevisaoIa, "blocos">): ReadonlySet<number> =>
  new Set(andamentoPorTema(estado).flatMap((t) => (t.prontos === t.total ? [t.ordem] : [])));

/** "5 de 17 temas": os temas com todos os blocos prontos. */
export function contagemTemas(estado: Pick<EstadoRevisaoIa, "blocos">): string {
  const temas = andamentoPorTema(estado);
  return `${temas.filter((t) => t.prontos === t.total).length} de ${plural(temas.length, "tema", "temas")}`;
}

/** "Lendo Estágio curricular — 5 de 17 temas"; sem bloco em andamento, só a contagem. */
export function textoAndamento(estado: Pick<EstadoRevisaoIa, "blocos">): string {
  const atual = andamentoPorTema(estado).find((t) => t.emAndamento);
  return atual === undefined ? `Lendo — ${contagemTemas(estado)}` : `Lendo ${atual.tema} — ${contagemTemas(estado)}`;
}

/** "O Claude leu 72 critérios e encontrou mais 5 pontos." */
export function textoConclusao(nomeIa: string, r: ResultadoRevisaoPpc, encontrados: number): string {
  const lidos = r.conferidosIa + r.paraConferirIa;
  const achou =
    encontrados === 0 ? "não encontrou pontos novos" : `encontrou mais ${plural(encontrados, "ponto", "pontos")}`;
  return `O ${nomeIa} leu ${plural(lidos, "critério", "critérios")} e ${achou}.`;
}

/**
 * As leituras com IA que ficaram por terminar (em andamento ou pausadas), da mais recente para a mais
 * antiga. A preparada e nunca começada não conta: é só a estimativa da faixa.
 */
export const leiturasPorTerminar = (lista: ReadonlyArray<EstadoRevisaoIa>): ReadonlyArray<EstadoRevisaoIa> =>
  lista.filter((e) => e.situacao === "em_andamento" || e.situacao === "pausada");
