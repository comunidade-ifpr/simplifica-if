// @effect-diagnostics nodeBuiltinImport:off -- apoio de teste: upgrade HTTP cru e POST ao MCP pelo node:http
/**
 * Apoio dos testes do servidor: o banco de fixture (o mesmo do `simplifica-mcp`), um driver falso do
 * motor, o cliente RPC (o `effect/rpc` sobre WebSocket, como a interface vai usar) e requisições cruas
 * para conferir as recusas.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import type * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/rpc";
import {
  type EtapaLeituraPpc,
  type EventoConversa,
  type EventoRevisaoPpc,
  GrupoApp,
  type ItemAoVivo,
} from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import * as Canal from "@simplifica-if/motor/Canal";
import { criarBancoFixture } from "../../../packages/mcp/test/fixture.ts";
import type * as Conversas from "../src/Conversas.ts";
import { inserirNormas } from "../../../packages/mcp/test/fixture-normas.ts";

export { diretorioTemporario, limparTemporarios } from "../../../packages/mcp/test/fixture.ts";
export { DCN_2021 } from "../../../packages/mcp/test/fixture-normas.ts";

/** Um token de teste com o tamanho mínimo de sobra. */
export const TOKEN = "token-de-teste-do-servidor-local-0123456789";

/** O `kb.sqlite` de fixture, com as normas (não depende do `tmp/kb.sqlite`). */
export function bancoFixture(): string {
  const banco = criarBancoFixture();
  inserirNormas(banco);
  return banco;
}

/** O que o driver falso viu e como o teste o controla. */
export interface Registro {
  readonly configs: Array<Motor.ConfigSessao>;
  /** Os textos que chegaram ao provider, na ordem. */
  readonly textos: Array<string>;
  encerradas: number;
  /** As conversas que o provider apagou (`Driver.esquecer`), com a pasta: `<idNativo> em <pasta>`. */
  readonly esquecidas: Array<string>;
  /** O provider recusa apagar (o `esquecer` devolve `false`; não entra em `esquecidas`). */
  recusarEsquecer?: boolean;
  /** Chamado a cada `esquecer`, para o teste esperar sem relógio. */
  aoEsquecer?: (() => void) | undefined;
  /** Chamado a cada sessão encerrada, para o teste esperar pelo encerramento sem relógio. */
  aoEncerrar?: (() => void) | undefined;
  /** Derruba o "processo" da sessão aberta mais recente (a queda), com `causa` no `cause` da falha. */
  derrubar?: ((causa?: Error) => Effect.Effect<void>) | undefined;
  /** O provider não retoma (como o `agy` sem `session/load`). */
  recusarRetomada?: boolean;
  /** O provider ignora o pedido de interrupção (o turno só acaba quando a sessão fecha). */
  ignorarInterrupcao?: boolean;
  /** Segura o fim do stream do turno, depois do `FimTurno`, até o `Deferred` se concluir. */
  segurarFim?: Deferred.Deferred<void> | undefined;
}

export const novoRegistro = (): Registro => ({ configs: [], textos: [], encerradas: 0, esquecidas: [] });

/**
 * Driver falso. A resposta depende do texto: com "escrev", pede aprovação para "escrever" e conclui
 * conforme a decisão; com "demor", só termina com a interrupção; com "limite", falha (`Erro` e `FimTurno`
 * com motivo `falha`) com a sessão viva; senão, responde `Resposta a: <texto>`
 * com o texto parcial e o final. A sessão tem um id nativo (`nativo-<n>`, ou o retomado) e uma queda
 * que o teste dispara (`registro.derrubar`). O Codex falso falha ao iniciar, com um `cause` que não pode
 * chegar à interface. Apagar a conversa no provider (`esquecer`) fica em `registro.esquecidas`.
 */
