/**
 * Driver do Codex (ChatGPT) pelo app-server (`codex app-server`, JSON-RPC por stdio) e o cliente
 * `@simplifica-if/effect-codex-app-server`, copiado do T3. O login é o do usuário, em `~/.codex`.
 *
 * - O MCP entra por thread, em `config` do `thread/start` (`mcp_servers.<nome>.*`), como o T3 faz
 *   com o servidor dele: nada se grava no `config.toml` do usuário.
 * - A thread é gravada pelo Codex (`~/.codex/sessions`), como no T3, para que se retome depois:
 *   `thread/resume` com o `threadId` (o `idNativo`) e a mesma configuração da thread nova (o MCP vem
 *   com o token da sessão nova). Por isso ela aparece no histórico do Codex do usuário; `ephemeral`
 *   impediria a retomada.
 * - **Queda:** quando o app-server acaba, o turno corrente falha e a sessão recusa os próximos.
 * - Sandbox e aprovação vêm da política (`read-only` com `on-request` na de fábrica). Os pedidos de
 *   aprovação (comando, edição de arquivo, elicitação de MCP) se classificam e passam pela política;
 *   `perguntar` vira `PedidoAprovacao`.
 * - Isolamento e contexto por thread (`isolamentoCodex`, `contextoCodex`): sem os MCP, conectores,
 *   plugins, hooks, skills e `AGENTS.md` do usuário, e sem as ferramentas e instruções que a política
 *   não usa. As instruções da sessão (com as skills do app) vão em `developerInstructions`.
 * - Telemetria: `TELEMETRIA_CODEX_ARGS` no `codex app-server` (analytics, feedback e OpenTelemetry).
 */
import * as CodexClient from "@simplifica-if/effect-codex-app-server/client";
import type { CodexAppServerError } from "@simplifica-if/effect-codex-app-server/errors";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Canal from "../Canal.ts";
import {
  type ConfigSessao,
  type Driver,
  type DeteccaoProvider,
  type EstadoLogin,
  FalhaProvider,
  Gravador,
} from "../Driver.ts";
import {
  type AlvoWeb,
  alvoWeb,
  erroDoTurno,
  type Evento,
  type MotivoFim,
  resumir,
  textoDeBlocos,
  type TipoFerramenta,
} from "../eventos.ts";
import { classificarFalha, textoTecnico } from "../falhas.ts";
import {
  ambienteSemTelemetria,
  buscaWebLigada,
  caminhosDoComando,
  type ClassePedido,
  type Politica,
  TELEMETRIA_CODEX_ARGS,
} from "../politica.ts";
import { acompanharInstalacao } from "../estados.ts";
import { esforcoCodex, type ModeloCodex, modelosCodex } from "../modelos.ts";
import { type Ambiente, limparAmbiente } from "../processo.ts";
import type * as CodexInstallation from "../t3/CodexInstallation.ts";
import { type Registro, registro, texto } from "./json.ts";

/**
 * Nome, tipo e entrada de uma ferramenta do Codex, a partir do item `ThreadItem`. `servidoresApp` são os
 * servidores MCP `preAprovado` da sessão.
 */
