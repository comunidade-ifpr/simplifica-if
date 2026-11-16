/**
 * Driver do Claude pelo Agent SDK (`@anthropic-ai/claude-agent-sdk`, a mesma versão do T3), com o
 * `claude` instalado pelo usuário e o login dele (Keychain ou `~/.claude`).
 *
 * - Uma sessão é um `query()` com entrada em stream: cada `enviar` empurra uma mensagem do usuário.
 * - O MCP entra em `mcpServers`, por stdio ou por HTTP, só nesta sessão; `settingSources: []` deixa
 *   de fora as configurações, os MCP, as skills, os hooks e o `CLAUDE.md` do usuário e do projeto.
 * - As ferramentas de servidores `preAprovado` entram em `allowedTools` (`mcp__<servidor>`), se a
 *   política permite; as demais passam por `canUseTool`, que as classifica (`classificarClaude`) e
 *   aplica a política: `perguntar` vira `PedidoAprovacao`.
 * - As instruções da sessão (com as skills do app) vão no `append` do system prompt `claude_code`.
 * - Telemetria: as variáveis de `TELEMETRIA_CLAUDE` no ambiente, sem as `OTEL_*` herdadas.
 * - Texto parcial: `includePartialMessages` entrega os `stream_event`; cada `text_delta` vira
 *   `TextoParcial` e o bloco completo (`assistant`), `TextoFinal`.
 * - **Retomada:** a sessão nova recebe um `sessionId` (UUID) escolhido aqui, que é o `idNativo`; a
 *   retomada abre o `query()` com `resume`, como o `ClaudeAdapterV2` do T3. Para isso o SDK grava a
 *   transcrição (`persistSession`, o padrão) em `~/.claude/projects/`, como o Claude Code e o T3.
 * - **Queda:** quando o stream do SDK acaba sem que a sessão tenha sido encerrada (o processo do
 *   `claude` morreu), o turno corrente falha e a sessão recusa os próximos (`Canal.morrer`).
 */
import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type DeteccaoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type Evento, resumir, textoDeBlocos } from "../eventos.ts";
import {
  ambienteSemTelemetria,
  buscaWebLigada,
  caminhosDoComando,
  type ClassePedido,
  type Politica,
} from "../politica.ts";
import { type Ambiente, limparAmbiente, localizar, primeiraLinha } from "../processo.ts";
import { resolveClaudeSdkExecutablePath } from "../t3/ClaudeExecutable.ts";
import * as ClaudeHome from "../t3/ClaudeHome.ts";

/** `mcp__ifpr__buscar_norma` → `ifpr.buscar_norma`; ferramentas nativas ficam como vieram. */
export function nomeFerramentaClaude(nome: string): string {
  const partes = /^mcp__(.+?)__(.+)$/.exec(nome);
  return partes ? `${partes[1]}.${partes[2]}` : nome;
}

/** Os blocos de conteúdo do Claude que não são ferramenta. */
const BLOCOS_SEM_FERRAMENTA = new Set<string>(["text", "thinking", "redacted_thinking"]);

/**
 * Traduz as mensagens do Agent SDK em eventos. Guarda o nome de cada `tool_use` para o resultado,
 * que só traz o id.
 */
