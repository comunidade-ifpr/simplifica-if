/**
 * Driver do Codex (ChatGPT) pelo app-server (`codex app-server`, JSON-RPC por stdio) e o cliente
 * `@simplifica-if/effect-codex-app-server`, copiado do T3. O login é o do usuário, em `~/.codex`.
 *
 * - O MCP entra por thread, em `config` do `thread/start` (`mcp_servers.<nome>.*`), como o T3 faz
 *   com o servidor dele: nada se grava no `config.toml` do usuário.
 * - A thread é `ephemeral`: não aparece no histórico do Codex do usuário.
 * - Pedidos de aprovação (comando, edição de arquivo, elicitação de MCP) viram `PedidoAprovacao`.
 */
import * as CodexClient from "@simplifica-if/effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type EstadoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type Evento, resumir, textoDeBlocos } from "../eventos.ts";
import { type Ambiente, limparAmbiente, localizar } from "../processo.ts";

type Registro = Record<string, unknown>;
const registro = (valor: unknown): Registro => (typeof valor === "object" && valor !== null ? (valor as Registro) : {});
const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");

/** Nome e entrada de uma ferramenta do Codex, a partir do item `ThreadItem`. */
function ferramentaDoItem(item: Registro): { readonly nome: string; readonly entrada: unknown } | undefined {
  switch (item.type) {
    case "mcpToolCall":
      return { nome: `${texto(item.server)}.${texto(item.tool)}`, entrada: item.arguments };
    case "dynamicToolCall":
      return { nome: texto(item.tool), entrada: item.arguments };
    case "commandExecution":
      return { nome: "comando", entrada: { comando: item.command } };
    case "fileChange":
      return {
        nome: "editar_arquivos",
        entrada: { arquivos: (Array.isArray(item.changes) ? item.changes : []).map((c) => registro(c).path) },
      };
    case "webSearch":
      return { nome: "busca_web", entrada: { consulta: item.query } };
    default:
      return undefined;
  }
}

function resultadoDoItem(item: Registro): { readonly resumo: string; readonly falhou: boolean } {
  switch (item.type) {
    case "mcpToolCall": {
      const erro = registro(item.error);
      if (item.error) return { resumo: resumir(texto(erro.message)), falhou: true };
      return { resumo: resumir(textoDeBlocos(registro(item.result).content)), falhou: item.status !== "completed" };
    }
    case "commandExecution":
      return {
        resumo: resumir(item.aggregatedOutput ?? ""),
        falhou: item.status !== "completed" || (typeof item.exitCode === "number" && item.exitCode !== 0),
      };
    case "fileChange":
      return { resumo: resumir(item.status), falhou: item.status !== "completed" };
    case "dynamicToolCall":
      return { resumo: resumir(textoDeBlocos(item.contentItems)), falhou: item.success === false };
    default:
      return { resumo: resumir(item.status ?? ""), falhou: item.status === "failed" };
  }
}

/**
 * Traduz as notificações do app-server em eventos. O uso de tokens é o `total` da thread; o
 * normalizador desconta o total do fim do turno anterior, para dar o uso do turno.
 */
export function criarNormalizadorCodex(): (metodo: string, parametros: unknown) => ReadonlyArray<Evento> {
  let ultimoTotal: Registro | undefined;
  let totalAnterior = { entrada: 0, saida: 0, cache: 0 };
  return (metodo, parametros) => {
    const p = registro(parametros);
    switch (metodo) {
      case "item/agentMessage/delta":
        return [{ _tag: "TextoParcial", texto: texto(p.delta) }];
      case "item/started": {
        const item = registro(p.item);
        const ferramenta = ferramentaDoItem(item);
        return ferramenta ? [{ _tag: "FerramentaIniciada", id: texto(item.id), ...ferramenta }] : [];
      }
      case "item/completed": {
        const item = registro(p.item);
        if (item.type === "agentMessage") return [{ _tag: "TextoFinal", texto: texto(item.text) }];
        const ferramenta = ferramentaDoItem(item);
        if (ferramenta === undefined) return [];
        return [{ _tag: "FerramentaConcluida", id: texto(item.id), nome: ferramenta.nome, ...resultadoDoItem(item) }];
      }
      case "thread/tokenUsage/updated":
        ultimoTotal = registro(registro(p.tokenUsage).total);
        return [];
      case "error":
        return [{ _tag: "Erro", mensagem: resumir(texto(registro(p.error).message) || p) }];
      case "mcpServer/startupStatus/updated":
        return p.status === "failed"
          ? [{ _tag: "Erro", mensagem: resumir(`servidor MCP ${texto(p.name)} não iniciou: ${texto(p.error)}`) }]
          : [];
      case "turn/completed": {
        const turno = registro(p.turn);
        const eventos: Array<Evento> = [];
        if (ultimoTotal !== undefined) {
          const total = {
            entrada: Number(ultimoTotal.inputTokens ?? 0),
            saida: Number(ultimoTotal.outputTokens ?? 0),
            cache: Number(ultimoTotal.cachedInputTokens ?? 0),
          };
          eventos.push({
            _tag: "UsoTokens",
            entrada: total.entrada - totalAnterior.entrada,
            saida: total.saida - totalAnterior.saida,
            cacheLeitura: total.cache - totalAnterior.cache,
          });
          totalAnterior = total;
        }
        if (turno.error) eventos.push({ _tag: "Erro", mensagem: resumir(texto(registro(turno.error).message)) });
        eventos.push({ _tag: "FimTurno", motivo: texto(turno.status) || "completed" });
        return eventos;
      }
      default:
        return [];
    }
  };
}

