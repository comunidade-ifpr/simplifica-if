/**
 * Driver do Antigravity (Gemini) pelo ACP (`agy acp`, JSON-RPC por stdio) e o cliente
 * `@simplifica-if/effect-acp`, copiado do T3. O login é o do usuário (`oauth-personal`).
 *
 * - O MCP entra em `mcpServers` do `session/new`, por stdio ou por HTTP (este só se o `initialize`
 *   anunciar `mcpCapabilities.http`, como no `AcpSessionRuntime` do T3).
 * - `initialize` e `authenticate` (eager, como no T3) também servem de detecção: o código -32000
 *   no `authenticate` quer dizer "sem login".
 * - `session/request_permission` vira `PedidoAprovacao`; o turno termina com a resposta do
 *   `session/prompt` (`stopReason`).
 */
import * as AcpClient from "@simplifica-if/effect-acp/client";
import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type EstadoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type Evento, resumir, textoDeBlocos } from "../eventos.ts";
import { acompanharInstalacao, acompanharLogin } from "../estados.ts";
import { type Ambiente, limparAmbiente } from "../processo.ts";
import { makeAntigravityAcpRuntime } from "../t3/antigravityAcpRuntime.ts";
import { makeAntigravityAuth } from "../t3/AntigravityAuth.ts";
import {
  buildAntigravityAcpSpawnInput,
  isAntigravitySignInRequiredError,
  makeAntigravityStdoutTransform,
  prepareAntigravityProfile,
  resolveAntigravityInstanceDirectories,
} from "../t3/antigravityAuthSupport.ts";
import type * as AntigravityInstallation from "../t3/AntigravityInstallation.ts";
import { ProviderInstanceId, ProviderSetupError } from "../t3/contracts-antigravity.ts";

type Registro = Record<string, unknown>;
const registro = (valor: unknown): Registro => (typeof valor === "object" && valor !== null ? (valor as Registro) : {});
const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");

/** Entrada do normalizador: o que o cliente ACP entrega, na ordem. */
export type EntradaAcp =
  | { readonly tipo: "session/update"; readonly notificacao: unknown }
  | { readonly tipo: "session/prompt"; readonly resposta: unknown };

/**
 * Nome da ferramenta: o `name` (extensão do Antigravity), ou o `title`, ou o `kind`. O Antigravity
 * chama as ferramentas MCP de `mcp_<servidor>_<ferramenta>`; com os servidores da sessão, vira
 * `<servidor>.<ferramenta>`, como nos outros providers.
 */
function nomeFerramenta(atualizacao: Registro, servidores: ReadonlyArray<string> = []): string {
  const nome = texto(atualizacao.name) || texto(atualizacao.title) || texto(atualizacao.kind) || "ferramenta";
  for (const servidor of servidores) {
    const prefixo = `mcp_${servidor}_`;
    if (nome.startsWith(prefixo)) return `${servidor}.${nome.slice(prefixo.length)}`;
  }
  return nome;
}

/** O Antigravity injeta `toolSummary` (um resumo em inglês) nos argumentos; ele não foi para o MCP. */
function entradaFerramenta(atualizacao: Registro): unknown {
  const { toolSummary: _resumo, ...resto } = registro(atualizacao.rawInput);
  return resto;
}

/**
 * Traduz `session/update` e a resposta do `session/prompt` em eventos. Os pedaços de texto se
 * acumulam até o fim do turno (ou até uma ferramenta), quando viram `TextoFinal`: o ACP não manda
 * a mensagem completa.
 */