export function criarNormalizadorClaude(
  opcoes: { readonly semFerramentas?: boolean } = {},
): (mensagem: SDKMessage) => ReadonlyArray<Evento> {
  const nomes = new Map<string, string>();
  return (mensagem) => {
    switch (mensagem.type) {
      case "stream_event": {
        // Texto de subagente (`parent_tool_use_id`) não é a resposta; ele chega pela ferramenta.
        if (mensagem.parent_tool_use_id !== null) return [];
        const evento = mensagem.event;
        if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
          return [{ _tag: "TextoParcial", texto: evento.delta.text }];
        }
        return [];
      }
      case "assistant": {
        // Mensagens de subagentes (`parent_tool_use_id`) ficam de fora: o resultado chega pela ferramenta.
        if (mensagem.parent_tool_use_id !== null) return [];
        const eventos: Array<Evento> = [];
        for (const bloco of mensagem.message.content) {
          if (bloco.type === "text" && bloco.text.trim() !== "") {
            eventos.push({ _tag: "TextoFinal", texto: bloco.text });
          } else if (bloco.type === "tool_use" || bloco.type === "mcp_tool_use") {
            const nome = nomeFerramentaClaude(bloco.name);
            nomes.set(bloco.id, nome);
            eventos.push({ _tag: "FerramentaIniciada", id: bloco.id, nome, entrada: bloco.input });
          } else if (opcoes.semFerramentas === true && !BLOCOS_SEM_FERRAMENTA.has(bloco.type)) {
            // No lado seguro: numa sessão de julgamento, bloco que não é texto nem raciocínio
            // (`server_tool_use`, resultados de ferramentas do servidor, tipos novos) conta como ferramenta.
            eventos.push({
              _tag: "FerramentaIniciada",
              id: `bloco-${eventos.length}`,
              nome: `bloco.${bloco.type}`,
              entrada: {},
            });
          }
        }
        return eventos;
      }
      case "user": {
        if (mensagem.parent_tool_use_id !== null || typeof mensagem.message.content === "string") return [];
        const eventos: Array<Evento> = [];
        for (const bloco of mensagem.message.content) {
          if (bloco.type !== "tool_result") continue;
          eventos.push({
            _tag: "FerramentaConcluida",
            id: bloco.tool_use_id,
            nome: nomes.get(bloco.tool_use_id) ?? "",
            resumo: resumir(textoDeBlocos(bloco.content)),
            falhou: bloco.is_error === true,
          });
        }
        return eventos;
      }
      case "result": {
        const eventos: Array<Evento> = [
          {
            _tag: "UsoTokens",
            entrada: mensagem.usage.input_tokens,
            saida: mensagem.usage.output_tokens,
            cacheLeitura: mensagem.usage.cache_read_input_tokens ?? 0,
            cacheEscrita: mensagem.usage.cache_creation_input_tokens ?? 0,
            custoUsd: mensagem.total_cost_usd,
          },
        ];
        if (mensagem.subtype !== "success") {
          eventos.push({ _tag: "Erro", mensagem: `turno terminou com ${mensagem.subtype}` });
        } else if (mensagem.is_error) {
          eventos.push({ _tag: "Erro", mensagem: resumir(mensagem.result) });
        }
        eventos.push({ _tag: "FimTurno", motivo: mensagem.stop_reason ?? mensagem.subtype });
        return eventos;
      }
      default:
        return [];
    }
  };
}

const PROVIDER = "claude" as const;
const ehFalhaProvider = Schema.is(FalhaProvider);

const LEITURA = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const ESCRITA = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const WEB = new Set(["WebFetch", "WebSearch"]);
const RECURSOS_MCP = new Set(["ReadMcpResourceTool", "ListMcpResourcesTool"]);

/**
 * Classifica o pedido do `canUseTool` pelo nome da ferramenta do Claude Code e tira da entrada os
 * caminhos que ele toca. `servidoresApp` são os servidores MCP `preAprovado` da sessão.
 */
export function classificarClaude(
  ferramenta: string,
  entrada: Record<string, unknown>,
  servidoresApp: ReadonlyArray<string>,
): ClassePedido {
  const caminho = (chave: string) => (typeof entrada[chave] === "string" ? [entrada[chave]] : []);
  const mcp = /^mcp__(.+?)__/.exec(ferramenta);
  if (mcp) return { tipo: servidoresApp.includes(mcp[1] ?? "") ? "mcp-app" : "mcp-outro", caminhos: [] };
  if (RECURSOS_MCP.has(ferramenta)) {
    const servidor = typeof entrada.server === "string" ? entrada.server : undefined;
    return { tipo: servidor !== undefined && servidoresApp.includes(servidor) ? "mcp-app" : "mcp-outro", caminhos: [] };
  }
  if (LEITURA.has(ferramenta)) {
    return { tipo: "leitura", caminhos: [...caminho("file_path"), ...caminho("path"), ...caminho("notebook_path")] };
  }
  if (ESCRITA.has(ferramenta))
    return { tipo: "escrita", caminhos: [...caminho("file_path"), ...caminho("notebook_path")] };
  if (ferramenta === "Bash") {
    return { tipo: "comando", caminhos: typeof entrada.command === "string" ? caminhosDoComando(entrada.command) : [] };
  }
  if (WEB.has(ferramenta)) return { tipo: "web", caminhos: [] };
  return { tipo: "outra", caminhos: [] };
}