const PROVIDER = "codex" as const;

/** As notificações que o normalizador lê; as demais o cliente descarta. */
const NOTIFICACOES = [
  "item/agentMessage/delta",
  "item/started",
  "item/completed",
  "thread/tokenUsage/updated",
  "error",
  "turn/completed",
  "mcpServer/startupStatus/updated",
] as const;

/** `mcp_servers.<nome>` para o `config` do `thread/start`. */
export function configMcpCodex(config: ConfigSessao): Record<string, Schema.Json> {
  const saida: Record<string, Schema.Json> = {};
  for (const servidor of config.servidoresMcp) {
    saida[`mcp_servers.${servidor.nome}`] = {
      command: servidor.comando,
      args: [...servidor.argumentos],
      ...(servidor.ambiente ? { env: { ...servidor.ambiente } } : {}),
      // Sem pedir aprovação a cada chamada: as ferramentas do servidor são só de leitura.
      ...(servidor.preAprovado ? { default_tools_approval_mode: "approve" } : {}),
    };
  }
  return saida;
}

/**
 * Desliga, só nesta thread, os servidores MCP do usuário que não são da sessão, os conectores do
 * ChatGPT (`features.apps`, que trazem o `codex_apps` com busca web).
 */
export function isolamentoCodex(configUsuario: Registro, config: ConfigSessao): Record<string, Schema.Json> {
  const nossos = new Set(config.servidoresMcp.map((servidor) => servidor.nome));
  const saida: Record<string, Schema.Json> = { "features.apps": false };
  for (const nome of Object.keys(registro(configUsuario.mcp_servers))) {
    if (!nossos.has(nome)) saida[`mcp_servers.${nome}.enabled`] = false;
  }
  return saida;
}

