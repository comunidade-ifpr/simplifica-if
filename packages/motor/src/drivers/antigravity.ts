/**
 * Driver do Antigravity (Gemini) pelo ACP (`agy acp`, JSON-RPC por stdio) e o cliente
 * `@simplifica-if/effect-acp`, copiado do T3. O login é o do usuário (`oauth-personal`).
 *
 * - O MCP entra em `mcpServers` do `session/new`, por stdio ou por HTTP (este só se o `initialize`
 *   anunciar `mcpCapabilities.http`, como no `AcpSessionRuntime` do T3).
 * - `initialize` e `authenticate` (eager, como no T3) também servem de detecção: o código -32000
 *   no `authenticate` quer dizer "sem login".
 * - `session/request_permission` se classifica (`classificarAcp`) e passa pela política; `perguntar`
 *   vira `PedidoAprovacao`. O turno termina com a resposta do `session/prompt` (`stopReason`).
 * - As instruções da sessão (com as skills do app) e as ferramentas desligadas (busca web) vão no
 *   `_meta.antigravity` do `session/new` (e do `session/load`), como no T3.
 * - Telemetria: `agy acp --disable-telemetry`, sem as `OTEL_*` herdadas.
 * - **Retomada:** `session/load` quando o `initialize` anuncia `loadSession` (como o
 *   `AcpSessionRuntime` do T3), senão `session/resume` se anunciado; sem nenhum dos dois, a sessão
 *   falha na operação `retomar`. O `session/load` repete o histórico em `session/update`, que fica de
 *   fora dos eventos: fora de um turno, as atualizações não viram eventos.
 * - **Queda:** quando o processo do `agy` acaba, o turno corrente falha e a sessão recusa os próximos.
 */
import * as AcpClient from "@simplifica-if/effect-acp/client";
import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as OpcoesAcp from "../acp/opcoes-sessao.ts";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type DeteccaoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type AlvoWeb, alvoWeb, erroDoTurno, type Evento, type MotivoFim, resumir, textoDeBlocos } from "../eventos.ts";
import {
  ambienteSemTelemetria,
  buscaWebLigada,
  caminhosDoComando,
  type ClassePedido,
  type Politica,
  TELEMETRIA_ANTIGRAVITY_ARGS,
} from "../politica.ts";
import { acompanharInstalacao, acompanharLogin } from "../estados.ts";
import type { ModeloProvider } from "../estados-provider.ts";
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
import { antigravitySessionMeta } from "../t3/AntigravityAcpSupport.ts";
import type * as AntigravityInstallation from "../t3/AntigravityInstallation.ts";
import { ProviderInstanceId, ProviderSetupError } from "../t3/contracts-antigravity.ts";
import { type Registro, registro, texto } from "./json.ts";

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
  opcoes: { readonly semFerramentas?: boolean } = {},
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
      if (resposta.error) eventos.push(erroDoTurno(texto(registro(resposta.error).message)));
      // `stopReason` do ACP: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`.
      const motivo: MotivoFim = resposta.error
        ? "falha"
        : resposta.stopReason === "cancelled"
          ? "interrompido"
          : "concluido";
      eventos.push({ _tag: "FimTurno", motivo });
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
          const entrada = entradaFerramenta(atualizacao);
          const classe = classificarAcp(atualizacao, servidores);
          const web = classe.tipo === "web" ? alvoWebAcp(nomeFerramenta(atualizacao, servidores), entrada) : undefined;
          eventos.push({
            _tag: "FerramentaIniciada",
            id,
            nome: nomes.get(id) ?? nomeFerramenta(atualizacao, servidores),
            tipo: classe.tipo,
            ...(web === undefined ? {} : { web }),
            entrada,
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
      default: {
        // No lado seguro: numa sessão de julgamento, atualização fora das benignas conhecidas conta
        // como ferramenta (e descarta o bloco).
        const tipo = texto(atualizacao.sessionUpdate);
        return opcoes.semFerramentas === true && !ATUALIZACOES_SEM_FERRAMENTA.has(tipo)
          ? [
              {
                _tag: "FerramentaIniciada",
                id: `atualizacao-${tipo}`,
                nome: `atualizacao.${tipo || "desconhecida"}`,
                tipo: "outra",
                entrada: {},
              },
            ]
          : [];
      }
    }
  };
}

