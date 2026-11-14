/**
 * Driver do Claude pelo Agent SDK (`@anthropic-ai/claude-agent-sdk`, a mesma versão do T3), com o
 * `claude` instalado pelo usuário e o login dele (Keychain ou `~/.claude`).
 *
 * - Uma sessão é um `query()` com entrada em stream: cada `enviar` empurra uma mensagem do usuário.
 * - O MCP entra em `mcpServers` como stdio, só nesta sessão; `settingSources: []` deixa de fora as
 *   configurações e os MCP do usuário e do projeto.
 * - As ferramentas de servidores `preAprovado` entram em `allowedTools` (`mcp__<servidor>`); as
 *   demais passam por `canUseTool`, que vira `PedidoAprovacao`.
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
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type EstadoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type Evento, resumir, textoDeBlocos } from "../eventos.ts";
import { type Ambiente, limparAmbiente, localizar, primeiraLinha } from "../processo.ts";
import { resolveClaudeSdkExecutablePath } from "../t3/ClaudeExecutable.ts";
import * as ClaudeHome from "../t3/ClaudeHome.ts";

/** `mcp__ifpr__buscar_norma` → `ifpr.buscar_norma`; ferramentas nativas ficam como vieram. */
export function nomeFerramentaClaude(nome: string): string {
  const partes = /^mcp__(.+?)__(.+)$/.exec(nome);
  return partes ? `${partes[1]}.${partes[2]}` : nome;
}

/**
 * Traduz as mensagens do Agent SDK em eventos. Guarda o nome de cada `tool_use` para o resultado,
 * que só traz o id.
 */
export function criarNormalizadorClaude(): (mensagem: SDKMessage) => ReadonlyArray<Evento> {
  const nomes = new Map<string, string>();
  return (mensagem) => {
    switch (mensagem.type) {
      case "stream_event": {
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

function mensagemDoUsuario(texto: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: texto }, parent_tool_use_id: null };
}

const opcoesBase = (ambiente: Ambiente, executavel: string) =>
  ({
    pathToClaudeCodeExecutable: executavel,
    env: limparAmbiente(ambiente),
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

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    if (executavel === undefined) {
      return {
        provider: PROVIDER,
        instalado: false,
        autenticado: false,
        mensagem: "CLI `claude` não encontrada no PATH",
      } satisfies EstadoProvider;
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
    } satisfies EstadoProvider;
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, fs),
  );

  const iniciar = Effect.fn("DriverClaude.iniciar")(function* (config: ConfigSessao) {
    if (executavel === undefined) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "iniciar", detalhe: "CLI `claude` ausente" });
    }
    const canal = yield* Canal.make;
    const gravar = yield* Gravador;
    const servicos = yield* Effect.context<never>();
    const entrada = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
    // @effect-diagnostics-next-line abortControllerInEffect:off -- o Agent SDK recebe um AbortController; o finalizador da sessão aborta
    const abortar = new AbortController();

    const canUseTool: CanUseTool = async (ferramenta, dados, contexto) => {
      gravar("entrada", { type: "can_use_tool", toolName: ferramenta, input: dados, toolUseID: contexto.toolUseID });
      const decisao = await Effect.runPromiseWith(servicos)(
        canal.pedirAprovacao({
          id: contexto.toolUseID,
          ferramenta: nomeFerramentaClaude(ferramenta),
          descricao: contexto.title ?? contexto.description ?? `usar ${ferramenta}`,
          entrada: dados,
        }),
        { signal: contexto.signal },
      );
      const resposta: PermissionResult =
        decisao === "permitir"
          ? { behavior: "allow", updatedInput: dados }
          : { behavior: "deny", message: "O usuário negou esta ação." };
      gravar("saida", { type: "can_use_tool_response", toolUseID: contexto.toolUseID, ...resposta });
      return resposta;
    };

    const mcpServers: Record<string, McpServerConfig> = {};
    for (const servidor of config.servidoresMcp) {
      mcpServers[servidor.nome] = {
        type: "stdio",
        command: servidor.comando,
        args: [...servidor.argumentos],
        ...(servidor.ambiente ? { env: { ...servidor.ambiente } } : {}),
        // Sem isso, as ferramentas MCP ficam atrás do ToolSearch, e cada turno gasta duas idas e
        // voltas só para descobri-las.
        alwaysLoad: true,
      };
    }

    const consulta: Query = query({
      prompt: Stream.toAsyncIterable(Stream.fromQueue(entrada)),
      options: {
        ...opcoesBase(opcoes.ambiente, executavel),
        abortController: abortar,
        cwd: config.pastaTrabalho,
        mcpServers,
        allowedTools: config.servidoresMcp.filter((s) => s.preAprovado).map((s) => `mcp__${s.nome}`),
        ...(config.buscaWeb === true ? {} : { disallowedTools: ["WebSearch", "WebFetch"] }),
        permissionMode: "default",
        canUseTool,
        includePartialMessages: true,
        ...(config.modelo ? { model: config.modelo } : {}),
      },
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        abortar.abort();
        consulta.close();
      }),
    );

    const normalizar = criarNormalizadorClaude();
    yield* Stream.fromAsyncIterable(consulta, Canal.falhaDe(PROVIDER, "ler mensagens")).pipe(
      Stream.runForEach((mensagem) => {
        gravar("entrada", mensagem);
        return Effect.forEach(normalizar(mensagem), canal.emitir, { discard: true });
      }),
      Effect.catchTags({ FalhaProvider: canal.falhar }),
      Effect.forkScoped,
    );

    return {
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
        try: () => consulta.interrupt(),
        catch: Canal.falhaDe(PROVIDER, "interromper"),
      }).pipe(Effect.asVoid),
    } satisfies Awaited<Effect.Success<ReturnType<Driver["iniciar"]>>>;
  });

  return { detectar, iniciar } satisfies Driver;
});
