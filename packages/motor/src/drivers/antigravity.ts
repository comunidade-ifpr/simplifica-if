/**
 * Driver do Antigravity (Gemini) pelo ACP (`agy acp`, JSON-RPC por stdio) e o cliente
 * `@simplifica-if/effect-acp`, copiado do T3. O login é o do usuário (`oauth-personal`).
 *
 * - O MCP entra em `mcpServers` do `session/new` (o T3 passa `[]`; aqui vai o `simplifica-mcp`).
 * - `initialize` e `authenticate` (eager, como no T3) também servem de detecção: o código -32000
 *   no `authenticate` quer dizer "sem login".
 * - `session/request_permission` vira `PedidoAprovacao`; o turno termina com a resposta do
 *   `session/prompt` (`stopReason`).
 */
import * as AcpClient from "@simplifica-if/effect-acp/client";
import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Canal from "../Canal.ts";
import { type ConfigSessao, type Driver, type EstadoProvider, FalhaProvider, Gravador } from "../Driver.ts";
import { type Evento, resumir, textoDeBlocos } from "../eventos.ts";
import { type Ambiente, limparAmbiente, localizar, primeiraLinha } from "../processo.ts";

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

/** Servidores MCP no formato do ACP. O `command` precisa ser caminho absoluto. */
export function mcpServersAcp(config: ConfigSessao): ReadonlyArray<AcpSchema.McpServer> {
  return config.servidoresMcp.map((servidor) => ({
    name: servidor.nome,
    command: servidor.comando,
    args: [...servidor.argumentos],
    env: Object.entries(servidor.ambiente ?? {}).map(([name, value]) => ({ name, value })),
  }));
}

export const make = Effect.fn("DriverAntigravity.make")(function* (opcoes: { readonly ambiente: Ambiente }) {
  const executavel = (yield* localizar("agy", opcoes.ambiente)).pipe(Option.getOrUndefined);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const abrir = Effect.fn("DriverAntigravity.abrir")(function* (binario: string, pasta: string) {
    const filho = yield* spawner
      .spawn(
        ChildProcess.make(binario, ["acp"], {
          cwd: pasta,
          env: limparAmbiente(opcoes.ambiente),
          extendEnv: false,
          forceKillAfter: "2 seconds",
        }),
      )
      .pipe(Effect.mapError(Canal.falhaDe(PROVIDER, "abrir agy acp")));
    const contexto = yield* Layer.build(AcpClient.layerChildProcess(filho));
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
      Effect.catchTags({
        AcpRequestError: (erro) =>
          erro.code === CODIGO_SEM_LOGIN ? Effect.succeed(false) : Effect.fail(Canal.falhaDe(PROVIDER, "login")(erro)),
      }),
      Effect.mapError(Canal.falhaDe(PROVIDER, "login")),
    );
    return { cliente, inicio, login };
  });

  const detectar: Driver["detectar"] = Effect.gen(function* () {
    if (executavel === undefined) {
      return { provider: PROVIDER, instalado: false, autenticado: false, mensagem: "CLI `agy` não encontrada no PATH" };
    }
    const versao = Option.getOrUndefined(yield* primeiraLinha(executavel, ["--version"], opcoes.ambiente));
    const resultado = yield* Effect.scoped(abrir(executavel, ".")).pipe(Effect.timeout("30 seconds"), Effect.option);
    const login = Option.map(resultado, (r) => r.login).pipe(Option.getOrElse(() => false));
    return {
      provider: PROVIDER,
      instalado: true,
      autenticado: login,
      ...(versao ? { versao } : {}),
      ...(login ? { metodo: METODO_LOGIN } : {}),
      ...(login
        ? {}
        : { mensagem: Option.isNone(resultado) ? "o `agy acp` não respondeu" : "Antigravity sem login: rode `agy`" }),
    } satisfies EstadoProvider;
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

  const iniciar = Effect.fn("DriverAntigravity.iniciar")(function* (config: ConfigSessao) {
    if (executavel === undefined) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "iniciar", detalhe: "CLI `agy` ausente" });
    }
    const canal = yield* Canal.make();
    const gravar = yield* Gravador;
    const escopo = yield* Effect.scope;
    const { cliente, login } = yield* abrir(executavel, config.pastaTrabalho);
    if (!login) {
      return yield* new FalhaProvider({ provider: PROVIDER, operacao: "login", detalhe: "Antigravity sem login" });
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
        const decisao = yield* canal.pedirAprovacao({
          id: pedido.toolCall.toolCallId,
          ferramenta: nomeFerramenta(
            registro(pedido.toolCall),
            config.servidoresMcp.map((servidor) => servidor.nome),
          ),
          descricao: pedido.title ?? pedido.toolCall.title ?? "permitir ação",
          entrada: pedido.toolCall.rawInput ?? {},
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

  return { detectar, iniciar } satisfies Driver;
});
