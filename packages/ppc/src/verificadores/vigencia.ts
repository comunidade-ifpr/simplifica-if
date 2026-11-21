// @effect-diagnostics globalDate:off -- aritmética de datas AAAA-MM-DD da base, sem relógio
/**
 * Vigência das normas na data de referência da base, para os verificadores: o status que o `kb`
 * calcula (`statusEm`), se ele é certo ou depende de data "a confirmar" (a publicação da Res. CNE/CP
 * nº 2/2026 no DOU, por exemplo), e as regras de transição que preservam a norma revogada.
 *
 * E os marcos normativos da revisão (`base-conhecimento/revisao-ppc/marcos-normativos.json`): para cada linha
 * normativa, a ficha responsável, a única que eleva a gravidade de um fato do marco a `nao_atende`; as
 * demais fichas de base legal registram o mesmo fato como `a_conferir`. `test/vigencia.test.ts`
 * confere que esta cópia bate com o arquivo da skill.
 */
import { type EntradaRegistro, Registro } from "@simplifica-if/kb/normas/registro";
import { sucessorasDe, type Relacao } from "@simplifica-if/kb/normas/relacoes";
import {
  type DatasNorma,
  type FonteVigencia,
  type ResultadoVigencia,
  statusEm,
  type Transicao,
  transicoesAplicaveis,
} from "@simplifica-if/kb/normas/vigencia";

export type TransicaoVigente = { id: string; norma: string; dispositivo: string; regra: string };

export type VigenciaNorma = {
  status: string;
  /**
   * `false` quando o status depende de data "a confirmar" recente: o efeito que o decide (o início da
   * norma vigente, ou a revogação) não pode ter ocorrido antes de uma data a menos de 180 dias da data
   * de referência. Efeito "a confirmar" mais antigo (a Res. CONSUP/IFPR nº 190/2024, sem a publicação
   * registrada) vale como presumido: a falta do dado na base não é incerteza jurídica.
   */
  certo: boolean;
  /** Regras de transição em curso (ou a confirmar) que preservam a norma: prazo de adequação, ressalva de revogação, faculdade de adequação. */
  transicoes: TransicaoVigente[];
  /** Quando a revogação total passou a valer (AAAA-MM-DD), se a base registra; só para `revogada`. */
  revogadaEm?: string | null;
};

/** A consulta, com a data em que a vigência é calculada (as consultas montadas aqui a trazem). */
export type ConsultaVigencia = ((id: string) => VigenciaNorma) & { readonly data?: string };

/** Tipos de transição que deixam citar a norma revogada sem desconformidade (o direito de conclusão é dos estudantes, não do PPC). */
const TIPOS_QUE_PRESERVAM = new Set(["prazo-de-adequacao", "ressalva-de-revogacao", "faculdade-de-adequacao"]);

/** Janela em que uma data "a confirmar" ainda é incerteza de fato (a publicação pode não ter saído). */
const DIAS_PRESUNCAO = 180;

