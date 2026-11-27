/**
 * "Enviar a versão corrigida" e a cópia comentada em funções puras (a `ListaViva` grava): as pendências
 * do código da lista casadas com as que a pré-conferência do arquivo novo aponta, o plano do que muda
 * (com o estado projetado para a cópia comentada), as marcas da cópia e os locais no documento.
 *
 * O casamento é pelo critério (a ficha, a origem e o título, que separa as duas regras da triagem), não
 * pela chave: a mensagem de uma pendência traz contagens ("(3 linhas)", "2 pendências; a primeira: …")
 * que mudam com a correção parcial, e a chave (o hash de ficha, trecho e mensagem) muda junto. Dentro do
 * critério:
 *
 * 1. a pendência idêntica (a mesma chave) continua;
 * 2. depois, a que aponta o mesmo trecho;
 * 3. com um ponto só de cada lado, o critério aponta o mesmo ponto com outro texto: continua (com mais
 *    de um, só o trecho distingue um ponto do outro);
 * 4. o resto da lista o arquivo novo resolveu, e o resto do arquivo novo entra como novo.
 *
 * Uma pendência que continua com outro texto passa a ter a mensagem e o trecho do arquivo novo, com a
 * chave nova (a cópia comentada marca a situação pela chave do texto dela).
 *
 * Na conferência ao salvar (`salvamento`), que roda a cada salvamento do Word, a pendência que a pessoa
 * marcou "Feito" e o arquivo salvo aponta igual (a mesma chave) fica como ela marcou: o código já a
 * apontava quando ela marcou, e reabri-la a cada salvamento desfaria a marcação sem nada ter mudado. Só
 * volta a aberta se o arquivo salvo a aponta com outro texto (o ponto mudou depois da marcação), e o
 * histórico diz que a marcação dela foi desfeita. "Enviar a versão corrigida", pedida uma vez, reabre
 * toda resolvida que o arquivo novo ainda aponta.
 */
