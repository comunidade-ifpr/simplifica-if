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

/** Servidor MCP por stdio, entregue ao provider só nesta sessão. */
export interface ServidorMcp {
  readonly nome: string;
  readonly comando: string;
  readonly argumentos: ReadonlyArray<string>;
  readonly ambiente?: Readonly<Record<string, string>>;
  /** Ferramentas só de leitura: o provider as chama sem pedir aprovação. */
  readonly preAprovado: boolean;
}

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

export interface Driver {
  readonly detectar: Effect.Effect<EstadoProvider>;
  readonly iniciar: (config: ConfigSessao) => Effect.Effect<SessaoDriver, FalhaProvider, Scope.Scope>;
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
