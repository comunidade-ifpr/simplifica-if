/** A revisão de PPC: a prévia sem IA, a revisão com IA e a lista viva das pendências. */
import { Ancora } from "@simplifica-if/mcp/grupo-leitura";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";
import { AvisoNaoAceito } from "./preferencias.ts";

/** Uma fonte da pendência, legível para quem não conhece o `ifpr://`: nome e dispositivo, e o endereço oficial. */
export const FonteRevisao = Schema.Struct({
  /** O título ou a citação da norma, com o dispositivo ("Nota Técnica PROENS/IFPR nº 1/2025"); nunca o ID. */
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
  /** A ficha da revisão de PPC (`CT-SUP-12`) ou `TRIAGEM`. Código interno: a interface mostra `tituloFicha`. */
  ficha: Schema.String,
  /** O título humano da ficha (nunca o código). */
  tituloFicha: Schema.String,
  /** O tema na ordem do parecer da PROENS, e a posição dele (0 = "Antes de começar"). */
  tema: Schema.String,
  ordemTema: Schema.Number,
  /** `nao_atende`: pendência; `a_conferir`: a pessoa confere (nunca é erro afirmado). */
  estado: Schema.Literals(["nao_atende", "a_conferir"]),
  /** O problema numa frase: o título da linha. */
  titulo: Schema.String,
  /** O resto da explicação (o raciocínio da IA, a regra de transição); `null` quando o título diz tudo. */
  explicacao: Schema.NullOr(Schema.String),
  /** O que falta no PPC, item a item; vazio quando a pendência não é de ausência. */
  faltas: Schema.Array(Schema.String),
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
  /**
   * A pendência existe porque o curso não foi identificado no CNCT (denominação, eixo, carga horária,
   * ingresso, legislação profissional): a interface as junta em "Qual é o curso?", que chama
   * `revisaoPpc.revisar` com o `cnct` escolhido.
   */
  dependeDoCurso: Schema.Boolean,
});
export type PendenciaRevisao = typeof PendenciaRevisao.Type;

/**
 * A situação de um critério: a decisão (`atende`, `nao_atende`, `a_conferir`, `nao_se_aplica`) ou
 * `nao_lido`, que ninguém decidiu ainda (ficha S ou J sem a revisão com IA, ou fora do modo rápido).
 */
export const EstadoCriterio = Schema.Literals(["atende", "nao_atende", "a_conferir", "nao_se_aplica", "nao_lido"]);
export type EstadoCriterio = typeof EstadoCriterio.Type;

/** Um critério da revisão (uma ficha da base), com a decisão do código, a da IA ou `nao_lido`. */
export const CriterioRevisao = Schema.Struct({
  ficha: Schema.String,
  /** O título humano da ficha (nunca o código). */
  titulo: Schema.String,
  tema: Schema.String,
  ordemTema: Schema.Number,
  estado: EstadoCriterio,
  /** O que a decisão diz; vazio no `nao_lido`. */
  mensagem: Schema.String,
  /** Quem decidiu (no `nao_lido`, quem decide: a IA). */
  origem: Schema.Literals(["codigo", "ia"]),
});
export type CriterioRevisao = typeof CriterioRevisao.Type;

export const LeituraIaRevisao = Schema.Literals(["nenhuma", "parcial", "completa"]);
export type LeituraIaRevisao = typeof LeituraIaRevisao.Type;

/**
 * O resultado de uma revisão: os arquivos, o curso, a régua e as contagens. As pendências não vêm aqui:
 * a lista viva (`ListaPendencias.pendencias`) é a única cópia delas.
 */
export const ResultadoRevisaoPpc = Schema.Struct({
  arquivoOriginal: Schema.String,
  /** A cópia comentada, na mesma pasta do original; o original não é alterado. */
  arquivoComentado: Schema.String,
  curso: Schema.Struct({
    cnct: Schema.NullOr(Schema.Struct({ slug: Schema.String, denominacao: Schema.String })),
    forma: Schema.NullOr(Schema.String),
    origem: Schema.Literals(["documento", "pessoa"]),
  }),
  /**
   * A régua: todos os critérios da revisão (as fichas da base, hoje 84), na ordem dos temas, cada um
   * com a decisão ou `nao_lido`. `criterios.length === totalCriterios`.
   */
  criterios: Schema.Array(CriterioRevisao),
  /** Quantos critérios o código conferiu (as fichas D), de quantos a revisão tem. */
  conferidos: Schema.Number,
  /** Quantos a IA decidiu (0 na pré-conferência), quantos foram à IA e ficaram para conferir, e os títulos dos que ficaram de fora (modo rápido). */
  conferidosIa: Schema.Number,
  paraConferirIa: Schema.Number,
  foraDaRevisao: Schema.Array(Schema.String),
  totalCriterios: Schema.Number,
  /**
   * Quanto a leitura com IA cobriu: `nenhuma` (só a pré-conferência), `parcial` (os blocos prontos de
   * uma leitura em andamento, pausada ou encerrada antes do fim) ou `completa`.
   */
  leituraIa: LeituraIaRevisao,
  /** `data_referencia` da base (AAAA-MM-DD). */
  dataBase: Schema.String,
  /** A lista viva destas pendências no servidor (etapa 5b). */
  lista: Schema.optionalKey(Schema.String),
});
export type ResultadoRevisaoPpc = typeof ResultadoRevisaoPpc.Type;

