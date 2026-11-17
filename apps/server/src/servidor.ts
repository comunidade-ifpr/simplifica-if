// @effect-diagnostics nodeBuiltinImport:off -- o servidor HTTP do Node (`createServer`) é a borda deste módulo
/**
 * `@simplifica-if/server`: o servidor local do app numa só aplicação Effect.
 *
 * - **RPC** (`GrupoApp` de `@simplifica-if/contratos-app`) por WebSocket em `ws://127.0.0.1:<porta>/rpc`,
 *   com um servidor `effect/rpc` para todas as conexões, como a rota `/ws` do T3 (`ws.ts`):
 *   `RpcServer.makeProtocolWithHttpEffectWebsocket` e a autenticação antes do upgrade
 *   (`Autenticacao.ts`), com o token ou um ingresso de curta duração (`POST /ingresso`).
 * - **MCP** `ifpr` por HTTP (`@simplifica-if/mcp/http`), numa porta própria; cada conversa recebe uma
 *   sessão com token próprio (`Conversas.ts`).
 * - **Conversas** gravadas no banco `conversas.sqlite` da pasta de estado (`persistencia/`), com a
 *   sessão do provider liberada ociosa e reaberta por retomada (`Conversas.ts`).
 * - **Motor** (`@simplifica-if/motor`) sobre os `Drivers` do ambiente: os reais (`Drivers.layerNode`,
 *   na CLI) ou drivers de teste.
 * - **Skills do app** (`CatalogoSkills.ts`): as da pasta `pastaSkills` com bloco `simplifica:` válido,
 *   entregues a toda conversa e listadas por `skills.listar`.
 * - **Revisão prévia de PPC** (`revisao-ppc/AnalisePpc.ts`): DOCX → pendências e cópia comentada, sem
 *   IA, num `Worker` com limite de memória e de tempo, sobre a base do mesmo `kb.sqlite`.
 * - **Leitura** (`GrupoLeitura`) sobre o `kb.sqlite`, só leitura: o mesmo serviço `Leitura` (uma
 *   conexão só ao banco) atende o RPC e o MCP HTTP (`McpHttp.layerSobreLeitura`).
 *
 * Tudo vive no escopo da layer: fechá-lo derruba o RPC, encerra as conversas (o processo de cada
 * provider morre) e fecha o servidor MCP.
 */
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { CAMINHO_INGRESSO, CAMINHO_LIBERAR_ARQUIVO, CAMINHO_RPC, GrupoApp } from "@simplifica-if/contratos-app";
import type { Canal } from "@simplifica-if/mcp/contratos";
import * as McpHttp from "@simplifica-if/mcp/http";
import { layerLeitura, Leitura } from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as Atualizador from "./Atualizador.ts";
import type { Abertura } from "@simplifica-if/atualizacao/local";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import * as Autenticacao from "./Autenticacao.ts";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import * as Conversas from "./Conversas.ts";
import * as Handlers from "./handlers.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Banco from "./persistencia/Banco.ts";
import * as Historico from "./persistencia/Historico.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";
import * as AnalisePpc from "./revisao-ppc/AnalisePpc.ts";
import * as ListaViva from "./revisao-ppc/ListaViva.ts";
import * as RevisaoIa from "./revisao-ppc/RevisaoIa.ts";
import * as Listas from "./persistencia/Listas.ts";
import * as Revisoes from "./persistencia/Revisoes.ts";

