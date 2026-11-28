/**
 * O contrato do módulo `revisao-ppc` (a tarefa "Revisar um PPC"): a prévia sem IA, a revisão com IA e a
 * lista viva das pendências. Exportado à parte, como `@simplifica-if/contratos-app/modulos/revisao-ppc`:
 * a raiz do pacote só junta o `GrupoRevisaoPpc` ao `GrupoApp` (`contratos.ts`, arquivo de composição).
 */
import {
  CRITICIDADES,
  DESCRICAO_CRITICIDADE,
  DESCRICAO_MODO_EXECUCAO,
  DESCRICAO_MOTIVO_ESCALONAMENTO,
  ehCriticidadeCriterio,
  esquemaModoExecucao,
  esquemaMotivoEscalonamento,
  MODOS_EXECUCAO,
  MOTIVOS_ESCALONAMENTO,
  type CriticidadeCriterio,
  type ModoExecucao,
  type MotivoEscalonamento,
} from "@simplifica-if/kb/revisao-ppc/constantes";
import { Ancora } from "@simplifica-if/mcp/grupo-leitura";
import { FalhaProvider } from "@simplifica-if/motor/erros";
import { NivelEsforco } from "@simplifica-if/motor/estados-provider";
import { Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";
import { FalhaPasta } from "../pasta.ts";
import { AvisoNaoAceito } from "../preferencias.ts";

export {
  CRITICIDADES,
  DESCRICAO_CRITICIDADE,
  DESCRICAO_MODO_EXECUCAO,
  DESCRICAO_MOTIVO_ESCALONAMENTO,
  ehCriticidadeCriterio,
  MODOS_EXECUCAO,
  MOTIVOS_ESCALONAMENTO,
  type CriticidadeCriterio,
  type ModoExecucao,
  type MotivoEscalonamento,
};

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
  /** Motivos fixos (sem texto do PPC) quando o verificador em código pediu escalonamento para a IA. */
  escalarParaIa: Schema.optionalKey(Schema.Array(esquemaMotivoEscalonamento)),
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
  /** O dia em que a revisão calculou a vigência das normas (AAAA-MM-DD). */
  dataBase: Schema.String,
});
export type ResultadoRevisaoPpc = typeof ResultadoRevisaoPpc.Type;

/** As etapas da leitura do PPC, na ordem em que começam. */
export const EtapaLeituraPpc = Schema.Literals(["lendo", "identificando", "conferindo", "gravando"]);
export type EtapaLeituraPpc = typeof EtapaLeituraPpc.Type;

/**
 * O andamento de `revisaoPpc.revisar`: cada etapa quando ela começa (`lendo` o documento,
 * `identificando` o curso no CNCT, `conferindo` os critérios automáticos, `gravando` a cópia
 * comentada) e, no fim, `pronto` com o id da lista viva (`revisaoPpc.lista` a abre).
 */