export function criarNormalizadorAntigravity(
  servidores: ReadonlyArray<string> = [],
): (entrada: EntradaAcp) => ReadonlyArray<Evento> {
  const nomes = new Map<string, string>();
  const iniciadas = new Set<string>();
  let acumulado = "";
  const fecharTexto = (): Array<Evento> => {
    const final = acumulado;
    acumulado = "";
    return final.trim() === "" ? [] : [{ _tag: "TextoFinal", texto: final }];
  };
  return (entrada) => {
    if (entrada.tipo === "session/prompt") {
      const resposta = registro(entrada.resposta);
      const uso = registro(resposta.usage);
      const eventos: Array<Evento> = fecharTexto();
      if (resposta.usage) {
        eventos.push({
          _tag: "UsoTokens",
          entrada: Number(uso.inputTokens ?? 0),
          saida: Number(uso.outputTokens ?? 0),
          ...(typeof uso.cachedReadTokens === "number" ? { cacheLeitura: uso.cachedReadTokens } : {}),
        });
      }
      if (resposta.error) eventos.push({ _tag: "Erro", mensagem: resumir(texto(registro(resposta.error).message)) });
      eventos.push({ _tag: "FimTurno", motivo: texto(resposta.stopReason) || "end_turn" });
      return eventos;
    }
    const atualizacao = registro(registro(entrada.notificacao).update);
    switch (atualizacao.sessionUpdate) {
      case "agent_message_chunk": {
        const pedaco = textoDeBlocos([atualizacao.content]);
        acumulado += pedaco;
        return pedaco === "" ? [] : [{ _tag: "TextoParcial", texto: pedaco }];
      }
      case "agent_message":
        acumulado = "";
        return [{ _tag: "TextoFinal", texto: textoDeBlocos([atualizacao.content]) }];
      case "tool_call":
      case "tool_call_update": {
        const id = texto(atualizacao.toolCallId);
        if (atualizacao.sessionUpdate === "tool_call" || atualizacao.name || atualizacao.title) {
          if (!nomes.has(id)) nomes.set(id, nomeFerramenta(atualizacao, servidores));
        }
        const eventos: Array<Evento> = [];
        if (!iniciadas.has(id)) {
          iniciadas.add(id);
          eventos.push(...fecharTexto());
          eventos.push({
            _tag: "FerramentaIniciada",
            id,
            nome: nomes.get(id) ?? nomeFerramenta(atualizacao, servidores),
            entrada: entradaFerramenta(atualizacao),
          });
        }
        if (atualizacao.status === "completed" || atualizacao.status === "failed") {
          const conteudo = atualizacao.rawOutput ?? textoDeBlocos(atualizacao.content);
          eventos.push({
            _tag: "FerramentaConcluida",
            id,
            nome: nomes.get(id) ?? nomeFerramenta(atualizacao, servidores),
            // O `agy` 1.5.3 não manda o resultado das ferramentas (sem `rawOutput` nem `content`).
            resumo: resumir(
              typeof conteudo === "string" ? conteudo : textoDeBlocos(registro(conteudo).content) || conteudo,
            ),
            falhou: atualizacao.status === "failed",
          });
        }
        return eventos;
      }
      default:
        return [];
    }
  };
}

const PROVIDER = "antigravity" as const;
/** Código JSON-RPC que o `agy` devolve no `authenticate` quando falta login (`antigravityAuthSupport.ts` do T3). */
const CODIGO_SEM_LOGIN = -32000;
const METODO_LOGIN = "oauth-personal";

/**
 * Servidores MCP no formato do ACP: stdio (`command` com caminho absoluto) ou HTTP
 * (`McpServerHttp`, `type: "http"`, com os cabeçalhos em lista `{ name, value }`).
 */