export interface Opcoes {
  /** O `kb.sqlite` servido pelo MCP e pela leitura. */
  readonly banco: string;
  /** O token do RPC, gerado pelo processo pai. */
  readonly token: Redacted.Redacted<string>;
  /** A porta do RPC; sem ela (ou com 0), a que o sistema escolher. */
  readonly porta?: number;
  /** A porta do MCP; sem ela (ou com 0), a que o sistema escolher. */
  readonly portaMcp?: number;
  /** As origens de navegador aceitas no WebSocket (ver `Autenticacao.ts`). */
  readonly origens?: ReadonlyArray<string>;
  /** O canal da base quando o banco não registra um (padrão: `dev`, como a CLI do MCP). */
  readonly canal?: Canal;
  /**
   * O banco das conversas (`conversas.sqlite` na pasta de estado, na CLI). Sem ele, o banco fica na
   * memória e as conversas se perdem quando o servidor fecha (testes).
   */
  readonly bancoConversas?: string;
  /** Depois de quanto tempo sem turno a sessão do provider se libera (`Conversas.OCIOSIDADE`). */
  readonly ociosidade?: Duration.Duration;
  /** Quanto se espera pelo fim do turno interrompido antes de liberar a sessão (`Conversas.PRAZO_INTERRUPCAO`). */
  readonly prazoInterrupcao?: Duration.Duration;
  /**
   * A pasta das skills do app (`CatalogoSkills.ts`): `.agents/skills` do checkout no desenvolvimento,
   * `<Resources>/skills` no app empacotado. Sem ela, as conversas não recebem skills.
   */
  readonly pastaSkills?: string;
  /** Limites e script do Worker da revisão prévia (`AnalisePpc.LIMITES`); os testes os apertam. */
  readonly revisaoPpc?: AnalisePpc.OpcoesAnalise;
  /** Paralelismo e tempo por turno da revisão com IA (`RevisaoIa.PARALELISMO`); os testes os mudam. */
  readonly revisaoIa?: RevisaoIa.OpcoesRevisaoIa;
  /** Tempo máximo de uma ação com IA sobre uma pendência (`ListaViva.TEMPO_ACAO`). */
  readonly listaViva?: { readonly tempoAcao?: Duration.Duration };
  /**
   * O segredo do processo principal do desktop (`EnvelopePartida.tokenDesktop`). Com ele, a revisão
   * prévia só analisa arquivos liberados em `CAMINHO_LIBERAR_ARQUIVO`.
   */
  readonly tokenDesktop?: Redacted.Redacted<string>;
  /**
   * A raiz das pastas de tarefa (M1.9): `Documentos/Simplifica IF`. Sem ela (testes), uma pasta
   * temporária que some com o servidor.
   */
  readonly pastaTrabalhos?: string;
  /**
   * Onde ficam as cópias da pasta antes de cada turno (o "Desfazer"): `copias/` ao lado do banco das
   * conversas; sem banco, uma pasta temporária.
   */
  readonly pastaCopias?: string;
  /** Limites das cópias e dos anexos (`PastasTrabalho.LIMITES`); os testes os apertam. */
  readonly limitesPasta?: Partial<PastasTrabalho.Limites>;
  /** Aviso de uso aceito e boas-vindas feitas ao abrir (M1.8): os testes que não passam por elas. */
  readonly primeiroUsoFeito?: boolean;
  /**
   * Atualização da base e das skills (M1.10), montada pela CLI depois de `prepararAbertura`. Sem ela,
   * o serviço responde como desligado (`atualizacao.estado`), com o motivo.
   */
  readonly atualizacao?: OpcoesAtualizacao;
}

export interface OpcoesAtualizacao {
  readonly desligada: string | null;
  readonly feed: string | null;
  readonly chave: ChavePublica | null;
  readonly canalPadrao: "beta" | "estavel";
  readonly pasta: string;
  readonly bancoEmpacotado: string;
  readonly versaoApp: string;
  readonly abertura: Abertura;
  readonly automatico?: boolean;
}

/** O serviço de atualização sobre as análises e conversas em curso (a troca espera) e as skills do catálogo. */
const layerAtualizador = (opcoes: Opcoes) =>
  Layer.effect(
    Atualizador.Atualizador,
    Effect.gen(function* () {
      const analise = yield* AnalisePpc.AnalisePpc;
      const ia = yield* RevisaoIa.RevisaoIa;
      const conversas = yield* Conversas.Conversas;
      const catalogo = yield* CatalogoSkills.CatalogoSkills;
      const pastas = yield* PastasTrabalho.PastasTrabalho;
      // A troca reinicia o servidor: espera análise, revisão com IA, conversa respondendo (as de
      // tarefa do M1.9 incluídas: são conversas com `tarefa`) e o Desfazer ou a cópia da pasta.
      const ocupado = Effect.gen(function* () {
        if (yield* analise.ocupada) return true;
        if (yield* pastas.emAndamento) return true;
        if ((yield* ia.listar).some((revisao) => revisao.situacao === "em_andamento")) return true;
        return (yield* conversas.listar).some((conversa) => conversa.estado === "respondendo");
      });
      const a = opcoes.atualizacao;
      return yield* Atualizador.make({
        ...(a ?? {
          desligada: "a atualização não foi configurada neste servidor",
          feed: null,
          chave: null,
          canalPadrao: "beta",
          pasta: "",
          bancoEmpacotado: opcoes.banco,
          versaoApp: "0.0.0",
          abertura: { banco: opcoes.banco, origem: "empacotada", info: null, pastasSkills: [], eventos: [] },
          automatico: false,
        }),
        versoesSkills: catalogo.versoes,
        ocupado,
      });
    }),
  );