/** `mcpServers` do `query()`: `McpStdioServerConfig` ou `McpHttpServerConfig` do Agent SDK. */
export function mcpServersClaude(config: ConfigSessao): Record<string, McpServerConfig> {
  const saida: Record<string, McpServerConfig> = {};
  for (const servidor of config.servidoresMcp) {
    saida[servidor.nome] = {
      ...(servidor.tipo === "http"
        ? {
            type: "http" as const,
            url: servidor.url,
            ...(servidor.cabecalhos ? { headers: { ...servidor.cabecalhos } } : {}),
          }
        : {
            type: "stdio" as const,
            command: servidor.comando,
            args: [...servidor.argumentos],
            ...(servidor.ambiente ? { env: { ...servidor.ambiente } } : {}),
          }),
      // Sem isso, as ferramentas MCP ficam atrás do ToolSearch, e cada turno gasta duas idas e
      // voltas só para descobri-las.
      alwaysLoad: true,
    };
  }
  return saida;
}

function mensagemDoUsuario(texto: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: texto }, parent_tool_use_id: null };
}

const opcoesBase = (ambiente: Ambiente, executavel: string) =>
  ({
    pathToClaudeCodeExecutable: executavel,
    env: ambienteSemTelemetria(PROVIDER, limparAmbiente(ambiente)),
    // Isolamento: sem settings, CLAUDE.md, hooks nem MCP do usuário ou do projeto.
    settingSources: [],
    persistSession: false,
  }) satisfies Options;

/** Prompt que nunca entrega mensagem: o SDK inicializa (login, modelos) sem chamar a API. */
// oxlint-disable-next-line require-yield -- nunca entrega mensagem, então nenhum prompt chega à API
async function* nuncaEntrega(sinal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>((resolver) => sinal.addEventListener("abort", () => resolver(), { once: true }));
}

