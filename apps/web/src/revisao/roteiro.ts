/**
 * O roteiro "Revisar comigo" (M1.11, etapa 5b) como a pessoa o lê: as paradas na ordem do parecer da
 * PROENS, a situação de cada pendência, o aviso de cobertura (o que ainda não foi visto) e a estimativa
 * de cada ação com IA.
 */
import type { EstimativaAcao, ListaPendencias, PendenciaViva, SituacaoPendencia } from "@simplifica-if/contratos-app";

export const ROTULO_SITUACAO_PENDENCIA: Record<SituacaoPendencia, string> = {
  aberta: "Aberta",
  vou_ajustar: "Vou ajustar",
  resolvida: "Resolvida",
  contestada_aceita: "Retirada após contestação",
  contestada_mantida: "Mantida, com a sua discordância",
};

/** A pendência ainda pede trabalho da pessoa (aberta, vou ajustar ou mantida depois de contestar). */
export const pendente = (p: PendenciaViva) =>
  p.situacao === "aberta" || p.situacao === "vou_ajustar" || p.situacao === "contestada_mantida";

/** O índice da parada em que a pessoa estava (ou a primeira). */
export function paradaInicial(lista: ListaPendencias): number {
  const indice = lista.paradas.findIndex((p) => p.ordem === lista.paradaAtual);
  return indice >= 0 ? indice : 0;
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
  n("vou_ajustar", "que você vai ajustar", "que você vai ajustar");
  n("resolvida", "resolvida", "resolvidas");
  n("contestada_mantida", "mantida com a sua discordância", "mantidas com a sua discordância");
  n("contestada_aceita", "retirada após contestação", "retiradas após contestação");
  return partes.length ? `${partes.join(" · ")}.` : "Nenhuma pendência.";
}

/**
 * O aviso honesto de cobertura do roteiro: as paradas ainda não vistas e quantas pendências há nelas.
 * Nulo quando todas foram vistas.
 */
export function avisoCobertura(lista: ListaPendencias): string | null {
  const naoVistas = lista.paradas.filter((p) => !p.vista);
  if (!naoVistas.length) return null;
  const vistas = lista.paradas.length - naoVistas.length;
  const comPendencias = naoVistas
    .map((p) => ({
      tema: p.tema,
      n: lista.pendencias.filter((x) => x.pendencia.ordemTema === p.ordem && pendente(x)).length,
    }))
    .map((p) => (p.n ? `${p.tema} (${p.n} ${p.n === 1 ? "pendência" : "pendências"})` : p.tema));
  return `Você passou por ${vistas} de ${lista.paradas.length} paradas. Ainda não viu: ${comPendencias.join("; ")}. Parar aqui não quer dizer que o resto está em ordem.`;
}

const milhares = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(n);

/** "Cerca de 6,2 mil tokens e 10 s (na API, uns US$ 0,03)." ou "Sem IA." */
export function textoEstimativaAcao(e: EstimativaAcao): string {
  if (e.tokensEntrada + e.tokensSaida === 0) return "Sem IA: o app confere no código.";
  const custo = e.custoUsd === null ? "" : ` (na API, uns US$ ${e.custoUsd.toFixed(3).replace(".", ",")})`;
  return `Estimativa: cerca de ${milhares(e.tokensEntrada + e.tokensSaida)} tokens e ${e.segundos} s${custo}. Soma ao uso desta revisão.`;
}