export function ferramentaDoItem(
  item: Registro,
  servidoresApp: ReadonlySet<string> = new Set(),
):
  | { readonly nome: string; readonly tipo: TipoFerramenta; readonly web?: AlvoWeb; readonly entrada: unknown }
  | undefined {
  switch (item.type) {
    case "mcpToolCall":
      return {
        nome: `${texto(item.server)}.${texto(item.tool)}`,
        tipo: servidoresApp.has(texto(item.server)) ? "mcp-app" : "mcp-outro",
        entrada: item.arguments,
      };
    case "dynamicToolCall":
      return { nome: texto(item.tool), tipo: "outra", entrada: item.arguments };
    case "commandExecution":
      return { nome: "comando", tipo: "comando", entrada: { comando: item.command } };
    case "fileChange":
      return {
        nome: "editar_arquivos",
        tipo: "escrita",
        entrada: { arquivos: (Array.isArray(item.changes) ? item.changes : []).map((c) => registro(c).path) },
      };
    case "webSearch": {
      const acao = registro(item.action);
      if (acao.type === "openPage") {
        const web = alvoWeb("ler", acao.url);
        return {
          nome: "ler_pagina_web",
          tipo: "web",
          ...(web === undefined ? {} : { web }),
          entrada: {
            ...(typeof acao.url === "string" ? { url: acao.url } : {}),
            ...(typeof item.query === "string" && item.query !== "" ? { consulta: item.query } : {}),
          },
        };
      }
      const web = alvoWeb("pesquisar", item.query);
      return {
        nome: "busca_web",
        tipo: "web",
        ...(web === undefined ? {} : { web }),
        entrada: {
          consulta: item.query,
          ...(typeof acao.url === "string" ? { url: acao.url } : {}),
        },
      };
    }
    default:
      // No lado seguro: todo item que não é mensagem, raciocínio ou a mensagem da pessoa conta como
      // ferramenta (`imageView`, `collabAgentToolCall`, `imageGeneration`, `openPage`, tipos novos…).
      // Numa sessão de julgamento, isso descarta o bloco.
      return ITENS_SEM_FERRAMENTA.has(texto(item.type))
        ? undefined
        : { nome: `item.${texto(item.type) || "desconhecido"}`, tipo: "outra", entrada: {} };
  }
}

/** Os itens do Codex que não são ferramenta. */
/** Teto de páginas do `model/list`: o catálogo de uma conta cabe em uma. */
const MAXIMO_PAGINAS_MODELOS = 10;

const ITENS_SEM_FERRAMENTA = new Set(["agentMessage", "reasoning", "userMessage"]);

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
    case "webSearch": {
      const acao = registro(item.action);
      const detalhe =
        (acao.type === "openPage" ? texto(acao.url) : "") || texto(item.query) || texto(acao.url) || texto(item.status);
      return { resumo: resumir(detalhe), falhou: item.status === "failed" };
    }
    default:
      return { resumo: resumir(item.status ?? ""), falhou: item.status === "failed" };
  }
}

/**
 * Traduz as notificações do app-server em eventos. O uso de tokens é o `total` da thread; o
 * normalizador desconta o total do fim do turno anterior, para dar o uso do turno.
 */