export const make = Effect.fn("DriverClaude.make")(function* (opcoes: { readonly ambiente: Ambiente }) {
  const local = yield* localizar("claude", opcoes.ambiente);
  // No Windows o SDK não passa pelo shell: o `claude.cmd` do npm vira o `claude.exe` do pacote (T3).
  const executavel = Option.isSome(local)
    ? yield* resolveClaudeSdkExecutablePath(local.value, limparAmbiente(opcoes.ambiente))
    : undefined;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const aleatorio = yield* SecureRandom.SecureRandom;

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    if (executavel === undefined) {
      return {
        provider: PROVIDER,
        instalado: false,
        autenticado: false,
        mensagem: "CLI `claude` não encontrada no PATH",
      } satisfies DeteccaoProvider;
    }
    const versao = Option.getOrUndefined(yield* primeiraLinha(executavel, ["--version"], opcoes.ambiente));
    // @effect-diagnostics-next-line abortControllerInEffect:off -- o Agent SDK recebe um AbortController, não um AbortSignal
    const abortar = new AbortController();
    const conta = yield* Effect.tryPromise({
      try: async () => {
        const consulta = query({
          prompt: nuncaEntrega(abortar.signal),
          options: { ...opcoesBase(opcoes.ambiente, executavel), abortController: abortar },
        });
        return (await consulta.initializationResult()).account;
      },
      catch: Canal.falhaDe(PROVIDER, "detectar"),
    }).pipe(Effect.timeout("30 seconds"), Effect.ensuring(Effect.sync(() => abortar.abort())), Effect.option);
    const info = Option.getOrUndefined(conta);
    // Mesmo critério do T3 (`ClaudeProvider.ts`): chave de API, e-mail ou assinatura contam como login.
    const autenticado =
      info !== undefined && (info.apiKeySource !== undefined || info.email !== undefined || !!info.subscriptionType);
    // Com um `managed-mcp.json` da organização, o Claude ignora os MCP da sessão: o `ifpr` não sobe.
    const mcpGerenciado = yield* ClaudeHome.hasClaudeManagedMcpConfig();
    return {
      provider: PROVIDER,
      instalado: true,
      autenticado,
      ...(versao ? { versao } : {}),
      ...(info?.tokenSource ? { metodo: info.tokenSource } : info?.apiKeySource ? { metodo: "apiKey" } : {}),
      ...(info?.subscriptionType ? { plano: info.subscriptionType } : {}),
      ...(autenticado ? {} : { mensagem: "Claude sem login: rode `claude auth login`" }),
      ...(mcpGerenciado
        ? { aviso: "esta máquina tem MCP gerenciado pela organização (managed-mcp.json); o Claude não carrega o ifpr" }
        : {}),
    } satisfies DeteccaoProvider;
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, fs),
  );

  const iniciar = Effect.fn("DriverClaude.iniciar")(function* (config: ConfigSessao, politica: Politica) {
    if (executavel === undefined) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "iniciar", detalhe: "CLI `claude` ausente" });
    }
    const canal = yield* Canal.comPolitica(politica, config.pastaTrabalho);
    const gravar = yield* Gravador;
    const servicos = yield* Effect.context<never>();
    const servidoresApp = config.servidoresMcp.filter((s) => s.preAprovado).map((s) => s.nome);
    const entrada = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
    const queda = yield* Deferred.make<FalhaProvider>();
    // O id da sessão no Claude: escolhido aqui na sessão nova, o retomado na retomada. O SDK o confirma
    // em cada mensagem (`session_id`); se mudar, vale o dele.
    let idNativo = config.retomar ?? (yield* aleatorio.uuidV4());
    // @effect-diagnostics-next-line abortControllerInEffect:off -- o Agent SDK recebe um AbortController; o finalizador da sessão aborta
    const abortar = new AbortController();

    const canUseTool: CanUseTool = async (ferramenta, dados, contexto) => {
      gravar("entrada", { type: "can_use_tool", toolName: ferramenta, input: dados, toolUseID: contexto.toolUseID });
      const { decisao, motivo } = await Effect.runPromiseWith(servicos)(
        canal.aprovar({
          id: contexto.toolUseID,
          ferramenta: nomeFerramentaClaude(ferramenta),
          descricao: contexto.title ?? contexto.description ?? `usar ${ferramenta}`,
          entrada: dados,
          classe: classificarClaude(ferramenta, dados, servidoresApp),
        }),
        { signal: contexto.signal },
      );
      const resposta: PermissionResult =
        decisao === "permitir"
          ? { behavior: "allow", updatedInput: dados }
          : { behavior: "deny", message: motivo ?? "O usuário negou esta ação." };
      gravar("saida", { type: "can_use_tool_response", toolUseID: contexto.toolUseID, ...resposta });
      return resposta;
    };

    const consulta: Query = query({
      prompt: Stream.toAsyncIterable(Stream.fromQueue(entrada)),
      options: {
        ...opcoesBase(opcoes.ambiente, executavel),
        // Como o T3 (`claudeQueryEnvironment`): na retomada, o primeiro pedido espera os MCP conectarem;
        // sem isso, o Claude diz ao modelo que o servidor `ifpr` caiu.
        ...(config.retomar === undefined
          ? {}
          : { env: { ...limparAmbiente(opcoes.ambiente), MCP_CONNECTION_NONBLOCKING: "0" } }),
        // Julgamento: um turno por sessão, então gravar o pedido no cache (1,25× o preço da entrada) não
        // tem retorno; no teste real, 343 mil tokens foram gravados no cache sem nenhuma leitura útil.
        ...(config.semFerramentas === true
          ? {
              env: { ...ambienteSemTelemetria(PROVIDER, limparAmbiente(opcoes.ambiente)), DISABLE_PROMPT_CACHING: "1" },
            }
          : {}),
        // Julgamento: a sessão não é retomada, e o PPC não fica na transcrição do `~/.claude/projects/`.
        persistSession: config.semFerramentas !== true,
        ...(config.retomar === undefined ? { sessionId: idNativo } : { resume: config.retomar }),
        abortController: abortar,
        cwd: config.pastaTrabalho,
        mcpServers: mcpServersClaude(config),
        // As ferramentas do app passam sem `canUseTool` quando a política as permite.
        allowedTools: politica.ferramentas.mcpApp === "permitir" ? servidoresApp.map((nome) => `mcp__${nome}`) : [],
        ...(buscaWebLigada(politica, config.buscaWeb) ? {} : { disallowedTools: ["WebSearch", "WebFetch"] }),
        // Julgamento: nenhuma ferramenta no contexto e nenhuma pergunta (`dontAsk` nega o que não foi
        // pré-aprovado); o prompt de sistema é só o do app.
        permissionMode: config.semFerramentas === true ? "dontAsk" : "default",
        ...(config.semFerramentas === true ? { tools: [] } : {}),
        canUseTool,
        includePartialMessages: true,
        ...(config.instrucoes === undefined
          ? {}
          : config.semFerramentas === true
            ? { systemPrompt: config.instrucoes }
            : { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: config.instrucoes } }),
        ...(config.modelo ? { model: config.modelo } : {}),
      },
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        abortar.abort();
        consulta.close();
      }),
    );

    const normalizar = criarNormalizadorClaude({ semFerramentas: config.semFerramentas === true });
    // Interrompido, o turno do Claude termina com `error_during_execution` (medido com o SDK 0.3.321):
    // não é erro para a pessoa, e o fim do turno sai como interrupção.
    let interrompendo = false;
    const depoisDeInterromper = (evento: Evento): ReadonlyArray<Evento> => {
      if (!interrompendo) return [evento];
      if (evento._tag === "Erro" && evento.mensagem.includes("error_during_execution")) return [];
      if (evento._tag !== "FimTurno") return [evento];
      interrompendo = false;
      return [{ _tag: "FimTurno", motivo: "interrupted" }];
    };
    yield* Stream.fromAsyncIterable(consulta, Canal.falhaDe(PROVIDER, "ler mensagens")).pipe(
      Stream.runForEach((mensagem) => {
        gravar("entrada", mensagem);
        if (typeof mensagem.session_id === "string" && mensagem.session_id !== "") idNativo = mensagem.session_id;
        return Effect.forEach(normalizar(mensagem).flatMap(depoisDeInterromper), canal.emitir, { discard: true });
      }),
      // O stream só acaba sozinho se o processo do `claude` acabou: é queda. No encerramento da sessão,
      // o fiber é interrompido antes.
      Effect.exit,
      Effect.flatMap((saida) => {
        const erro = Exit.isFailure(saida) ? Cause.squash(saida.cause) : undefined;
        const falha = ehFalhaProvider(erro)
          ? erro
          : erro !== undefined
            ? Canal.falhaDe(PROVIDER, "sessão")(erro)
            : new FalhaProvider({ provider: PROVIDER, operacao: "sessão", detalhe: "o processo do Claude encerrou" });
        return Deferred.succeed(queda, falha).pipe(Effect.andThen(canal.morrer(falha)), Effect.uninterruptible);
      }),
      Effect.forkScoped,
    );

    return {
      get idNativo() {
        return idNativo;
      },
      queda: Deferred.await(queda),
      enviar: (texto) =>
        canal.turno(
          Effect.suspend(() => {
            const mensagem = mensagemDoUsuario(texto);
            gravar("saida", mensagem);
            return Queue.offer(entrada, mensagem);
          }),
        ),
      responder: canal.responder,
      interromper: Effect.tryPromise({
        try: () => {
          interrompendo = true;
          return consulta.interrupt();
        },
        catch: Canal.falhaDe(PROVIDER, "interromper"),
      }).pipe(Effect.asVoid),
    } satisfies Awaited<Effect.Success<ReturnType<Driver["iniciar"]>>>;
  });

  return { detectar, iniciar } satisfies Driver;
});