/** As etapas da leitura do PPC, na ordem em que começam. */
export const EtapaLeituraPpc = Schema.Literals(["lendo", "identificando", "conferindo", "gravando"]);
export type EtapaLeituraPpc = typeof EtapaLeituraPpc.Type;

/**
 * O andamento de `revisaoPpc.revisar`: cada etapa quando ela começa (`lendo` o documento,
 * `identificando` o curso no CNCT, `conferindo` os critérios automáticos, `gravando` a cópia
 * comentada) e, no fim, `pronto` com o resultado.
 */
export const EventoRevisaoPpc = Schema.Union([
  Schema.Struct({ tipo: Schema.Literal("etapa"), etapa: EtapaLeituraPpc }),
  Schema.Struct({ tipo: Schema.Literal("pronto"), resultado: ResultadoRevisaoPpc }),
]);
export type EventoRevisaoPpc = typeof EventoRevisaoPpc.Type;

/** A revisão não terminou; `motivo` é a frase para a pessoa (arquivo grande, protegido, corrompido, tempo). */
export class FalhaRevisaoPpc extends Schema.TaggedError<FalhaRevisaoPpc>()("FalhaRevisaoPpc", {
  arquivo: Schema.String,
  motivo: Schema.String,
  /**
   * O arquivo não está liberado nesta execução do app (a liberação vale até fechar o app): a interface
   * pede para escolher o mesmo arquivo de novo e repete a ação.
   */
  escolherDeNovo: Schema.optionalKey(Schema.Boolean),
}) {
  override get message(): string {
    return this.motivo;
  }
}

export const ehFalhaRevisaoPpc = Schema.is(FalhaRevisaoPpc);

/* ---------------------------------------------------------------- revisão com IA (etapa 4) */

/**
 * `rapido`: as fichas que bloqueiam a submissão e os temas que mais devolvem; `completo`: todas as S e J
 * (as que pedem leitura: `totalCriterios - conferidos` do resultado, número que vem da base).
 */
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
  /** De que é a porcentagem, como a frase a diz: "do limite de 5 horas do plano Pro", "da cota diária do plano gratuito". */
  limiteDoPlano: Schema.String,
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

/**
 * O que um bloco em andamento está fazendo: `aguardando` a primeira resposta da IA, `recebendo` o
 * texto, o app `conferindo` a resposta ou a `nova_tentativa` com os problemas da primeira.
 */
export const EtapaBlocoIa = Schema.Literals(["aguardando", "recebendo", "conferindo", "nova_tentativa"]);
export type EtapaBlocoIa = typeof EtapaBlocoIa.Type;

