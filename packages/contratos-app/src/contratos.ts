/**
 * `@simplifica-if/contratos-app`: o contrato entre a interface do app e o servidor local
 * (`apps/server`), em Effect Schema, como o `packages/contracts` do T3. A interface, o servidor e o
 * desktop importam daqui; nada aqui depende do Node, e importar o pacote não carrega o `kb`, a leitura
 * do MCP nem os drivers do motor (`test/sem-servidor.test.ts` confere o grafo de imports).
 *
 * - `GrupoApp`: a API RPC (`effect/rpc`) por WebSocket. Seis grupos: providers, conversa, skills, pasta de trabalho, revisão de PPC e leitura (o
 *   `GrupoLeitura` de `@simplifica-if/mcp/grupo-leitura`, só as definições, sem duplicar; os handlers
 *   ficam em `@simplifica-if/mcp/rpc`, que este pacote não importa). Os métodos de providers e de conversa
 *   têm nome com prefixo, como os `WS_METHODS` do T3: `cliente["conversa.enviar"]({ … })`.
 * - `EnvelopePartida`: o que o processo pai (o desktop) escreve numa linha no stdin do servidor, como
 *   o `DesktopBackendBootstrap` do T3: o token do RPC e as origens permitidas.
 * - `LinhaPartida`: a linha JSON que o servidor imprime no stdout quando está pronto, com a porta e as
 *   URLs do RPC e do MCP.
 *
 * Autenticação do WebSocket: `Authorization: Bearer <token>` ou, para o navegador, que não manda
 * cabeçalho no WebSocket, um ingresso de curta duração na URL (`?ingresso=`, `PARAMETRO_INGRESSO`),
 * como o `wsTicket` do T3: o cliente o pede com o token em `POST /ingresso` (`CAMINHO_INGRESSO`) e o
 * usa uma vez, em até `VALIDADE_INGRESSO_MS`. O token, que vale enquanto o servidor viver, nunca vai
 * na URL.
 */
import { GrupoLeitura, type LinkLido } from "@simplifica-if/mcp/grupo-leitura";
import type {
  EstadoInstalacao as EstadoInstalacaoMotor,
  EstadoLogin as EstadoLoginMotor,
  EstadoProvider as EstadoProviderMotor,
} from "@simplifica-if/motor";
import {
  AprovacaoDesconhecida,
  Decisao,
  FalhaProvider,
  OperacaoNaoSuportada,
  SessaoDesconhecida,
  TurnoEmAndamento,
} from "@simplifica-if/motor/erros";
import { Evento, Provider } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

export { AprovacaoDesconhecida, Decisao, FalhaProvider, OperacaoNaoSuportada, SessaoDesconhecida, TurnoEmAndamento };
export { Evento, Provider };
export { GrupoLeitura };
export type { LinkLido };

/* ================================================================== partida */

/** O caminho do WebSocket do RPC. */
export const CAMINHO_RPC = "/rpc";

/** O caminho que troca o token (`Authorization: Bearer`) por um ingresso do WebSocket (`POST`). */
export const CAMINHO_INGRESSO = "/ingresso";

/** O parâmetro da URL do WebSocket com o ingresso, para o cliente que não manda cabeçalho (navegador). */
export const PARAMETRO_INGRESSO = "ingresso";

/** Por quanto tempo o ingresso vale depois de emitido; ele vale também para uma conexão só. */
export const VALIDADE_INGRESSO_MS = 60_000;

/** A resposta de `POST /ingresso`. */
export const Ingresso = Schema.Struct({
  ingresso: Schema.String,
  /** Milissegundos desde a época Unix em que o ingresso deixa de valer. */
  expiraEm: Schema.Number,
});
export type Ingresso = typeof Ingresso.Type;

/** A variável de ambiente com o token, a alternativa ao `EnvelopePartida` no stdin. */
export const VARIAVEL_TOKEN = "SIMPLIFICA_SERVIDOR_TOKEN";

/** Menor token aceito: 32 caracteres (o desktop gera 32 bytes aleatórios, em base64url). */
export const TAMANHO_MINIMO_TOKEN = 32;

export const TokenServidor = Schema.String.check(Schema.isMinLength(TAMANHO_MINIMO_TOKEN));

/**
 * A primeira linha do stdin do servidor, em JSON, escrita pelo processo pai. Com ela, o stdin vira o
 * cordão do pai: quando ele fecha, o servidor se encerra.
 */