export const driverFalso = (registro: Registro, provider: Motor.Provider): Motor.Driver => ({
  detectar: Effect.succeed({ provider, instalado: true, autenticado: true, versao: "0.0.0-teste", plano: "teste" }),
  esquecer: (idNativo, pasta) =>
    Effect.sync(() => {
      const apagou = registro.recusarEsquecer !== true;
      if (apagou) registro.esquecidas.push(`${idNativo} em ${pasta}`);
      registro.aoEsquecer?.();
      return apagou;
    }),
  iniciar: (config) =>
    Effect.gen(function* () {
      if (provider === "codex") {
        return yield* new Motor.FalhaProvider({
          provider,
          operacao: "iniciar sessão",
          tipo: "desconhecido",
          cause: new Error("falha de teste em /Users/alguem/segredo para alguem@exemplo.com"),
        });
      }
      if (config.retomar !== undefined && registro.recusarRetomada === true) {
        return yield* new Motor.FalhaProvider({ provider, operacao: "retomar", tipo: "versao" });
      }
      registro.configs.push(config);
      const idNativo = config.retomar ?? `nativo-${registro.configs.length}`;
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      const queda = yield* Deferred.make<Motor.FalhaProvider>();
      registro.derrubar = (causa) => {
        const falha = new Motor.FalhaProvider({
          provider,
          operacao: "sessão",
          tipo: "queda",
          ...(causa ? { cause: causa } : {}),
        });
        return Deferred.succeed(queda, falha).pipe(Effect.andThen(canal.morrer(falha)), Effect.uninterruptible);
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          registro.encerradas++;
          registro.aoEncerrar?.();
        }),
      );
      const escrever = (texto: string) =>
        Effect.gen(function* () {
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Vou " });
          yield* canal.emitir({
            _tag: "FerramentaIniciada",
            id: "f1",
            nome: "escrever",
            tipo: "escrita",
            entrada: { texto },
          });
          const decisao = yield* canal.pedirAprovacao({
            id: "f1",
            ferramenta: "escrever",
            tipo: "escrita",
            descricao: "escrever um arquivo",
            entrada: { texto },
          });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: "f1",
            nome: "escrever",
            resumo: decisao,
            falhou: decisao === "negar",
          });
          yield* canal.emitir({ _tag: "TextoFinal", texto: `Vou ${decisao}` });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "concluido" });
        });
      // "grav": pede aprovação e, permitido, cria `resultado.md` e altera `entrada.md` na pasta (o Desfazer).
      const gravar = (texto: string) =>
        Effect.gen(function* () {
          const decisao = yield* canal.pedirAprovacao({
            id: "g1",
            ferramenta: "Write",
            tipo: "escrita",
            descricao: "gravar resultado.md",
            entrada: { texto },
          });
          if (decisao === "permitir") {
            NodeFS.writeFileSync(NodePath.join(config.pastaTrabalho, "resultado.md"), `# Resultado\n\n${texto}\n`);
            const entrada = NodePath.join(config.pastaTrabalho, "entrada.md");
            if (NodeFS.existsSync(entrada)) NodeFS.writeFileSync(entrada, "alterado pela IA\n");
            // "link:<alvo>": troca `x.txt` por um link para <alvo> e muda `sub/a.txt` (o Desfazer não segue links).
            const link = /link:(\S+)/.exec(texto)?.[1];
            if (link !== undefined) {
              NodeFS.rmSync(NodePath.join(config.pastaTrabalho, "x.txt"), { force: true });
              NodeFS.symlinkSync(link, NodePath.join(config.pastaTrabalho, "x.txt"));
              NodeFS.writeFileSync(NodePath.join(config.pastaTrabalho, "sub", "a.txt"), "mudado pela IA\n");
            }
            // "subpasta": também cria `novo/sub/x.md` (pastas novas que o Desfazer tira).
            if (texto.includes("subpasta")) {
              NodeFS.mkdirSync(NodePath.join(config.pastaTrabalho, "novo", "sub"), { recursive: true });
              NodeFS.writeFileSync(NodePath.join(config.pastaTrabalho, "novo", "sub", "x.md"), "x\n");
            }
          }
          yield* canal.emitir({ _tag: "TextoFinal", texto: decisao === "permitir" ? "Gravei." : "Não gravei." });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "concluido" });
        });
      const responder = (texto: string) =>
        Effect.gen(function* () {
          registro.textos.push(texto);
          if (texto.includes("grav")) return yield* gravar(texto);
          if (texto.includes("escrev")) return yield* escrever(texto);
          if (texto.includes("demor")) {
            yield* canal.emitir({ _tag: "TextoParcial", texto: "Pensando " });
            return yield* Effect.never;
          }
          // "limite": a conta no limite de uso; o turno falha e a sessão continua aberta.
          if (texto.includes("limite")) {
            yield* canal.emitir(Motor.erroDoTurno("You've hit your usage limit."));
            return yield* canal.emitir({ _tag: "FimTurno", motivo: "falha" });
          }
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Resposta a: " });
          yield* canal.emitir({ _tag: "TextoParcial", texto });
          yield* canal.emitir({ _tag: "TextoFinal", texto: `Resposta a: ${texto}` });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "concluido" });
        });
      return {
        idNativo,
        queda: Deferred.await(queda),
        enviar: (texto) => {
          const eventos = canal.turno(Effect.asVoid(Effect.forkIn(responder(texto), escopo)));
          const segurar = registro.segurarFim;
          return segurar === undefined
            ? eventos
            : Stream.concat(eventos, Stream.drain(Stream.fromEffect(Deferred.await(segurar))));
        },
        responder: canal.responder,
        interromper:
          registro.ignorarInterrupcao === true
            ? Effect.void
            : canal.emitir({ _tag: "FimTurno", motivo: "interrompido" }),
      } satisfies Motor.SessaoDriver;
    }),
});

