/** A revisão de PPC: a prévia sem IA, a revisão com IA e a lista viva das pendências. */
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";
import { AvisoNaoAceito } from "./preferencias.ts";

/** Uma fonte da pendência, legível para quem não conhece o `ifpr://`: nome e dispositivo, e o endereço oficial. */
export const FonteRevisao = Schema.Struct({
  rotulo: Schema.String,
  /** Endereço oficial (http), quando a base o registra. */
  url: Schema.NullOr(Schema.String),
  /** O link `ifpr://` (abre no painel de leitura). */
  link: Schema.String,
});

/** Onde o comentário ficou na cópia comentada: no trecho, no título (ausência) ou só na lista. */
export const LocalNoDocumento = Schema.Literals(["no-trecho", "no-inicio", "so-na-lista"]);
export type LocalNoDocumento = typeof LocalNoDocumento.Type;

export const PendenciaRevisao = Schema.Struct({
  /** A ficha da `revisar-ppc` (`CT-SUP-12`) ou `TRIAGEM`. */
  ficha: Schema.String,
  tituloFicha: Schema.String,
  /** O tema na ordem do parecer da PROENS, e a posição dele (0 = "Antes de começar"). */
  tema: Schema.String,
  ordemTema: Schema.Number,
  /** `nao_atende`: pendência; `a_conferir`: a pessoa confere (nunca é erro afirmado). */
  estado: Schema.Literals(["nao_atende", "a_conferir"]),
  mensagem: Schema.String,
  oQueFazer: Schema.String,
  trecho: Schema.NullOr(Schema.String),
  secao: Schema.NullOr(Schema.String),
  fontes: Schema.Array(FonteRevisao),
  /** Outras fichas que apontam o mesmo trecho ou a mesma norma ausente ("Também em …"). */
  tambemEm: Schema.Array(Schema.Struct({ ficha: Schema.String, titulo: Schema.String })),
  /** `no-inicio`: algo que falta, listado no comentário do título junto ao aviso. */
  noDocumento: LocalNoDocumento,
  /** `codigo`: conferido pela base; `ia`: avaliação da IA, com trechos e normas conferidos pelo app. */
  origem: Schema.Literals(["codigo", "ia"]),
});
export type PendenciaRevisao = typeof PendenciaRevisao.Type;

/** Um critério conferido automaticamente (ficha D), com o resultado. */
export const CriterioRevisao = Schema.Struct({
  ficha: Schema.String,
  titulo: Schema.String,
  tema: Schema.String,
  ordemTema: Schema.Number,
  estado: Schema.Literals(["atende", "nao_atende", "a_conferir", "nao_se_aplica"]),
  mensagem: Schema.String,
  origem: Schema.Literals(["codigo", "ia"]),
});
export type CriterioRevisao = typeof CriterioRevisao.Type;

export const ResultadoRevisaoPpc = Schema.Struct({
  arquivoOriginal: Schema.String,
  /** A cópia comentada, na mesma pasta do original; o original não é alterado. */
  arquivoComentado: Schema.String,
  curso: Schema.Struct({
    cnct: Schema.NullOr(Schema.Struct({ slug: Schema.String, denominacao: Schema.String })),
    forma: Schema.NullOr(Schema.String),
    origem: Schema.Literals(["documento", "pessoa"]),
  }),
  pendencias: Schema.Array(PendenciaRevisao),
  criterios: Schema.Array(CriterioRevisao),
  /** Quantos critérios o código conferiu, de quantos a revisão tem. */
  conferidos: Schema.Number,
  /** Quantos a IA decidiu (0 na pré-conferência), quantos foram à IA e ficaram para conferir, e os títulos dos que ficaram de fora (modo rápido). */
  conferidosIa: Schema.Number,
  paraConferirIa: Schema.Number,
  foraDaRevisao: Schema.Array(Schema.String),
  totalCriterios: Schema.Number,
  /** `data_referencia` da base (AAAA-MM-DD). */
  dataBase: Schema.String,
  /** A lista viva destas pendências no servidor (etapa 5b); ausente nos resultados gravados antes dela. */
  lista: Schema.optionalKey(Schema.String),
});
export type ResultadoRevisaoPpc = typeof ResultadoRevisaoPpc.Type;

/** A revisão não terminou; `motivo` é a frase para a pessoa (arquivo grande, protegido, corrompido, tempo). */
export class FalhaRevisaoPpc extends Schema.TaggedError<FalhaRevisaoPpc>()("FalhaRevisaoPpc", {
  arquivo: Schema.String,
  motivo: Schema.String,
}) {
  override get message(): string {
    return this.motivo;
  }
}