export const make = Effect.fn("DriverCodex.make")(function* (opcoes: { readonly ambiente: Ambiente }) {
  const executavel = (yield* localizar("codex", opcoes.ambiente)).pipe(Option.getOrUndefined);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  /** Abre o app-server num processo e devolve o cliente já inicializado. */
  const abrir = Effect.fn("DriverCodex.abrir")(function* (binario: string, pasta: string) {
    const filho = yield* spawner
      .spawn(
        ChildProcess.make(binario, ["app-server"], {
          cwd: pasta,
          env: limparAmbiente(opcoes.ambiente),
          extendEnv: false,
          forceKillAfter: "2 seconds",
        }),
      )
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "abrir app-server")));
    const contexto = yield* Layer.build(CodexClient.layerChildProcess(filho));
    const cliente = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(Effect.provide(contexto));
    const inicio = yield* cliente
      .request("initialize", {
        clientInfo: { name: "simplifica-if", title: "Simplifica IF", version: "0.1.0" },
        capabilities: { experimentalApi: true, optOutNotificationMethods: null },
      })
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "initialize")));
    yield* cliente.notify("initialized", undefined).pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "initialized")));
    return { cliente, inicio };
  });

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    if (executavel === undefined) {
      return {
        provider: PROVIDER,
        instalado: false,
        autenticado: false,
        mensagem: "CLI `codex` não encontrada no PATH",
      };
    }
    const resultado = yield* Effect.scoped(
      Effect.gen(function* () {
        const { cliente, inicio } = yield* abrir(executavel, ".");
        const conta = yield* cliente
          .request("account/read", {})
          .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "conta")));
        // `planType` vem do token em cache; `account/rateLimits/read` perguntaria ao backend (o T3 faz os dois).
        const versao = /\/([^\s]+)/.exec(inicio.userAgent)?.[1];
        const info = registro(conta.account);
        const autenticado = conta.account !== null && conta.account !== undefined;
        return {
          provider: PROVIDER,
          instalado: true,
          autenticado,
          ...(versao ? { versao } : {}),
          ...(typeof info.type === "string" ? { metodo: info.type } : {}),
          ...(typeof info.planType === "string" ? { plano: info.planType } : {}),
          ...(autenticado ? {} : { mensagem: "Codex sem login: rode `codex login`" }),
        } satisfies EstadoProvider;
      }),
    ).pipe(Effect.timeout("30 seconds"), Effect.option);
    return Option.getOrElse(resultado, (): EstadoProvider => ({
      provider: PROVIDER,
      instalado: true,
      autenticado: false,
      mensagem: "o app-server do Codex não respondeu",
    }));
  });

  const iniciar = Effect.fn("DriverCodex.iniciar")(function* (config: ConfigSessao) {
    if (executavel === undefined) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "iniciar", detalhe: "CLI `codex` ausente" });
    }
    const canal = yield* Canal.make();
    const gravar = yield* Gravador;
    const { cliente } = yield* abrir(executavel, config.pastaTrabalho);
    const normalizar = criarNormalizadorCodex();

    for (const metodo of NOTIFICACOES) {
      yield* cliente.handleServerNotification(metodo, (parametros) =>
        Effect.suspend(() => {
          gravar("entrada", { metodo, parametros });
          return Effect.forEach(normalizar(metodo, parametros), canal.emitir, { discard: true });
        }),
      );
    }

    const aprovar = (id: string, ferramenta: string, descricao: string, entrada: unknown) =>
      Effect.sync(() => gravar("entrada", { metodo: "pedido de aprovação", id, ferramenta, descricao })).pipe(
        Effect.andThen(canal.pedirAprovacao({ id, ferramenta, descricao, entrada })),
        Effect.tap((decisao) => Effect.sync(() => gravar("saida", { metodo: "resposta de aprovação", id, decisao }))),
      );
    yield* cliente.handleServerRequest("item/commandExecution/requestApproval", (p) =>
      aprovar(p.itemId, "comando", p.reason ?? `executar ${p.command ?? "comando"}`, { comando: p.command }).pipe(
        Effect.map((decisao) => ({ decision: decisao === "permitir" ? "accept" : "decline" }) as const),
      ),
    );
    yield* cliente.handleServerRequest("item/fileChange/requestApproval", (p) =>
      aprovar(p.itemId, "editar_arquivos", p.reason ?? "alterar arquivos", { raiz: p.grantRoot }).pipe(
        Effect.map((decisao) => ({ decision: decisao === "permitir" ? "accept" : "decline" }) as const),
      ),
    );
    yield* cliente.handleServerRequest("mcpServer/elicitation/request", (p) =>
      aprovar(`${p.serverName}:${p.message.slice(0, 40)}`, `${p.serverName}`, p.message, p._meta).pipe(
        Effect.map((decisao) => ({ action: decisao === "permitir" ? "accept" : "decline" }) as const),
      ),
    );

    // O `model` do `config.toml` do usuário pode não valer para a conta (ex.: modelo de API numa conta
    // ChatGPT); sem modelo na sessão, vai o padrão que o `model/list` dá para a conta.
    const modelo =
      config.modelo ??
      (yield* cliente.request("model/list", {}).pipe(
        Effect.map((lista) => lista.data.find((candidato) => candidato.isDefault)?.model),
        Effect.orElseSucceed(() => undefined),
      ));
    // Isolamento sem tocar no `config.toml`: os MCP e os conectores (apps) do usuário ficam
    // desligados nesta thread. Sem isso, a resposta pode vir de outra ferramenta (busca web dos
    // conectores, MCP pessoais), e não da base.
    const configUsuario = yield* cliente.request("config/read", { includeLayers: false }).pipe(
      Effect.map((resposta) => registro(resposta.config)),
      Effect.orElseSucceed((): Registro => ({})),
    );
    const isolamento = isolamentoCodex(configUsuario, config);
    const thread = yield* cliente
      .request("thread/start", {
        cwd: config.pastaTrabalho,
        ephemeral: true,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        config: {
          ...isolamento,
          ...configMcpCodex(config),
          ...(config.buscaWeb === true ? {} : { web_search: "disabled" }),
        },
        ...(modelo ? { model: modelo } : {}),
      })
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "thread/start")));
    const threadId = thread.thread.id;
    let turnoCorrente: string | undefined;

    // Se o app-server cair no meio de um turno, o turno termina com erro.
    yield* cliente.awaitTermination.pipe(
      Effect.catch((erro) => canal.falhar(Canal.falhaDe(PROVIDER, "app-server encerrou")(erro))),
      Effect.forkScoped,
    );

    return {
      enviar: (mensagem) =>
        canal.turno(
          cliente
            .request("turn/start", { threadId, input: [{ type: "text", text: mensagem, text_elements: [] }] })
            .pipe(
              Effect.tap((resposta) => Effect.sync(() => (turnoCorrente = resposta.turn.id))),
              Effect.mapError(Canal.falhaDe(PROVIDER, "turn/start")),
              Effect.asVoid,
            ),
        ),
      responder: canal.responder,
      interromper: Effect.suspend(() =>
        turnoCorrente === undefined
          ? Effect.void
          : cliente
              .request("turn/interrupt", { threadId, turnId: turnoCorrente })
              .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "turn/interrupt")), Effect.asVoid),
      ),
    } satisfies Effect.Success<ReturnType<Driver["iniciar"]>>;
  });

  return { detectar, iniciar } satisfies Driver;
});