export const EnvelopePartida = Schema.Struct({
  token: TokenServidor,
  /**
   * Origens (`Origin`) aceitas no WebSocket, como `app://simplifica`. Sem elas, só clientes que não
   * mandam `Origin` (o Node, o processo principal do Electron) se conectam.
   */
  origens: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * O segredo do processo principal do desktop, que a janela nunca recebe. Com ele, a revisão prévia
   * só analisa arquivos que o processo principal liberou (`CAMINHO_LIBERAR_ARQUIVO`), os escolhidos no
   * diálogo do sistema; sem ele (desenvolvimento, navegador), aceita qualquer `.docx`.
   */
  tokenDesktop: Schema.optionalKey(TokenServidor),
});
export type EnvelopePartida = typeof EnvelopePartida.Type;

/** `POST` com `Authorization: Bearer <tokenDesktop>` e `{ "arquivo": "<caminho absoluto>" }`: libera o arquivo. */
export const CAMINHO_LIBERAR_ARQUIVO = "/revisao-ppc/liberar";

/** A linha JSON que o servidor imprime no stdout quando está pronto; é a única coisa no stdout. */
export const LinhaPartida = Schema.Struct({
  servidor: Schema.Literal("simplifica-if"),
  pid: Schema.Number,
  porta: Schema.Number,
  /** `ws://127.0.0.1:<porta>/rpc` */
  rpc: Schema.String,
  /** `http://127.0.0.1:<porta MCP>/mcp`, o servidor MCP `ifpr` das sessões. */
  mcp: Schema.String,
});
export type LinhaPartida = typeof LinhaPartida.Type;

/* ================================================================== estados */

/**
 * Resultado da detecção: instalado, versão, login e o que o app oferece para o provider (instalar,
 * entrar). Nunca traz e-mail nem credencial.
 */
export const EstadoProvider = Schema.Struct({
  provider: Provider,
  instalado: Schema.Boolean,
  origem: Schema.optionalKey(Schema.Literals(["gerenciada", "local"])),
  versao: Schema.optionalKey(Schema.String),
  autenticado: Schema.Boolean,
  metodo: Schema.optionalKey(Schema.String),
  plano: Schema.optionalKey(Schema.String),
  mensagem: Schema.optionalKey(Schema.String),
  aviso: Schema.optionalKey(Schema.String),
  /** O app instala (ou atualiza) a CLI gerenciada do provider (`providers.instalar`). */
  podeInstalar: Schema.Boolean,
  /** O app faz o login do provider (`providers.entrar`). */
  podeEntrar: Schema.Boolean,
});
export type EstadoProvider = typeof EstadoProvider.Type;

/** Progresso da instalação gerenciada de uma CLI. */
export const EstadoInstalacao = Schema.Struct({
  provider: Provider,
  fase: Schema.Literals(["parada", "baixando", "extraindo", "verificando", "concluida", "falhou", "cancelada"]),
  baixados: Schema.Number,
  total: Schema.optionalKey(Schema.Number),
  versao: Schema.optionalKey(Schema.String),
  versaoInstalada: Schema.optionalKey(Schema.String),
  executavel: Schema.optionalKey(Schema.String),
  origem: Schema.optionalKey(Schema.Literals(["gerenciada", "local"])),
  mensagem: Schema.optionalKey(Schema.String),
});
export type EstadoInstalacao = typeof EstadoInstalacao.Type;

/** Progresso do login dentro do app. Em `aguardando`, `url` é a página que o app abre no navegador. */
export const EstadoLogin = Schema.Struct({
  provider: Provider,
  fase: Schema.Literals(["parado", "iniciando", "aguardando", "verificando", "concluido", "falhou", "cancelado"]),
  url: Schema.optionalKey(Schema.String),
  mensagem: Schema.optionalKey(Schema.String),
});
export type EstadoLogin = typeof EstadoLogin.Type;

type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Confere<T extends true> = T;
/** Os estados daqui e as interfaces do motor são o mesmo tipo: mudar um sem o outro quebra o typecheck. */
export type ConfereEstadosDoMotor = [
  Confere<Igual<EstadoProvider, EstadoProviderMotor>>,
  Confere<Igual<EstadoInstalacao, EstadoInstalacaoMotor>>,
  Confere<Igual<EstadoLogin, EstadoLoginMotor>>,
];

/* ================================================================== erros */