/**
 * As atualizações do ACP que não são ferramenta: as vistas nas gravações reais do `agy` 1.5.x
 * (`test/fixtures/antigravity-*.jsonl`) e as de estado da sessão do protocolo.
 */
const ATUALIZACOES_SEM_FERRAMENTA = new Set([
  "agent_message_chunk",
  "agent_message",
  "agent_thought_chunk",
  "user_message_chunk",
  "available_commands_update",
  "config_option_update",
  "session_info_update",
  "current_mode_update",
  "usage_update",
  "plan",
]);

/**
 * Ferramentas de busca e leitura web do `agy` 1.5.x, controladas por `buscaWebLigada`.
 * Conferido no `agy` 1.5.14: `search_web` roda direto (sem `session/request_permission`) e
 * `read_url_content` não vem exposta no ACP (mantida aqui e no `classificarAcp` por defesa em profundidade).
 */
export const FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY = ["search_web", "read_url_content"] as const;

/** Automação de navegador do `agy` 1.5.x: sempre em `disabledTools`, mesmo com busca web ligada. */
export const FERRAMENTAS_NAVEGADOR_ANTIGRAVITY = ["browser_subagent", "browser"] as const;

/** As ferramentas que vão em `_meta.antigravity.disabledTools` conforme a política e o modo da sessão. */
export function ferramentasDesligadasAntigravity(politica: Politica, semFerramentas: boolean): ReadonlyArray<string> {
  if (semFerramentas) return FERRAMENTAS_ANTIGRAVITY;
  return buscaWebLigada(politica)
    ? FERRAMENTAS_NAVEGADOR_ANTIGRAVITY
    : [...FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY, ...FERRAMENTAS_NAVEGADOR_ANTIGRAVITY];
}

/**
 * Todas as ferramentas do `agy` 1.5.9 que se conhecem (as `strings` do binário e as gravações em
 * `test/fixtures/`), desligadas no `_meta.antigravity.disabledTools` numa sessão `semFerramentas`. Nome
 * que a versão não tem não atrapalha; nome novo que falte aqui ainda passa pela política de
 * julgamento (nega sem perguntar) e pelo julgamento, que descarta o bloco que tentar ferramenta.
 */
export const FERRAMENTAS_ANTIGRAVITY = [
  ...FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY,
  ...FERRAMENTAS_NAVEGADOR_ANTIGRAVITY,
  "read_file",
  "view_file",
  "list_dir",
  "list_directory",
  "glob",
  "grep_search",
  "view_code_item",
  "run_command",
  "command_status",
  "write_file",
  "write_to_file",
  "replace",
  "read_resource",
  "plan",
  "teamwork",
  "schedule",
  "learn",
  "goal",
  "compact",
  "boost",
] as const;

/** Os arquivos que o `agy` 1.5.9 grava por sessão no perfil (`<perfil>/antigravity-acp/…`). */
export function arquivosDaSessaoAntigravity(
  juntar: (...partes: string[]) => string,
  perfil: string,
  sessionId: string,
): string[] {
  // Só um id com cara de UUID: o nome entra num caminho que se apaga.
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return [];
  const acp = juntar(perfil, "antigravity-acp");
  return [
    juntar(acp, "conversations", `${sessionId}.db`),
    juntar(acp, "conversations", `${sessionId}.db-wal`),
    juntar(acp, "conversations", `${sessionId}.db-shm`),
    juntar(acp, "brain", sessionId),
    juntar(acp, "annotations", `${sessionId}.pbtxt`),
  ];
}

const CHAVE_DE_CAMINHO = /path|file|dir|cwd/i;
const CHAVE_DE_URL = /(?:url|uri)$/i;
const CHAVE_DE_CONSULTA = /query/i;

/** O alvo de uma ferramenta web do `agy`: a URL que `read_url_content` lê, ou a consulta de `search_web`. */
function alvoWebAcp(nome: string, entrada: unknown): AlvoWeb | undefined {
  const valores = Object.entries(registro(entrada));
  const primeiro = (chave: RegExp) =>
    valores.find(([nome, valor]) => chave.test(nome) && typeof valor === "string")?.[1];
  return nome === "read_url_content"
    ? alvoWeb("ler", primeiro(CHAVE_DE_URL))
    : alvoWeb("pesquisar", primeiro(CHAVE_DE_CONSULTA));
}

