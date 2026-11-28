/**
 * Persistência unificada da revisão de PPC no banco das conversas (`Banco.ts`): as listas vivas de
 * pendências (`revisao_ppc_listas_pendencias`, `revisao_ppc_pendencias_vivas`, `revisao_ppc_eventos_pendencia`, `revisao_ppc_acoes_ia`) e as revisões
 * com IA (`revisao_ppc_revisoes_ia`, `revisao_ppc_blocos_ia`, `revisao_ppc_tentativas_ia`).
 *
 * Os JSONs são do próprio servidor, gravados e lidos pelos schemas do contrato; uma falha do banco ou um
 * JSON fora de forma é defeito, como no `Historico`. Três colunas ficam de fora da decodificação por
 * schema: `resultados_ia` (`EntradaIa`), `plano` (`PlanoRevisaoIa`) e o resultado de bloco
 * (`ResultadoBloco`), cujos tipos são TypeScript puros; aqui só se confere que são JSON.
 *
 * A serialização de escritas que leem e regravam uma lista (`comTravaDaLista`) é por lista: listas
 * diferentes nunca bloqueiam umas às outras durante chamadas longas ao Worker.
 *
 * Toda escrita numa lista avisa o id dela em `assinarMudancas` (o fluxo `revisaoPpc.acompanharLista`),
 * depois de gravada: a leitura com IA, as ações e a conferência ao salvar escrevem por aqui.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { type Provider } from "@simplifica-if/contratos-app";
import {
  type AcaoPendencia,
  EstimativaRevisaoIa,
  type EventoPendencia,
  type ModoRevisaoIa,
  PendenciaRevisao,
  ResultadoRevisaoPpc,
  type SituacaoPendencia,
  type SituacaoRevisaoIa,
  SugestaoTexto,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { EntradaIa } from "@simplifica-if/ppc/revisao-previa";
import { descarregar } from "../../../persistencia/Banco.ts";

/** "Qual é o curso?" numa lista com a conferência com IA em andamento (a lista seria substituída). */
export class RevisaoEmAndamento extends Schema.TaggedError<RevisaoEmAndamento>()("RevisaoEmAndamento", {
  arquivo: Schema.String,
}) {
  override get message(): string {
    return "A conferência com IA desta revisão está em andamento. Pause-a antes de trocar o curso.";
  }
}

const ehRevisaoEmAndamento = Schema.is(RevisaoEmAndamento);

export interface RegistroLista {
  readonly id: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly revisao: string | null;
  readonly provider: Provider | null;
  readonly modelo: string | null;
  readonly cnct: string | null;
  readonly forma: string | null;
  /** O PPC convertido, sem as linhas de texto dirigido a IA (o que as ações com IA recebem). */
  readonly markdown: string;
  readonly linhasTextoParaIa: readonly number[];
  readonly resultado: ResultadoRevisaoPpc;
  /** Os resultados conferidos da leitura com IA (com o que ficou de fora e se ela terminou), ou nulo. */
  readonly resultadosIa: EntradaIa | null;
  /** Sobe a cada mudança nas pendências. */
  readonly versao: number;
  /** A versão que a cópia comentada reflete; nula se nenhuma (a lista herdou situações de outra). */
  readonly versaoCopia: number | null;
  /** O `.docx` que a revisão acompanha no Word (a conferência ao salvar), ou nulo. */
  readonly arquivoAcompanhado: string | null;
  /** O sha256 do acompanhado na última conferência; nulo se ele ainda não foi conferido. */
  readonly sha256Conferido: string | null;
  /**
   * As pendências e os critérios do código vêm de uma conferência ao salvar, e não do texto revisado
   * (`markdown`): a mesclagem da IA e a cópia comentada, que montam sobre o texto revisado, não os refazem.
   * Não volta atrás ao trocar o acompanhado; volta a falso só quando o texto da lista muda ("Enviar a versão
   * corrigida") ou a lista é refeita ("Qual é o curso?").
   */
  readonly codigoConferido: boolean;
  /** A conversa ao lado da revisão e a pasta dela, ou nulo antes da primeira mensagem. */
  readonly conversa: { readonly id: string; readonly pasta: string } | null;
  /**
   * O texto (sem as linhas de texto dirigido a IA) do último arquivo conferido ao salvar, que a pasta da
   * conversa ao lado recebe; nulo sem conferência ou depois de "Enviar a versão corrigida".
   */
  readonly markdownConferido: string | null;
  readonly criadaEm: string;
  readonly atualizadaEm: string;
}

export interface RegistroPendencia {
  readonly chave: string;
  readonly ordem: number;
  readonly pendencia: PendenciaRevisao;
  readonly situacao: SituacaoPendencia;
  readonly resolvidaPor: "pessoa" | "revisarDeNovo" | null;
  readonly sugestao: SugestaoTexto | null;
  /** A IA que julgou a pendência da leitura com IA; nula nas do código e nas de antes da migração 5. */
  readonly ia: Provider | null;
}

export type NovaLista = Omit<
  RegistroLista,
  | "criadaEm"
  | "atualizadaEm"
  | "versao"
  | "versaoCopia"
  | "arquivoAcompanhado"
  | "sha256Conferido"
  | "codigoConferido"
  | "conversa"
  | "markdownConferido"
>;

/** O que a mesclagem de um bloco da leitura com IA muda na lista (a mesma lista, nunca uma nova). */
export interface MesclagemIa {
  readonly resultado: ResultadoRevisaoPpc;
  readonly resultadosIa: EntradaIa;
  readonly revisao: string;
  readonly provider: Provider;
  readonly modelo: string | null;
}

/** O arquivo de uma lista, trocado por "Enviar a versão corrigida", com o resultado da cópia gravada dele. */
export type ArquivoLista = Pick<
  RegistroLista,
  "arquivo" | "sha256" | "markdown" | "linhasTextoParaIa" | "cnct" | "forma" | "resultado"
>;

/**
 * O que "Enviar a versão corrigida" muda numa pendência: a situação (com o evento) e, quando o arquivo
 * novo aponta o mesmo ponto com outro texto, a pendência como ele a aponta, com a chave nova.
 */
export interface MudancaPendencia {
  readonly chave: string;
  readonly nova?: { readonly chave: string; readonly pendencia: PendenciaRevisao };
  readonly situacao: SituacaoPendencia;
  readonly resolvidaPor: "pessoa" | "revisarDeNovo" | null;
  readonly evento: Evento | null;
}

export interface Evento {
  readonly acao: AcaoPendencia;
  readonly situacao: SituacaoPendencia;
  readonly texto: string;
  readonly motivo?: string | null;
  readonly uso?: UsoRevisaoIa | null;
}

export interface AcaoIaGravada {
  readonly acao: AcaoPendencia;
  readonly numero: number;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
  readonly ferramentas: ReadonlyArray<string>;
}

export interface RegistroRevisaoIa<Plano = unknown> {
  readonly id: string;
  /** A lista viva de onde a leitura nasceu; nula se a lista saiu (apagada, expirada ou substituída). */
  readonly lista: string | null;
  /** O arquivo e o conteúdo da lista quando a leitura foi preparada. */
  readonly arquivo: string;
  readonly sha256: string;
  readonly provider: Provider;
  readonly modelo: string | null;
  readonly modo: ModoRevisaoIa;
  readonly situacao: SituacaoRevisaoIa;
  readonly motivo: string | null;
  readonly limite: boolean;
  readonly plano: Plano;
  readonly estimativa: EstimativaRevisaoIa;
  readonly resultado: ResultadoRevisaoPpc | null;
  readonly criadaEm: string;
  readonly atualizadaEm: string;
}