/** A pasta de trabalho pedida não é um caminho absoluto de uma pasta que existe. */
export class PastaTrabalhoInvalida extends Schema.TaggedError<PastaTrabalhoInvalida>()("PastaTrabalhoInvalida", {
  pasta: Schema.String,
}) {
  override get message(): string {
    return `a pasta de trabalho precisa ser o caminho absoluto de uma pasta que existe: ${this.pasta}`;
  }
}

export const ehPastaTrabalhoInvalida = Schema.is(PastaTrabalhoInvalida);

/* ================================================================== providers */

const EntradaProvider = Schema.Struct({ provider: Provider });

export class GrupoProviders extends RpcGroup.make(
  Rpc.make("providers.detectar", { payload: EntradaProvider, success: EstadoProvider }),
  /** Instala ou atualiza a CLI gerenciada (Codex, Antigravity); o stream termina numa fase final. */
  Rpc.make("providers.instalar", {
    payload: EntradaProvider,
    success: EstadoInstalacao,
    error: Schema.Union([FalhaProvider, OperacaoNaoSuportada]),
    stream: true,
  }),
  /** Login dentro do app (Antigravity); o stream termina numa fase final. */
  Rpc.make("providers.entrar", {
    payload: EntradaProvider,
    success: EstadoLogin,
    error: Schema.Union([FalhaProvider, OperacaoNaoSuportada]),
    stream: true,
  }),
) {}

/* ================================================================== conversa */

export const EntradaIniciar = Schema.Struct({
  provider: Provider,
  /** Caminho absoluto da pasta de trabalho da sessão; é também a única pasta que o MCP `ifpr` lê. */
  pastaTrabalho: Schema.String,
  modelo: Schema.optionalKey(Schema.String),
  buscaWeb: Schema.optionalKey(Schema.Boolean),
  /**
   * A tarefa da conversa (M1.9): o nome da skill do catálogo, ou `conversa` para a caixa livre do
   * Início. Fica gravada para a interface mostrar as etapas da skill ao reabrir.
   */
  tarefa: Schema.optionalKey(Schema.String),
});
export type EntradaIniciar = typeof EntradaIniciar.Type;

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
export const ItemEvento = Schema.TaggedStruct("EventoTurno", {
  turno: Schema.Number,
  ordem: Schema.Number,
  evento: Evento,
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
    error: Schema.Union([FalhaProvider, PastaTrabalhoInvalida]),
  }),
  /**
   * Envia a mensagem; o stream traz os eventos do turno e termina depois de `FimTurno`. Sem sessão
   * aberta (`liberada`, `caiu`), reabre antes pela retomada. Uma falha do provider no meio do turno
   * chega como `Erro` e `FimTurno` (motivo `falha`), e a conversa continua.
   */
  Rpc.make("conversa.enviar", {
    payload: Schema.Struct({ sessao: Schema.String, texto: Schema.String }),
    success: Evento,
    error: Schema.Union([FalhaProvider, TurnoEmAndamento, SessaoDesconhecida]),
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
    error: Schema.Union([FalhaProvider, SessaoDesconhecida]),
  }),
  /** 👍/👎 na resposta do turno (`null` retira a avaliação); gravado no servidor. */
  Rpc.make("conversa.avaliar", {
    payload: Schema.Struct({ sessao: Schema.String, turno: Schema.Number, nota: Schema.NullOr(NotaResposta) }),
    error: SessaoDesconhecida,
  }),
) {}

/* ================================================================== skills */

/**
 * Uma skill do app no catálogo do servidor: o que os futuros cartões da tela inicial mostram. Vem do
 * `name` e do bloco `simplifica:` do `SKILL.md` (`@simplifica-if/mcp/skills`).
 */
/** Uma entrada do formulário da tarefa (`entradas` do manifesto). */
export const EntradaTarefa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["arquivo", "curso", "texto", "norma"]),
  rotulo: Schema.String,
  /** As extensões aceitas num `arquivo` (`.docx`, `.md`). */
  aceita: Schema.optionalKey(Schema.Array(Schema.String)),
  opcional: Schema.optionalKey(Schema.Boolean),
});
export type EntradaTarefa = typeof EntradaTarefa.Type;

/** Uma etapa do indicador (`etapas` do manifesto); a skill a marca com a ferramenta `etapa`. */
export const EtapaTarefa = Schema.Struct({
  id: Schema.String,
  rotulo: Schema.String,
  /** A etapa informa `progresso` (feito de total). */
  progresso: Schema.optionalKey(Schema.Boolean),
});
export type EtapaTarefa = typeof EtapaTarefa.Type;