/**
 * Classifica o `toolCall` de um `session/request_permission` pelo nome (MCP e busca/leitura web
 * conhecidas) e pelo `kind` do ACP: `read`/`search` são leitura; `edit`/`delete`/`move`, escrita;
 * `execute`, comando. Só `search_web` e `read_url_content`, pelo nome (antes do `kind`), viram
 * `web`; `read_url_content` exige URL extraível (sem ela, `avaliar` nega); qualquer outro `fetch`
 * cai em `outra` (pergunta). Os caminhos vêm de `locations` e das chaves de caminho da entrada.
 */
export function classificarAcp(toolCall: Registro, servidoresApp: ReadonlyArray<string>): ClassePedido {
  const nome = nomeFerramenta(toolCall, servidoresApp);
  const entrada = registro(toolCall.rawInput);
  const servidor = /^([^.]+)\./.exec(nome)?.[1] ?? (nome === "read_resource" ? texto(entrada.ServerName) : undefined);
  if (servidor !== undefined && servidoresApp.includes(servidor)) return { tipo: "mcp-app", caminhos: [] };
  if (nome.startsWith("mcp_") || nome.includes(".") || nome === "read_resource")
    return { tipo: "mcp-outro", caminhos: [] };
  if ((FERRAMENTAS_BUSCA_WEB_ANTIGRAVITY as ReadonlyArray<string>).includes(nome)) {
    const exigeUrl = nome === "read_url_content";
    const urls = Object.entries(entrada).flatMap(([chave, valor]) =>
      typeof valor === "string" && valor.trim() !== "" && CHAVE_DE_URL.test(chave) ? [valor] : [],
    );
    return {
      tipo: "web",
      caminhos: [],
      ...(urls.length > 0 ? { urls } : {}),
      ...(exigeUrl ? { exigeUrl: true } : {}),
    };
  }
  const caminhos = [
    ...(Array.isArray(toolCall.locations) ? toolCall.locations.map((local) => texto(registro(local).path)) : []),
    ...Object.entries(entrada).flatMap(([chave, valor]) =>
      typeof valor === "string" && CHAVE_DE_CAMINHO.test(chave) ? [valor] : [],
    ),
  ].filter((caminho) => caminho !== "");
  switch (toolCall.kind) {
    case "read":
    case "search":
      return { tipo: "leitura", caminhos };
    case "edit":
    case "delete":
    case "move":
      return { tipo: "escrita", caminhos };
    case "execute": {
      const comando = Object.values(entrada).find((valor) => typeof valor === "string" && valor.includes(" "));
      return {
        tipo: "comando",
        caminhos: [...caminhos, ...(typeof comando === "string" ? caminhosDoComando(comando) : [])],
      };
    }
    default:
      return { tipo: "outra", caminhos };
  }
}

const PROVIDER = "antigravity" as const;
/** Código JSON-RPC que o `agy` devolve no `authenticate` quando falta login (`antigravityAuthSupport.ts` do T3). */
const CODIGO_SEM_LOGIN = -32000;
const METODO_LOGIN = "oauth-personal";
/** Quanto a detecção espera pelo `session/new` da sessão descartável em que sonda os modelos. */
const PRAZO_SESSAO_DE_SONDA = "10 seconds";
/** Por quanto tempo a lista de modelos sondada vale; a conta muda de modelos raramente. */
const VALIDADE_MODELOS_MS = 10 * 60 * 1000;

/**
 * Servidores MCP no formato do ACP: stdio (`command` com caminho absoluto) ou HTTP
 * (`McpServerHttp`, `type: "http"`, com os cabeçalhos em lista `{ name, value }`).
 */
/**
 * Comando que roda a ponte stdio → HTTP do T3 (`AcpMcpStdioBridge`), para agentes ACP que não
 * anunciam MCP por HTTP. No app é o próprio executável com um subcomando; no harness,
 * `node packages/motor/scripts/ponte-mcp.ts`.
 */