import type {
  CriterioRevisao,
  PendenciaRevisao,
  SituacaoPendencia,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { chavePendencia, type MarcaPendencia } from "@simplifica-if/ppc/revisao-previa";
import type { MudancaPendencia } from "./persistencia/RevisoesPpc.ts";

export interface PendenciaDaLista {
  readonly chave: string;
  readonly pendencia: PendenciaRevisao;
  readonly situacao: SituacaoPendencia;
  readonly resolvidaPor: "pessoa" | "revisarDeNovo" | null;
}

export interface EventoDaLista {
  readonly chave: string;
  readonly acao: string;
  readonly texto: string;
  readonly motivo?: string | null | undefined;
}

/** A situação de cada pendência não aberta, com a nota, para a cópia comentada (pela chave). */
export function marcasDaCopia(
  pendencias: ReadonlyArray<Pick<PendenciaDaLista, "chave" | "situacao" | "resolvidaPor">>,
  eventos: ReadonlyArray<EventoDaLista>,
): Record<string, MarcaPendencia> {
  const situacoes: Record<string, MarcaPendencia> = {};
  for (const p of pendencias) {
    if (p.situacao === "aberta") continue;
    const ultimo = eventos.filter((e) => e.chave === p.chave).at(-1);
    const ultimaContestacao = eventos.filter((e) => e.chave === p.chave && e.acao === "contestar").at(-1);
    const nota =
      p.situacao === "resolvida"
        ? p.resolvidaPor === "revisarDeNovo"
          ? "Conferida na nova revisão do arquivo atualizado."
          : "Marcada pela coordenação, sem nova revisão."
        : p.situacao === "contestada_mantida" && ultimo?.acao === "contestar"
          ? ultimo.texto.replace(/^Mantida: /, "Resposta da revisão: ")
          : p.situacao === "contestada_aceita" && ultimaContestacao
            ? `Motivo da coordenação: “${ultimaContestacao.motivo ?? ""}”. ${ultimaContestacao.texto}`
            : undefined;
    situacoes[p.chave] = {
      situacao: p.situacao,
      ...(nota ? { nota } : {}),
      // Só a pendência confirmada pela nova revisão sai do documento.
      ...(p.situacao === "resolvida" && p.resolvidaPor === "revisarDeNovo" ? { foraDoDocumento: true } : {}),
    };
  }
  return situacoes;
}

/** Onde cada pendência ficou na cópia gravada, pela chave (o `noDocumento` real, que a lista guarda). */
export const locaisNoDocumento = (
  pendencias: ReadonlyArray<PendenciaRevisao>,
): ReadonlyMap<string, PendenciaRevisao["noDocumento"]> =>
  new Map(pendencias.map((p) => [chavePendencia(p), p.noDocumento]));

const criterio = (p: PendenciaRevisao) => `${p.ficha}|${p.origem}|${p.tituloFicha}`;

/**
 * Casa as pendências da lista com as do arquivo novo, critério a critério: a pendência do arquivo novo
 * de cada uma da lista (nula se o arquivo novo não a aponta mais) e as do arquivo novo que sobram.
 */
export function casarPendencias(
  antigas: ReadonlyArray<PendenciaDaLista>,
  novas: ReadonlyArray<PendenciaRevisao>,
): {
  readonly casadas: ReadonlyMap<string, PendenciaRevisao | null>;
  readonly sobras: ReadonlyArray<PendenciaRevisao>;
} {
  const casadas = new Map<string, PendenciaRevisao | null>();
  const sobras: PendenciaRevisao[] = [];
  const grupos = new Map<string, { antigas: PendenciaDaLista[]; novas: PendenciaRevisao[] }>();
  const grupo = (p: PendenciaRevisao) => {
    const k = criterio(p);
    let g = grupos.get(k);
    if (g === undefined) grupos.set(k, (g = { antigas: [], novas: [] }));
    return g;
  };
  for (const a of antigas) grupo(a.pendencia).antigas.push(a);
  for (const n of novas) grupo(n).novas.push(n);
  for (const g of grupos.values()) {
    let restoAntigas = g.antigas;
    let restoNovas = g.novas;
    const casar = (igual: (a: PendenciaDaLista, n: PendenciaRevisao) => boolean) => {
      const livres: PendenciaDaLista[] = [];
      for (const a of restoAntigas) {
        const i = restoNovas.findIndex((n) => igual(a, n));
        if (i < 0) livres.push(a);
        else {
          casadas.set(a.chave, restoNovas[i]!);
          restoNovas = restoNovas.filter((_, j) => j !== i);
        }
      }
      restoAntigas = livres;
    };
    casar((a, n) => chavePendencia(n) === a.chave);
    casar((a, n) => a.pendencia.trecho !== null && a.pendencia.trecho === n.trecho);
    // Um ponto só de cada lado: o mesmo ponto, com outro texto. Com mais de um, só o trecho os distingue.
    if (g.antigas.length === 1 && g.novas.length === 1 && restoAntigas.length === 1 && restoNovas.length === 1) {
      casadas.set(restoAntigas[0]!.chave, restoNovas[0]!);
      restoAntigas = [];
      restoNovas = [];
    }
    for (const a of restoAntigas) casadas.set(a.chave, null);
    sobras.push(...restoNovas);
  }
  return { casadas, sobras };
}

export interface PlanoArquivoNovo {
  readonly mudancas: ReadonlyArray<MudancaPendencia>;
  readonly novas: ReadonlyArray<{ readonly chave: string; readonly pendencia: PendenciaRevisao }>;
  /** O estado final projetado da lista após aplicar o plano, para `marcasDaCopia`. */
  readonly pendenciasFinais: ReadonlyArray<Pick<PendenciaDaLista, "chave" | "situacao" | "resolvidaPor">>;
  readonly eventosFinais: ReadonlyArray<EventoDaLista>;
  /** As contagens como a lista as mostra (sem o bloqueio do curso nem as retiradas). */
  readonly resolvidas: number;
  readonly continuam: number;
  readonly contagemNovas: number;
  /** As chaves das que contam em `resolvidas` e em `contagemNovas` (a conferência ao salvar as realça). */
  readonly chavesResolvidas: ReadonlyArray<string>;
  readonly chavesNovas: ReadonlyArray<string>;
}

/**
 * O que o arquivo novo muda na lista. Só as pendências do código: as da IA ficam como estão (para elas,
 * "Já resolvi" por pendência). `semCurso`: o arquivo novo não tem o curso no CNCT, e as pendências que
 * dependem dele ficam no bloqueio "Qual é o curso?", fora das contagens (como `noBloqueio` na interface);
 * as retiradas por contestação também ficam fora.
 */
export function planoArquivoNovo(
  lista: ReadonlyArray<PendenciaDaLista>,
  doArquivoNovo: ReadonlyArray<PendenciaRevisao>,
  nome: string,
  semCurso: boolean,
  eventos: ReadonlyArray<EventoDaLista> = [],
  opcoes: { readonly salvamento?: boolean } = {},
): PlanoArquivoNovo {
  const doCodigo = lista.filter((p) => p.pendencia.origem === "codigo");
  const { casadas, sobras } = casarPendencias(
    doCodigo,
    doArquivoNovo.filter((p) => p.origem === "codigo"),
  );
  const visivel = (p: PendenciaRevisao, situacao: SituacaoPendencia) =>
    !(p.dependeDoCurso && semCurso) && situacao !== "contestada_aceita";
  const chaves = new Set(lista.map((p) => p.chave));
  const mudancas: MudancaPendencia[] = [];
  const chavesResolvidas: string[] = [];
  let continuam = 0;
  for (const p of doCodigo) {
    const nova = casadas.get(p.chave) ?? null;
    if (nova === null) {
      if (p.situacao === "resolvida" && p.resolvidaPor === "revisarDeNovo") continue;
      if (visivel(p.pendencia, p.situacao)) chavesResolvidas.push(p.chave);
      mudancas.push({
        chave: p.chave,
        situacao: "resolvida",
        resolvidaPor: "revisarDeNovo",
        evento: {
          acao: "revisarDeNovo",
          situacao: "resolvida",
          texto: `Conferida na revisão de ${nome}: o critério não aponta mais este ponto.`,
        },
      });
      continue;
    }
    if (visivel(nova, p.situacao)) continuam += 1;
    const chave = chavePendencia(nova);
    // A chave nova já é de outra pendência da lista (raro): a pendência fica com a dela.
    const textoNovo = chave !== p.chave && !chaves.has(chave) ? { chave, pendencia: nova } : undefined;
    const daPessoa = p.situacao === "resolvida" && p.resolvidaPor === "pessoa";
    const reabre = p.situacao === "resolvida" && !(opcoes.salvamento && daPessoa && textoNovo === undefined);
    if (!reabre && textoNovo === undefined) continue;
    const situacao = reabre ? "aberta" : p.situacao;
    mudancas.push({
      chave: p.chave,
      ...(textoNovo === undefined ? {} : { nova: textoNovo }),
      situacao,
      resolvidaPor: reabre ? null : p.resolvidaPor,
      evento: {
        acao: "revisarDeNovo",
        situacao,
        texto: `A revisão de ${nome} ainda aponta este ponto${textoNovo === undefined ? "" : ", com o texto atualizado"}${reabre && daPessoa ? "; a marcação de feito foi desfeita" : ""}.`,
      },
    });
  }
  const novas: { chave: string; pendencia: PendenciaRevisao }[] = [];
  const vistas = new Set([...chaves, ...mudancas.flatMap((m) => (m.nova ? [m.nova.chave] : []))]);
  for (const pendencia of sobras) {
    const chave = chavePendencia(pendencia);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    novas.push({ chave, pendencia });
  }
  const finais = new Map<string, Pick<PendenciaDaLista, "chave" | "situacao" | "resolvidaPor">>(
    lista.map((p) => [p.chave, p]),
  );
  const eventosFinais: EventoDaLista[] = [...eventos];
  for (const m of mudancas) {
    const chave = m.nova?.chave ?? m.chave;
    finais.delete(m.chave);
    finais.set(chave, { chave, situacao: m.situacao, resolvidaPor: m.resolvidaPor });
    if (m.nova) for (const e of eventosFinais.filter((e) => e.chave === m.chave)) eventosFinais.push({ ...e, chave });
    if (m.evento) eventosFinais.push({ chave, ...m.evento });
  }
  const chavesNovas = novas.filter((n) => visivel(n.pendencia, "aberta")).map((n) => n.chave);
  return {
    mudancas,
    novas,
    pendenciasFinais: [...finais.values()],
    eventosFinais,
    resolvidas: chavesResolvidas.length,
    continuam,
    contagemNovas: chavesNovas.length,
    chavesResolvidas,
    chavesNovas,
  };
}

/**
 * A régua com os critérios do código (as fichas D) tirados de `doCodigo`: depois de uma conferência ao
 * salvar, os do arquivo salvo, que a montagem sobre o texto revisado (a mesclagem da IA, a cópia
 * comentada) não pode desfazer. Os da IA ficam os de `criterios`.
 */
export function comCriteriosDoCodigo(
  criterios: ReadonlyArray<CriterioRevisao>,
  doCodigo: ReadonlyArray<CriterioRevisao>,
): ReadonlyArray<CriterioRevisao> {
  const porFicha = new Map(doCodigo.filter((c) => c.origem === "codigo").map((c) => [c.ficha, c]));
  return criterios.map((c) => (c.origem === "codigo" ? (porFicha.get(c.ficha) ?? c) : c));
}
