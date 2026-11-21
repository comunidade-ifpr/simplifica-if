/**
 * O roteiro "Revisar comigo" (M1.11, etapa 5b) como a pessoa o lê: as paradas na ordem do parecer da
 * PROENS, a situação de cada pendência, o aviso de cobertura (o que ainda não foi visto) e a estimativa
 * de cada ação com IA.
 */
import type { EstimativaAcao, ListaPendencias, PendenciaViva, SituacaoPendencia } from "@simplifica-if/contratos-app";
import { dolares } from "../lib/formato.ts";

export const ROTULO_SITUACAO_PENDENCIA: Record<SituacaoPendencia, string> = {
  aberta: "Aberta",
  resolvida: "Resolvida",
  contestada_aceita: "Contestada com evidência (confira)",
  contestada_mantida: "Mantida, com a sua discordância",
};

/** A pendência ainda pede trabalho da pessoa (aberta ou mantida depois de contestar). */
export const pendente = (p: PendenciaViva) => p.situacao === "aberta" || p.situacao === "contestada_mantida";

/** Uma parada do roteiro: um tema com pendência ou critério decidido, na ordem do parecer. */
export interface Parada {
  readonly ordem: number;
  readonly tema: string;
  readonly vista: boolean;
}

/** As paradas da lista, calculadas na tela (o servidor não guarda mais o roteiro); `vistas` é da tela. */
export function paradasDe(lista: ListaPendencias, vistas: ReadonlySet<number>): Parada[] {
  const temas = new Map<number, string>();
  for (const p of lista.pendencias) temas.set(p.pendencia.ordemTema, p.pendencia.tema);
  for (const c of lista.resultado.criterios) if (c.estado !== "nao_lido") temas.set(c.ordemTema, c.tema);
  return [...temas].sort(([a], [b]) => a - b).map(([ordem, tema]) => ({ ordem, tema, vista: vistas.has(ordem) }));
}

export const pendenciasDaParada = (lista: ListaPendencias, ordem: number) =>
  lista.pendencias
    .filter((p) => p.pendencia.ordemTema === ordem)
    // Primeiro o que precisa de ajuste, depois o que é para conferir.
    .sort((a, b) => Number(a.pendencia.estado === "a_conferir") - Number(b.pendencia.estado === "a_conferir"));

/** "3 abertas · 2 vou ajustar · 1 resolvida…", só com as situações que existem. */
export function resumoSituacoes(lista: ListaPendencias): string {
  const conta = (s: SituacaoPendencia) => lista.pendencias.filter((p) => p.situacao === s).length;
  const partes: string[] = [];
  const n = (s: SituacaoPendencia, um: string, varios: string) => {
    const k = conta(s);
    if (k) partes.push(`${k} ${k === 1 ? um : varios}`);
  };
  n("aberta", "aberta", "abertas");
  n("resolvida", "resolvida", "resolvidas");
  n("contestada_mantida", "mantida com a sua discordância", "mantidas com a sua discordância");
  n("contestada_aceita", "contestada com evidência, para conferir", "contestadas com evidência, para conferir");
  return partes.length ? `${partes.join(" · ")}.` : "Nenhuma pendência.";
}

/**
 * O aviso honesto de cobertura do roteiro: as paradas ainda não vistas e quantas pendências há nelas.
 * Nulo quando todas foram vistas.
 */
export function avisoCobertura(lista: ListaPendencias, paradas: ReadonlyArray<Parada>): string | null {
  const naoVistas = paradas.filter((p) => !p.vista);
  if (!naoVistas.length) return null;
  const vistas = paradas.length - naoVistas.length;
  const comPendencias = naoVistas
    .map((p) => ({
      tema: p.tema,
      n: lista.pendencias.filter((x) => x.pendencia.ordemTema === p.ordem && pendente(x)).length,
    }))
    .map((p) => (p.n ? `${p.tema} (${p.n} ${p.n === 1 ? "pendência" : "pendências"})` : p.tema));
  return `Você passou por ${vistas} de ${paradas.length} paradas. Ainda não viu: ${comPendencias.join("; ")}. Parar aqui não quer dizer que o resto está em ordem.`;
}

/** "Estimativa: cerca de 10 s (pago por uso, uns US$ 0,03)…" ou "Sem IA…" (sem a contagem de tokens, M1.14). */
export function textoEstimativaAcao(e: EstimativaAcao): string {
  if (e.tokensEntrada + e.tokensSaida === 0) return "Sem IA: o app confere no código.";
  const custo = e.custoUsd === null ? "" : ` (pago por uso, uns ${dolares(e.custoUsd)})`;
  return `Estimativa: cerca de ${e.segundos} s${custo}. Soma ao uso desta revisão.`;
}