/** Um bloco da revisão: um lote S, um tema J ou as transversais, numa sessão curta do provider. */
export const BlocoRevisaoIa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["S", "J", "T"]),
  tema: Schema.String,
  ordemTema: Schema.Number,
  fichas: Schema.Number,
  /** Os títulos humanos dos critérios do bloco (nunca o código). */
  titulosFichas: Schema.Array(Schema.String),
  estado: Schema.Literals(["pendente", "em_andamento", "pronto"]),
  /** Só no `em_andamento`. */
  etapa: Schema.NullOr(EtapaBlocoIa),
  /** Quando o bloco começou nesta execução e quando a IA deu sinal de vida pela última vez (ISO). */
  iniciadoEm: Schema.NullOr(Schema.String),
  ultimaAtividadeEm: Schema.NullOr(Schema.String),
  /** Fichas que ficaram "a conferir" porque a resposta não passou na conferência. */
  naoConferidas: Schema.Number,
  /** Nos blocos prontos: quantos pontos (para corrigir ou conferir) o bloco encontrou. */
  pendenciasEncontradas: Schema.Number,
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
  /** A lista viva de onde a leitura nasceu; nula se a lista saiu (apagada, expirada ou substituída). */
  lista: Schema.NullOr(Schema.String),
  /** O arquivo da lista quando a leitura foi preparada. */
  arquivoOriginal: Schema.String,
  provider: Provider,
  modelo: Schema.NullOr(Schema.String),
  modo: ModoRevisaoIa,
  situacao: SituacaoRevisaoIa,
  motivo: Schema.NullOr(Schema.String),
  /** A pausa veio de limite de taxa ou de cota (a pessoa espera e retoma). */
  limite: Schema.Boolean,
  /** O bloco que parou a leitura (tempo, falha do provider), ao lado do `motivo`; só em memória. */
  blocoPausado: Schema.NullOr(Schema.String),
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
 * A situação de uma pendência na lista viva: `aberta`; `resolvida` (a pessoa marca "Feito", ou a
 * revisão do arquivo novo decide); `contestada_aceita` (retirada: a resposta da IA trouxe trecho ou
 * norma que o app conferiu) e `contestada_mantida` (a discordância fica registrada).
 */
export const SituacaoPendencia = Schema.Literals(["aberta", "resolvida", "contestada_aceita", "contestada_mantida"]);
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

