/**
 * Tradução dos estados de instalação e de login do T3 (`ProviderInstallState`, `ProviderAuthState`)
 * para os do motor, e os streams que acompanham uma operação até a fase final.
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Canal from "./Canal.ts";
import type { EstadoInstalacao, EstadoLogin, FalhaProvider } from "./Driver.ts";
import type { Provider } from "./eventos.ts";
import { classificarFalhaEstado, type TipoFalhaEstado } from "./falhas.ts";
import type { ProviderAuthState } from "./t3/contracts-antigravity.ts";
import type { ProviderInstallState } from "./t3/contracts.ts";

const FASES_INSTALACAO = {
  idle: "parada",
  downloading: "baixando",
  extracting: "extraindo",
  verifying: "verificando",
  succeeded: "concluida",
  failed: "falhou",
  cancelled: "cancelada",
} as const satisfies Record<ProviderInstallState["phase"], EstadoInstalacao["fase"]>;

const FASES_LOGIN = {
  idle: "parado",
  starting: "iniciando",
  waiting: "aguardando",
  verifying: "verificando",
  succeeded: "concluido",
  failed: "falhou",
  cancelled: "cancelado",
} as const satisfies Record<ProviderAuthState["phase"], EstadoLogin["fase"]>;

/** A mensagem do T3 e, quando o classificador a reconhece, o tipo da falha que ela descreve. */
function mensagemComTipo(mensagem: string | null): {
  readonly mensagem?: string;
  readonly tipoFalha?: TipoFalhaEstado;
} {
  if (mensagem === null) return {};
  const tipoFalha = classificarFalhaEstado(mensagem);
  return tipoFalha === undefined ? { mensagem } : { mensagem, tipoFalha };
}

export function estadoInstalacao(provider: Provider, estado: ProviderInstallState): EstadoInstalacao {
  return {
    provider,
    fase: FASES_INSTALACAO[estado.phase],
    baixados: estado.downloadedBytes,
    ...(estado.totalBytes === null ? {} : { total: estado.totalBytes }),
    ...(estado.version === null ? {} : { versao: estado.version }),
    ...(estado.installedVersion === null ? {} : { versaoInstalada: estado.installedVersion }),
    ...(estado.executablePath ? { executavel: estado.executablePath } : {}),
    ...(estado.source ? { origem: estado.source === "managed" ? "gerenciada" : "local" } : {}),
    ...mensagemComTipo(estado.message),
  };
}

export function estadoLogin(provider: Provider, estado: ProviderAuthState): EstadoLogin {
  const url = estado.authorizationUrl ?? (estado.interaction?.type === "browser" ? estado.interaction.url : undefined);
  return {
    provider,
    fase: FASES_LOGIN[estado.phase],
    ...(url ? { url } : {}),
    ...mensagemComTipo(estado.message),
  };
}

const FINAIS_INSTALACAO = new Set<EstadoInstalacao["fase"]>(["concluida", "falhou", "cancelada"]);
const FINAIS_LOGIN = new Set<EstadoLogin["fase"]>(["concluido", "falhou", "cancelado"]);

/**
 * `start` e depois as mudanças, até a fase final. O estado devolvido pelo `start` entra primeiro,
 * porque um Codex local suportado já sai `succeeded`, sem mudança nenhuma depois.
 */
export function acompanharInstalacao<E>(
  provider: Provider,
  instalacao: {
    readonly start: Effect.Effect<ProviderInstallState, E>;
    readonly changes: Stream.Stream<ProviderInstallState>;
  },
): Stream.Stream<EstadoInstalacao, FalhaProvider> {
  return Stream.unwrap(
    Effect.map(instalacao.start, (inicial) =>
      Stream.concat(Stream.make(inicial), instalacao.changes).pipe(
        Stream.map((estado) => estadoInstalacao(provider, estado)),
        Stream.takeUntil((estado) => FINAIS_INSTALACAO.has(estado.fase)),
      ),
    ).pipe(Effect.mapError(Canal.falhaDe(provider, "instalar"))),
  );
}

/** O login até a fase final: `start` e depois o `subscribe` do mesmo dono. */
export function acompanharLogin<E>(
  provider: Provider,
  iniciar: Effect.Effect<ProviderAuthState, E>,
  mudancas: Stream.Stream<ProviderAuthState>,
): Stream.Stream<EstadoLogin, FalhaProvider> {
  return Stream.unwrap(
    Effect.map(iniciar, (inicial) =>
      Stream.concat(Stream.make(inicial), mudancas).pipe(
        Stream.map((estado) => estadoLogin(provider, estado)),
        Stream.changesWith((a, b) => a.fase === b.fase && a.url === b.url && a.mensagem === b.mensagem),
        Stream.takeUntil((estado) => FINAIS_LOGIN.has(estado.fase)),
      ),
    ).pipe(Effect.mapError(Canal.falhaDe(provider, "entrar"))),
  );
}