const diasAntes = (data: string, dias: number) =>
  new Date(Date.parse(`${data}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

/** O efeito incerto que decide o status é anterior ao limite (ocorreu, com folga)? */
function presumidaHaTempo(status: ResultadoVigencia, limite: string): boolean {
  if (status.status === "revogada") {
    const revogacoes = status.eventos.filter((e) => e.tipo === "revoga" && !e.parcial && e.ocorreu !== false);
    return revogacoes.some((e) => e.ocorreu === true || (e.efeito_minimo !== null && e.efeito_minimo <= limite));
  }
  return status.inicio.certo || (status.inicio.minimo !== null && status.inicio.minimo <= limite);
}

/** Os dados da vigência, planos (atravessam o `postMessage` de um Worker): do `kb.sqlite` no app. */
export type DadosVigencia = {
  normas: readonly EntradaRegistro[];
  datas: ReadonlyMap<string, DatasNorma>;
  relacoes: readonly Relacao[];
  transicoes: readonly Transicao[];
};

/** A consulta sobre dados já carregados, sem ler arquivo nenhum (o app empacotado não tem o checkout). */
export function vigenciaDeDados(dados: DadosVigencia, data: string): ConsultaVigencia {
  return consultarVigencia(
    {
      registro: new Registro(dados.normas),
      datas: dados.datas,
      relacoes: dados.relacoes,
      transicoes: dados.transicoes,
    },
    data,
  );
}

/** A consulta memorizada sobre os dados da vigência (dos arquivos do checkout ou do `kb.sqlite`). */
export function consultarVigencia(fonte: FonteVigencia, data: string): ConsultaVigencia {
  const cache = new Map<string, VigenciaNorma>();
  const limite = diasAntes(data, DIAS_PRESUNCAO);
  const consulta = (id: string): VigenciaNorma => {
    const salvo = cache.get(id);
    if (salvo) return salvo;
    const status = statusEm(id, data, fonte);
    const transicoes = transicoesAplicaveis(id, data, fonte)
      .filter(
        (t) =>
          t.norma_anterior === status.id &&
          TIPOS_QUE_PRESERVAM.has(t.tipo) &&
          t.situacao !== "encerrada" &&
          t.situacao !== "a-iniciar",
      )
      .map((t) => ({ id: t.id, norma: t.norma, dispositivo: t.dispositivo, regra: t.regra }));
    const revogacoes = status.eventos
      .filter((e) => e.tipo === "revoga" && !e.parcial && e.ocorreu !== false)
      .map((e) => e.efeito_de ?? e.efeito_minimo)
      .filter((d): d is string => d !== null)
      .sort();
    const vigencia: VigenciaNorma = {
      status: status.status,
      certo: status.certo || presumidaHaTempo(status, limite),
      transicoes,
      revogadaEm: status.status === "revogada" ? (revogacoes[0] ?? null) : null,
    };
    cache.set(id, vigencia);
    return vigencia;
  };
  return Object.assign(consulta, { data });
}

/** Meses em que uma revogação conta como recente quando a data do PPC não é conhecida. */
export const MESES_REVOGACAO_RECENTE = 12;

/**
 * Revogação recente (menos de `MESES_REVOGACAO_RECENTE` meses na data de referência) que pode ser
 * posterior ao PPC: posterior à data dele, quando conhecida (só o ano: o fim do ano); sem ela, basta
 * ser recente. Revogação antiga não entra: o PPC revisto agora já devia citar a sucessora. Sem a data
 * da revogação ou a de referência, não.
 */
export function revogacaoRecente(
  revogadaEm: string | null | undefined,
  dataPpc: string | null | undefined,
  referencia: string | undefined,
): boolean {
  if (!revogadaEm || !referencia) return false;
  if (revogadaEm <= diasAntes(referencia, Math.round(MESES_REVOGACAO_RECENTE * 30.44))) return false;
  if (dataPpc) return revogadaEm > (/^\d{4}$/.test(dataPpc) ? `${dataPpc}-12-31` : dataPpc);
  return true;
}

/* ------------------------------------------------------------------ marcos */

export type Marco = { id: string; linha: readonly string[]; responsavel: string };

/** Linhas normativas e ficha responsável, de `base-conhecimento/revisao-ppc/marcos-normativos.json` (conferido em teste). */
export const MARCOS: readonly Marco[] = [
  {
    id: "dcn_ept",
    linha: ["br/cne-ceb/res/2012/6", "br/cne-cp/res/2021/1", "br/cne-cp/res/2026/2"],
    responsavel: "CT-SUP-12",
  },
  {
    id: "dcnem",
    linha: ["br/cne-ceb/res/2012/2", "br/cne-ceb/res/2018/3", "br/cne-ceb/res/2024/2"],
    responsavel: "CT-SUP-12",
  },
  { id: "eja", linha: ["br/cne-ceb/res/2021/1", "br/cne-ceb/res/2025/3"], responsavel: "CT-CURR-02" },
  {
    id: "assistencia_estudantil_ifpr",
    linha: ["ifpr/consup/res/2009/11", "ifpr/consup/res/2025/239"],
    responsavel: "CT-SUP-24",
  },
];

/** Todas as normas que sucedem `id` por revogação total, em cadeia (6/2012 → 1/2021 → 2/2026), sem filtro de status. */
export function sucessorasEmCadeia(id: string, relacoes: readonly Relacao[]): string[] {
  const vistas = new Set<string>();
  const fila = [id];
  while (fila.length) {
    for (const sucessora of sucessorasDe(fila.shift()!, relacoes))
      if (!vistas.has(sucessora)) {
        vistas.add(sucessora);
        fila.push(sucessora);
      }
  }
  return [...vistas];
}

/** Marco da norma: o que a tem na linha, ou cuja linha contém uma sucessora dela (a 53/2011, revogada pela 239/2025). */
export function marcoDa(id: string, relacoes: readonly Relacao[]): Marco | null {
  const cadeia = [id, ...sucessorasEmCadeia(id, relacoes)];
  return MARCOS.find((m) => cadeia.some((n) => m.linha.includes(n))) ?? null;
}

/** Ficha que eleva a gravidade de um fato sobre a norma: a responsável do marco; fora de marco, CT-SUP-12 (a ficha da vigência). */
export const fichaResponsavel = (id: string, relacoes: readonly Relacao[]) =>
  marcoDa(id, relacoes)?.responsavel ?? "CT-SUP-12";