export const ehFalhaRevisaoPpc = Schema.is(FalhaRevisaoPpc);

/* ---------------------------------------------------------------- revisão com IA (etapa 4) */

/** `rapido`: as fichas que bloqueiam a submissão e os temas que mais devolvem; `completo`: as 68 S e J. */
export const ModoRevisaoIa = Schema.Literals(["rapido", "completo"]);
export type ModoRevisaoIa = typeof ModoRevisaoIa.Type;

/** O que a revisão deve gastar, mostrado antes de começar (método em `apps/server/src/revisao-ppc/estimativa.ts`). */
export const EstimativaRevisaoIa = Schema.Struct({
  provider: Provider,
  blocos: Schema.Number,
  fichas: Schema.Number,
  tokensEntrada: Schema.Number,
  tokensSaida: Schema.Number,
  minutos: Schema.Number,
  /** US$ equivalentes na API, quando o preço do modelo é conhecido (Claude). */
  custoUsd: Schema.NullOr(Schema.Number),
  percentualJanela: Schema.Number,
  nomeJanela: Schema.String,
});
export type EstimativaRevisaoIa = typeof EstimativaRevisaoIa.Type;

export const UsoRevisaoIa = Schema.Struct({
  entrada: Schema.Number,
  saida: Schema.Number,
  cacheLeitura: Schema.Number,
  cacheEscrita: Schema.Number,
  custoUsd: Schema.Number,
});
export type UsoRevisaoIa = typeof UsoRevisaoIa.Type;

/** Um bloco da revisão: um lote S, um tema J ou as transversais, numa sessão curta do provider. */
export const BlocoRevisaoIa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["S", "J", "T"]),
  tema: Schema.String,
  ordemTema: Schema.Number,
  fichas: Schema.Number,
  estado: Schema.Literals(["pendente", "em_andamento", "pronto"]),
  /** Fichas que ficaram "a conferir" porque a resposta não passou na conferência. */
  naoConferidas: Schema.Number,
  segundos: Schema.NullOr(Schema.Number),
});
export type BlocoRevisaoIa = typeof BlocoRevisaoIa.Type;

/**
 * - `preparada`: o plano e a estimativa prontos, esperando a confirmação;
 * - `em_andamento`, `pausada` (limite de taxa, cota, provider caído, app fechado ou a pedido; `motivo`
 *   diz qual), `concluida` (com `resultado`) ou `falhou` (`motivo`).
 */
export const SituacaoRevisaoIa = Schema.Literals(["preparada", "em_andamento", "pausada", "concluida", "falhou"]);
export type SituacaoRevisaoIa = typeof SituacaoRevisaoIa.Type;

export const EstadoRevisaoIa = Schema.Struct({
  id: Schema.String,
  arquivoOriginal: Schema.String,
  provider: Provider,
  modelo: Schema.NullOr(Schema.String),
  modo: ModoRevisaoIa,
  situacao: SituacaoRevisaoIa,
  motivo: Schema.NullOr(Schema.String),
  /** A pausa veio de limite de taxa ou de cota (a pessoa espera e retoma). */
  limite: Schema.Boolean,
  blocos: Schema.Array(BlocoRevisaoIa),
  estimativa: EstimativaRevisaoIa,
  uso: UsoRevisaoIa,
  resultado: Schema.NullOr(ResultadoRevisaoPpc),
  criadaEm: Schema.String,
  atualizadaEm: Schema.String,
});
export type EstadoRevisaoIa = typeof EstadoRevisaoIa.Type;

const EntradaRevisaoIa = Schema.Struct({ revisao: Schema.String });

/* ---------------------------------------------------------------- lista viva e conversa (etapa 5b) */

/**
 * A situação de uma pendência na lista viva: `aberta`; `vou_ajustar` e `resolvida` (a pessoa marca, ou
 * a revisão do arquivo novo decide); `contestada_aceita` (retirada: a resposta da IA trouxe trecho ou
 * norma que o app conferiu) e `contestada_mantida` (a discordância fica registrada).
 */
export const SituacaoPendencia = Schema.Literals([
  "aberta",
  "vou_ajustar",
  "resolvida",
  "contestada_aceita",
  "contestada_mantida",
]);
export type SituacaoPendencia = typeof SituacaoPendencia.Type;

export const AcaoPendencia = Schema.Literals(["marcar", "contestar", "sugerir", "revisarDeNovo"]);
export type AcaoPendencia = typeof AcaoPendencia.Type;