export function criarNormalizadorCodex(
  servidoresApp: ReadonlySet<string> = new Set(),
): (metodo: string, parametros: unknown) => ReadonlyArray<Evento> {
  let ultimoTotal: Registro | undefined;
  let totalAnterior = { entrada: 0, saida: 0, cache: 0 };
  return (metodo, parametros) => {
    const p = registro(parametros);
    switch (metodo) {
      case "item/agentMessage/delta":
        return [{ _tag: "TextoParcial", texto: texto(p.delta) }];
      case "item/started": {
        const item = registro(p.item);
        const ferramenta = ferramentaDoItem(item, servidoresApp);
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
        return [erroDoTurno(texto(registro(p.error).message) || resumir(p))];
      case "mcpServer/startupStatus/updated":
        return p.status === "failed"
          ? [erroDoTurno(`servidor MCP ${texto(p.name)} não iniciou: ${texto(p.error)}`)]
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
        if (turno.error) eventos.push(erroDoTurno(texto(registro(turno.error).message)));
        // `status` do `Turn`: `completed`, `interrupted`, `failed` (`inProgress` não chega aqui).
        const motivo: MotivoFim =
          turno.status === "interrupted"
            ? "interrompido"
            : turno.status === "failed" || turno.error
              ? "falha"
              : "concluido";
        eventos.push({ _tag: "FimTurno", motivo });
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

/**
 * `mcp_servers.<nome>` para o `config` do `thread/start`: HTTP (streamable HTTP) com `url` e
 * `http_headers`, como o T3 passa o servidor dele (`codexThreadRuntimeParams` em `CodexAdapterV2.ts`).
 */
export function configMcpCodex(config: ConfigSessao, politica: Politica): Record<string, Schema.Json> {
  const saida: Record<string, Schema.Json> = {};
  for (const servidor of config.servidoresMcp) {
    saida[`mcp_servers.${servidor.nome}`] = {
      url: servidor.url,
      ...(servidor.cabecalhos ? { http_headers: { ...servidor.cabecalhos } } : {}),
      // Sem pedir aprovação a cada chamada: as ferramentas do servidor são só de leitura.
      ...(servidor.preAprovado && politica.ferramentas.mcpApp === "permitir"
        ? { default_tools_approval_mode: "approve" }
        : {}),
    };
  }
  return saida;
}

/**
 * Desliga, só nesta thread, o que vem do usuário:
 * - os servidores MCP do usuário que não são da sessão;
 * - os conectores do ChatGPT (`features.apps`, que trazem o `codex_apps` com busca web) e os plugins
 *   (`features.plugins`). Os plugins trazem MCP próprios, skills e hooks: o `cua_repl` (computer use
 *   e navegador) vem do plugin `unified-computer-use@openai-bundled`, pelo `.mcp.json` dele, e sobe
 *   mesmo com `features.computer_use` e `features.browser_use` desligados;
 * - os hooks (`features.hooks`);
 * - as skills: as do sistema (`skills.bundled.enabled`) e cada uma que o `skills/list` acha para a
 *   pasta (`skills.config`, por caminho), inclusive as de `.agents/skills` da pasta de trabalho; as
 *   do app chegam pelas instruções da sessão;
 * - o `AGENTS.md` da pasta de trabalho (`project_doc_max_bytes = 0`). O `~/.codex/AGENTS.md` do
 *   usuário continua entrando: não há chave por thread que o tire (só um `CODEX_HOME` próprio).
 */
export function isolamentoCodex(
  configUsuario: Registro,
  config: ConfigSessao,
  skillsDoUsuario: ReadonlyArray<string> = [],
): Record<string, Schema.Json> {
  const nossos = new Set(config.servidoresMcp.map((servidor) => servidor.nome));
  const saida: Record<string, Schema.Json> = {
    "features.apps": false,
    "features.plugins": false,
    "features.hooks": false,
    "skills.bundled.enabled": false,
    project_doc_max_bytes: 0,
  };
  for (const nome of Object.keys(registro(configUsuario.mcp_servers))) {
    if (!nossos.has(nome)) saida[`mcp_servers.${nome}.enabled`] = false;
  }
  if (skillsDoUsuario.length > 0) {
    saida["skills.config"] = skillsDoUsuario.map((caminho) => ({ path: caminho, enabled: false }));
  }
  return saida;
}

/**
 * Tira do contexto o que a política não usa (medido na pergunta de referência; ver o README): as
 * ferramentas de metas (`goals`), geração de imagem, `sleep`, sugestão de ferramentas e busca de
 * skills, e as instruções de skills, de apps e de modos de colaboração. Ficam as instruções de
 * permissão (o modelo precisa delas para pedir aprovação), o contexto do ambiente e o terminal.
 */
export const CONTEXTO_CODEX: Readonly<Record<string, Schema.Json>> = {
  "features.goals": false,
  "features.image_generation": false,
  "features.sleep_tool": false,
  "features.tool_suggest": false,
  "features.skill_search": false,
  include_skills_usage_instructions: false,
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false,
};

/**
 * Uma thread de julgamento (`ConfigSessao.semFerramentas`) sem ferramenta nenhuma. Com sandbox
 * `read-only` e `on-request`, o Codex roda comandos de leitura **sem pedir aprovação** (o sandbox
 * permite ler o disco inteiro), então a política nunca seria consultada: uma injeção que escapasse ao
 * filtro poderia ler `~/.ssh` e pôr o conteúdo no texto da resposta. As chaves são as de
 * `codex features list` do codex-cli 0.169.0: o shell (`shell_tool`, `unified_exec`), a leitura de
 * imagem, os subagentes, o `apply_patch` e a busca web.
 */
export const SEM_FERRAMENTAS_CODEX: Readonly<Record<string, Schema.Json>> = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.multi_agent": false,
  "features.multi_agent_v2": false,
  include_apply_patch_tool: false,
  web_search: "disabled",
};

/** Classifica o pedido de comando: o `cwd` e os caminhos citados; com rede, é `web`. */
/**
 * A falha da queda do `codex app-server`, como a do `agy`: sempre `queda`, qualquer que seja a
 * mensagem do transporte ("Codex App Server transport operation 'read-process-exit-status' failed.").
 * O erro original, com o código de saída, fica em `cause`.
 */
export function falhaQuedaCodex(erro: CodexAppServerError): FalhaProvider {
  return new FalhaProvider({ provider: PROVIDER, operacao: "sessão", tipo: "queda", cause: erro });
}

/**
 * Modo do `web_search` no `config` da thread do Codex: `"live"` (servidores da OpenAI) quando a
 * política liga a web, respeitando eventual restrição gerida em `allowedWebSearchModes` (cai para
 * `"cached"`, `"indexed"` ou `"disabled"`). Quando a política desliga, sempre `"disabled"`.
 */
export function modoBuscaWebCodex(
  politica: Politica,
  modosPermitidos?: ReadonlyArray<string> | null,
): "live" | "cached" | "indexed" | "disabled" {
  if (!buscaWebLigada(politica)) return "disabled";
  if (modosPermitidos == null) return "live";
  if (modosPermitidos.includes("live")) return "live";
  if (modosPermitidos.includes("cached")) return "cached";
  if (modosPermitidos.includes("indexed")) return "indexed";
  return "disabled";
}

/** O objeto `config` do `thread/start` e `thread/resume` do Codex (puro, para travar a ordem em teste). */
export function configThreadCodex(entrada: {
  readonly configUsuario: Registro;
  readonly config: ConfigSessao;
  readonly politica: Politica;
  readonly skillsDoUsuario?: ReadonlyArray<string>;
  readonly modosWebPermitidos?: ReadonlyArray<string> | null;
  readonly esforco?: string;
}): Record<string, Schema.Json> {
  return {
    ...isolamentoCodex(entrada.configUsuario, entrada.config, entrada.skillsDoUsuario),
    ...CONTEXTO_CODEX,
    ...configMcpCodex(entrada.config, entrada.politica),
    web_search: modoBuscaWebCodex(entrada.politica, entrada.modosWebPermitidos),
    // `SEM_FERRAMENTAS_CODEX` vem depois para garantir `web_search: "disabled"` no julgamento.
    ...(entrada.config.semFerramentas === true ? SEM_FERRAMENTAS_CODEX : {}),
    ...(entrada.esforco ? { model_reasoning_effort: entrada.esforco } : {}),
  };
}

/**
 * Classifica o pedido de comando: com `networkApprovalContext`, é `comando-rede` (negado sempre
 * pela política, sem afrouxar `curl`/scripts de rede); sem ele, é `comando` com `cwd` e caminhos.
 */
export function classificarComandoCodex(p: {
  readonly command?: string | null;
  readonly cwd?: string | null;
  readonly networkApprovalContext?: unknown;
}): ClassePedido {
  if (p.networkApprovalContext !== undefined && p.networkApprovalContext !== null) {
    const host = texto(registro(p.networkApprovalContext).host);
    return { tipo: "comando-rede", caminhos: [], ...(host !== "" ? { host } : {}) };
  }
  return {
    tipo: "comando",
    caminhos: [...(p.cwd ? [p.cwd] : []), ...(p.command ? caminhosDoComando(p.command) : [])],
  };
}

/**
 * Os hosts da página de login que o `codex app-server` devolve na `authUrl` (`codex-cli` 0.169.0, em
 * 16/11/2026: `https://auth.openai.com/oauth/authorize?…`). Outra URL não vai ao navegador.
 */
const HOSTS_LOGIN_CODEX = new Set(["auth.openai.com"]);

/** A `authUrl` é a página oficial de login da OpenAI, em HTTPS? */
export function authUrlOficialCodex(url: string): boolean {
  try {
    const lida = new URL(url);
    return (
      lida.protocol === "https:" && HOSTS_LOGIN_CODEX.has(lida.hostname) && lida.username === "" && lida.port === ""
    );
  } catch {
    return false;
  }
}

/** O fim do login (`account/login/completed`) como a interface o mostra: a frase e, à parte, o detalhe. */
export function fimLoginCodex(fim: {
  readonly success: boolean;
  readonly error?: string | null | undefined;
}): Omit<EstadoLogin, "provider"> {
  if (fim.success) return { fase: "concluido" };
  return {
    fase: "falhou",
    mensagem: "O login não foi concluído. Tente de novo; se continuar, feche o navegador e entre outra vez.",
    ...(fim.error ? { detalhe: textoTecnico(fim.error) } : {}),
  };
}

export const make = Effect.fn("DriverCodex.make")(function* (opcoes: {
  readonly ambiente: Ambiente;
  /**
   * A instalação do T3: prefere um `codex` local suportado no PATH e, sem ele, usa a cópia gerenciada
   * em `<pastaEstado>/tools/codex`. O login continua o do `~/.codex` do usuário.
   */
  readonly instalacao: CodexInstallation.CodexInstallation["Service"];
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  /** Abre o app-server num processo e devolve o cliente já inicializado. */
  const abrir = Effect.fn("DriverCodex.abrir")(function* (binario: string, pasta: string) {
    const filho = yield* spawner
      .spawn(
        ChildProcess.make(binario, ["app-server", ...TELEMETRIA_CODEX_ARGS], {
          cwd: pasta,
          env: ambienteSemTelemetria(PROVIDER, limparAmbiente(opcoes.ambiente)),
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

  /**
   * Todas as páginas do `model/list`. A falha vira lista vazia, com aviso no log: a sessão segue com o
   * padrão do Codex e a interface fica sem o botão do modelo.
   */
  const catalogoDeModelos = Effect.fn("DriverCodex.catalogoDeModelos")(
    function* (cliente: Effect.Success<ReturnType<typeof abrir>>["cliente"]) {
      const modelos: Array<Effect.Success<ReturnType<typeof cliente.request<"model/list">>>["data"][number]> = [];
      let cursor: string | undefined;
      for (let pagina = 0; pagina < MAXIMO_PAGINAS_MODELOS; pagina++) {
        const lista = yield* cliente.request("model/list", cursor === undefined ? {} : { cursor });
        modelos.push(...lista.data);
        if (!lista.nextCursor) break;
        cursor = lista.nextCursor;
      }
      return modelos;
    },
    Effect.tapError((erro) => Effect.logWarning("Codex: o model/list falhou", erro)),
    Effect.orElseSucceed((): ReadonlyArray<ModeloCodex> => []),
  );

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    const resolvido = yield* opcoes.instalacao.resolve().pipe(Effect.option);
    if (Option.isNone(resolvido)) {
      return {
        provider: PROVIDER,
        instalado: false,
        autenticado: false,
        mensagem: "Codex não instalado (ou versão sem suporte): use instalar",
      };
    }
    const executavel = resolvido.value.executablePath;
    const origem = resolvido.value.source === "managed" ? ("gerenciada" as const) : ("local" as const);
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
        const modelos = autenticado ? modelosCodex(yield* catalogoDeModelos(cliente)) : [];
        return {
          provider: PROVIDER,
          instalado: true,
          origem,
          autenticado,
          ...(versao ? { versao } : {}),
          ...(typeof info.type === "string" ? { metodo: info.type } : {}),
          ...(typeof info.planType === "string" ? { plano: info.planType } : {}),
          ...(autenticado ? {} : { mensagem: "Codex sem login: use entrar" }),
          ...(modelos.length > 0 ? { modelos } : {}),
        } satisfies DeteccaoProvider;
      }),
    ).pipe(Effect.timeout("30 seconds"), Effect.option);
    return Option.getOrElse(resultado, (): DeteccaoProvider => ({
      provider: PROVIDER,
      instalado: true,
      origem,
      autenticado: false,
      mensagem: "o app-server do Codex não respondeu",
    }));
  });

  const iniciar = Effect.fn("DriverCodex.iniciar")(function* (config: ConfigSessao, politica: Politica) {
    // Reserva até o fim da sessão: a instalação não remove o binário de uma sessão em andamento.
    const executavel = yield* opcoes.instalacao.acquire().pipe(
      Effect.mapError(
        (erro) =>
          new FalhaProvider({
            provider: PROVIDER,
            operacao: "iniciar",
            tipo: classificarFalha("iniciar", erro.detail),
            cause: erro,
          }),
      ),
    );
    const canal = yield* Canal.comPolitica(politica, config.pastaTrabalho);
    const gravar = yield* Gravador;
    const { cliente } = yield* abrir(executavel.executablePath, config.pastaTrabalho);
    const servidoresApp = new Set(config.servidoresMcp.filter((s) => s.preAprovado).map((s) => s.nome));
    const normalizar = criarNormalizadorCodex(servidoresApp);
    // Os arquivos de cada `fileChange`: o pedido de aprovação só traz o id do item.
    const arquivosDoItem = new Map<string, ReadonlyArray<string>>();

    for (const metodo of NOTIFICACOES) {
      yield* cliente.handleServerNotification(metodo, (parametros) =>
        Effect.suspend(() => {
          gravar("entrada", { metodo, parametros });
          const item = registro(registro(parametros).item);
          if (metodo === "item/started" && item.type === "fileChange" && Array.isArray(item.changes)) {
            arquivosDoItem.set(
              texto(item.id),
              item.changes.map((mudanca) => texto(registro(mudanca).path)).filter((caminho) => caminho !== ""),
            );
          }
          return Effect.forEach(normalizar(metodo, parametros), canal.emitir, { discard: true });
        }),
      );
    }

    const aprovar = (id: string, ferramenta: string, descricao: string, entrada: unknown, classe: ClassePedido) =>
      Effect.sync(() => gravar("entrada", { metodo: "pedido de aprovação", id, ferramenta, descricao, classe })).pipe(
        Effect.andThen(canal.aprovar({ id, ferramenta, descricao, entrada, classe })),
        Effect.map(({ decisao }) => decisao),
        Effect.tap((decisao) => Effect.sync(() => gravar("saida", { metodo: "resposta de aprovação", id, decisao }))),
      );
    yield* cliente.handleServerRequest("item/commandExecution/requestApproval", (p) =>
      aprovar(
        p.approvalId ?? p.itemId,
        "comando",
        p.reason ?? `executar ${p.command ?? "comando"}`,
        { comando: p.command, pasta: p.cwd },
        classificarComandoCodex(p),
      ).pipe(Effect.map((decisao) => ({ decision: decisao === "permitir" ? "accept" : "decline" }) as const)),
    );
    yield* cliente.handleServerRequest("item/fileChange/requestApproval", (p) => {
      const arquivos = arquivosDoItem.get(p.itemId) ?? [];
      return aprovar(
        p.itemId,
        "editar_arquivos",
        p.reason ?? "alterar arquivos",
        { arquivos, raiz: p.grantRoot },
        { tipo: "escrita", caminhos: [...arquivos, ...(p.grantRoot ? [p.grantRoot] : [])] },
      ).pipe(Effect.map((decisao) => ({ decision: decisao === "permitir" ? "accept" : "decline" }) as const));
    });
    yield* cliente.handleServerRequest("mcpServer/elicitation/request", (p) =>
      aprovar(`${p.serverName}:${p.message.slice(0, 40)}`, `${p.serverName}`, p.message, p._meta, {
        tipo: servidoresApp.has(p.serverName) ? "mcp-app" : "mcp-outro",
        caminhos: [],
      }).pipe(Effect.map((decisao) => ({ action: decisao === "permitir" ? "accept" : "decline" }) as const)),
    );

    // O `model` e o `model_reasoning_effort` do `config.toml` do usuário podem não valer para a conta
    // (ex.: modelo de API numa conta ChatGPT) nem para o modelo: sem modelo na sessão, vai o padrão que
    // o `model/list` dá para a conta, e o esforço é o pedido ou o padrão do modelo (`esforcoCodex`).
    const catalogo = yield* catalogoDeModelos(cliente);
    const efetivo =
      config.modelo === undefined
        ? catalogo.find((candidato) => candidato.isDefault)
        : catalogo.find((candidato) => candidato.model === config.modelo);
    const modelo = config.modelo ?? efetivo?.model;
    const esforco = esforcoCodex(efetivo, config.esforco);
    // Isolamento sem tocar no `config.toml`: os MCP, os conectores (apps) e os plugins do usuário
    // ficam desligados nesta thread. A busca web nativa usa os servidores da OpenAI quando a
    // política liga (`web_search: "live"`), respeitando restrições geridas em `configRequirements`.
    const configUsuario = yield* cliente.request("config/read", { includeLayers: false }).pipe(
      Effect.map((resposta) => registro(resposta.config)),
      Effect.orElseSucceed((): Registro => ({})),
    );
    const modosWebPermitidos =
      buscaWebLigada(politica) && config.semFerramentas !== true
        ? yield* cliente.request("configRequirements/read", undefined).pipe(
            Effect.map((resposta) => resposta.requirements?.allowedWebSearchModes ?? null),
            Effect.tapError((erro) =>
              Effect.logWarning("Codex: configRequirements/read falhou; seguindo com live", erro),
            ),
            Effect.orElseSucceed((): ReadonlyArray<string> | null => null),
          )
        : null;
    // Todas as skills que o Codex acharia para a pasta (do usuário, do sistema e da pasta).
    const skillsDoUsuario = yield* cliente.request("skills/list", { cwds: [config.pastaTrabalho] }).pipe(
      Effect.map((resposta) => resposta.data.flatMap((entrada) => entrada.skills.map((skill) => skill.path))),
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
    );
    const parametros = {
      cwd: config.pastaTrabalho,
      // Na de fábrica, somente leitura: qualquer escrita ou comando fora do sandbox passa por aprovação.
      approvalPolicy: politica.codex.aprovacao,
      sandbox: politica.codex.sandbox,
      config: configThreadCodex({
        configUsuario,
        config,
        politica,
        skillsDoUsuario,
        modosWebPermitidos,
        ...(esforco ? { esforco } : {}),
      }),
      // A thread de julgamento não é retomada (a retomada é por bloco, no servidor): não fica no
      // histórico do Codex do usuário.
      ...(config.semFerramentas === true ? { ephemeral: true } : {}),
      ...(config.instrucoes === undefined ? {} : { developerInstructions: config.instrucoes }),
      ...(modelo ? { model: modelo } : {}),
    } as const;
    const thread =
      config.retomar === undefined
        ? yield* cliente
            .request("thread/start", parametros)
            .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "thread/start")))
        : yield* cliente
            // Sem os turnos na resposta: o histórico da interface vem do banco do app.
            .request("thread/resume", { ...parametros, threadId: config.retomar, excludeTurns: true })
            .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "retomar")));
    const threadId = thread.thread.id;
    let turnoCorrente: string | undefined;

    // Se o app-server acabar (queda), o turno corrente termina com erro e a sessão recusa os próximos.
    // No encerramento da sessão, o fiber é interrompido antes de o processo morrer.
    const queda = yield* Deferred.make<FalhaProvider>();
    yield* cliente.awaitTermination.pipe(
      Effect.catch((erro) => {
        const falha = falhaQuedaCodex(erro);
        return Deferred.succeed(queda, falha).pipe(Effect.andThen(canal.morrer(falha)), Effect.uninterruptible);
      }),
      Effect.forkScoped,
    );

    return {
      idNativo: threadId,
      queda: Deferred.await(queda),
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

  /**
   * O login da conta do ChatGPT pelo próprio app-server (`account/login/start` com `type: "chatgpt"`),
   * como o app do Codex: ele abre um servidor de retorno local e devolve a `authUrl`, que a interface
   * abre no navegador; o fim chega em `account/login/completed`. O login fica no `~/.codex` do usuário,
   * o mesmo do Codex do terminal. Fechar o stream (a pessoa saiu da tela) fecha o app-server e cancela
   * o login. Sem resposta em 10 minutos, o login falha por tempo.
   */
  const entrar: Driver["entrar"] = Stream.callback<EstadoLogin, FalhaProvider>((fila) =>
    Effect.gen(function* () {
      const emitir = (estado: Omit<EstadoLogin, "provider">) => Queue.offer(fila, { provider: PROVIDER, ...estado });
      const terminar = (estado: Omit<EstadoLogin, "provider">) =>
        emitir(estado).pipe(Effect.andThen(Queue.end(fila)), Effect.asVoid);
      yield* emitir({ fase: "iniciando" });
      const resolvido = yield* opcoes.instalacao
        .resolve()
        .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "entrar: Codex não instalado")));
      const { cliente } = yield* abrir(resolvido.executablePath, ".");
      const idLogin = yield* Deferred.make<string>();
      yield* cliente.handleServerNotification("account/login/completed", (fim) =>
        Effect.gen(function* () {
          const esperado = yield* Deferred.await(idLogin);
          if (typeof fim.loginId === "string" && fim.loginId !== esperado) return;
          yield* terminar(fimLoginCodex(fim));
        }),
      );
      const inicio = yield* cliente
        .request("account/login/start", { type: "chatgpt" })
        .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "entrar")));
      if (inicio.type !== "chatgpt") {
        return yield* new FalhaProvider({ provider: PROVIDER, operacao: "entrar", tipo: "semLogin" });
      }
      if (!authUrlOficialCodex(inicio.authUrl)) {
        // A página de login devolvida não é a da OpenAI (auth.openai.com).
        return yield* new FalhaProvider({ provider: PROVIDER, operacao: "entrar", tipo: "semLogin" });
      }
      yield* Deferred.succeed(idLogin, inicio.loginId);
      yield* emitir({ fase: "aguardando", url: inicio.authUrl });
      yield* Effect.sleep("10 minutes");
      yield* terminar({ fase: "falhou", mensagem: "O login não terminou em 10 minutos. Tente de novo." });
    }),
  );

  /**
   * A thread gravada em `~/.codex/sessions` (e no índice do Codex), pelo `thread/delete` de um app-server
   * aberto só para isso. Uma thread que o Codex não conhece não tem o que apagar.
   */
  const esquecer = Effect.fn("DriverCodex.esquecer")(function* (idNativo: string, pastaTrabalho: string) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const executavel = yield* opcoes.instalacao.acquire();
        const { cliente } = yield* abrir(executavel.executablePath, pastaTrabalho);
        return yield* cliente.request("thread/delete", { threadId: idNativo }).pipe(
          Effect.as(true),
          // Só a recusa do próprio pedido diz que a thread não existe; um `codex` sem `thread/delete`
          // ("Method not found") não apagou nada.
          Effect.catchTags({
            CodexAppServerRequestError: (erro) =>
              !/method not found/i.test(erro.errorMessage) &&
              /not found|no rollout|unknown thread|does not exist/i.test(erro.errorMessage)
                ? Effect.succeed(true)
                : Effect.fail(erro),
          }),
        );
      }),
    ).pipe(
      Effect.timeout("30 seconds"),
      Effect.catchCause((causa) =>
        Effect.logWarning("Codex: não foi possível apagar a thread", causa).pipe(Effect.as(false)),
      ),
    );
  });

  return {
    detectar,
    iniciar,
    esquecer,
    instalar: acompanharInstalacao(PROVIDER, opcoes.instalacao),
    entrar,
  } satisfies Driver;
});