export const ResumoSkill = Schema.Struct({
  nome: Schema.String,
  titulo: Schema.String,
  resumo: Schema.String,
  area: Schema.String,
  /** Os perfis a quem a tarefa serve (`publico`); vazio quando o manifesto não diz. */
  publico: Schema.Array(Schema.String),
  /** O formulário da tarefa; vazio quando o manifesto não declara. */
  entradas: Schema.Array(EntradaTarefa),
  /** O indicador de etapas; vazio quando o manifesto não declara. */
  etapas: Schema.Array(EtapaTarefa),
  /** Como o manifesto escreve (`20min`, `1h`). */
  duracaoEstimada: Schema.optionalKey(Schema.String),
});
export type ResumoSkill = typeof ResumoSkill.Type;

export class GrupoSkills extends RpcGroup.make(
  /** As skills do catálogo do servidor, em ordem alfabética do nome; todas vão para toda conversa. */
  Rpc.make("skills.listar", { payload: Schema.Struct({}), success: Schema.Array(ResumoSkill) }),
) {}

/* ================================================================== revisão de PPC */

/**
 * O sufixo da cópia comentada: `<nome> - revisão prévia (Simplifica IF).docx` (depois ` (2)`, ` (3)`…),
 * na pasta do original. O servidor grava com ele; o desktop só abre arquivos com ele.
 */
export const SUFIXO_REVISAO_PREVIA = " - revisão prévia (Simplifica IF)";

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

/** A análise não terminou; `motivo` é a frase para a pessoa (arquivo grande, protegido, corrompido, tempo). */
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

