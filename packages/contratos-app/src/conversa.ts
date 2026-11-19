/** A conversa com a IA da pessoa: sessão, turnos, aprovações, histórico e avaliação. */
import {
  AprovacaoDesconhecida,
  Decisao,
  FalhaProvider,
  SessaoDesconhecida,
  TurnoEmAndamento,
} from "@simplifica-if/motor/erros";
import { NivelEsforco } from "@simplifica-if/motor/estados-provider";
import { Evento, Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";
import { MudancasPasta } from "./pasta.ts";
import { AvisoNaoAceito } from "./preferencias.ts";

/** A pasta de trabalho pedida não é um caminho absoluto de uma pasta que existe. */
export class PastaTrabalhoInvalida extends Schema.TaggedError<PastaTrabalhoInvalida>()("PastaTrabalhoInvalida", {
  pasta: Schema.String,
}) {
  override get message(): string {
    return `a pasta da tarefa precisa ser o caminho completo de uma pasta que existe: ${this.pasta}`;
  }
}

export const ehPastaTrabalhoInvalida = Schema.is(PastaTrabalhoInvalida);

export const EntradaIniciar = Schema.Struct({
  provider: Provider,
  /** Caminho absoluto da pasta de trabalho da sessão; é também a única pasta que o MCP `ifpr` lê. */
  pastaTrabalho: Schema.String,
  /** O `id` de um dos `modelos` de `providers.detectar`; sem ele, o padrão da conta. */
  modelo: Schema.optionalKey(Schema.String),
  /** O `esforcoAprofundado` do modelo escolhido; sem ele, o esforço padrão do modelo. */
  esforco: Schema.optionalKey(NivelEsforco),
  buscaWeb: Schema.optionalKey(Schema.Boolean),
  /**
   * A tarefa da conversa (M1.9): o nome da skill do catálogo, ou `conversa` para a caixa livre do
   * Início. Fica gravada para a interface mostrar as etapas da skill ao reabrir.
   */
  tarefa: Schema.optionalKey(Schema.String),
});
export type EntradaIniciar = typeof EntradaIniciar.Type;

/** A `tarefa` de `conversa.iniciar` não é skill do catálogo nem `conversa`. */
export class TarefaDesconhecida extends Schema.TaggedError<TarefaDesconhecida>()("TarefaDesconhecida", {
  tarefa: Schema.String,
}) {
  override get message(): string {
    return "Esta tarefa não existe mais no app.";
  }
}

export const SessaoIniciada = Schema.Struct({
  /** O id da conversa, que dura além da sessão do provider (é o que os outros métodos recebem em `sessao`). */
  sessao: Schema.String,
});

/**
 * O estado de uma conversa gravada:
 * - `pronta`: a sessão do provider está aberta, sem turno em andamento;
 * - `respondendo`: há um turno em andamento;
 * - `liberada`: sem sessão aberta (ociosa por 30 minutos, encerrada ou o app fechou); a próxima
 *   mensagem (ou `conversa.retomar`) a reabre pela retomada do provider;
 * - `caiu`: o processo do provider caiu; a próxima mensagem a reabre pela retomada.
 */
export const EstadoConversa = Schema.Literals(["pronta", "respondendo", "liberada", "caiu"]);
export type EstadoConversa = typeof EstadoConversa.Type;

/** Uma conversa na lista: o que a interface mostra sem carregar o histórico. */
export const ResumoConversa = Schema.Struct({
  id: Schema.String,
  provider: Provider,
  pastaTrabalho: Schema.String,
  modelo: Schema.optionalKey(Schema.String),
  /** Derivado da primeira mensagem; vazio antes dela. */
  titulo: Schema.String,
  estado: EstadoConversa,
  turnos: Schema.Number,
  /** Datas em ISO 8601 (UTC). */
  criadaEm: Schema.String,
  atualizadaEm: Schema.String,
  /** A tarefa (`EntradaIniciar.tarefa`), quando a conversa nasceu de uma. */
  tarefa: Schema.optionalKey(Schema.String),
});
export type ResumoConversa = typeof ResumoConversa.Type;

/**
 * Um item do histórico. `turno` conta a partir de 1 (a mensagem da pessoa abre o turno); `ordem`
 * cresce na conversa inteira. O `TextoParcial` não se grava: no histórico, o texto vem do
 * `TextoFinal`; ao vivo (`conversa.acompanhar`), ele leva a `ordem` do último item gravado.
 */
export const ItemMensagem = Schema.TaggedStruct("Mensagem", {
  turno: Schema.Number,
  ordem: Schema.Number,
  texto: Schema.String,
});
/**
 * Um evento do turno: os do motor (o provider) e os do app, hoje só `MudancasPasta` (o que a pessoa
 * mexeu na pasta fora da conversa), que abre o turno logo depois da mensagem.
 */
export const EventoConversa = Schema.Union([Evento, MudancasPasta]);
export type EventoConversa = typeof EventoConversa.Type;

export const ItemEvento = Schema.TaggedStruct("EventoTurno", {
  turno: Schema.Number,
  ordem: Schema.Number,
  evento: EventoConversa,
});
/** A resposta da pessoa a um `PedidoAprovacao` do turno. */
export const ItemDecisao = Schema.TaggedStruct("DecisaoAprovacao", {
  turno: Schema.Number,
  ordem: Schema.Number,
  aprovacao: Schema.String,
  decisao: Decisao,
});
export const ItemConversa = Schema.Union([ItemMensagem, ItemEvento, ItemDecisao]);
export type ItemConversa = typeof ItemConversa.Type;

/** Uma conversa com o histórico inteiro. */
/** A avaliação de uma resposta (👍/👎), por turno. */
export const NotaResposta = Schema.Literals(["util", "nao_util"]);
export type NotaResposta = typeof NotaResposta.Type;

export const AvaliacaoResposta = Schema.Struct({ turno: Schema.Number, nota: NotaResposta });
export type AvaliacaoResposta = typeof AvaliacaoResposta.Type;

export const ConversaGravada = Schema.Struct({
  conversa: ResumoConversa,
  itens: Schema.Array(ItemConversa),
  /** As avaliações gravadas das respostas, por turno. */
  avaliacoes: Schema.Array(AvaliacaoResposta),
});
export type ConversaGravada = typeof ConversaGravada.Type;

const EntradaSessao = Schema.Struct({ sessao: Schema.String });

export class GrupoConversa extends RpcGroup.make(
  /**
   * Abre a sessão no provider, já com o MCP `ifpr` HTTP do servidor e um token só dela, e grava a
   * conversa. A conversa não depende da conexão: dura até ser apagada, e a sessão do provider se
   * libera ociosa e se reabre por retomada.
   */
  Rpc.make("conversa.iniciar", {
    payload: EntradaIniciar,
    success: SessaoIniciada,
    error: Schema.Union([FalhaProvider, PastaTrabalhoInvalida, TarefaDesconhecida, AvisoNaoAceito]),
  }),
  /**
   * Envia a mensagem; o stream traz os eventos do turno e termina depois de `FimTurno`. Sem sessão
   * aberta (`liberada`, `caiu`), reabre antes pela retomada. Uma falha do provider no meio do turno
   * chega como `Erro` e `FimTurno` (motivo `falha`), e a conversa continua.
   */
  Rpc.make("conversa.enviar", {
    payload: Schema.Struct({ sessao: Schema.String, texto: Schema.String }),
    success: EventoConversa,
    error: Schema.Union([FalhaProvider, TurnoEmAndamento, SessaoDesconhecida, AvisoNaoAceito]),
    stream: true,
  }),
  /** Responde a um `PedidoAprovacao` do turno em andamento. */
  Rpc.make("conversa.responderAprovacao", {
    payload: Schema.Struct({ sessao: Schema.String, aprovacao: Schema.String, decisao: Decisao }),
    error: Schema.Union([SessaoDesconhecida, AprovacaoDesconhecida]),
  }),
  Rpc.make("conversa.interromper", {
    payload: EntradaSessao,
    error: Schema.Union([SessaoDesconhecida, FalhaProvider]),
  }),
  /**
   * Libera a sessão do provider (o processo morre e o token do MCP é revogado); a conversa fica
   * gravada, `liberada`, e se retoma na próxima mensagem.
   */
  Rpc.make("conversa.encerrar", { payload: EntradaSessao, error: SessaoDesconhecida }),
  /** As conversas gravadas, da mais recente para a mais antiga. */
  Rpc.make("conversa.listar", { payload: Schema.Struct({}), success: Schema.Array(ResumoConversa) }),
  /** Uma conversa com o histórico (mensagens, eventos e decisões). */
  Rpc.make("conversa.carregar", { payload: EntradaSessao, success: ConversaGravada, error: SessaoDesconhecida }),
  /**
   * Os itens depois de `depois` (a maior `ordem` já vista) e, se há turno em andamento, os que chegam
   * até o `FimTurno` dele: é como a interface que recarregou volta a acompanhar a resposta. Sem turno
   * em andamento, termina depois dos itens gravados.
   */
  Rpc.make("conversa.acompanhar", {
    payload: Schema.Struct({ sessao: Schema.String, depois: Schema.Number }),
    success: ItemConversa,
    error: SessaoDesconhecida,
    stream: true,
  }),
  /** Reabre já a sessão do provider pela retomada (sem esperar a próxima mensagem). */
  Rpc.make("conversa.retomar", {
    payload: EntradaSessao,
    success: ResumoConversa,
    error: Schema.Union([FalhaProvider, SessaoDesconhecida, AvisoNaoAceito]),
  }),
  /** 👍/👎 na resposta do turno (`null` retira a avaliação); gravado no servidor. */
  Rpc.make("conversa.avaliar", {
    payload: Schema.Struct({ sessao: Schema.String, turno: Schema.Number, nota: Schema.NullOr(NotaResposta) }),
    error: SessaoDesconhecida,
  }),
) {}