export const ListaPendencias = Schema.Struct({
  id: Schema.String,
  arquivoOriginal: Schema.String,
  sha256: Schema.String,
  /** A revisão com IA de onde a lista veio, ou nulo (só a pré-conferência). */
  revisao: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Provider),
  resultado: ResultadoRevisaoPpc,
  pendencias: Schema.Array(PendenciaViva),
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

/**
 * O PPC revisado, para o leitor (`ifpr://revisao/<lista>/<versão>#p-<chave>`): o Markdown convertido do `.docx`
 * que a lista guarda, com as seções e, para cada pendência com trecho, a âncora `p-<chave>` nas linhas
 * onde o trecho está, localizado na hora sobre o texto atual da lista.
 */
export const DocumentoRevisado = Schema.Struct({
  /** O nome do arquivo `.docx`. */
  titulo: Schema.String,
  markdown: Schema.String,
  /** As seções (`secao-<n>`) e os trechos das pendências (`p-<chave>`), na ordem do documento. */
  ancoras: Schema.Array(Ancora),
  /**
   * O texto de cada trecho com âncora (`id` = `p-<chave>`), como a pendência o mostra: o leitor destaca
   * a frase exata dentro das linhas da âncora.
   */
  trechos: Schema.Array(Schema.Struct({ id: Schema.String, texto: Schema.String })),
});
export type DocumentoRevisado = typeof DocumentoRevisado.Type;

/** "Enviar a versão corrigida": a lista reconferida contra o arquivo novo e o que mudou. */
export const ResultadoArquivoNovo = Schema.Struct({
  /** A lista, agora sobre o arquivo novo (`arquivoOriginal` e `resultado` dele, a cópia comentada regravada). */
  lista: ListaPendencias,
  /** Pendências do código que o arquivo novo resolveu (`resolvida`, `resolvidaPor: "revisarDeNovo"`). */
  resolvidas: Schema.Number,
  /** Pendências do código que o arquivo novo ainda aponta (ficam ou voltam a `aberta`). */
  continuam: Schema.Number,
  /** Pendências do código que só o arquivo novo aponta (entram abertas). */
  novas: Schema.Number,
});
export type ResultadoArquivoNovo = typeof ResultadoArquivoNovo.Type;

/** Dias sem uso que uma lista viva fica guardada (com o texto do PPC e os motivos) antes de sair sozinha. */
export const DIAS_LISTA = 30;

export class GrupoRevisaoPpc extends RpcGroup.make(
  /**
   * Revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3): conversão, pré-conferência das fichas D
   * e cópia comentada do DOCX, com uma lista viva nova. `arquivo` é o caminho absoluto liberado pelo
   * desktop (`escolherDocx` ou `soltarDocx`); `cnct` (slug) e `forma` substituem o curso identificado
   * no documento ("Qual é o curso?": a lista nova substitui a anterior). Em stream: as etapas, quando
   * cada uma começa, e por último o `pronto`, com o resultado (e o id da lista em `resultado.lista`).
   */
  Rpc.make("revisaoPpc.revisar", {
    payload: Schema.Struct({
      arquivo: Schema.String,
      cnct: Schema.optionalKey(Schema.String),
      forma: Schema.optionalKey(Schema.String),
    }),
    success: EventoRevisaoPpc,
    error: FalhaRevisaoPpc,
    stream: true,
  }),
  /**
   * Prepara a revisão com IA (etapa 4) de uma lista viva: monta os blocos e os pedidos sobre o texto e o
   * curso que a lista guarda (o contexto normativo vem do `kb.sqlite`) e estima o custo, sem reler o
   * `.docx`. Nada vai ao provider. A preparada anterior da mesma lista sai.
   */
  Rpc.make("revisaoPpc.prepararIa", {
    payload: Schema.Struct({
      lista: Schema.String,
      provider: Provider,
      modo: ModoRevisaoIa,
      modelo: Schema.optionalKey(Schema.String),
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
  /** A lista viva (etapa 5b): as pendências com a situação e o histórico. */
  Rpc.make("revisaoPpc.lista", { payload: EntradaLista, success: ListaPendencias, error: FalhaRevisaoPpc }),
  /** A lista viva mais recente, para continuar depois de fechar o app (nula se não há). */
  Rpc.make("revisaoPpc.ultimaLista", { payload: Schema.Struct({}), success: Schema.NullOr(ListaPendencias) }),
  /** Todas as listas vivas guardadas, da mais recente para a mais antiga ("Revisões recentes"). */
  Rpc.make("revisaoPpc.listas", { payload: Schema.Struct({}), success: Schema.Array(ListaPendencias) }),
  /**
   * "Qual é o curso?": a lista refeita com o curso escolhido no CNCT (`cnct`, e a `forma`, se houver).
   * Os resultados conferidos da leitura com IA, se a lista veio dela, entram de novo, como na cópia
   * comentada; a situação, o histórico e a sugestão de cada pendência passam à lista nova, que
   * substitui a anterior.
   */
  Rpc.make("revisaoPpc.trocarCurso", {
    payload: Schema.Struct({ lista: Schema.String, cnct: Schema.String, forma: Schema.optionalKey(Schema.String) }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /**
   * As discordâncias registradas contra pendências do código (a conferência automática), em CSV, para a
   * curadoria das regras: se o verificador errou, é defeito da regra. Leva o trecho e o motivo da pessoa.
   */
  Rpc.make("revisaoPpc.exportarDiscordancias", { payload: Schema.Struct({}), success: Schema.String }),
  /**
   * Apaga a revisão: a lista viva (com o texto do PPC), o que a pessoa marcou e escreveu e todas as
   * leituras com IA dela, parando a que estiver rodando. A cópia comentada e o original ficam.
   */
  Rpc.make("revisaoPpc.apagarLista", { payload: EntradaLista }),
  /** "Feito" (`resolvida`, pela palavra da pessoa) ou "Desfazer" (`aberta`): só muda a situação, sem IA. */
  Rpc.make("revisaoPpc.marcar", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      situacao: Schema.Literals(["aberta", "resolvida"]),
    }),
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
  /**
   * "Enviar a versão corrigida": converte e pré-confere o `.docx` novo (só o código, sem IA). Cada
   * pendência do código sai do resultado (resolvida ou aberta), as que só o arquivo novo aponta entram
   * abertas, e as da IA ficam como estão (para elas, `revisarDeNovo` por pendência). A lista passa a
   * apontar o arquivo novo, e a cópia comentada é regravada a partir dele. O arquivo precisa ter sido
   * liberado pelo desktop, como no `revisar`.
   */
  Rpc.make("revisaoPpc.revisarArquivoNovo", {
    payload: Schema.Struct({ lista: Schema.String, arquivo: Schema.String }),
    success: ResultadoArquivoNovo,
    error: FalhaRevisaoPpc,
  }),
  /**
   * A cópia comentada com a situação de cada pendência no comentário e no aviso, regravada só se a lista
   * mudou desde a última cópia (ou se ela sumiu). `<nome> - revisão prévia (Simplifica IF).docx`; ` (2)`…
   * quando a cópia está travada, só de leitura, não é arquivo comum ou foi editada pela pessoa (a cópia
   * editada nunca é sobrescrita).
   */
  Rpc.make("revisaoPpc.gerarCopia", { payload: EntradaLista, success: ListaPendencias, error: FalhaRevisaoPpc }),
  /** O texto do PPC revisado, com as seções e os trechos das pendências, para o painel de leitura. */
  Rpc.make("revisaoPpc.documento", { payload: EntradaLista, success: DocumentoRevisado, error: FalhaRevisaoPpc }),
) {}