/** Um passo do histórico de uma pendência, com o uso da IA quando houve. */
export const EventoPendencia = Schema.Struct({
  em: Schema.String,
  acao: AcaoPendencia,
  situacao: SituacaoPendencia,
  /** A frase para a pessoa (o que mudou e por quê). */
  texto: Schema.String,
  /** O motivo escrito pela pessoa, na contestação. */
  motivo: Schema.NullOr(Schema.String),
  uso: Schema.NullOr(UsoRevisaoIa),
});
export type EventoPendencia = typeof EventoPendencia.Type;

/** A redação sugerida pela IA, com os fatos que o app não conferiu. Nunca aplicada ao documento. */
export const SugestaoTexto = Schema.Struct({
  texto: Schema.String,
  observacao: Schema.String,
  completar: Schema.Array(Schema.String),
  naoConferidos: Schema.Array(
    Schema.Struct({ fato: Schema.String, tipo: Schema.Literals(["numero", "norma", "nome", "sigla", "data"]) }),
  ),
});
export type SugestaoTexto = typeof SugestaoTexto.Type;

export const PendenciaViva = Schema.Struct({
  chave: Schema.String,
  pendencia: PendenciaRevisao,
  situacao: SituacaoPendencia,
  /** Quem decidiu a `resolvida`: a palavra da pessoa ou a revisão do arquivo novo. */
  resolvidaPor: Schema.NullOr(Schema.Literals(["pessoa", "revisarDeNovo"])),
  historico: Schema.Array(EventoPendencia),
  sugestao: Schema.NullOr(SugestaoTexto),
  /** "Discordo…" e "Sugerir texto" valem para fichas da revisão (não para a triagem). */
  aceitaIa: Schema.Boolean,
});
export type PendenciaViva = typeof PendenciaViva.Type;

/** Uma parada do roteiro: um tema, na ordem do parecer da PROENS. */
export const ParadaRoteiro = Schema.Struct({
  ordem: Schema.Number,
  tema: Schema.String,
  vista: Schema.Boolean,
});
export type ParadaRoteiro = typeof ParadaRoteiro.Type;

export const ListaPendencias = Schema.Struct({
  id: Schema.String,
  arquivoOriginal: Schema.String,
  /** A revisão com IA de onde a lista veio, ou nulo (só a pré-conferência). */
  revisao: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Provider),
  resultado: ResultadoRevisaoPpc,
  pendencias: Schema.Array(PendenciaViva),
  paradas: Schema.Array(ParadaRoteiro),
  /** A parada em que a pessoa estava (ordem do tema). */
  paradaAtual: Schema.Number,
  /** O uso somado das ações com IA desta lista. */
  uso: UsoRevisaoIa,
  criadaEm: Schema.String,
  atualizadaEm: Schema.String,
});
export type ListaPendencias = typeof ListaPendencias.Type;

/** A estimativa de uma ação com IA, mostrada antes de confirmar. */
export const EstimativaAcao = Schema.Struct({
  provider: Provider,
  tokensEntrada: Schema.Number,
  tokensSaida: Schema.Number,
  segundos: Schema.Number,
  custoUsd: Schema.NullOr(Schema.Number),
});
export type EstimativaAcao = typeof EstimativaAcao.Type;

const EntradaLista = Schema.Struct({ lista: Schema.String });