export const layerDriversFalsos = (registro: Registro) =>
  Layer.succeed(
    Motor.Drivers,
    Motor.Drivers.of({
      claude: driverFalso(registro, "claude"),
      codex: driverFalso(registro, "codex"),
      antigravity: driverFalso(registro, "antigravity"),
    }),
  );

/**
 * O cliente do `GrupoApp` em `url`, com os cabeçalhos dados; fecha com o escopo. Sem nova tentativa:
 * uma conexão recusada falha as chamadas.
 */
export const cliente = (url: string, cabecalhos?: Record<string, string>) =>
  Effect.gen(function* () {
    // O protocolo vive no escopo de quem chama: com `Effect.provide`, o socket fecharia ao fim do `make`.
    const protocolo = yield* Layer.build(
      RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
        Layer.provide(Socket.layerWebSocket(url, cabecalhos === undefined ? {} : { headers: cabecalhos })),
        Layer.provide(NodeSocket.layerWebSocketConstructor),
        Layer.provide(RpcSerialization.layerJson),
      ),
    );
    return yield* RpcClient.make(GrupoApp).pipe(Effect.provide(protocolo));
  });

/**
 * `revisaoPpc.revisar` (ou o `ListaViva.revisar`) até o fim: as etapas, na ordem em que chegaram, e o
 * resultado do `pronto`. Sem `pronto`, defeito.
 */
export const revisarAteOFim = <E, R>(stream: Stream.Stream<EventoRevisaoPpc, E, R>) =>
  Stream.runCollect(stream).pipe(
    Effect.flatMap((eventos) => {
      const etapas: Array<EtapaLeituraPpc> = [];
      for (const evento of eventos) if (evento.tipo === "etapa") etapas.push(evento.etapa);
      const pronto = eventos.find((evento) => evento.tipo === "pronto");
      return pronto?.tipo === "pronto"
        ? Effect.succeed({ etapas, ...pronto.resultado })
        : Effect.die("revisaoPpc.revisar terminou sem o resultado");
    }),
  );

/** Um pedido de upgrade WebSocket cru: o status da resposta (101 se o servidor aceitou). */
export const pedirUpgrade = (url: string, cabecalhos: Record<string, string>) =>
  Effect.callback<number>((resume) => {
    const requisicao = NodeHttp.request(url.replace(/^ws:/, "http:"), {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...cabecalhos,
      },
    });
    requisicao.on("upgrade", (_resposta, socket) => {
      socket.destroy();
      resume(Effect.succeed(101));
    });
    requisicao.on("response", (resposta) => {
      resposta.resume();
      resume(Effect.succeed(resposta.statusCode ?? 0));
    });
    requisicao.on("error", (erro) => resume(Effect.die(erro)));
    requisicao.end();
    return Effect.sync(() => requisicao.destroy());
  });

