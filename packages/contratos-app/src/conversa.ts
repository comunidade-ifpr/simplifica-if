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

export const EntradaIniciar = Schema.Struct({
  provider: Provider,
  /** Caminho absoluto da pasta de trabalho da sessão; é também a única pasta que o MCP `ifpr` lê. */
  pastaTrabalho: Schema.String,
  /** O `id` de um dos `modelos` de `providers.detectar`; sem ele, o padrão da conta. */
  modelo: Schema.optionalKey(Schema.String),
  /** O `esforcoAprofundado` do modelo escolhido; sem ele, o esforço padrão do modelo. */
  esforco: Schema.optionalKey(NivelEsforco),
  /**
   * A tarefa da conversa: o `id` de uma tarefa de abertura `conversa` do catálogo (`tarefas.listar`).
   * Sem ela, a conversa é livre (a caixa do Início). Fica gravada para a interface mostrar o título e
   * as etapas da tarefa ao reabrir.
   */
  tarefa: Schema.optionalKey(Schema.String),
});
export type EntradaIniciar = typeof EntradaIniciar.Type;

/**
 * A `tarefa` de `conversa.iniciar` não abre conversa: não é uma tarefa de conversa que este app atende
 * (`indisponivel`: saiu do catálogo, foi descontinuada, pede um app ou uma base mais nova, ou cita uma
 * skill que o app não tem) ou é `experimental` e o canal em uso não é o beta (`so-no-beta`).
 */
export class TarefaDesconhecida extends Schema.TaggedError<TarefaDesconhecida>()("TarefaDesconhecida", {
  tarefa: Schema.String,
  motivo: Schema.Literals(["indisponivel", "so-no-beta"]),
}) {
  override get message(): string {
    return this.motivo === "so-no-beta"
      ? "Esta tarefa é experimental: só abre no canal beta das atualizações."
      : "Esta tarefa não está disponível neste app: pode ter saído do catálogo ou pedir uma versão mais nova do app.";
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
 *   mensagem a reabre pela retomada do provider;
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
  /** O `id` da tarefa (`EntradaIniciar.tarefa`), quando a conversa nasceu de uma; sem ele, conversa livre. */
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

/**
 * O estado da conversa, como o servidor o vê, em `conversa.acompanhar`: o de agora ao começar e cada
 * mudança depois (`respondendo` ao abrir o turno, o estado em repouso ao fechá-lo). Não se grava.
 */
export const EstadoAoVivo = Schema.TaggedStruct("Estado", { estado: EstadoConversa });

/** O que `conversa.acompanhar` entrega: os itens da conversa e o estado dela. */
export const ItemAoVivo = Schema.Union([ItemConversa, EstadoAoVivo]);
export type ItemAoVivo = typeof ItemAoVivo.Type;

/** O turno que `conversa.enviar` abriu: o número e a `ordem` da mensagem gravada. */
export const TurnoAberto = Schema.Struct({ turno: Schema.Number, ordem: Schema.Number });
export type TurnoAberto = typeof TurnoAberto.Type;

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

/**
 * O que apagar a conversa faz, em fatos (a interface escreve as frases): o que sai do app e o que fica
 * no computador da pessoa.
 */
export const PreviaApagarConversa = Schema.Struct({
  /** A IA está respondendo: o app para o turno antes de apagar. */
  respondendo: Schema.Boolean,
  /** As mensagens da pessoa (as respostas da IA saem junto). */
  mensagens: Schema.Number,
  /** Os arquivos anexados pelo app registrados para a pasta. */
  anexos: Schema.Number,
  /**
   * A pasta da tarefa, que fica no computador. Só a `gerida` (filha de `Documentos/Simplifica IF`) e
   * não `compartilhada` com outra conversa pode ir para a Lixeira.
   */
  pasta: Schema.Struct({
    caminho: Schema.String,
    gerida: Schema.Boolean,
    compartilhada: Schema.Boolean,
    arquivos: Schema.Number,
  }),
  /** Os relatos de erro salvos em arquivo (`Relatos de erro/`), que ficam: trazem trecho da conversa. */
  relatos: Schema.Array(Schema.String),
});
export type PreviaApagarConversa = typeof PreviaApagarConversa.Type;

export const ResultadoApagarConversa = Schema.Struct({
  /**
   * O registro da conversa que a IA guarda neste computador (a transcrição do Claude, a thread do
   * Codex, a sessão do Antigravity): `apagada`, `ficou` (o provider não deixou apagar) ou `nenhuma`.
   */
  transcricao: Schema.Literals(["apagada", "ficou", "nenhuma"]),
});
export type ResultadoApagarConversa = typeof ResultadoApagarConversa.Type;

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
   * Abre o turno com a mensagem e responde assim que ele abre, com o número dele e a `ordem` da mensagem
   * gravada. Sem sessão aberta (`liberada`, `caiu`), reabre antes pela retomada. O turno corre no
   * servidor, e os itens dele chegam por `conversa.acompanhar`; uma falha do provider no meio do turno
   * chega como `Erro` e `FimTurno` (motivo `falha`), e a conversa continua.
   */
  Rpc.make("conversa.enviar", {
    payload: Schema.Struct({ sessao: Schema.String, texto: Schema.String }),
    success: TurnoAberto,
    error: Schema.Union([FalhaProvider, TurnoEmAndamento, SessaoDesconhecida, AvisoNaoAceito]),
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
   * A conversa ao vivo: os itens gravados depois de `depois` (a maior `ordem` já vista), o texto parcial
   * acumulado da resposta em andamento (com a `ordem` do último item gravado), o estado de agora
   * (`Estado`) e, daí em diante, cada item e cada mudança de estado. Não termina sozinho: segue a
   * conversa até quem acompanha cancelar ou a conversa ser apagada. É como a interface segue todo turno,
   * e como volta a ele depois de recarregar ou de a conexão cair.
   */
  Rpc.make("conversa.acompanhar", {
    payload: Schema.Struct({ sessao: Schema.String, depois: Schema.Number }),
    success: ItemAoVivo,
    error: SessaoDesconhecida,
    stream: true,
  }),
  /** 👍/👎 na resposta do turno (`null` retira a avaliação); gravado no servidor. */
  Rpc.make("conversa.avaliar", {
    payload: Schema.Struct({ sessao: Schema.String, turno: Schema.Number, nota: Schema.NullOr(NotaResposta) }),
    error: SessaoDesconhecida,
  }),
  /** O que apagar a conversa tira do app e o que fica no computador, para o diálogo de confirmação. */
  Rpc.make("conversa.previaApagar", {
    payload: EntradaSessao,
    success: PreviaApagarConversa,
    error: SessaoDesconhecida,
  }),
  /**
   * Apaga a conversa: para o turno em andamento, fecha a sessão do provider e apaga as mensagens, as
   * avaliações, as cópias do Desfazer e o registro que a IA guarda neste computador. A pasta da tarefa
   * fica (a interface a manda à Lixeira pelo desktop, se a pessoa pedir).
   */
  Rpc.make("conversa.apagar", {
    payload: EntradaSessao,
    success: ResultadoApagarConversa,
    error: SessaoDesconhecida,
  }),
) {}