export interface RegistroBlocoIa<Resultado = unknown> {
  readonly bloco: string;
  readonly resultado: Resultado;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
  /** A IA que leu o bloco; nula nos blocos de antes da migração 5 (a IA era a da revisão). */
  readonly provider: Provider | null;
}

export interface TentativaGravada {
  readonly numero: number;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
  readonly ferramentas: ReadonlyArray<string>;
}

/** Os problemas da conferência de uma resposta, por ficha (ou `*`): só texto do app. */
export type ProblemasDaConferencia = Readonly<Record<string, ReadonlyArray<string>>>;

export type NovaRevisaoIa = Omit<RegistroRevisaoIa, "criadaEm" | "atualizadaEm" | "resultado" | "limite" | "motivo">;

export interface AlteracaoRevisaoIa {
  readonly situacao: SituacaoRevisaoIa;
  readonly motivo?: string | null;
  readonly limite?: boolean;
  readonly resultado?: ResultadoRevisaoPpc;
}

/** Caminhos de `.docx` das revisões ainda gravadas no banco, separados por papel (originais vs acompanhados/cópias). */
export interface CaminhosEmRevisao {
  readonly originais: ReadonlyArray<string>;
  readonly acompanhados: ReadonlyArray<string>;
}

export class RevisoesPpc extends Context.Service<
  RevisoesPpc,
  {
    /**
     * Serializa operações compostas sobre a mesma lista (não reentrante para o mesmo `id`). Listas
     * diferentes correm em paralelo.
     */
    readonly comTravaDaLista: <A, E, R>(id: string, efeito: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** O id de cada lista escrita (ou apagada) daqui em diante, até o escopo fechar. */
    readonly assinarMudancas: Effect.Effect<PubSub.Subscription<string>, never, Scope.Scope>;

    /* ------------------------------------------------------------ listas */

    /**
     * Cria a lista. Cada revisão é independente: a lista nova não herda nada de outra do mesmo arquivo.
     * Só com `substitui` (a mesma revisão refeita, como em "Qual é o curso?") a situação, o histórico e a
     * sugestão das pendências de mesma chave, a leitura com IA, o uso das ações e o arquivo acompanhado
     * (sem a última conferência: o vigia o confere de novo com o curso novo) passam daquela lista, que
     * sai. Recusa com `RevisaoEmAndamento` se a lista a substituir tiver leitura com IA em andamento.
     */
    readonly criarLista: (
      lista: NovaLista,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      substitui?: string,
    ) => Effect.Effect<void, RevisaoEmAndamento>;
    readonly buscarLista: (id: string) => Effect.Effect<RegistroLista | null>;
    /** Liga a lista à leitura com IA que começou (ou que retoma). */
    readonly ligarRevisao: (
      id: string,
      revisao: string,
      provider: Provider,
      modelo: string | null,
    ) => Effect.Effect<void>;
    /**
     * Os resultados da IA mesclados na mesma lista, numa transação: o resultado e os resultados da IA
     * novos, e as pendências que ainda não estavam nela, abertas (as que estavam ficam como a pessoa as
     * deixou). A cópia comentada deixa de estar em dia.
     */
    readonly mesclarIa: (
      id: string,
      mesclagem: MesclagemIa,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao; ia: Provider | null }>,
      /** Chaves da IA de uma leitura anterior que não existem mais no resultado recalculado. */
      obsoletas?: ReadonlyArray<string>,
    ) => Effect.Effect<void>;
    /** Todas as listas, da mais recente para a mais antiga. */
    readonly todasListas: Effect.Effect<ReadonlyArray<string>>;
    /** Os caminhos de `.docx` das revisões ativas no banco (para autorizar sem pedir de novo após reiniciar). */
    readonly caminhosEmRevisao: () => Effect.Effect<CaminhosEmRevisao>;
    readonly pendencias: (id: string) => Effect.Effect<ReadonlyArray<RegistroPendencia>>;
    readonly eventos: (id: string) => Effect.Effect<ReadonlyArray<EventoPendencia & { chave: string }>>;
    readonly mudarPendencia: (
      id: string,
      chave: string,
      mudanca: {
        situacao: SituacaoPendencia;
        resolvidaPor?: "pessoa" | "revisarDeNovo" | null;
        sugestao?: SugestaoTexto;
      },
      evento: Evento,
    ) => Effect.Effect<void>;
    /**
     * "Enviar a versão corrigida", numa transação: as mudanças nas pendências, as novas (abertas, com o
     * evento `textoNovas`), onde cada pendência ficou na nova cópia comentada (`noDocumento`) e a lista
     * passando ao arquivo novo, com a cópia comentada dele em dia.
     */
    readonly aplicarArquivoNovo: (
      id: string,
      mudancas: ReadonlyArray<MudancaPendencia>,
      novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      textoNovas: string,
      arquivo: ArquivoLista,
      noDocumento?: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
    ) => Effect.Effect<void>;
    /** Passa a acompanhar `arquivo` no Word, com o sha256 da última conferência (nulo: conferir na próxima vez). */
    readonly acompanhar: (id: string, arquivo: string, sha256Conferido: string | null) => Effect.Effect<void>;
    /**
     * A conferência ao salvar, numa transação: as mudanças nas pendências e as novas (abertas, com o evento
     * `textoNovas`), como em `aplicarArquivoNovo`, o resultado com a régua do código do arquivo salvo e o
     * sha256 conferido (e `codigoConferido`), sem trocar o arquivo da lista nem a versão da cópia comentada.
     */
    readonly aplicarConferencia: (
      id: string,
      mudancas: ReadonlyArray<MudancaPendencia>,
      novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      textoNovas: string,
      resultado: ResultadoRevisaoPpc,
      sha256Conferido: string,
      /** O texto do arquivo conferido, sem as linhas de texto dirigido a IA (`markdownConferido`). */
      markdownConferido: string,
    ) => Effect.Effect<void>;
    /** Liga a lista à conversa ao lado que ela abriu (a pasta é a da conversa). */
    readonly ligarConversa: (id: string, conversa: string, pasta: string) => Effect.Effect<void>;
    /** As conversas ao lado ligadas a alguma lista (os ids). */
    readonly conversasLigadas: Effect.Effect<ReadonlyArray<string>>;
    /** Desliga das listas a conversa ao lado `conversa` (apagada): a próxima mensagem abre outra. */
    readonly desligarConversa: (conversa: string) => Effect.Effect<void>;
    /**
     * O resultado da cópia comentada regravada, que reflete a `versaoCopia` da lista, e onde cada
     * pendência ficou no documento (`noDocumento`, pela chave), numa transação.
     */
    readonly trocarResultado: (
      id: string,
      resultado: ResultadoRevisaoPpc,
      versaoCopia: number,
      noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
    ) => Effect.Effect<void>;
    /** Grava o uso de uma ação com IA; sem efeito se a lista foi apagada enquanto a ação rodava. */
    readonly gravarAcao: (id: string, chave: string, acao: AcaoIaGravada) => Effect.Effect<void>;
    readonly usoLista: (id: string) => Effect.Effect<UsoRevisaoIa>;
    readonly apagarLista: (id: string) => Effect.Effect<void>;
    /** Acrescenta pendências novas (a triagem do arquivo da nova revisão), abertas, com o evento; sem efeito se a lista sumiu. */
    readonly acrescentarPendencias: (
      id: string,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      texto: string,
    ) => Effect.Effect<void>;
    /** Apaga as listas sem uso desde `antesDe` (ISO), com o texto do PPC e os motivos. */
    readonly expirarListas: (antesDe: string) => Effect.Effect<number>;
    /** As contestações registradas, de todas as listas, com a pendência e o arquivo. */
    readonly contestacoes: Effect.Effect<
      ReadonlyArray<{ arquivo: string; em: string; motivo: string | null; texto: string; pendencia: PendenciaRevisao }>
    >;

    /* ------------------------------------------------------------ revisões com IA */

    readonly criarRevisao: (revisao: NovaRevisaoIa) => Effect.Effect<void>;
    readonly buscarRevisao: (id: string) => Effect.Effect<RegistroRevisaoIa | null>;
    /** A revisão sem o plano (que pode ter centenas de KB): o estado a cada mudança lê só esta linha. */
    readonly resumoRevisao: (id: string) => Effect.Effect<RegistroRevisaoIa<null> | null>;
    /** Da mais recente para a mais antiga, sem o plano (que pode ser grande). */
    readonly listarRevisoes: Effect.Effect<ReadonlyArray<RegistroRevisaoIa<null>>>;
    readonly alterarRevisao: (id: string, alteracao: AlteracaoRevisaoIa) => Effect.Effect<void>;
    /** A leitura passa a outra IA (a pausada no limite da assinatura continua com ela). */
    readonly trocarIa: (id: string, provider: Provider, modelo: string | null) => Effect.Effect<void>;
    /**
     * Pausa a revisão somente se ainda estiver `em_andamento` no banco: não sobrescreve `concluida` nem
     * `falhou` numa corrida com o fim da execução.
     */
    readonly pausarRevisaoSeEmAndamento: (id: string, motivo: string) => Effect.Effect<void>;
    readonly gravarBloco: (revisao: string, bloco: RegistroBlocoIa) => Effect.Effect<void>;
    readonly blocos: (revisao: string) => Effect.Effect<ReadonlyArray<RegistroBlocoIa>>;
    /** As revisões que o banco dá como em andamento, de uma execução anterior do servidor. */
    readonly revisoesEmAndamento: Effect.Effect<ReadonlyArray<string>>;
    /** Grava o uso de uma tentativa (mesmo sem o bloco terminar). */
    readonly gravarTentativa: (revisao: string, bloco: string, tentativa: TentativaGravada) => Effect.Effect<void>;
    /**
     * O que a conferência recusou na resposta de uma tentativa já gravada (`{}`: passou), por ficha ou
     * `*` para a resposta inteira.
     */
    readonly gravarProblemas: (
      revisao: string,
      bloco: string,
      numero: number,
      problemas: ProblemasDaConferencia,
    ) => Effect.Effect<void>;
    /** O uso somado de todas as tentativas da revisão e das ações com IA da lista viva dela. */
    readonly usoTotalRevisao: (revisao: string) => Effect.Effect<UsoRevisaoIa>;
    /** Apaga a revisão, o plano (com o texto do PPC), os blocos e as tentativas. */
    readonly apagarRevisao: (id: string) => Effect.Effect<void>;
    /** As revisões de uma lista, em qualquer situação. */
    readonly revisoesDaLista: (
      lista: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly id: string; readonly situacao: SituacaoRevisaoIa }>>;
    /**
     * As revisões que não estão `em_andamento` e cuja lista saiu (apagada, expirou ou foi substituída), e
     * as que nenhuma lista referencia mais e não estão `preparada` (uma leitura nova da mesma lista tomou
     * o lugar dela): o resultado já está (ou estava) na lista.
     */
    readonly revisoesOrfas: Effect.Effect<ReadonlyArray<string>>;
    /** Apaga as revisões `preparada` (nunca iniciadas) criadas antes de `antesDe` (ISO). */
    readonly expirarRevisoesPreparadas: (antesDe: string) => Effect.Effect<number>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/persistencia/RevisoesPpc") {}

const NumerosJson = Schema.fromJsonString(Schema.Array(Schema.Number));
const ResultadoJson = Schema.fromJsonString(ResultadoRevisaoPpc);
const PendenciaJson = Schema.fromJsonString(PendenciaRevisao);
const SugestaoJson = Schema.fromJsonString(SugestaoTexto);
const UsoJson = Schema.fromJsonString(UsoRevisaoIa);
const FerramentasJson = Schema.fromJsonString(Schema.Array(Schema.String));
const ProblemasJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(Schema.String)));
const EstimativaJson = Schema.fromJsonString(EstimativaRevisaoIa);
/** Os resultados da IA, o plano e o resultado de um bloco, lidos com os tipos de quem os gravou. */
const DesconhecidoJson = Schema.fromJsonString(Schema.Unknown);