export interface PonteMcp {
  readonly comando: string;
  readonly argumentos: ReadonlyArray<string>;
}

/**
 * Servidores MCP no formato do ACP, como o `acpMcpContext` do T3: HTTP quando o agente anuncia
 * `mcpCapabilities.http`; senão, a ponte stdio, com a URL e o `Authorization` no `env` do servidor
 * (nunca na linha de comando). O `command` do stdio precisa ser caminho absoluto.
 */
export function mcpServersAcp(
  config: ConfigSessao,
  opcoes: { readonly http: boolean; readonly ponte?: PonteMcp },
): ReadonlyArray<AcpSchema.McpServer> {
  return config.servidoresMcp.flatMap((servidor): ReadonlyArray<AcpSchema.McpServer> => {
    if (opcoes.http) {
      return [
        {
          type: "http" as const,
          name: servidor.nome,
          url: servidor.url,
          headers: Object.entries(servidor.cabecalhos ?? {}).map(([name, value]) => ({ name, value })),
        },
      ];
    }
    if (opcoes.ponte === undefined) return [];
    return [
      {
        name: servidor.nome,
        command: opcoes.ponte.comando,
        args: [...opcoes.ponte.argumentos],
        env: [
          // Como no T3: o app desktop roda como Node pelo Electron.
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "T3_ACP_MCP_ENDPOINT", value: servidor.url },
          { name: "T3_ACP_MCP_AUTHORIZATION", value: servidor.cabecalhos?.Authorization ?? "" },
        ],
      },
    ];
  });
}

/**
 * Motivo para recusar a sessão, ou nada: servidor HTTP com um agente que não anuncia HTTP e sem a
 * ponte stdio configurada. Não cai para nada em silêncio.
 */
export function recusaMcpAcp(
  inicio: AcpSchema.InitializeResponse,
  config: ConfigSessao,
  ponte: PonteMcp | undefined,
): string | undefined {
  if (
    config.servidoresMcp.length === 0 ||
    inicio.agentCapabilities?.mcpCapabilities?.http === true ||
    ponte !== undefined
  ) {
    return undefined;
  }
  const versao = inicio.agentInfo?.version ? ` (${inicio.agentInfo.version})` : "";
  return `o agy${versao} não anuncia MCP por HTTP (mcpCapabilities.http) e não há ponte stdio configurada; servidores HTTP da sessão: ${config.servidoresMcp.map((servidor) => servidor.nome).join(", ")}`;
}

/**
 * Retoma uma sessão ACP: `session/load` se o agente anuncia `loadSession`, senão `session/resume` se
 * anuncia `sessionCapabilities.resume` (a ordem do `AcpSessionRuntime` do T3); sem nenhum, falha na
 * operação `retomar`, e quem chamou recomeça com o histórico como contexto.
 */