export function mcpServersAcp(config: ConfigSessao): ReadonlyArray<AcpSchema.McpServer> {
  return config.servidoresMcp.map((servidor) =>
    servidor.tipo === "http"
      ? {
          type: "http" as const,
          name: servidor.nome,
          url: servidor.url,
          headers: Object.entries(servidor.cabecalhos ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          name: servidor.nome,
          command: servidor.comando,
          args: [...servidor.argumentos],
          env: Object.entries(servidor.ambiente ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}

/**
 * Confere, pelo `initialize`, se o agente aceita os servidores MCP da sessão. O stdio é obrigatório
 * no ACP; o HTTP só vale com `agentCapabilities.mcpCapabilities.http`. Devolve o motivo da recusa,
 * ou nada se o agente aceita todos. Sem suporte, a sessão falha: não cai para stdio em silêncio.
 */
export function recusaMcpAcp(inicio: AcpSchema.InitializeResponse, config: ConfigSessao): string | undefined {
  const http = config.servidoresMcp.filter((servidor) => servidor.tipo === "http");
  if (http.length === 0 || inicio.agentCapabilities?.mcpCapabilities?.http === true) return undefined;
  const versao = inicio.agentInfo?.version ? ` (${inicio.agentInfo.version})` : "";
  return `o agy${versao} não anuncia MCP por HTTP (mcpCapabilities.http) no initialize; servidores HTTP da sessão: ${http.map((servidor) => servidor.nome).join(", ")}`;
}

/** Dono do fluxo de login no `ProviderAuthController` do T3 (um app, um dono). */
const DONO_LOGIN = "simplifica-if";
const INSTANCIA = ProviderInstanceId.make("antigravity");

export const make = Effect.fn("DriverAntigravity.make")(function* (opcoes: {
  readonly ambiente: Ambiente;
  /** Pasta de estado do app: o perfil próprio fica em `<pastaEstado>/providers/antigravity/<hash>`. */
  readonly pastaEstado: string;
  /** A instalação do T3: a cópia gerenciada, ou o `binario` indicado. */
  readonly instalacao: AntigravityInstallation.AntigravityInstallation["Service"];
  /** Executável próprio (o `binaryPath` do T3); vazio, a instalação gerenciada. */
  readonly binario?: string;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ambienteNode = limparAmbiente(opcoes.ambiente) as NodeJS.ProcessEnv;
  const binario = opcoes.binario ?? "";
  // Perfil próprio, como no T3: GEMINI_HOME do app, sem o login, os MCP, os hooks e as chaves do
  // usuário (o `agy` do terminal e o app Antigravity continuam com os deles).
  const pastas = yield* resolveAntigravityInstanceDirectories(opcoes.pastaEstado, INSTANCIA);
  const arquivoToken = path.join(pastas.profile, "antigravity-acp", "acp_token.json");

  const comServicos = <A, E>(
    efeito: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner>,
  ) =>
    efeito.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

  /** Executável reservado, perfil preparado e a entrada de spawn do `agy acp`, como no `AntigravityDriver` do T3. */
  const prepararSpawn = Effect.fn("DriverAntigravity.prepararSpawn")(function* (pasta: string) {
    const executavel = yield* opcoes.instalacao.acquire(binario, ambienteNode);
    const perfil = yield* comServicos(
      prepareAntigravityProfile({
        profileDirectory: pastas.profile,
        baseEnv: ambienteNode,
        tempDirectory: pastas.runtimeTemp,
      }),
    );
    // Uma pasta temporária por processo; o T3 faz o mesmo para não apagar arquivos de outra sessão.
    const temporaria = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: perfil.tempDirectory, prefix: "run-" }),
      (pastaTemp) => fs.remove(pastaTemp, { recursive: true, force: true }).pipe(Effect.ignore),
    );
    return {
      executavel,
      spawn: buildAntigravityAcpSpawnInput({
        installation: executavel,
        profile: perfil,
        cwd: pasta,
        baseEnv: ambienteNode,
        runtimeTempDirectory: temporaria,
      }),
    };
  });

  const abrir = Effect.fn("DriverAntigravity.abrir")(function* (pasta: string) {
    const { spawn } = yield* prepararSpawn(pasta).pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "preparar agy acp")));
    const filho = yield* spawner
      .spawn(
        ChildProcess.make(spawn.command, [...spawn.args], {
          cwd: pasta,
          ...(spawn.env ? { env: spawn.env } : {}),
          extendEnv: false,
          forceKillAfter: "2 seconds",
        }),
      )
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "abrir agy acp")));
    // Sem login, o `agy` imprime a URL de autorização; o transform do T3 a troca pelo erro de "sem login".
    const contexto = yield* Layer.build(
      AcpClient.layerChildProcess(filho, { transformStdout: makeAntigravityStdoutTransform() }),
    );
    const cliente = yield* Effect.service(AcpClient.AcpClient).pipe(Effect.provide(contexto));
    const inicio = yield* cliente.agent
      .initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "simplifica-if", title: "Simplifica IF", version: "0.1.0" },
      })
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "initialize")));
    const login = yield* cliente.agent.authenticate({ methodId: METODO_LOGIN }).pipe(
      Effect.as(true),
      Effect.catch((erro) =>
        isAntigravitySignInRequiredError(erro) || (erro._tag === "AcpRequestError" && erro.code === CODIGO_SEM_LOGIN)
          ? Effect.succeed(false)
          : Effect.fail(Canal.falhaDe(PROVIDER, "login")(erro)),
      ),
    );
    return { cliente, inicio, login };
  });

  // O fluxo de login do T3 (`AntigravityAuth`): um `agy acp` descartável numa pasta temporária, com o
  // BROWSER trocado por um ajudante que entrega a URL em vez de abrir o navegador.
  const login = yield* makeAntigravityAuth({
    instanceId: INSTANCIA,
    makeRuntime: Effect.fn("DriverAntigravity.runtimeDeLogin")(
      function* (entrada) {
        const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-antigravity-login-" });
        const { executavel, spawn } = yield* prepararSpawn(pasta);
        return yield* makeAntigravityAcpRuntime({
          spawn,
          cwd: pasta,
          childProcessSpawner: spawner,
          runtimeVersion: executavel.version,
          ...(entrada.onAuthorizationUrl ? { onAuthorizationUrl: entrada.onAuthorizationUrl } : {}),
        });
      },
      Effect.catchTags({
        AntigravityInstallationError: (erro) =>
          Effect.fail(
            new ProviderSetupError({ instanceId: INSTANCIA, operation: "resolve", detail: erro.detail, cause: erro }),
          ),
        PlatformError: (erro) =>
          Effect.fail(
            new ProviderSetupError({
              instanceId: INSTANCIA,
              operation: "start",
              detail: "Não foi possível preparar o perfil do Antigravity para o login.",
              cause: erro,
            }),
          ),
      }),
    ),
    onAuthenticated: () => Effect.void,
    onSignedOut: Effect.void,
    usesBrowser: true,
  });

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    // O T3 não abre processo na detecção (o runtime antigo descompactava ~1 GB a cada execução). O
    // `agy` 1.5.x é um binário só, e no macOS guarda o login no Keychain, não no `acp_token.json` do
    // perfil: sem o arquivo, a detecção pergunta ao próprio `agy acp` (initialize + authenticate).
    const resolvido = yield* opcoes.instalacao.resolve(binario, ambienteNode).pipe(Effect.option);
    if (Option.isNone(resolvido)) {
      return {
        provider: PROVIDER,
        instalado: false,
        autenticado: false,
        mensagem: "Antigravity não instalado: use instalar",
      } satisfies EstadoProvider;
    }
    const comToken = yield* fs.exists(arquivoToken).pipe(Effect.orElseSucceed(() => false));
    const autenticado =
      comToken ||
      (yield* Effect.scoped(
        Effect.gen(function* () {
          const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-antigravity-detectar-" });
          return (yield* abrir(pasta)).login;
        }),
      ).pipe(
        Effect.timeout("30 seconds"),
        Effect.orElseSucceed(() => false),
      ));
    return {
      provider: PROVIDER,
      instalado: true,
      origem: resolvido.value.source === "managed" ? "gerenciada" : "local",
      autenticado,
      ...(resolvido.value.version ? { versao: resolvido.value.version } : {}),
      ...(autenticado ? { metodo: METODO_LOGIN } : { mensagem: "Antigravity sem login no app: use entrar" }),
    } satisfies EstadoProvider;
  });

  const iniciar = Effect.fn("DriverAntigravity.iniciar")(function* (config: ConfigSessao) {
    const canal = yield* Canal.make;
    const gravar = yield* Gravador;
    const escopo = yield* Effect.scope;
    const aberto = yield* abrir(config.pastaTrabalho);
    if (!aberto.login) {
      return yield* new FalhaProvider({
        provider: PROVIDER,
        operacao: "login",
        detalhe: "Antigravity sem login no app: use entrar",
      });
    }
    const cliente = aberto.cliente;
    const recusa = recusaMcpAcp(aberto.inicio, config);
    if (recusa !== undefined) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "session/new", detalhe: recusa });
    }
    const normalizar = criarNormalizadorAntigravity(config.servidoresMcp.map((servidor) => servidor.nome));
    const processar = (entrada: EntradaAcp) =>
      Effect.suspend(() => {
        gravar("entrada", entrada);
        return Effect.forEach(normalizar(entrada), canal.emitir, { discard: true });
      });

    yield* cliente.handleSessionUpdate((notificacao) => processar({ tipo: "session/update", notificacao }));
    yield* cliente.handleRequestPermission((pedido) =>
      Effect.gen(function* () {
        gravar("entrada", { tipo: "session/request_permission", pedido });
        const ferramenta = nomeFerramenta(
          registro(pedido.toolCall),
          config.servidoresMcp.map((servidor) => servidor.nome),
        );
        // No perfil próprio o `agy` pede permissão até para MCP. Ferramentas de servidores pré-aprovados
        // (as de leitura do ifpr) passam sem perguntar, como no `allowedTools` do Claude e no
        // `default_tools_approval_mode` do Codex.
        const preAprovada = config.servidoresMcp.some(
          (servidor) => servidor.preAprovado && ferramenta.startsWith(`${servidor.nome}.`),
        );
        const decisao = preAprovada
          ? ("permitir" as const)
          : yield* canal.pedirAprovacao({
              id: pedido.toolCall.toolCallId,
              ferramenta,
              descricao: pedido.title ?? pedido.toolCall.title ?? "permitir ação",
              entrada: entradaFerramenta(registro(pedido.toolCall)),
            });
        const tipos = decisao === "permitir" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
        const opcao = pedido.options.find((candidata) => tipos.includes(candidata.kind));
        const resposta: AcpSchema.RequestPermissionResponse =
          opcao === undefined
            ? { outcome: { outcome: "cancelled" } }
            : { outcome: { outcome: "selected", optionId: opcao.optionId } };
        gravar("saida", { tipo: "session/request_permission", resposta });
        return resposta;
      }),
    );

    const sessao = yield* cliente.agent
      .createSession({ cwd: config.pastaTrabalho, mcpServers: mcpServersAcp(config) })
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "session/new")));
    const sessionId = sessao.sessionId;

    return {
      enviar: (mensagem) =>
        canal.turno(
          Effect.sync(() => gravar("saida", { tipo: "session/prompt", texto: mensagem })).pipe(
            Effect.andThen(
              cliente.agent.prompt({ sessionId, prompt: [{ type: "text", text: mensagem }] }).pipe(
                Effect.flatMap((resposta) => processar({ tipo: "session/prompt", resposta })),
                Effect.catch((erro) => canal.falhar(Canal.falhaDe(PROVIDER, "session/prompt")(erro))),
                Effect.forkIn(escopo),
              ),
            ),
            Effect.asVoid,
          ),
        ),
      responder: canal.responder,
      interromper: cliente.agent.cancel({ sessionId }).pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "cancel"))),
    } satisfies Effect.Success<ReturnType<Driver["iniciar"]>>;
  });

  return {
    detectar,
    iniciar,
    instalar: acompanharInstalacao(PROVIDER, opcoes.instalacao),
    entrar: acompanharLogin(PROVIDER, login.controller.start(DONO_LOGIN), login.controller.subscribe(DONO_LOGIN)),
  } satisfies Driver;
});