const LinhaLista = Schema.Struct({
  id: Schema.String,
  arquivo: Schema.String,
  sha256: Schema.String,
  revisao_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  modelo: Schema.NullOr(Schema.String),
  cnct: Schema.NullOr(Schema.String),
  forma: Schema.NullOr(Schema.String),
  markdown: Schema.String,
  linhas_texto_ia: NumerosJson,
  resultado: ResultadoJson,
  resultados_ia: Schema.NullOr(DesconhecidoJson),
  versao: Schema.Number,
  versao_copia: Schema.NullOr(Schema.Number),
  arquivo_acompanhado: Schema.NullOr(Schema.String),
  sha256_conferido: Schema.NullOr(Schema.String),
  codigo_conferido: Schema.Number,
  conversa_id: Schema.NullOr(Schema.String),
  conversa_pasta: Schema.NullOr(Schema.String),
  markdown_conferido: Schema.NullOr(Schema.String),
  criada_em: Schema.String,
  atualizada_em: Schema.String,
});

const LinhaPendencia = Schema.Struct({
  chave: Schema.String,
  ordem: Schema.Number,
  pendencia: PendenciaJson,
  situacao: Schema.String,
  resolvida_por: Schema.NullOr(Schema.String),
  sugestao: Schema.NullOr(SugestaoJson),
  ia: Schema.NullOr(Schema.String),
});

const LinhaEvento = Schema.Struct({
  chave: Schema.String,
  em: Schema.String,
  acao: Schema.String,
  situacao: Schema.String,
  texto: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  uso: Schema.NullOr(UsoJson),
});

const LinhaContestacao = Schema.Struct({
  arquivo: Schema.String,
  em: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  texto: Schema.String,
  pendencia: PendenciaJson,
});