const retomarSessao = (
  inicio: AcpSchema.InitializeResponse,
  cliente: AcpClient.AcpClient["Service"],
  pedido: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly mcpServers: ReadonlyArray<AcpSchema.McpServer>;
    readonly _meta?: Exclude<AcpSchema.NewSessionRequest["_meta"], undefined>;
  },
): Effect.Effect<OpcoesAcp.OpcoesDaSessao, FalhaProvider> => {
  const capacidades = inicio.agentCapabilities;
  if (capacidades?.loadSession === true) {
    return cliente.agent.loadSession(pedido).pipe(
      Effect.map((resposta) => ({
        sessionId: pedido.sessionId,
        configOptions: resposta.configOptions,
        models: resposta.models,
      })),
      Effect.mapError(Canal.falhaDe(PROVIDER, "retomar")),
    );
  }
  if (capacidades?.sessionCapabilities?.resume != null) {
    return cliente.agent.resumeSession(pedido).pipe(
      Effect.map((resposta) => ({
        sessionId: pedido.sessionId,
        configOptions: resposta.configOptions,
        models: resposta.models,
      })),
      Effect.mapError(Canal.falhaDe(PROVIDER, "retomar")),
    );
  }
  const versao = inicio.agentInfo?.version ? ` ${inicio.agentInfo.version}` : "";
  return Effect.fail(
    new FalhaProvider({
      provider: PROVIDER,
      operacao: "retomar",
      tipo: "versao",
      cause: new Error(`o agy${versao} não anuncia session/load nem session/resume`),
    }),
  );
};

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
  /** Ponte stdio → HTTP para o MCP, quando o `agy` não anuncia HTTP (o 1.5.9 não anuncia). */
  readonly ponteMcp?: PonteMcp;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ambienteNode = ambienteSemTelemetria(PROVIDER, limparAmbiente(opcoes.ambiente)) as NodeJS.ProcessEnv;
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
    const spawn = buildAntigravityAcpSpawnInput({
      installation: executavel,
      profile: perfil,
      cwd: pasta,
      baseEnv: ambienteNode,
      runtimeTempDirectory: temporaria,
    });
    // Telemetria desligada em todo `agy acp` do app: sessão, detecção e login.
    return { executavel, spawn: { ...spawn, args: [...spawn.args, ...TELEMETRIA_ANTIGRAVITY_ARGS] } };
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
    return { cliente, inicio, login, filho };
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

  /** Os modelos da última sondagem, da versão do `agy` em que foi feita e até quando valem. */
  let modelosGuardados:
    | { readonly versao: string | undefined; readonly ate: number; readonly modelos: ReadonlyArray<ModeloProvider> }
    | undefined;

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
      } satisfies DeteccaoProvider;
    }
    const comToken = yield* fs.exists(arquivoToken).pipe(Effect.orElseSucceed(() => false));
    const versao = resolvido.value.version ?? undefined;
    const agora = yield* Clock.currentTimeMillis;
    const guardados =
      modelosGuardados !== undefined && modelosGuardados.versao === versao && agora < modelosGuardados.ate
        ? modelosGuardados.modelos
        : undefined;
    // Os modelos só existem dentro de uma sessão: com login, a detecção abre uma descartável e a sonda
    // (`OpcoesAcp.sondarModelos`), e guarda a lista por `VALIDADE_MODELOS`. Com a lista guardada, a
    // detecção custa o de antes: nenhum processo com o `acp_token.json`, ou só o `agy acp` do login.
    const sondagem =
      comToken && guardados !== undefined
        ? { login: true, modelos: guardados }
        : yield* Effect.scoped(
            Effect.gen(function* () {
              const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-antigravity-detectar-" });
              let idDaSonda: string | undefined;
              // Antes de abrir o processo, para rodar depois que ele termina (como na sessão de julgamento).
              yield* Effect.addFinalizer(() =>
                idDaSonda === undefined
                  ? Effect.void
                  : Effect.forEach(
                      arquivosDaSessaoAntigravity(path.join, pastas.profile, idDaSonda),
                      (alvo) => fs.remove(alvo, { recursive: true, force: true }).pipe(Effect.ignore),
                      { discard: true },
                    ),
              );
              // Cada passo tem o seu prazo: a demora da sondagem não tira o login já conferido.
              const aberto = yield* abrir(pasta).pipe(Effect.timeout("30 seconds"), Effect.option);
              if (Option.isNone(aberto) || !aberto.value.login) return { login: false, modelos: [] };
              if (guardados !== undefined) return { login: true, modelos: guardados };
              const agente = aberto.value.cliente.agent;
              const modelos = yield* agente.createSession({ cwd: pasta, mcpServers: [] }).pipe(
                Effect.timeout(PRAZO_SESSAO_DE_SONDA),
                Effect.tap((sessao) => Effect.sync(() => (idDaSonda = sessao.sessionId))),
                Effect.flatMap((sessao) => OpcoesAcp.sondarModelos(agente, sessao)),
                Effect.tapError((erro) => Effect.logWarning("Antigravity: a sondagem dos modelos falhou", erro)),
                Effect.orElseSucceed((): ReadonlyArray<ModeloProvider> => []),
              );
              return { login: true, modelos };
            }),
          ).pipe(Effect.orElseSucceed(() => ({ login: false, modelos: [] as ReadonlyArray<ModeloProvider> })));
    // A lista vazia e a de quem saiu da conta não ficam guardadas.
    modelosGuardados =
      sondagem.login && sondagem.modelos.length > 0
        ? guardados === undefined
          ? { versao, ate: agora + VALIDADE_MODELOS_MS, modelos: sondagem.modelos }
          : modelosGuardados
        : undefined;
    const autenticado = comToken || sondagem.login;
    return {
      provider: PROVIDER,
      instalado: true,
      origem: resolvido.value.source === "managed" ? "gerenciada" : "local",
      autenticado,
      ...(versao ? { versao } : {}),
      ...(autenticado ? { metodo: METODO_LOGIN } : { mensagem: "Antigravity sem login no app: use entrar" }),
      ...(sondagem.modelos.length > 0 ? { modelos: sondagem.modelos } : {}),
    } satisfies DeteccaoProvider;
  });

  const iniciar = Effect.fn("DriverAntigravity.iniciar")(function* (config: ConfigSessao, politica: Politica) {
    const canal = yield* Canal.comPolitica(politica, config.pastaTrabalho);
    const gravar = yield* Gravador;
    const escopo = yield* Effect.scope;
    // Julgamento: o `agy` guarda a conversa no perfil próprio do app (`conversations/<id>.db`,
    // `brain/<id>/`, `annotations/<id>.pbtxt`, conferido no 1.5.9), com o texto do pedido. A sessão de
    // julgamento não é retomada, então esses arquivos se apagam no fim. Registrado antes de abrir o
    // processo, o finalizador roda depois que ele termina.
    let idDaSessao: string | undefined;
    if (config.semFerramentas === true)
      yield* Effect.addFinalizer(() =>
        idDaSessao === undefined
          ? Effect.void
          : Effect.forEach(
              arquivosDaSessaoAntigravity(path.join, pastas.profile, idDaSessao),
              (alvo) => fs.remove(alvo, { recursive: true, force: true }).pipe(Effect.ignore),
              { discard: true },
            ),
      );
    const aberto = yield* abrir(config.pastaTrabalho);
    if (!aberto.login) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "login", tipo: "semLogin" });
    }
    const cliente = aberto.cliente;
    const recusa = recusaMcpAcp(aberto.inicio, config, opcoes.ponteMcp);
    if (recusa !== undefined) {
      return yield* new FalhaProvider({
        provider: PROVIDER,
        operacao: "session/new",
        tipo: "mcp",
        cause: new Error(recusa),
      });
    }
    const normalizar = criarNormalizadorAntigravity(
      config.servidoresMcp.map((servidor) => servidor.nome),
      { semFerramentas: config.semFerramentas === true },
    );
    // Fora de um turno (o histórico que o `session/load` repete), as atualizações não viram eventos.
    let emTurno = false;
    const servidoresApp = config.servidoresMcp.filter((servidor) => servidor.preAprovado).map((s) => s.nome);
    const processar = (entrada: EntradaAcp) =>
      Effect.suspend(() => {
        gravar("entrada", entrada);
        if (entrada.tipo === "session/update" && !emTurno) return Effect.void;
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
        // No perfil próprio o `agy` pede permissão até para MCP e leitura. A política responde sozinha
        // o que pode (as ferramentas do ifpr passam, como no `allowedTools` do Claude e no
        // `default_tools_approval_mode` do Codex; o que sai da pasta se nega) e pergunta o resto.
        const { decisao } = yield* canal.aprovar({
          id: pedido.toolCall.toolCallId,
          ferramenta,
          descricao: pedido.title ?? pedido.toolCall.title ?? "permitir ação",
          entrada: entradaFerramenta(registro(pedido.toolCall)),
          classe: classificarAcp(registro(pedido.toolCall), servidoresApp),
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

    const mcpServers = mcpServersAcp(config, {
      http: aberto.inicio.agentCapabilities?.mcpCapabilities?.http === true,
      ...(opcoes.ponteMcp ? { ponte: opcoes.ponteMcp } : {}),
    });
    const meta = antigravitySessionMeta(
      aberto.inicio,
      config.instrucoes,
      ferramentasDesligadasAntigravity(politica, config.semFerramentas === true),
    );
    const pedidoSessao = { cwd: config.pastaTrabalho, mcpServers, ...(meta === undefined ? {} : { _meta: meta }) };
    const sessao =
      config.retomar === undefined
        ? yield* cliente.agent.createSession(pedidoSessao).pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "session/new")))
        : yield* retomarSessao(aberto.inicio, cliente, { ...pedidoSessao, sessionId: config.retomar });
    const sessionId = sessao.sessionId;
    idDaSessao = sessionId;
    // O modelo e o raciocínio valem por sessão: aplicados na nova e de novo na retomada. Na retomada,
    // o modelo que saiu da conta não impede a conversa de voltar: fica o que o `agy` carregou.
    // Sem esforço ("Normal"), vai o nível próprio do modelo, da última sondagem; sem sondagem neste
    // processo, fica o que o `agy` dá ao trocar de modelo (o herdado do padrão).
    const esforco =
      config.esforco ?? modelosGuardados?.modelos.find((modelo) => modelo.id === config.modelo)?.esforcoNormal;
    yield* OpcoesAcp.aplicarEscolha(cliente.agent, sessao, { modelo: config.modelo, esforco }).pipe(
      Effect.catchTags({
        ModeloAcpIndisponivel: (erro) =>
          config.retomar === undefined
            ? Effect.fail(new FalhaProvider({ provider: PROVIDER, operacao: "modelo", tipo: "modelo", cause: erro }))
            : Effect.logWarning("Antigravity: a retomada segue sem o modelo escolhido", erro),
      }),
      Effect.mapError((erro) => (erro._tag === "FalhaProvider" ? erro : Canal.falhaDe(PROVIDER, "modelo")(erro))),
    );

    // Quando o processo do `agy` acaba sozinho (queda), o turno corrente falha e a sessão recusa os
    // próximos. No encerramento da sessão, o fiber é interrompido antes de o processo morrer.
    const queda = yield* Deferred.make<FalhaProvider>();
    yield* aberto.filho.exitCode.pipe(
      Effect.exit,
      Effect.flatMap((saida) => {
        const falha = new FalhaProvider({
          provider: PROVIDER,
          operacao: "sessão",
          tipo: "queda",
          ...(saida._tag === "Success"
            ? { cause: new Error(`o processo do agy encerrou (código ${saida.value})`) }
            : {}),
        });
        return Deferred.succeed(queda, falha).pipe(Effect.andThen(canal.morrer(falha)), Effect.uninterruptible);
      }),
      Effect.forkScoped,
    );

    return {
      idNativo: sessionId,
      queda: Deferred.await(queda),
      enviar: (mensagem) =>
        canal.turno(
          Effect.sync(() => {
            emTurno = true;
            gravar("saida", { tipo: "session/prompt", texto: mensagem });
          }).pipe(
            Effect.andThen(
              cliente.agent.prompt({ sessionId, prompt: [{ type: "text", text: mensagem }] }).pipe(
                Effect.flatMap((resposta) => processar({ tipo: "session/prompt", resposta })),
                Effect.catch((erro) => canal.falhar(Canal.falhaDe(PROVIDER, "session/prompt")(erro))),
                Effect.ensuring(Effect.sync(() => (emTurno = false))),
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

  /** Os arquivos da sessão no perfil próprio do app (`arquivosDaSessaoAntigravity`). */
  const esquecer = Effect.fn("DriverAntigravity.esquecer")(function* (idNativo: string, _pastaTrabalho: string) {
    const alvos = arquivosDaSessaoAntigravity(path.join, pastas.profile, idNativo);
    if (alvos.length === 0) return false;
    const falhas = yield* Effect.forEach(alvos, (alvo) =>
      fs.remove(alvo, { recursive: true, force: true }).pipe(
        Effect.as(0),
        Effect.catch((erro) =>
          Effect.logWarning("Antigravity: não foi possível apagar a sessão", erro).pipe(Effect.as(1)),
        ),
      ),
    );
    return falhas.every((n) => n === 0);
  });

  return {
    detectar,
    iniciar,
    esquecer,
    instalar: acompanharInstalacao(PROVIDER, opcoes.instalacao),
    entrar: acompanharLogin(PROVIDER, login.controller.start(DONO_LOGIN), login.controller.subscribe(DONO_LOGIN)),
  } satisfies Driver;
});