export const EventoRevisaoPpc = Schema.Union([
  Schema.Struct({ tipo: Schema.Literal("etapa"), etapa: EtapaLeituraPpc }),
  Schema.Struct({ tipo: Schema.Literal("pronto"), lista: Schema.String }),
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

/** Um bloco da revisão: um lote `focal`, um tema `tematico` ou os critérios `transversal`, numa sessão curta do provider. */
export const BlocoRevisaoIa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["focal", "tematico", "transversal"]),
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
  /**
   * A pausa veio do limite de uso da assinatura (cota ou limite de taxa): a pessoa espera a janela ou
   * continua com outra IA (`revisaoPpc.continuarIaCom`). O serviço fora do ar não conta.
   */
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
  /**
   * A IA que julgou a pendência da leitura com IA ("julgada pelo Claude"); nula nas do código e nas de
   * antes de a leitura gravar a IA de cada bloco.
   */
  julgadaPor: Schema.NullOr(Provider),
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
  /**
   * O `.docx` que a revisão acompanha no Word ("Acompanhar no Word"): a cópia comentada ou outro que a
   * pessoa escolheu. Cada salvamento dele é conferido (`acompanharLista`), sem trocar `arquivoOriginal`.
   */
  arquivoAcompanhado: Schema.NullOr(Schema.String),
  /**
   * As conversas ao lado desta revisão, na ordem em que se abriram ("Conversas desta revisão"). Cada uma tem
   * a sua pasta, com o Markdown do PPC, que fica no computador quando a revisão é apagada; `pendencia` é a
   * chave da pendência de que ela nasceu ("Conversar sobre esta pendência" a retoma), nula na conversa geral.
   * `titulo` é o da conversa (vazio antes de a primeira mensagem dar um). A conversa que continuou com outra
   * IA aparece pela continuação.
   */
  conversas: Schema.Array(
    Schema.Struct({
      conversa: Schema.String,
      pasta: Schema.String,
      pendencia: Schema.NullOr(Schema.String),
      titulo: Schema.String,
    }),
  ),
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
 * O PPC revisado, para o leitor (`ifpr://revisao-ppc/<lista>/<versão>#p-<chave>`): o Markdown convertido do `.docx`
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

/**
 * A ficha de um critério da revisão (`ifpr://revisao-ppc/<lista>/criterio/<ID>`), em linguagem de quem
 * revisa: o que confere, por que (as normas, com a situação de vigência na data da base), o que conta
 * como atendido e como não atendido, quando fica "a conferir", como o app confere e o estado neste PPC.
 * É critério da tarefa, não fonte normativa.
 */
export const FichaCriterio = Schema.Struct({
  /** O código da ficha (`CT-SUP-17`). */
  id: Schema.String,
  titulo: Schema.String,
  /** `BLOQ`, `OBRIG` ou `REC`; `null` se a ficha não diz. */
  criticidade: Schema.NullOr(Schema.String),
  /** O que o critério confere (a pergunta da ficha). */
  pergunta: Schema.NullOr(Schema.String),
  /**
   * As referências que fundamentam o critério, uma por referência, com os dispositivos na ordem da ficha:
   * uma norma da base, o CNCT (`cnct:catalogo`) ou uma referência externa, sem texto na base
   * (`externo:abnt/nbr/6023`).
   */
  normas: Schema.Array(
    Schema.Struct({
      /** O ID na ficha (`br/cne-cp/res/2026/2`, `cnct:catalogo`, `externo:ifpr/pdi`). */
      norma: Schema.String,
      tipo: Schema.Literals(["norma", "cnct", "externo"]),
      /**
       * O título (da base; o do CNCT, com o curso da revisão quando há); `null` se a base não tem a norma.
       */
      titulo: Schema.NullOr(Schema.String),
      /** Onde abre no Ler (a norma, ou o curso da revisão no CNCT); `null` sem destino (a referência externa). */
      link: Schema.NullOr(Schema.String),
      /** Os dispositivos citados (`art57`), sem o `#`; vazio quando a ficha cita a norma inteira. */
      dispositivos: Schema.Array(Schema.String),
      /** A situação de vigência na data da base (`vigente`, `revogada`…); `null` se a base não a tem. */
      vigencia: Schema.NullOr(Schema.String),
    }),
  ),
  /** O que conta como atendido e como não atendido, e quando fica "a conferir". */
  atendido: Schema.NullOr(Schema.String),
  naoAtendido: Schema.NullOr(Schema.String),
  aConferir: Schema.NullOr(Schema.String),
  /** Como o app confere: `hibrido`, `focal`, `tematico` ou `transversal`. */
  modo: esquemaModoExecucao,
  /** O porquê do modo, como a ficha o escreve. */
  justificativa: Schema.NullOr(Schema.String),
  /** Os temas das seções do PPC em que o critério procura (os tópicos da ficha), pelo título. */
  secoes: Schema.Array(Schema.String),
  /** O critério nesta revisão: o estado na régua e, se há, a pendência dele (a primeira, na ordem da lista). */
  nestePpc: Schema.Struct({
    estado: EstadoCriterio,
    /** O que a decisão diz; vazio no `nao_lido`. */
    mensagem: Schema.String,
    pendencia: Schema.NullOr(
      Schema.Struct({
        chave: Schema.String,
        /** Aberta, feita ou retirada (a lista viva): o "Neste PPC" acompanha a marcação. */
        situacao: SituacaoPendencia,
        titulo: Schema.String,
        secao: Schema.NullOr(Schema.String),
        trecho: Schema.NullOr(Schema.String),
      }),
    ),
  }),
});
export type FichaCriterio = typeof FichaCriterio.Type;

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

/**
 * O fluxo `revisaoPpc.acompanharLista`: a lista agora e a cada mudança, e o resultado de cada conferência
 * ao salvar do arquivo acompanhado.
 *
 * - `conferido`: as chaves das pendências do código que o arquivo salvo resolveu e das que só ele aponta
 *   (as que entram na lista), e quantas continuam, sem o bloqueio do curso nem as retiradas.
 * - `falhou`: o arquivo salvo não pôde ser conferido (incompleto no meio do salvamento, corrompido, ou não
 *   parece o mesmo PPC); a lista não mudou e espera o próximo salvamento. Com `escolherDeNovo`, a
 *   liberação do arquivo se perdeu (o app foi fechado): a pessoa o escolhe de novo.
 */
export const EventoAcompanhamento = Schema.Union([
  Schema.Struct({ tipo: Schema.Literal("lista"), lista: ListaPendencias }),
  Schema.Struct({
    tipo: Schema.Literal("conferido"),
    em: Schema.String,
    resolvidas: Schema.Array(Schema.String),
    novas: Schema.Array(Schema.String),
    continuam: Schema.Number,
  }),
  Schema.Struct({
    tipo: Schema.Literal("falhou"),
    em: Schema.String,
    motivo: Schema.String,
    escolherDeNovo: Schema.Boolean,
  }),
]);
export type EventoAcompanhamento = typeof EventoAcompanhamento.Type;

/**
 * O que `revisaoPpc.conversarSobre` preparou: a conversa ao lado (`nova` se as conversas da lista mudaram:
 * a que acabou de abrir, ou a que continuou a pedida com outra IA) e o que entrou na pasta dela, para as
 * fichas da mensagem.
 * - `ppc`: o Markdown do PPC (`arquivo`, o nome na pasta), com a instrução de leitura que vai na ficha e
 *   `atualizadoEm` (ISO) quando ele acabou de ser regravado porque o texto da lista mudou;
 * - `docx`: o nome, na pasta, da cópia do `.docx` que a pessoa anexou.
 */
export const ConversaSobre = Schema.Struct({
  conversa: Schema.String,
  nova: Schema.Boolean,
  ppc: Schema.NullOr(
    Schema.Struct({ arquivo: Schema.String, instrucao: Schema.String, atualizadoEm: Schema.NullOr(Schema.String) }),
  ),
  docx: Schema.NullOr(Schema.String),
});
export type ConversaSobre = typeof ConversaSobre.Type;

/** Dias sem uso que uma lista viva fica guardada (com o texto do PPC e os motivos) antes de sair sozinha. */
export const DIAS_LISTA = 30;

export class GrupoRevisaoPpc extends RpcGroup.make(
  /**
   * Revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3): conversão, pré-conferência das fichas D
   * e cópia comentada do DOCX, com uma lista viva nova. `arquivo` é o caminho absoluto liberado pelo
   * desktop (`escolherDocx` ou `soltarDocx`); `cnct` (slug) e `forma` substituem o curso identificado
   * no documento ("Qual é o curso?": a lista nova substitui a anterior). Em stream: as etapas, quando
   * cada uma começa, e por último o `pronto`, com o id da lista viva.
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
  /**
   * A leitura com IA da lista, pausada (no limite da assinatura, por exemplo), continua com outra IA: só os
   * blocos que faltam vão a ela, e cada pendência nova diz que IA a julgou.
   */
  Rpc.make("revisaoPpc.continuarIaCom", {
    payload: Schema.Struct({ lista: Schema.String, provider: Provider }),
    success: EstadoRevisaoIa,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito]),
  }),
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
  /**
   * A ficha do critério `id` na revisão `lista`, para o painel de leitura: o texto vem das fichas da
   * revisão no `kb.sqlite`, e o "Neste PPC", da lista. Lista que não existe ou critério que a base não
   * tem: `FalhaRevisaoPpc`.
   */
  Rpc.make("revisaoPpc.criterio", {
    payload: Schema.Struct({ lista: Schema.String, id: Schema.String }),
    success: FichaCriterio,
    error: FalhaRevisaoPpc,
  }),
  /**
   * "Acompanhar no Word": sem `arquivo`, a cópia comentada (regravada se a lista mudou, como em
   * `gerarCopia`) passa a ser o arquivo acompanhado; com `arquivo`, o `.docx` que a pessoa escolheu (ou
   * escolheu de novo, depois de fechar o app), liberado pelo desktop. Se a revisão já acompanha um
   * arquivo, só confere que ele está liberado (`escolherDeNovo` se não está). A lista que volta traz o
   * `arquivoAcompanhado`, que "Abrir no Word" passa a abrir.
   */
  Rpc.make("revisaoPpc.acompanhar", {
    payload: Schema.Struct({ lista: Schema.String, arquivo: Schema.optionalKey(Schema.String) }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /**
   * A lista agora e a cada mudança, e, enquanto o fluxo está aberto, o vigia do arquivo acompanhado: cada
   * salvamento é conferido sem IA (`conferido` ou `falhou`). Ao abrir, confere o arquivo se ele mudou
   * desde a última conferência. Termina quando a lista sai.
   */
  Rpc.make("revisaoPpc.acompanharLista", {
    payload: EntradaLista,
    success: EventoAcompanhamento,
    error: FalhaRevisaoPpc,
    stream: true,
  }),
  /**
   * Confere o arquivo acompanhado agora, se ele mudou desde a última conferência (a janela ganhou foco:
   * numa pasta do OneDrive ou de rede, o vigia pode não ver o salvamento). O resultado chega pelo
   * `acompanharLista`.
   */
  Rpc.make("revisaoPpc.conferirAcompanhado", { payload: EntradaLista }),
  /**
   * Uma conversa ao lado da revisão, antes de cada mensagem dela. `conversa`: retoma essa (uma das ligadas à
   * lista, ou uma conversa da cadeia de continuações de uma delas). Sem ela, `pendencia` retoma a conversa
   * nascida dessa pendência, se há, ou abre uma nova ligada a ela, mesmo que a pendência tenha mudado de chave
   * (o salvamento lhe deu outro trecho); sem as duas, abre uma conversa geral nova. A nova tem a pasta própria
   * ("PPC <curso> – <tema>": o critério da pendência; sem ela na lista, o `tema` que a interface mandou; senão,
   * "conversa") e é livre, com a origem na revisão e a IA pedida. Com `ppc`, grava (ou regrava, se o texto da lista mudou) o Markdown do PPC com o sumário de
   * seções e linhas, e a nota com o caminho do `.docx`; com `docx`, a cópia do `.docx` (o acompanhado ou o
   * revisado, liberado pelo desktop). Só entra na pasta o que a ficha ainda pede. `chave`: a pendência em
   * foco, por cuja seção a instrução de leitura manda começar.
   */
  Rpc.make("revisaoPpc.conversarSobre", {
    payload: Schema.Struct({
      lista: Schema.String,
      conversa: Schema.optionalKey(Schema.String),
      pendencia: Schema.optionalKey(Schema.String),
      tema: Schema.optionalKey(Schema.String),
      chave: Schema.optionalKey(Schema.String),
      provider: Provider,
      modelo: Schema.optionalKey(Schema.String),
      esforco: Schema.optionalKey(NivelEsforco),
      ppc: Schema.Boolean,
      docx: Schema.Boolean,
    }),
    success: ConversaSobre,
    error: Schema.Union([FalhaRevisaoPpc, AvisoNaoAceito, FalhaProvider, FalhaPasta]),
  }),
) {}