const LinhaRevisao = Schema.Struct({
  id: Schema.String,
  lista_id: Schema.NullOr(Schema.String),
  arquivo: Schema.String,
  sha256: Schema.String,
  provider: Schema.String,
  modelo: Schema.NullOr(Schema.String),
  modo: Schema.String,
  situacao: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  limite: Schema.Number,
  plano: Schema.NullOr(DesconhecidoJson),
  estimativa: EstimativaJson,
  resultado: Schema.NullOr(ResultadoJson),
  criada_em: Schema.String,
  atualizada_em: Schema.String,
});

const LinhaBloco = Schema.Struct({
  bloco_id: Schema.String,
  resultado: DesconhecidoJson,
  uso: UsoJson,
  segundos: Schema.Number,
  provider: Schema.NullOr(Schema.String),
});

const lerLinhasLista = Schema.decodeUnknownEffect(Schema.Array(LinhaLista));
const lerPendencias = Schema.decodeUnknownEffect(Schema.Array(LinhaPendencia));
const lerEventos = Schema.decodeUnknownEffect(Schema.Array(LinhaEvento));
const lerContestacoes = Schema.decodeUnknownEffect(Schema.Array(LinhaContestacao));
const lerLinhasRevisao = Schema.decodeUnknownEffect(Schema.Array(LinhaRevisao));
const lerBlocos = Schema.decodeUnknownEffect(Schema.Array(LinhaBloco));
const lerUsos = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ uso: UsoJson })));

const codificarNumeros = Schema.encodeEffect(NumerosJson);
const codificarResultado = Schema.encodeEffect(ResultadoJson);
const codificarPendencia = Schema.encodeEffect(PendenciaJson);
const codificarSugestao = Schema.encodeEffect(SugestaoJson);
const codificarUso = Schema.encodeEffect(UsoJson);
const codificarFerramentas = Schema.encodeEffect(FerramentasJson);
const codificarProblemas = Schema.encodeEffect(ProblemasJson);
const codificarEstimativa = Schema.encodeEffect(EstimativaJson);
const codificarDesconhecido = Schema.encodeEffect(DesconhecidoJson);

const paraRegistroRevisao = (linha: typeof LinhaRevisao.Type): RegistroRevisaoIa => ({
  id: linha.id,
  lista: linha.lista_id,
  arquivo: linha.arquivo,
  sha256: linha.sha256,
  provider: linha.provider as Provider,
  modelo: linha.modelo,
  modo: linha.modo as ModoRevisaoIa,
  situacao: linha.situacao as SituacaoRevisaoIa,
  motivo: linha.motivo,
  limite: linha.limite === 1,
  plano: linha.plano,
  estimativa: linha.estimativa,
  resultado: linha.resultado,
  criadaEm: linha.criada_em,
  atualizadaEm: linha.atualizada_em,
});

