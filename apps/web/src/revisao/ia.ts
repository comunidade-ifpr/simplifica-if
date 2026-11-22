/**
 * Os textos da leitura com IA como a pessoa os lê, em funções puras: a estimativa na faixa, o detalhe
 * do uso, o andamento por tema, o painel "Ver andamento" (bloco a bloco), a frase do fim e as revisões
 * que ficaram por terminar.
 */
import type {
  BlocoRevisaoIa,
  EstadoRevisaoIa,
  EtapaBlocoIa,
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
 * O limite do plano como a pessoa o conhece, mantendo qual plano serviu de referência: "do limite de 5
 * horas do plano Pro", "da cota diária do plano gratuito". O servidor dá a janela de referência
 * ("uma janela de 5 horas do plano Pro").
 */
export function limiteDoPlano(nomeJanela: string): string {
  const plano = / do plano .+$/.exec(nomeJanela)?.[0] ?? "";
  const horas = /janela de (\d+) horas?/.exec(nomeJanela);
  if (horas !== null) return `do limite de ${horas[1]} horas${plano}`;
  if (/cota diária/.test(nomeJanela)) return `da cota diária${plano}`;
  return `de ${nomeJanela}`;
}

/**
 * A segunda frase da faixa: "O Claude confere em cerca de 6 minutos, usando perto de 14 % do limite de 5
 * horas do plano Pro." No escopo menor, diz quantos confere: "O Claude confere os 30 que mais devolvem PPC em cerca de…".
 */
export function textoEstimativa(e: EstimativaRevisaoIa, modo: ModoRevisaoIa, nomeIa: string): string {
  const quais =
    modo === "rapido" ? ` ${e.fichas === 1 ? "o que mais devolve" : `os ${e.fichas} que mais devolvem`} PPC` : "";
  return `O ${nomeIa} confere${quais} em cerca de ${plural(e.minutos, "minuto", "minutos")}, usando perto de ${porcento(e.percentualJanela)} ${limiteDoPlano(e.nomeJanela)}.`;
}

/** O detalhe do uso, no "Opções": de onde vem a estimativa e, quando se sabe, o preço pago por uso. */
export function detalheEstimativa(e: EstimativaRevisaoIa): string {
  const custo = e.custoUsd === null ? "" : ` Pago por uso, custaria cerca de ${dolares(e.custoUsd)}.`;
  return `Estimativa aproximada: o uso por critério vem de medições reais, mas as empresas de IA não publicam o tamanho do limite do plano. Dá para pausar, e o que já foi conferido fica guardado.${custo}`;
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

/** "5 de 17 temas": os temas com todos os blocos prontos. */
export function contagemTemas(estado: Pick<EstadoRevisaoIa, "blocos">): string {
  const temas = andamentoPorTema(estado);
  return `${temas.filter((t) => t.prontos === t.total).length} de ${plural(temas.length, "tema", "temas")}`;
}

/** "a, b e c". */
const juntar = (partes: ReadonlyArray<string>): string =>
  partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)!}`;

/**
 * "Conferindo Identificação e oferta e Matriz curricular — 1 de 4 temas": os temas em andamento (os blocos
 * vão em paralelo); sem bloco em andamento, só a contagem.
 */
export function textoAndamento(estado: Pick<EstadoRevisaoIa, "blocos">): string {
  const atuais = andamentoPorTema(estado)
    .filter((t) => t.emAndamento)
    .map((t) => t.tema);
  return atuais.length === 0
    ? `Conferindo — ${contagemTemas(estado)}`
    : `Conferindo ${juntar(atuais)} — ${contagemTemas(estado)}`;
}

/** Os blocos prontos (o "Encerrar leitura por aqui" só aparece com algum). */
export const blocosProntos = (estado: Pick<EstadoRevisaoIa, "blocos">): number =>
  estado.blocos.filter((b) => b.estado === "pronto").length;

/* ---------------------------------------------------------------- "Ver andamento" */

const ETAPA: Readonly<Record<EtapaBlocoIa, string>> = {
  aguardando: "esperando a resposta da IA",
  recebendo: "recebendo a resposta",
  conferindo: "conferindo a resposta",
  nova_tentativa: "pedindo de novo o que não passou na conferência",
};

/** "42 s", "3 min 5 s", "1 min". */
export function duracao(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  return s % 60 === 0 ? `${min} min` : `${min} min ${s % 60} s`;
}

const desde = (iso: string | null, agora: number): number | null =>
  iso === null ? null : Math.max(0, (agora - Date.parse(iso)) / 1000);

export type SituacaoBlocoPainel = "pronto" | "lendo" | "pausado" | "fila";

export interface LinhaAndamento {
  readonly id: string;
  /** O tema do bloco ("Critérios transversais" no T). */
  readonly titulo: string;
  readonly situacao: SituacaoBlocoPainel;
  /** O que aconteceu ou está acontecendo, numa frase curta. */
  readonly detalhe: string;
  /** Os critérios do bloco (títulos humanos). */
  readonly criterios: ReadonlyArray<string>;
}

const tituloDoBloco = (b: BlocoRevisaoIa) => (b.tipo === "T" ? "Critérios transversais" : b.tema);

/**
 * As linhas do painel "Ver andamento", na ordem do parecer: pronto (tempo e pontos encontrados), lendo
 * (a etapa, há quanto tempo e o último sinal da IA), o que parou a leitura e os que estão na fila. O
 * tempo decorrido é calculado aqui, com o relógio da tela (`agora`, em ms), sem tique do servidor.
 */
export function linhasAndamento(
  estado: Pick<EstadoRevisaoIa, "blocos" | "blocoPausado" | "situacao">,
  agora: number,
): ReadonlyArray<LinhaAndamento> {
  return [...estado.blocos]
    .sort((a, b) => a.ordemTema - b.ordemTema)
    .map((b) => {
      const base = { id: b.id, titulo: tituloDoBloco(b), criterios: b.titulosFichas };
      if (b.estado === "pronto") {
        const pontos =
          b.pendenciasEncontradas === 0
            ? "nenhum ponto"
            : plural(b.pendenciasEncontradas, "ponto encontrado", "pontos encontrados");
        const tempo = b.segundos === null ? "" : ` em ${duracao(b.segundos)}`;
        return { ...base, situacao: "pronto", detalhe: `Conferido${tempo}; ${pontos}.` };
      }
      if (b.estado === "em_andamento") {
        const ha = desde(b.iniciadoEm, agora);
        const sinal = desde(b.ultimaAtividadeEm, agora);
        const etapa = ETAPA[b.etapa ?? "aguardando"];
        const partes = [
          `${etapa.charAt(0).toUpperCase()}${etapa.slice(1)}`,
          ha === null ? "" : `conferindo há ${duracao(ha)}`,
          sinal === null ? "" : `último sinal da IA há ${duracao(sinal)}`,
        ].filter(Boolean);
        return { ...base, situacao: "lendo", detalhe: `${partes.join("; ")}.` };
      }
      if (estado.blocoPausado === b.id && (estado.situacao === "pausada" || estado.situacao === "falhou"))
        return { ...base, situacao: "pausado", detalhe: "A conferência parou neste tema." };
      return { ...base, situacao: "fila", detalhe: "Na fila." };
    });
}

const MILHAR = new Intl.NumberFormat("pt-BR");

/** O rodapé do painel: o modelo e o uso somado até aqui, sem nada técnico além disso. */
export function rodapeAndamento(estado: Pick<EstadoRevisaoIa, "modelo" | "uso">): string {
  const u = estado.uso;
  const uso = `${MILHAR.format(u.entrada + u.cacheLeitura + u.cacheEscrita)} tokens de entrada e ${MILHAR.format(u.saida)} de saída até aqui`;
  return estado.modelo === null ? `Uso: ${uso}.` : `Modelo ${estado.modelo}. Uso: ${uso}.`;
}

/** "O Claude conferiu 72 critérios e encontrou mais 5 pontos." */
export function textoConclusao(nomeIa: string, r: ResultadoRevisaoPpc, encontrados: number): string {
  const lidos = r.conferidosIa + r.paraConferirIa;
  const achou =
    encontrados === 0 ? "não encontrou pontos novos" : `encontrou mais ${plural(encontrados, "ponto", "pontos")}`;
  return `O ${nomeIa} conferiu ${plural(lidos, "critério", "critérios")} e ${achou}.`;
}

/**
 * As leituras com IA que ficaram por terminar (em andamento ou pausadas), da mais recente para a mais
 * antiga. A preparada e nunca começada não conta: é só a estimativa da faixa.
 */
export const leiturasPorTerminar = (lista: ReadonlyArray<EstadoRevisaoIa>): ReadonlyArray<EstadoRevisaoIa> =>
  lista.filter((e) => e.situacao === "em_andamento" || e.situacao === "pausada");