/** Uma requisição HTTP crua: o status, os cabeçalhos e o corpo da resposta. */
export const pedirHttp = (
  url: string,
  opcoes: { readonly metodo: string; readonly cabecalhos?: Record<string, string>; readonly corpo?: string },
) =>
  Effect.callback<{ status: number; cabecalhos: NodeHttp.IncomingHttpHeaders; corpo: string }>((resume) => {
    const requisicao = NodeHttp.request(url.replace(/^ws:/, "http:"), {
      method: opcoes.metodo,
      headers: opcoes.cabecalhos ?? {},
    });
    requisicao.on("response", (resposta) => {
      let corpo = "";
      resposta.setEncoding("utf8");
      resposta.on("data", (pedaco: string) => (corpo += pedaco));
      resposta.on("end", () =>
        resume(Effect.succeed({ status: resposta.statusCode ?? 0, cabecalhos: resposta.headers, corpo })),
      );
    });
    requisicao.on("error", (erro) => resume(Effect.die(erro)));
    requisicao.end(opcoes.corpo);
    return Effect.sync(() => requisicao.destroy());
  });

const CORPO_INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "teste", version: "0" } },
});

/** Um `initialize` MCP por POST: o status da resposta. */
export const postarInitialize = (url: string, cabecalhos: Readonly<Record<string, string>>) =>
  Effect.callback<number>((resume) => {
    const requisicao = NodeHttp.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...cabecalhos,
      },
    });
    requisicao.on("response", (resposta) => {
      resposta.resume();
      resume(Effect.succeed(resposta.statusCode ?? 0));
    });
    requisicao.on("error", (erro) => resume(Effect.die(erro)));
    requisicao.end(CORPO_INITIALIZE);
    return Effect.sync(() => requisicao.destroy());
  });

/**
 * Um turno inteiro como a interface o vê: acompanha a conversa desde agora (o estado de agora fecha o
 * retrato, com a inscrição já feita), envia a mensagem e junta os eventos do turno até o `FimTurno`,
 * passando cada um a `aoEvento` (para responder a uma aprovação, por exemplo).
 */
export const turnoAoVivo = <E1, E2, E3 = never>(
  acompanhar: (depois: number) => Stream.Stream<ItemAoVivo, E1>,
  enviar: Effect.Effect<{ readonly turno: number }, E2>,
  aoEvento: (evento: EventoConversa) => Effect.Effect<unknown, E3> = () => Effect.void,
): Effect.Effect<Array<EventoConversa>, E1 | E2 | E3 | Cause.Done> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fila = yield* Stream.toQueue(acompanhar(Number.MAX_SAFE_INTEGER), { capacity: "unbounded" });
      let item = yield* Queue.take(fila);
      while (item._tag !== "Estado") item = yield* Queue.take(fila);
      const { turno } = yield* enviar;
      const eventos: Array<EventoConversa> = [];
      for (;;) {
        item = yield* Queue.take(fila);
        if (item._tag !== "EventoTurno" || item.turno !== turno) continue;
        eventos.push(item.evento);
        yield* aoEvento(item.evento);
        if (item.evento._tag === "FimTurno") return eventos;
      }
    }),
  );

/** `turnoAoVivo` sobre as `Conversas`. */
export const turnoCompleto = (conversas: Conversas.Conversas["Service"], id: string, texto: string) =>
  turnoAoVivo((depois) => conversas.acompanhar(id, depois), conversas.enviar(id, texto));

type ClienteRpc = Effect.Success<ReturnType<typeof cliente>>;

/** `turnoAoVivo` pelo RPC; com `aprovar`, permite cada pedido de aprovação do turno. */
export const turnoRpc = (rpc: ClienteRpc, sessao: string, texto: string, opcoes: { readonly aprovar?: boolean } = {}) =>
  turnoAoVivo(
    (depois) => rpc["conversa.acompanhar"]({ sessao, depois }),
    rpc["conversa.enviar"]({ sessao, texto }),
    (evento) =>
      opcoes.aprovar === true && evento._tag === "PedidoAprovacao"
        ? rpc["conversa.responderAprovacao"]({ sessao, aprovacao: evento.id, decisao: "permitir" })
        : Effect.void,
  );