/** As pastas de tarefa e das cópias: as dadas, ou temporárias (removidas com o servidor). */
const layerPastas = (opcoes: Opcoes) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const temporaria = (prefixo: string) =>
        Effect.acquireRelease(
          Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefixo))),
          (pasta) => Effect.promise(() => NodeFSP.rm(pasta, { recursive: true, force: true })),
        );
      const raiz = opcoes.pastaTrabalhos ?? (yield* temporaria("simplifica-trabalhos-"));
      const copias =
        opcoes.pastaCopias ??
        (opcoes.bancoConversas === undefined
          ? yield* temporaria("simplifica-copias-")
          : NodePath.join(NodePath.dirname(opcoes.bancoConversas), "copias"));
      return PastasTrabalho.layer({
        raiz,
        copias,
        ...(opcoes.limitesPasta === undefined ? {} : { limites: opcoes.limitesPasta }),
      });
    }),
  );

/** O servidor do RPC não abriu: porta ocupada, sem permissão ou interface indisponível. */
export class ServidorNaoAbriu extends Schema.TaggedError<ServidorNaoAbriu>()("ServidorNaoAbriu", {
  porta: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.porta === 0
      ? "não foi possível abrir o servidor do Simplifica IF em 127.0.0.1"
      : `não foi possível abrir o servidor do Simplifica IF em 127.0.0.1:${this.porta} (a porta pode estar em uso)`;
  }
}

export class ServidorApp extends Context.Service<
  ServidorApp,
  {
    /** A porta do RPC. */
    readonly porta: number;
    /** `ws://127.0.0.1:<porta>/rpc` */
    readonly urlRpc: string;
    /** `http://127.0.0.1:<porta MCP>/mcp` */
    readonly urlMcp: string;
  }
>()("@simplifica-if/server/servidor/ServidorApp") {}

/**
 * O servidor `effect/rpc` do `GrupoApp`, atrás da autenticação, na rota GET `/rpc`, e a emissão de
 * ingressos do WebSocket em `POST /ingresso` (com o `OPTIONS` do CORS).
 */
