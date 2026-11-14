/**
 * Contrato entre o `Motor` e cada provider. Um driver sabe detectar o provider e abrir uma sessão;
 * a sessão envia mensagens, recebe respostas de aprovação e se interrompe. Encerrar é fechar o
 * `Scope` em que a sessão foi aberta: o processo do provider morre junto.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { Evento, Provider } from "./eventos.ts";

/** Servidor MCP por stdio: o provider abre o processo, só nesta sessão. */
export interface ServidorMcpStdio {
  readonly tipo: "stdio";
  readonly nome: string;
  readonly comando: string;
  readonly argumentos: ReadonlyArray<string>;
  readonly ambiente?: Readonly<Record<string, string>>;
  /** Ferramentas só de leitura: o provider as chama sem pedir aprovação. */
  readonly preAprovado: boolean;
}

/**
 * Uma chamada de ferramenta concluída, como o servidor MCP do app a viu: o nome sem o servidor
 * (`buscar_norma`), o começo do resultado e se ele é de erro.
 */
export interface ResultadoFerramenta {
  /** O nome da ferramenta, sem o servidor; numa leitura de recurso (`resources/read`), o URI lido. */
  readonly ferramenta: string;
  readonly resumo: string;
  readonly falhou: boolean;
}

/**
 * Servidor MCP por HTTP (streamable HTTP), já em execução: o provider só se conecta, só nesta sessão.
 * `cabecalhos` leva o escopo da sessão (`Authorization: Bearer <token>`).
 */
export interface ServidorMcpHttp {
  readonly tipo: "http";
  readonly nome: string;
  readonly url: string;
  readonly cabecalhos?: Readonly<Record<string, string>>;
  /** Ferramentas só de leitura: o provider as chama sem pedir aprovação. */
  readonly preAprovado: boolean;
  /**
   * As chamadas desta sessão ao servidor, na ordem em que terminam (no app, o `chamadas` do
   * `ServidorMcpHttp` de `@simplifica-if/mcp/http`, filtrado pelo rótulo da sessão). Com ele, o
   * `Motor` completa o `resumo` vazio de `FerramentaConcluida` das ferramentas deste servidor: o
   * `agy` não manda o resultado pelo ACP. Veja `resultados.ts`.
   */
  readonly resultados?: Stream.Stream<ResultadoFerramenta>;
}

/** Servidor MCP entregue ao provider só nesta sessão, por stdio ou por HTTP. */
export type ServidorMcp = ServidorMcpStdio | ServidorMcpHttp;

export interface ConfigSessao {
  readonly provider: Provider;
  readonly pastaTrabalho: string;
  readonly servidoresMcp: ReadonlyArray<ServidorMcp>;
  /** Modelo do provider; sem ele, o padrão da conta. */
  readonly modelo?: string;
  /**
   * Busca na web (padrão: desligada). Desligada, a resposta sai da base e do que o usuário anexa.
   * O Antigravity não tem como desligá-la por sessão.
   */
  readonly buscaWeb?: boolean;
}

export const Decisao = Schema.Literals(["permitir", "negar"]);
export type Decisao = typeof Decisao.Type;

/** Resultado da detecção: instalado, versão e login. Nunca traz e-mail nem credencial. */
export interface EstadoProvider {
  readonly provider: Provider;
  readonly instalado: boolean;
  /** `gerenciada`: a cópia que o app instalou; `local`: a CLI que o usuário já tinha. */
  readonly origem?: "gerenciada" | "local";
  readonly versao?: string;
  readonly autenticado: boolean;
  /** Como está logado: `claude.ai`, `chatgpt`, `apiKey`, `oauth-personal`… */
  readonly metodo?: string;
  /** Plano da assinatura, quando o provider informa (`max`, `plus`, `pro`…). */
  readonly plano?: string;
  readonly mensagem?: string;
  /** Algo que impede o app de funcionar direito mesmo com login (ex.: MCP bloqueado pela organização). */
  readonly aviso?: string;
}