/** O que a revisão deve gastar, mostrado antes de começar (método no `estimativa.ts` do `packages/ppc`). */
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
 * a reanálise do arquivo novo decide); `contestada_aceita` (retirada: a resposta da IA trouxe trecho ou
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

export const AcaoPendencia = Schema.Literals(["marcar", "contestar", "sugerir", "reanalisar"]);
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
  /** Quem decidiu a `resolvida`: a palavra da pessoa ou a reanálise do arquivo novo. */
  resolvidaPor: Schema.NullOr(Schema.Literals(["pessoa", "reanalise"])),
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
  Rpc.make("revisaoPpc.analisar", {
    payload: Schema.Struct({
      arquivo: Schema.String,
      cnct: Schema.optionalKey(Schema.String),
      forma: Schema.optionalKey(Schema.String),
    }),
    success: ResultadoRevisaoPpc,
    error: FalhaRevisaoPpc,
  }),
  /**
   * Prepara a revisão com IA (etapa 4) do arquivo já analisado: converte de novo, monta os blocos e
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
    error: FalhaRevisaoPpc,
  }),
  /** Começa ou retoma a revisão preparada (ou pausada); só os blocos pendentes vão ao provider. */
  Rpc.make("revisaoPpc.iniciarIa", { payload: EntradaRevisaoIa, success: EstadoRevisaoIa, error: FalhaRevisaoPpc }),
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
      acao: Schema.Literals(["contestar", "sugerir", "reanalisar"]),
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
    error: FalhaRevisaoPpc,
  }),
  /** "Sugerir texto": a redação proposta, com os fatos conferidos; nunca aplicada ao documento. */
  Rpc.make("revisaoPpc.sugerir", {
    payload: Schema.Struct({ lista: Schema.String, chave: Schema.String, provider: Schema.optionalKey(Provider) }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /**
   * "Já resolvi" com o arquivo atualizado: reconfere só a ficha da pendência no `.docx` novo (o código e,
   * nas fichas da IA, um lote pequeno); a situação sai do resultado, nunca da palavra da pessoa.
   */
  Rpc.make("revisaoPpc.reanalisar", {
    payload: Schema.Struct({
      lista: Schema.String,
      chave: Schema.String,
      arquivo: Schema.String,
      provider: Schema.optionalKey(Provider),
    }),
    success: ListaPendencias,
    error: FalhaRevisaoPpc,
  }),
  /** Gera de novo a cópia comentada do original, com a situação de cada pendência no comentário e no aviso. */
  Rpc.make("revisaoPpc.gerarCopia", { payload: EntradaLista, success: ListaPendencias, error: FalhaRevisaoPpc }),
) {}

/* ================================================================== pasta de trabalho */

/**
 * Uma recusa da pasta de trabalho (criar, anexar, ver, desfazer), com a frase para a pessoa em
 * `motivo`.
 */
export class FalhaPasta extends Schema.TaggedError<FalhaPasta>()("FalhaPasta", { motivo: Schema.String }) {
  override get message(): string {
    return this.motivo;
  }
}
export const ehFalhaPasta = Schema.is(FalhaPasta);

/** Um arquivo da pasta de trabalho da conversa. */
export const ArquivoPasta = Schema.Struct({
  /** O caminho relativo à pasta, com `/`. */
  nome: Schema.String,
  /** O caminho absoluto (para "Abrir" e "Mostrar na pasta" no desktop). */
  caminho: Schema.String,
  tamanho: Schema.Number,
  /** ISO 8601. */
  alteradoEm: Schema.String,
  /** `anexado`: entrou pelo app ("Anexar"); `pasta`: criado ou alterado na pasta (pela IA ou pela pessoa). */
  origem: Schema.Literals(["anexado", "pasta"]),
});
export type ArquivoPasta = typeof ArquivoPasta.Type;

/** O que "Desfazer o que a IA fez nesta pasta" faria agora. */
export const PrevisaoDesfazer = Schema.Struct({
  /** Há uma cópia diferente do estado atual para restaurar. */
  disponivel: Schema.Boolean,
  /** O turno cuja cópia (o estado de antes dele) seria restaurada. */
  turno: Schema.optionalKey(Schema.Number),
  /** Quando a cópia foi feita (ISO 8601). */
  copiaEm: Schema.optionalKey(Schema.String),
  /** Arquivos que sairiam (criados depois da cópia). */
  criados: Schema.Array(Schema.String),
  /** Arquivos que voltariam ao conteúdo da cópia. */
  alterados: Schema.Array(Schema.String),
  /** Arquivos que voltariam (apagados depois da cópia). */
  apagados: Schema.Array(Schema.String),
  /** Por que não há cópia de algum turno (pasta grande demais), em linguagem simples. */
  aviso: Schema.optionalKey(Schema.String),
});
export type PrevisaoDesfazer = typeof PrevisaoDesfazer.Type;

/** A pasta de trabalho de uma conversa. */
export const PastaConversa = Schema.Struct({
  pasta: Schema.String,
  /** A pasta foi criada pelo app em `Documentos/Simplifica IF` (só essas têm arquivos listados e "Desfazer"). */
  gerida: Schema.Boolean,
  arquivos: Schema.Array(ArquivoPasta),
  desfazer: PrevisaoDesfazer,
});
export type PastaConversa = typeof PastaConversa.Type;

export class GrupoPasta extends RpcGroup.make(
  /**
   * Cria a pasta de uma tarefa em `Documentos/Simplifica IF/<titulo>` (nome seguro, sem colisão:
   * ` (2)`, ` (3)`…) e devolve o caminho, para anexar e depois `conversa.iniciar`.
   */
  Rpc.make("pasta.criar", {
    payload: Schema.Struct({ titulo: Schema.String }),
    success: Schema.Struct({ pasta: Schema.String }),
    error: FalhaPasta,
  }),
  /**
   * Copia para a pasta (criada por `pasta.criar`) um arquivo escolhido no diálogo do desktop, que o
   * processo principal liberou (`CAMINHO_LIBERAR_ARQUIVO`); nome repetido ganha ` (2)`.
   */
  Rpc.make("pasta.anexar", {
    payload: Schema.Struct({ pasta: Schema.String, arquivo: Schema.String }),
    success: ArquivoPasta,
    error: FalhaPasta,
  }),
  /** Os arquivos da pasta da conversa e o que "Desfazer" faria. */
  Rpc.make("pasta.ver", {
    payload: EntradaSessao,
    success: PastaConversa,
    error: Schema.Union([FalhaPasta, SessaoDesconhecida]),
  }),
  /**
   * Restaura a cópia da pasta do turno mais recente que a IA mudou (a de antes do turno) e devolve a
   * pasta depois. Recusa com turno em andamento.
   */
  Rpc.make("pasta.desfazer", {
    payload: EntradaSessao,
    success: PastaConversa,
    error: Schema.Union([FalhaPasta, SessaoDesconhecida, TurnoEmAndamento]),
  }),
) {}

/* ================================================================== app */

/** A API inteira do servidor local: providers, conversa, skills, revisão de PPC e leitura. */
export class GrupoApp extends GrupoProviders.merge(
  GrupoConversa,
  GrupoSkills,
  GrupoPasta,
  GrupoRevisaoPpc,
  GrupoLeitura,
) {}