const layerRotaRpc = Layer.unwrap(
  Effect.gen(function* () {
    const autenticacao = yield* Autenticacao.Autenticacao;
    const analise = yield* AnalisePpc.AnalisePpc;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    // Como o T3 (`WS_RPC_SERVER_OPTIONS`): um defeito num handler não derruba as outras chamadas. A
    // conexão que cai não encerra conversa: elas não dependem da conexão (`Conversas.ts`).
    yield* RpcServer.make(GrupoApp, {
      disableTracing: true,
      disableFatalDefects: true,
    }).pipe(Effect.provideService(RpcServer.Protocol, protocol), Effect.forkScoped);
    return Layer.mergeAll(
      HttpRouter.add(
        "GET",
        CAMINHO_RPC,
        Effect.gen(function* () {
          const requisicao = yield* HttpServerRequest.HttpServerRequest;
          const recusa = yield* autenticacao.conferir(requisicao);
          return Option.isSome(recusa) ? recusa.value : yield* httpEffect;
        }),
      ),
      HttpRouter.add("POST", CAMINHO_INGRESSO, autenticacao.emitirIngresso),
      // O processo principal do desktop libera o arquivo escolhido no diálogo (revisão prévia).
      HttpRouter.add(
        "POST",
        CAMINHO_LIBERAR_ARQUIVO,
        Effect.gen(function* () {
          const requisicao = yield* HttpServerRequest.HttpServerRequest;
          const recusa = yield* autenticacao.conferirDesktop(requisicao);
          if (Option.isSome(recusa)) return recusa.value;
          const corpo = yield* Effect.option(requisicao.json);
          const arquivo = Option.isSome(corpo) ? (corpo.value as { arquivo?: unknown } | null)?.arquivo : undefined;
          if (typeof arquivo !== "string" || !NodePath.isAbsolute(arquivo))
            return HttpServerResponse.empty({ status: 400 });
          yield* analise.liberar(arquivo);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
      HttpRouter.add("OPTIONS", CAMINHO_INGRESSO, autenticacao.preflightIngresso),
    );
  }),
);

const makeServidorApp = Effect.gen(function* () {
  const endereco = (yield* HttpServer.HttpServer).address;
  const mcp = yield* McpHttp.ServidorMcpHttp;
  const porta = NetAddress.isInetAddress(endereco) ? endereco.port : 0;
  return ServidorApp.of({ porta, urlRpc: `ws://127.0.0.1:${porta}${CAMINHO_RPC}`, urlMcp: mcp.url });
});

/**
 * O servidor local inteiro. Pede os `Drivers` do motor (os reais, `Drivers.layerNode`, ou de teste) e
 * os serviços do Node (`NodeServices.layer`).
 */
export const layer = (opcoes: Opcoes) => {
  const porta = opcoes.porta ?? 0;
  const canal = opcoes.canal ?? "dev";
  // Um `Leitura` só (uma conexão ao `kb.sqlite`) para o MCP HTTP e para o RPC de leitura.
  // No app, a ferramenta `etapa` é registrada: a interface a lê nos eventos da conversa (M1.9).
  const leitura = Layer.effect(
    Leitura,
    Effect.gen(function* () {
      const servico = yield* Leitura;
      return Leitura.of({
        ...servico,
        etapa: Effect.fn("Leitura.etapa")(function* (entrada: Parameters<typeof servico.etapa>[0]) {
          const resposta = yield* servico.etapa(entrada);
          return { ...resposta, dados: { registrado: true } };
        }),
      });
    }),
  ).pipe(Layer.provideMerge(layerLeitura({ banco: opcoes.banco, canal })));
  const mcp = McpHttp.layerSobreLeitura(opcoes.portaMcp ? { porta: opcoes.portaMcp } : {});
  const banco = opcoes.bancoConversas === undefined ? Banco.layerMemoria : Banco.layerArquivo(opcoes.bancoConversas);
  const nucleo = Conversas.layer({
    ...(opcoes.ociosidade === undefined ? {} : { ociosidade: opcoes.ociosidade }),
    ...(opcoes.prazoInterrupcao === undefined ? {} : { prazoInterrupcao: opcoes.prazoInterrupcao }),
  }).pipe(
    Layer.provideMerge(layerPastas(opcoes)),
    Layer.provideMerge(ListaViva.layer(opcoes.listaViva)),
    Layer.provideMerge(RevisaoIa.layer(opcoes.revisaoIa)),
    Layer.provideMerge(Revisoes.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(Listas.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(AnalisePpc.layer({ ...opcoes.revisaoPpc, exigirLiberacao: opcoes.tokenDesktop !== undefined })),
    Layer.provideMerge(Motor.layer),
    Layer.provideMerge(Historico.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(
      (opcoes.primeiroUsoFeito === true ? Preferencias.layerPrimeiroUsoFeito : Preferencias.layer).pipe(
        Layer.provide(banco),
      ),
    ),
    Layer.provideMerge(
      opcoes.pastaSkills === undefined
        ? CatalogoSkills.layerVazio
        : CatalogoSkills.layer(opcoes.pastaSkills, opcoes.atualizacao?.abertura.pastasSkills ?? []),
    ),
    Layer.provideMerge(mcp),
    Layer.provideMerge(leitura),
  );
  const comAtualizacao = layerAtualizador(opcoes).pipe(Layer.provideMerge(nucleo));
  const handlers = Handlers.layer.pipe(Layer.provide(comAtualizacao));
  const servir = HttpRouter.serve(layerRotaRpc, { disableLogger: true, disableListenLog: true });
  // Sem o fechamento preventivo: ele espera as conexões abertas antes de interromper os fibers que as
  // fecham, e um WebSocket conectado segurava o encerramento pelos 20 s do prazo. Assim, as conexões
  // fecham (1001) e o servidor fecha logo depois.
  const node = Layer.effect(
    HttpServer.HttpServer,
    NodeHttpServer.make(() => NodeHttp.createServer(), {
      host: "127.0.0.1",
      port: porta,
      disablePreemptiveShutdown: true,
    }).pipe(Effect.mapError((erro) => new ServidorNaoAbriu({ porta, cause: erro }))),
  );
  return Layer.effect(ServidorApp, makeServidorApp).pipe(
    Layer.provide(servir),
    Layer.provide(
      Autenticacao.layer({ token: opcoes.token, origens: opcoes.origens ?? [], tokenDesktop: opcoes.tokenDesktop }),
    ),
    Layer.provide(Layer.mergeAll(handlers, RpcSerialization.layerJson)),
    Layer.provide(nucleo),
    Layer.provide(node),
    Layer.provide(
      Layer.mergeAll(NodeHttpServer.layerHttpServices, NodeCrypto.layerDigest, NodeCrypto.layerSecureRandom),
    ),
  );
};