export class FalhaProvider extends Schema.TaggedError<FalhaProvider>()("FalhaProvider", {
  provider: Schema.String,
  operacao: Schema.String,
  detalhe: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.provider}: falha em ${this.operacao}: ${this.detalhe}`;
  }
}

export class AprovacaoDesconhecida extends Schema.TaggedError<AprovacaoDesconhecida>()("AprovacaoDesconhecida", {
  id: Schema.String,
}) {
  override get message(): string {
    return `não há pedido de aprovação pendente com o id ${this.id}`;
  }
}

export class TurnoEmAndamento extends Schema.TaggedError<TurnoEmAndamento>()("TurnoEmAndamento", {}) {
  override get message(): string {
    return "a sessão já tem um turno em andamento";
  }
}

export interface SessaoDriver {
  /** Envia a mensagem e devolve os eventos do turno; o stream termina depois de `FimTurno`. */
  readonly enviar: (texto: string) => Stream.Stream<Evento, FalhaProvider | TurnoEmAndamento>;
  readonly responder: (idAprovacao: string, decisao: Decisao) => Effect.Effect<void, AprovacaoDesconhecida>;
  readonly interromper: Effect.Effect<void, FalhaProvider>;
}

/** Progresso da instalação gerenciada de uma CLI (a do T3: download, sha256, staging, versão ativa). */
export interface EstadoInstalacao {
  readonly provider: Provider;
  readonly fase: "parada" | "baixando" | "extraindo" | "verificando" | "concluida" | "falhou" | "cancelada";
  readonly baixados: number;
  readonly total?: number;
  /** A versão que a instalação oferece (a fixada pelo T3 ou uma mais nova). */
  readonly versao?: string;
  readonly versaoInstalada?: string;
  readonly executavel?: string;
  /** `local`: uma CLI suportada que o usuário já tinha; `gerenciada`: a cópia do app. */
  readonly origem?: "gerenciada" | "local";
  readonly mensagem?: string;
}

/** Progresso do login dentro do app. Em `aguardando`, `url` é a página que o app abre no navegador. */
export interface EstadoLogin {
  readonly provider: Provider;
  readonly fase: "parado" | "iniciando" | "aguardando" | "verificando" | "concluido" | "falhou" | "cancelado";
  readonly url?: string;
  readonly mensagem?: string;
}

export class OperacaoNaoSuportada extends Schema.TaggedError<OperacaoNaoSuportada>()("OperacaoNaoSuportada", {
  provider: Schema.String,
  operacao: Schema.String,
}) {
  override get message(): string {
    return `${this.provider} não oferece ${this.operacao} pelo app`;
  }
}

export interface Driver {
  readonly detectar: Effect.Effect<EstadoProvider>;
  readonly iniciar: (config: ConfigSessao) => Effect.Effect<SessaoDriver, FalhaProvider, Scope.Scope>;
  /** Instala (ou atualiza) a CLI gerenciada; o stream termina numa fase final. */
  readonly instalar?: Stream.Stream<EstadoInstalacao, FalhaProvider>;
  /** Login dentro do app; o stream termina numa fase final. */
  readonly entrar?: Stream.Stream<EstadoLogin, FalhaProvider>;
}

/** Os drivers disponíveis, por provider. `Drivers.layerNode` (em `drivers/index.ts`) monta os reais. */
export class Drivers extends Context.Service<Drivers, Readonly<Record<Provider, Driver>>>()(
  "@simplifica-if/motor/Driver/Drivers",
) {}

/** Gravação opcional das mensagens nativas (fixtures): recebe cada mensagem crua, na ordem. */
export const Gravador = Context.Reference<(direcao: "entrada" | "saida", mensagem: unknown) => void>(
  "@simplifica-if/motor/Driver/Gravador",
  { defaultValue: () => () => {} },
);