const somarUsos = (linhas: ReadonlyArray<{ readonly uso: UsoRevisaoIa }>): UsoRevisaoIa => {
  const total = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 };
  for (const l of linhas) {
    const u = l.uso;
    for (const k of Object.keys(total) as (keyof UsoRevisaoIa)[]) total[k] += u[k];
  }
  return total as UsoRevisaoIa;
};

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const travas = new Map<string, { readonly semaforo: Semaphore.Semaphore; ativos: number }>();
  const mudancas = yield* PubSub.unbounded<string>();
  /** Avisa quem acompanha a lista, depois da escrita. */
  const avisar = (id: string) => PubSub.publish(mudancas, id).pipe(Effect.asVoid);

  const comTravaDaLista = <A, E, R>(id: string, efeito: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      let entrada = travas.get(id);
      if (entrada === undefined) {
        entrada = { semaforo: Semaphore.makeUnsafe(1), ativos: 0 };
        travas.set(id, entrada);
      }
      entrada.ativos += 1;
      const atual = entrada;
      return atual.semaforo
        .withPermits(1)(efeito)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              atual.ativos -= 1;
              if (atual.ativos === 0 && travas.get(id) === atual) travas.delete(id);
            }),
          ),
        );
    });

  /** Uma mudança nas pendências: a cópia comentada deixa de estar em dia. */
  const tocar = (id: string, data: string) =>
    sql`UPDATE revisao_ppc_listas_pendencias SET atualizada_em = ${data}, versao = versao + 1 WHERE id = ${id}`;

  /* ------------------------------------------------------------ listas */

  const criarLista = Effect.fn("RevisoesPpc.criarLista")(function* (
    l: NovaLista,
    pendenciasLista: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    substitui?: string,
  ) {
    const data = yield* agora;
    const linhasTextoIa = yield* codificarNumeros(l.linhasTextoParaIa).pipe(Effect.orDie);
    const resultadoJson = yield* codificarResultado(l.resultado).pipe(Effect.orDie);
    const resultadosIaJson =
      l.resultadosIa === null ? null : yield* codificarDesconhecido(l.resultadosIa).pipe(Effect.orDie);
    const pendenciasCodificadas = yield* Effect.forEach(pendenciasLista, (p) =>
      codificarPendencia(p.pendencia).pipe(Effect.map((json) => ({ chave: p.chave, json }))),
    ).pipe(Effect.orDie);

    const anterior = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // A lista substituída não pode ter leitura com IA em andamento (a leitura ligada a uma lista é
          // sempre dela: nasce nela e passa à lista que a substitui), conferido na mesma transação.
          const ant =
            substitui === undefined
              ? undefined
              : (yield* sql<{ id: string }>`SELECT id FROM revisao_ppc_listas_pendencias WHERE id = ${substitui}`)[0];
          // Substituir uma lista que não existe mais (apagada ou expirada no meio) perderia a herança calado.
          if (substitui !== undefined && !ant)
            return yield* Effect.die(new Error(`criarLista: a lista a substituir não existe (${substitui})`));
          if (ant) {
            const ativa = yield* sql<{ id: string }>`
              SELECT id FROM revisao_ppc_revisoes_ia WHERE situacao = 'em_andamento' AND lista_id = ${ant.id} LIMIT 1
            `;
            if (ativa.length > 0) return yield* new RevisaoEmAndamento({ arquivo: l.arquivo });
          }

          yield* sql`
            INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma, markdown,
              linhas_texto_ia, resultado, resultados_ia, versao, versao_copia, criada_em, atualizada_em)
            VALUES (${l.id}, ${l.arquivo}, ${l.sha256}, ${l.revisao}, ${l.provider}, ${l.modelo}, ${l.cnct}, ${l.forma},
              ${l.markdown}, ${linhasTextoIa}, ${resultadoJson}, ${resultadosIaJson},
              0, ${ant ? null : 0}, ${data}, ${data})
          `;
          let ordem = 0;
          for (const p of pendenciasCodificadas) {
            yield* sql`
              INSERT OR IGNORE INTO revisao_ppc_pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
              VALUES (${l.id}, ${p.chave}, ${ordem++}, ${p.json}, 'aberta', NULL, NULL)
            `;
          }
          if (ant) {
            yield* sql`
              UPDATE revisao_ppc_pendencias_vivas AS nova SET
                situacao = velha.situacao, resolvida_por = velha.resolvida_por, sugestao = velha.sugestao, ia = velha.ia
              FROM revisao_ppc_pendencias_vivas AS velha
              WHERE nova.lista_id = ${l.id} AND velha.lista_id = ${ant.id} AND velha.chave = nova.chave
            `;
            yield* sql`
              INSERT INTO revisao_ppc_eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
              SELECT ${l.id}, e.chave, e.em, e.acao, e.situacao, e.texto, e.motivo, e.uso
              FROM revisao_ppc_eventos_pendencia e JOIN revisao_ppc_pendencias_vivas p ON p.lista_id = ${l.id} AND p.chave = e.chave
              WHERE e.lista_id = ${ant.id}
            `;
            // A leitura com IA que a lista nova leva passa a ela antes de a anterior sair.
            if (l.revisao !== null)
              yield* sql`UPDATE revisao_ppc_revisoes_ia SET lista_id = ${l.id} WHERE id = ${l.revisao}`;
            // O uso das ações continua contado; a lista substituída sai (o texto do PPC e os motivos não
            // ficam guardados em dobro).
            yield* sql`UPDATE revisao_ppc_acoes_ia SET lista_id = ${l.id} WHERE lista_id = ${ant.id}`;
            yield* sql`
              UPDATE revisao_ppc_listas_pendencias AS nova SET
                arquivo_acompanhado = velha.arquivo_acompanhado,
                conversa_id = velha.conversa_id, conversa_pasta = velha.conversa_pasta
              FROM revisao_ppc_listas_pendencias AS velha
              WHERE nova.id = ${l.id} AND velha.id = ${ant.id}
            `;
            yield* sql`DELETE FROM revisao_ppc_listas_pendencias WHERE id = ${ant.id}`;
          }
          return ant;
        }),
      )
      .pipe(Effect.catchIf((e) => !ehRevisaoEmAndamento(e), Effect.die));
    // A lista substituída levava o texto do PPC.
    if (anterior) yield* descarregar(sql).pipe(Effect.orDie);
    yield* avisar(l.id);
    if (anterior) yield* avisar(anterior.id);
  });

  const buscarLista = Effect.fn("RevisoesPpc.buscarLista")(function* (id: string) {
    const l = (yield* lerLinhasLista(yield* sql`SELECT * FROM revisao_ppc_listas_pendencias WHERE id = ${id}`))[0];
    if (!l) return null;
    return {
      id: l.id,
      arquivo: l.arquivo,
      sha256: l.sha256,
      revisao: l.revisao_id,
      provider: l.provider as Provider | null,
      modelo: l.modelo,
      cnct: l.cnct,
      forma: l.forma,
      markdown: l.markdown,
      linhasTextoParaIa: l.linhas_texto_ia,
      resultado: l.resultado,
      resultadosIa: l.resultados_ia as EntradaIa | null,
      versao: l.versao,
      versaoCopia: l.versao_copia,
      arquivoAcompanhado: l.arquivo_acompanhado,
      sha256Conferido: l.sha256_conferido,
      codigoConferido: l.codigo_conferido !== 0,
      conversa:
        l.conversa_id === null || l.conversa_pasta === null ? null : { id: l.conversa_id, pasta: l.conversa_pasta },
      markdownConferido: l.markdown_conferido,
      criadaEm: l.criada_em,
      atualizadaEm: l.atualizada_em,
    } satisfies RegistroLista;
  }, Effect.orDie);

  const ligarRevisao = Effect.fn("RevisoesPpc.ligarRevisao")(function* (
    id: string,
    revisao: string,
    provider: Provider,
    modelo: string | null,
  ) {
    yield* sql`
      UPDATE revisao_ppc_listas_pendencias SET revisao_id = ${revisao}, provider = ${provider}, modelo = ${modelo}
      WHERE id = ${id}
    `;
    yield* avisar(id);
  }, Effect.orDie);

  const todasListas = sql<{
    id: string;
  }>`SELECT id FROM revisao_ppc_listas_pendencias ORDER BY atualizada_em DESC`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const pendencias = Effect.fn("RevisoesPpc.pendencias")(function* (id: string) {
    const linhas = yield* lerPendencias(
      yield* sql`SELECT chave, ordem, pendencia, situacao, resolvida_por, sugestao, ia FROM revisao_ppc_pendencias_vivas WHERE lista_id = ${id} ORDER BY ordem`,
    );
    return linhas.map((l): RegistroPendencia => ({
      chave: l.chave,
      ordem: l.ordem,
      pendencia: l.pendencia,
      situacao: l.situacao as SituacaoPendencia,
      resolvidaPor: l.resolvida_por as RegistroPendencia["resolvidaPor"],
      sugestao: l.sugestao,
      ia: l.ia as Provider | null,
    }));
  }, Effect.orDie);

  const eventos = Effect.fn("RevisoesPpc.eventos")(function* (id: string) {
    const linhas = yield* lerEventos(
      yield* sql`SELECT chave, em, acao, situacao, texto, motivo, uso FROM revisao_ppc_eventos_pendencia WHERE lista_id = ${id} ORDER BY em, rowid`,
    );
    return linhas.map((l) => ({
      chave: l.chave,
      em: l.em,
      acao: l.acao as AcaoPendencia,
      situacao: l.situacao as SituacaoPendencia,
      texto: l.texto,
      motivo: l.motivo,
      uso: l.uso,
    }));
  }, Effect.orDie);

  const mudarPendencia = Effect.fn("RevisoesPpc.mudarPendencia")(function* (
    id: string,
    chave: string,
    m: { situacao: SituacaoPendencia; resolvidaPor?: "pessoa" | "revisarDeNovo" | null; sugestao?: SugestaoTexto },
    e: Evento,
  ) {
    const data = yield* agora;
    const sugestao = m.sugestao === undefined ? null : yield* codificarSugestao(m.sugestao);
    const usoEvento = e.uso ? yield* codificarUso(e.uso) : null;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          UPDATE revisao_ppc_pendencias_vivas SET
            situacao = ${m.situacao},
            resolvida_por = ${m.situacao === "resolvida" ? (m.resolvidaPor ?? "pessoa") : null},
            sugestao = COALESCE(${sugestao}, sugestao)
          WHERE lista_id = ${id} AND chave = ${chave}
        `;
        // A lista pode ter sido apagada enquanto a ação com IA rodava: nada se grava nela.
        yield* sql`
          INSERT INTO revisao_ppc_eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
          SELECT ${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null}, ${usoEvento}
          WHERE EXISTS (SELECT 1 FROM revisao_ppc_listas_pendencias WHERE id = ${id})
        `;
        yield* tocar(id, data);
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  /** Insere as pendências novas, abertas, depois da última, cada uma com o evento. */
  const inserirNovas = Effect.fn("RevisoesPpc.inserirNovas")(function* (
    id: string,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    texto: string,
    data: string,
  ) {
    const maior =
      (yield* sql<{
        m: number | null;
      }>`SELECT MAX(ordem) AS m FROM revisao_ppc_pendencias_vivas WHERE lista_id = ${id}`)[0]?.m ?? 0;
    let ordem = maior + 1;
    for (const p of novas) {
      yield* sql`
        INSERT OR IGNORE INTO revisao_ppc_pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
        VALUES (${id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL)
      `;
      yield* sql`
        INSERT INTO revisao_ppc_eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
        VALUES (${id}, ${p.chave}, ${data}, 'revisarDeNovo', 'aberta', ${texto}, NULL, NULL)
      `;
    }
  });

  /** Atualiza `noDocumento` de cada pendência conforme a cópia comentada gravada. */
  const atualizarLocais = Effect.fn("RevisoesPpc.atualizarLocais")(function* (
    id: string,
    noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    for (const p of yield* pendencias(id)) {
      const local = noDocumento.get(p.chave);
      if (local === undefined || local === p.pendencia.noDocumento) continue;
      yield* sql`
        UPDATE revisao_ppc_pendencias_vivas SET pendencia = ${yield* codificarPendencia({ ...p.pendencia, noDocumento: local })}
        WHERE lista_id = ${id} AND chave = ${p.chave}
      `;
    }
  });

  /**
   * As mudanças de "Enviar a versão corrigida" e da conferência ao salvar nas pendências: a situação, o
   * evento e, quando o arquivo novo aponta o mesmo ponto com outro texto, a chave nova. Dentro da transação
   * de quem chama.
   */
  const aplicarMudancas = Effect.fn("RevisoesPpc.aplicarMudancas")(function* (
    id: string,
    mudancasPendencias: ReadonlyArray<MudancaPendencia>,
    data: string,
  ) {
    for (const m of mudancasPendencias) {
      let chave = m.chave;
      if (m.nova !== undefined) {
        // O mesmo ponto com outro texto: a pendência, o histórico e o uso passam à chave nova.
        yield* sql`
          UPDATE revisao_ppc_pendencias_vivas SET chave = ${m.nova.chave}, pendencia = ${yield* codificarPendencia(m.nova.pendencia)}
          WHERE lista_id = ${id} AND chave = ${chave}
        `;
        yield* sql`UPDATE revisao_ppc_eventos_pendencia SET chave = ${m.nova.chave} WHERE lista_id = ${id} AND chave = ${chave}`;
        yield* sql`UPDATE revisao_ppc_acoes_ia SET chave = ${m.nova.chave} WHERE lista_id = ${id} AND chave = ${chave}`;
        chave = m.nova.chave;
      }
      yield* sql`
        UPDATE revisao_ppc_pendencias_vivas SET situacao = ${m.situacao}, resolvida_por = ${m.situacao === "resolvida" ? m.resolvidaPor : null}
        WHERE lista_id = ${id} AND chave = ${chave}
      `;
      if (m.evento !== null) {
        const e = m.evento;
        yield* sql`
          INSERT INTO revisao_ppc_eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
          VALUES (${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null},
            ${e.uso ? yield* codificarUso(e.uso) : null})
        `;
      }
    }
  });

  const aplicarArquivoNovo = Effect.fn("RevisoesPpc.aplicarArquivoNovo")(function* (
    id: string,
    mudancas: ReadonlyArray<MudancaPendencia>,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    textoNovas: string,
    a: ArquivoLista,
    noDocumento?: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* aplicarMudancas(id, mudancas, data);
        yield* inserirNovas(id, novas, textoNovas, data);
        if (noDocumento !== undefined) yield* atualizarLocais(id, noDocumento);
        // A cópia comentada já foi gravada com o estado final: fica em dia. O texto da lista passa a ser o
        // do arquivo novo, com as pendências do código dele. O acompanhado continua só se é o arquivo
        // enviado (já conferido); outro acompanhado conferiria uma versão anterior contra o texto novo.
        yield* sql`
          UPDATE revisao_ppc_listas_pendencias SET arquivo = ${a.arquivo}, sha256 = ${a.sha256}, markdown = ${a.markdown},
            linhas_texto_ia = ${yield* codificarNumeros(a.linhasTextoParaIa)}, cnct = ${a.cnct}, forma = ${a.forma},
            resultado = ${yield* codificarResultado(a.resultado)}, versao = versao + 1, versao_copia = versao + 1,
            sha256_conferido = CASE WHEN arquivo_acompanhado = ${a.arquivo} THEN ${a.sha256} ELSE NULL END,
            arquivo_acompanhado = CASE WHEN arquivo_acompanhado = ${a.arquivo} THEN arquivo_acompanhado ELSE NULL END,
            codigo_conferido = 0, markdown_conferido = NULL, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  const acompanhar = Effect.fn("RevisoesPpc.acompanhar")(function* (
    id: string,
    arquivo: string,
    sha256Conferido: string | null,
  ) {
    yield* sql`
      UPDATE revisao_ppc_listas_pendencias SET arquivo_acompanhado = ${arquivo}, sha256_conferido = ${sha256Conferido}
      WHERE id = ${id}
    `;
    yield* avisar(id);
  }, Effect.orDie);

  const aplicarConferencia = Effect.fn("RevisoesPpc.aplicarConferencia")(function* (
    id: string,
    mudancasPendencias: ReadonlyArray<MudancaPendencia>,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    textoNovas: string,
    resultado: ResultadoRevisaoPpc,
    sha256Conferido: string,
    markdownConferido: string,
  ) {
    const data = yield* agora;
    const resultadoJson = yield* codificarResultado(resultado);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* aplicarMudancas(id, mudancasPendencias, data);
        yield* inserirNovas(id, novas, textoNovas, data);
        yield* sql`
          UPDATE revisao_ppc_listas_pendencias SET resultado = ${resultadoJson}, sha256_conferido = ${sha256Conferido},
            codigo_conferido = 1, markdown_conferido = ${markdownConferido}
          WHERE id = ${id}
        `;
        // A versão sobe só com mudança nas pendências; a da cópia comentada fica (a cópia não é regravada).
        if (mudancasPendencias.length > 0 || novas.length > 0) yield* tocar(id, data);
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  const ligarConversa = Effect.fn("RevisoesPpc.ligarConversa")(function* (id: string, conversa: string, pasta: string) {
    yield* sql`
      UPDATE revisao_ppc_listas_pendencias SET conversa_id = ${conversa}, conversa_pasta = ${pasta} WHERE id = ${id}
    `;
    yield* avisar(id);
  }, Effect.orDie);

  const conversasLigadas = sql<{
    conversa_id: string;
  }>`SELECT DISTINCT conversa_id FROM revisao_ppc_listas_pendencias WHERE conversa_id IS NOT NULL`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.conversa_id)),
    Effect.orDie,
  );

  const desligarConversa = Effect.fn("RevisoesPpc.desligarConversa")(function* (conversa: string) {
    const listas = yield* sql<{ id: string }>`
      SELECT id FROM revisao_ppc_listas_pendencias WHERE conversa_id = ${conversa}
    `;
    yield* sql`
      UPDATE revisao_ppc_listas_pendencias SET conversa_id = NULL, conversa_pasta = NULL
      WHERE conversa_id = ${conversa}
    `;
    for (const lista of listas) yield* avisar(lista.id);
  }, Effect.orDie);

  const mesclarIa = Effect.fn("RevisoesPpc.mesclarIa")(function* (
    id: string,
    m: MesclagemIa,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao; ia: Provider | null }>,
    obsoletas: ReadonlyArray<string> = [],
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(m.resultado);
    const resultadosIa = yield* codificarDesconhecido(m.resultadosIa);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const chave of obsoletas)
          yield* sql`DELETE FROM revisao_ppc_pendencias_vivas WHERE lista_id = ${id} AND chave = ${chave}`;
        const maior =
          (yield* sql<{
            m: number | null;
          }>`SELECT MAX(ordem) AS m FROM revisao_ppc_pendencias_vivas WHERE lista_id = ${id}`)[0]?.m ?? 0;
        let ordem = maior + 1;
        for (const p of novas)
          yield* sql`
            INSERT OR IGNORE INTO revisao_ppc_pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao, ia)
            VALUES (${id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL, ${p.ia})
          `;
        yield* sql`
          UPDATE revisao_ppc_listas_pendencias SET resultado = ${resultado}, resultados_ia = ${resultadosIa},
            revisao_id = ${m.revisao}, provider = ${m.provider}, modelo = ${m.modelo},
            versao = versao + 1, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  const trocarResultado = Effect.fn("RevisoesPpc.trocarResultado")(function* (
    id: string,
    r: ResultadoRevisaoPpc,
    versaoCopia: number,
    noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(r);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* atualizarLocais(id, noDocumento);
        yield* sql`
          UPDATE revisao_ppc_listas_pendencias SET resultado = ${resultado}, versao_copia = ${versaoCopia}, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  const gravarAcao = Effect.fn("RevisoesPpc.gravarAcao")(function* (id: string, chave: string, a: AcaoIaGravada) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisao_ppc_acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
      SELECT ${id}, ${chave}, ${a.acao}, ${a.numero}, ${yield* codificarUso(a.uso)}, ${a.segundos},
        ${yield* codificarFerramentas(a.ferramentas)}, ${data}
      WHERE EXISTS (SELECT 1 FROM revisao_ppc_listas_pendencias WHERE id = ${id})
    `;
    yield* avisar(id);
  }, Effect.orDie);

  const usoLista = Effect.fn("RevisoesPpc.usoLista")(function* (id: string) {
    return somarUsos(yield* lerUsos(yield* sql`SELECT uso FROM revisao_ppc_acoes_ia WHERE lista_id = ${id}`));
  }, Effect.orDie);

  const apagarLista = Effect.fn("RevisoesPpc.apagarLista")(function* (id: string) {
    yield* sql`DELETE FROM revisao_ppc_listas_pendencias WHERE id = ${id}`;
    yield* descarregar(sql);
    yield* avisar(id);
  }, Effect.orDie);

  const acrescentarPendencias = Effect.fn("RevisoesPpc.acrescentarPendencias")(function* (
    id: string,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    texto: string,
  ) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // A lista apagada no meio da nova revisão de uma pendência não ganha pendências.
        const existe = yield* sql<{
          n: number;
        }>`SELECT COUNT(*) AS n FROM revisao_ppc_listas_pendencias WHERE id = ${id}`;
        if ((existe[0]?.n ?? 0) === 0) return;
        yield* inserirNovas(id, novas, texto, data);
        yield* tocar(id, data);
      }),
    );
    yield* avisar(id);
  }, Effect.orDie);

  const expirarListas = Effect.fn("RevisoesPpc.expirarListas")(function* (antesDe: string) {
    const linhas = yield* sql<{
      id: string;
    }>`SELECT id FROM revisao_ppc_listas_pendencias WHERE atualizada_em < ${antesDe}`;
    for (const l of linhas) yield* sql`DELETE FROM revisao_ppc_listas_pendencias WHERE id = ${l.id}`;
    if (linhas.length > 0) yield* descarregar(sql);
    for (const l of linhas) yield* avisar(l.id);
    return linhas.length;
  }, Effect.orDie);

  const contestacoes = sql`
    SELECT l.arquivo, e.em, e.motivo, e.texto, p.pendencia
    FROM revisao_ppc_eventos_pendencia e
    JOIN revisao_ppc_pendencias_vivas p ON p.lista_id = e.lista_id AND p.chave = e.chave
    JOIN revisao_ppc_listas_pendencias l ON l.id = e.lista_id
    WHERE e.acao = 'contestar'
    ORDER BY e.em
  `.pipe(Effect.flatMap(lerContestacoes), Effect.orDie);

  /* ------------------------------------------------------------ revisões com IA */

  const criarRevisao = Effect.fn("RevisoesPpc.criarRevisao")(function* (r: NovaRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisao_ppc_revisoes_ia (id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, plano, estimativa, criada_em, atualizada_em)
      VALUES (${r.id}, ${r.lista}, ${r.arquivo}, ${r.sha256}, ${r.provider}, ${r.modelo}, ${r.modo},
        ${r.situacao}, ${yield* codificarDesconhecido(r.plano)}, ${yield* codificarEstimativa(r.estimativa)}, ${data}, ${data})
    `;
  }, Effect.orDie);

  const buscarRevisao = Effect.fn("RevisoesPpc.buscarRevisao")(function* (id: string) {
    const linhas = yield* lerLinhasRevisao(yield* sql`SELECT * FROM revisao_ppc_revisoes_ia WHERE id = ${id}`);
    return linhas[0] ? paraRegistroRevisao(linhas[0]) : null;
  }, Effect.orDie);

  const resumoRevisao = Effect.fn("RevisoesPpc.resumoRevisao")(function* (id: string) {
    const linhas = yield* lerLinhasRevisao(
      yield* sql`
        SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
          estimativa, resultado, criada_em, atualizada_em
        FROM revisao_ppc_revisoes_ia WHERE id = ${id}
      `,
    );
    return linhas[0] ? (paraRegistroRevisao(linhas[0]) as RegistroRevisaoIa<null>) : null;
  }, Effect.orDie);

  const listarRevisoes = sql`
    SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
      estimativa, NULL AS resultado, criada_em, atualizada_em
    FROM revisao_ppc_revisoes_ia ORDER BY atualizada_em DESC
  `.pipe(
    Effect.flatMap(lerLinhasRevisao),
    Effect.map((linhas) => linhas.map((l) => paraRegistroRevisao(l) as RegistroRevisaoIa<null>)),
    Effect.orDie,
  );

  const alterarRevisao = Effect.fn("RevisoesPpc.alterarRevisao")(function* (id: string, a: AlteracaoRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      UPDATE revisao_ppc_revisoes_ia SET
        situacao = ${a.situacao},
        motivo = ${a.motivo ?? null},
        limite = ${a.limite === true ? 1 : 0},
        resultado = COALESCE(${a.resultado === undefined ? null : yield* codificarResultado(a.resultado)}, resultado),
        atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const trocarIa = Effect.fn("RevisoesPpc.trocarIa")(function* (id: string, provider: Provider, modelo: string | null) {
    const data = yield* agora;
    yield* sql`
      UPDATE revisao_ppc_revisoes_ia SET provider = ${provider}, modelo = ${modelo}, atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const pausarRevisaoSeEmAndamento = Effect.fn("RevisoesPpc.pausarRevisaoSeEmAndamento")(function* (
    id: string,
    motivo: string,
  ) {
    const data = yield* agora;
    yield* sql`
      UPDATE revisao_ppc_revisoes_ia SET
        situacao = 'pausada',
        motivo = ${motivo},
        limite = 0,
        atualizada_em = ${data}
      WHERE id = ${id} AND situacao = 'em_andamento'
    `;
  }, Effect.orDie);

  const gravarBloco = Effect.fn("RevisoesPpc.gravarBloco")(function* (revisao: string, b: RegistroBlocoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT OR REPLACE INTO revisao_ppc_blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, provider, criado_em)
      VALUES (${revisao}, ${b.bloco}, ${yield* codificarDesconhecido(b.resultado)}, ${yield* codificarUso(b.uso)}, ${b.segundos}, ${b.provider}, ${data})
    `;
    yield* sql`UPDATE revisao_ppc_revisoes_ia SET atualizada_em = ${data} WHERE id = ${revisao}`;
  }, Effect.orDie);

  const blocos = Effect.fn("RevisoesPpc.blocos")(function* (revisao: string) {
    const linhas = yield* lerBlocos(
      yield* sql`SELECT bloco_id, resultado, uso, segundos, provider FROM revisao_ppc_blocos_ia WHERE revisao_id = ${revisao}`,
    );
    return linhas.map((l): RegistroBlocoIa => ({
      bloco: l.bloco_id,
      resultado: l.resultado,
      uso: l.uso,
      segundos: l.segundos,
      provider: l.provider as Provider | null,
    }));
  }, Effect.orDie);

  const revisoesEmAndamento = sql<{
    id: string;
  }>`SELECT id FROM revisao_ppc_revisoes_ia WHERE situacao = 'em_andamento'`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const gravarTentativa = Effect.fn("RevisoesPpc.gravarTentativa")(function* (
    revisao: string,
    bloco: string,
    t: TentativaGravada,
  ) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisao_ppc_tentativas_ia (revisao_id, bloco_id, numero, uso, segundos, ferramentas, criada_em)
      VALUES (${revisao}, ${bloco}, ${t.numero}, ${yield* codificarUso(t.uso)}, ${t.segundos},
        ${yield* codificarFerramentas(t.ferramentas)}, ${data})
    `;
  }, Effect.orDie);

  const gravarProblemas = Effect.fn("RevisoesPpc.gravarProblemas")(function* (
    revisao: string,
    bloco: string,
    numero: number,
    problemas: ProblemasDaConferencia,
  ) {
    // A última linha com esse número: a retomada de um bloco recomeça a contagem, e a tentativa que a
    // pausa cortou (sem conferência) fica com `problemas` nulo.
    yield* sql`
      UPDATE revisao_ppc_tentativas_ia SET problemas = ${yield* codificarProblemas(problemas)}
      WHERE rowid = (
        SELECT MAX(rowid) FROM revisao_ppc_tentativas_ia
        WHERE revisao_id = ${revisao} AND bloco_id = ${bloco} AND numero = ${numero}
      )
    `;
  }, Effect.orDie);

  const usoTotalRevisao = Effect.fn("RevisoesPpc.usoTotalRevisao")(function* (revisao: string) {
    // As tentativas do lote e as ações com IA da lista viva que veio dela (etapa 5b).
    const linhas = yield* lerUsos(
      yield* sql`
        SELECT uso FROM revisao_ppc_tentativas_ia WHERE revisao_id = ${revisao}
        UNION ALL
        SELECT a.uso FROM revisao_ppc_acoes_ia a JOIN revisao_ppc_listas_pendencias l ON l.id = a.lista_id WHERE l.revisao_id = ${revisao}
      `,
    );
    return somarUsos(linhas);
  }, Effect.orDie);

  const apagarRevisao = Effect.fn("RevisoesPpc.apagarRevisao")(function* (id: string) {
    yield* sql`DELETE FROM revisao_ppc_revisoes_ia WHERE id = ${id}`;
    yield* descarregar(sql);
  }, Effect.orDie);

  const revisoesDaLista = Effect.fn("RevisoesPpc.revisoesDaLista")(function* (lista: string) {
    const linhas = yield* sql<{ id: string; situacao: string }>`
      SELECT id, situacao FROM revisao_ppc_revisoes_ia WHERE lista_id = ${lista}
    `;
    return linhas.map((l) => ({ id: l.id, situacao: l.situacao as SituacaoRevisaoIa }));
  }, Effect.orDie);

  const revisoesOrfas = sql<{ id: string }>`
    SELECT r.id FROM revisao_ppc_revisoes_ia r
    WHERE r.situacao <> 'em_andamento'
      AND (
        r.lista_id IS NULL
        OR (r.situacao <> 'preparada' AND NOT EXISTS (SELECT 1 FROM revisao_ppc_listas_pendencias l WHERE l.revisao_id = r.id))
      )
  `.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const expirarRevisoesPreparadas = Effect.fn("RevisoesPpc.expirarRevisoesPreparadas")(function* (antesDe: string) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM revisao_ppc_revisoes_ia WHERE situacao = 'preparada' AND criada_em < ${antesDe}
    `;
    for (const l of linhas) yield* sql`DELETE FROM revisao_ppc_revisoes_ia WHERE id = ${l.id}`;
    if (linhas.length > 0) yield* descarregar(sql);
    return linhas.length;
  }, Effect.orDie);

  const caminhosEmRevisao = Effect.fn("RevisoesPpc.caminhosEmRevisao")(function* () {
    const originais = new Set<string>();
    const acompanhados = new Set<string>();
    const listas = yield* sql<{
      arquivo: string;
      arquivo_acompanhado: string | null;
      arquivo_comentado: string | null;
    }>`
      SELECT arquivo, arquivo_acompanhado,
        CASE
          WHEN json_valid(resultado) AND json_type(resultado, '$.arquivoComentado') = 'text'
          THEN json_extract(resultado, '$.arquivoComentado')
          ELSE NULL
        END AS arquivo_comentado
      FROM revisao_ppc_listas_pendencias
    `;
    for (const l of listas) {
      if (l.arquivo !== "") originais.add(l.arquivo);
      if (l.arquivo_acompanhado !== null && l.arquivo_acompanhado !== "") acompanhados.add(l.arquivo_acompanhado);
      if (l.arquivo_comentado !== null && l.arquivo_comentado !== "") acompanhados.add(l.arquivo_comentado);
    }
    const revisoes = yield* sql<{ arquivo: string }>`SELECT arquivo FROM revisao_ppc_revisoes_ia`;
    for (const r of revisoes) {
      if (r.arquivo !== "") originais.add(r.arquivo);
    }
    return { originais: [...originais], acompanhados: [...acompanhados] } satisfies CaminhosEmRevisao;
  }, Effect.orDie);

  return RevisoesPpc.of({
    comTravaDaLista,
    assinarMudancas: PubSub.subscribe(mudancas),
    criarLista,
    buscarLista,
    ligarRevisao,
    mesclarIa,
    todasListas,
    caminhosEmRevisao,
    pendencias,
    eventos,
    mudarPendencia,
    aplicarArquivoNovo,
    acompanhar,
    aplicarConferencia,
    ligarConversa,
    conversasLigadas,
    desligarConversa,
    trocarResultado,
    gravarAcao,
    usoLista,
    apagarLista,
    acrescentarPendencias,
    expirarListas,
    contestacoes,
    criarRevisao,
    buscarRevisao,
    resumoRevisao,
    listarRevisoes,
    alterarRevisao,
    trocarIa,
    pausarRevisaoSeEmAndamento,
    gravarBloco,
    blocos,
    revisoesEmAndamento,
    gravarTentativa,
    gravarProblemas,
    usoTotalRevisao,
    apagarRevisao,
    revisoesDaLista,
    revisoesOrfas,
    expirarRevisoesPreparadas,
  });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(RevisoesPpc, make);