export class GrupoRevisaoPpc extends RpcGroup.make(
  /**
   * Revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3): conversão, pré-conferência das fichas D
   * e cópia comentada do DOCX. `arquivo` é o caminho absoluto escolhido no diálogo do sistema; `cnct`
   * (slug) e `forma` substituem o curso identificado no documento.
   */
  Rpc.make("revisaoPpc.revisar", {
    payload: Schema.Struct({
      arquivo: Schema.String,
      cnct: Schema.optionalKey(Schema.String),
      forma: Schema.optionalKey(Schema.String),
    }),
    success: ResultadoRevisaoPpc,
    error: FalhaRevisaoPpc,
  }),
  /**
   * Prepara a revisão com IA (etapa 4) do arquivo já revisado: converte de novo, monta os blocos e
   * os pedidos (o contexto normativo vem do `kb.sqlite`) e estima o custo. Nada vai ao provider.
   */
  Rpc.make("revisaoPpc.prepararIa", {
    payload: Schema.Struct({
      arquivo: Schema.String,
      provider: Provider,
      modo: ModoRevisaoIa,
      modelo: Schema.optionalKey(Schema.String),
      cnct: Schema.optionalKey(Schema.String),
      forma: Schema.optionalKey(Schema.String),
    }),
    success: EstadoRevisaoIa,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
  /** Começa ou retoma a revisão preparada (ou pausada); só os blocos pendentes vão ao provider. */
  Rpc.make("revisaoPpc.iniciarIa", {
    payload: EntradaRevisaoIa,
    success: EstadoRevisaoIa,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
  /** Pausa: os blocos em andamento param e voltam a pendentes; os prontos ficam gravados. */
  Rpc.make("revisaoPpc.pausarIa", { payload: EntradaRevisaoIa, success: EstadoRevisaoIa, error: FalhaRevisaoPpc }),
  /** O estado agora e a cada mudança (bloco pronto, pausa, fim); termina quando a revisão termina. */
  Rpc.make("revisaoPpc.acompanharIa", {
    payload: EntradaRevisaoIa,
    success: EstadoRevisaoIa,
    error: FalhaRevisaoPpc,
    stream: true,
  }),
  /** Apaga a revisão com IA: o plano (com o texto do PPC), os blocos e o uso de cada tentativa. */
  Rpc.make("revisaoPpc.apagarIa", { payload: EntradaRevisaoIa }),
  /** As revisões com IA gravadas (sem o resultado), da mais recente para a mais antiga. */
  Rpc.make("revisaoPpc.listarIa", { payload: Schema.Struct({}), success: Schema.Array(EstadoRevisaoIa) }),
  /** A lista viva (etapa 5b): as pendências com a situação, o histórico e as paradas do roteiro. */
  Rpc.make("revisaoPpc.lista", { payload: EntradaLista, success: ListaPendencias, error: FalhaRevisaoPpc }),
  /** A lista viva mais recente, para continuar depois de fechar o app (nula se não há). */
  Rpc.make("revisaoPpc.ultimaLista", { payload: Schema.Struct({}), success: Schema.NullOr(ListaPendencias) }),
  /**
   * As discordâncias registradas contra pendências do código (a conferência automática), em CSV, para a
   * curadoria das regras: se o verificador errou, é defeito da regra. Leva o trecho e o motivo da pessoa.
   */
  Rpc.make("revisaoPpc.exportarDiscordancias", { payload: Schema.Struct({}), success: Schema.String }),
  /** Apaga a lista viva (com o texto do PPC que ela guarda). */
  Rpc.make("revisaoPpc.apagarLista", { payload: EntradaLista }),
  /** "Vou ajustar", "Já resolvi" (pela palavra da pessoa) ou "Reabrir": só muda a situação, sem IA. */
  Rpc.make("revisaoPpc.marcar", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      situacao: Schema.Literals(["aberta", "vou_ajustar", "resolvida"]),
    }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /** A pessoa chegou a uma parada do roteiro (fica vista; a lista lembra onde ela estava). */
  Rpc.make("revisaoPpc.verParada", {
    payload: Schema.Struct({ lista: Schema.String, ordem: Schema.Number }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /** Quanto uma ação com IA deve gastar, antes de confirmar. */
  Rpc.make("revisaoPpc.estimarAcao", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      acao: Schema.Literals(["contestar", "sugerir", "revisarDeNovo"]),
      provider: Schema.optionalKey(Provider),
    }),
    success: EstimativaAcao,
    error: FalhaRevisaoPpc,
  }),
  /** "Discordo…": a IA reavalia com o motivo da pessoa; o código decide se retira. */
  Rpc.make("revisaoPpc.contestar", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      motivo: Schema.String,
      provider: Schema.optionalKey(Provider),
    }),
    success: ListaPendencias,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
  /** "Sugerir texto": a redação proposta, com os fatos conferidos; nunca aplicada ao documento. */
  Rpc.make("revisaoPpc.sugerir", {
    payload: Schema.Struct({ lista: Schema.String, chave: Schema.String, provider: Schema.optionalKey(Provider) }),
    success: ListaPendencias,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
  /**
   * "Já resolvi" com o arquivo atualizado: reconfere só a ficha da pendência no `.docx` novo (o código e,
   * nas fichas da IA, um lote pequeno); a situação sai do resultado, nunca da palavra da pessoa.
   */
  Rpc.make("revisaoPpc.revisarDeNovo", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      arquivo: Schema.String,
      provider: Schema.optionalKey(Provider),
    }),
    success: ListaPendencias,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
  /** Gera de novo a cópia comentada do original, com a situação de cada pendência no comentário e no aviso. */
  Rpc.make("revisaoPpc.gerarCopia", { payload: EntradaLista, success: ListaPendencias, error: FalhaRevisaoPpc }),
) {}
