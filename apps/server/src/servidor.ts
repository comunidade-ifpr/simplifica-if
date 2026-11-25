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
 * - **Revisão prévia de PPC** (`revisao-ppc/RevisorPpc.ts`): DOCX → pendências e cópia comentada, sem
 *   IA, num `Worker` com limite de memória e de tempo, sobre a base do mesmo `kb.sqlite`.
 * - **Diagnóstico** (`diagnostico/Diagnostico.ts`): o pacote `.zip` com os logs saneados da pasta de logs
 *   e o `sistema.json`, em `Documentos/Simplifica IF/Diagnósticos/`.
 * - **Leitura** (`GrupoLeitura`) sobre o `kb.sqlite`, só leitura: o mesmo serviço `Leitura` (uma
 *   conexão só ao banco) atende o RPC e o MCP HTTP (`McpHttp.layerSobreLeitura`).
 *
 * Tudo vive no escopo da layer: fechá-lo derruba o RPC, encerra as conversas (o processo de cada
 * provider morre) e fecha o servidor MCP.
 */
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, UrlParams } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { RpcSerialization, RpcServer } from "effect/rpc";
import {
  CAMINHO_INGRESSO,
  CAMINHO_LIBERAR_ARQUIVO,
  CAMINHO_RPC,
  GrupoApp,
  PARAMETRO_INGRESSO,
} from "@simplifica-if/contratos-app";
import type { Canal, CanalDistribuicao } from "@simplifica-if/kb/canal";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as McpRpc from "@simplifica-if/mcp/rpc";
import * as Motor from "@simplifica-if/motor";
import * as ArquivosLiberados from "./ArquivosLiberados.ts";
import * as Atualizador from "./Atualizador.ts";
import * as AtualizadorHarnesses from "./AtualizadorHarnesses.ts";
import type { Abertura } from "@simplifica-if/atualizacao/local";
import type { ChavePublica } from "@simplifica-if/atualizacao/minisign";
import { layerHttp } from "@simplifica-if/atualizacao/remoto";
import * as Autenticacao from "./Autenticacao.ts";
import * as CatalogoSkills from "./CatalogoSkills.ts";
import * as Conversas from "./Conversas.ts";
import * as Handlers from "./handlers.ts";
import * as PastasTrabalho from "./PastasTrabalho.ts";
import * as Relatos from "./Relatos.ts";
import * as Diagnostico from "./diagnostico/Diagnostico.ts";
import * as Banco from "./persistencia/Banco.ts";
import * as Historico from "./persistencia/Historico.ts";
import * as Preferencias from "./persistencia/Preferencias.ts";
import * as RevisorPpc from "./revisao-ppc/RevisorPpc.ts";
import * as TextosAnexos from "./textos-anexos/TextosAnexos.ts";
import * as ListaViva from "./revisao-ppc/ListaViva.ts";
import * as RevisaoIa from "./revisao-ppc/RevisaoIa.ts";
import * as CopiasComentadas from "./persistencia/CopiasComentadas.ts";
import * as RevisoesPpc from "./persistencia/RevisoesPpc.ts";

export interface Opcoes {
  /** O `kb.sqlite` servido pelo MCP e pela leitura. */
  readonly banco: string;
  /** O token do RPC, gerado pelo processo pai. */
  readonly token: Redacted.Redacted<string>;
  /** A porta do RPC; sem ela (ou com 0), a que o sistema escolher. */
  readonly porta?: number;
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
  /** Paralelismo e tempo por turno da revisão com IA (`RevisaoIa.PARALELISMO`); os testes os mudam. */
  readonly revisaoIa?: RevisaoIa.OpcoesRevisaoIa;
  /**
   * O segredo do processo principal do desktop (`EnvelopePartida.tokenDesktop`). Com ele, a revisão
   * prévia só revisa arquivos liberados em `CAMINHO_LIBERAR_ARQUIVO`.
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
  /** "Isto está errado" (M1.12): o repositório da curadoria (padrão: o da política de fábrica). */
  readonly relatos?: Relatos.OpcoesRelatos;
  /**
   * "Gerar diagnóstico": a pasta de logs (`--pasta-logs`) e o modo dos traces. Sem a pasta, o pacote sai
   * só com o `sistema.json` e o `LEIA-ME.txt`.
   */
  readonly diagnostico?: Diagnostico.OpcoesDiagnostico;
  /** Aviso de uso aceito e boas-vindas feitas ao abrir (M1.8): os testes que não passam por elas. */
  readonly primeiroUsoFeito?: boolean;
  /**
   * Atualização da base e das skills (M1.10), montada pela CLI depois de `prepararAbertura`. Sem ela,
   * o serviço responde como desligado (`atualizacao.estado`), com o motivo.
   */
  readonly atualizacao?: OpcoesAtualizacao;
  /** Atualização silenciosa dos harnesses gerenciados (Antigravity, Codex) em segundo plano. */
  readonly atualizacaoHarnesses?: {
    readonly automatico?: boolean;
    readonly atrasoInicial?: Duration.Input;
    readonly intervalo?: Duration.Input;
    readonly intervaloOcupado?: Duration.Input;
  };
}

export interface OpcoesAtualizacao {
  readonly desligada: string | null;
  readonly feed: string | null;
  readonly chave: ChavePublica | null;
  readonly canalPadrao: CanalDistribuicao;
  readonly pasta: string;
  readonly bancoEmpacotado: string;
  readonly versaoApp: string;
  readonly abertura: Abertura;
  readonly automatico?: boolean;
}

/** Há revisão de PPC, conversa respondendo ou operação na pasta de tarefa em andamento? */
const servidorOcupado = Effect.gen(function* () {
  const revisor = yield* RevisorPpc.RevisorPpc;
  const ia = yield* RevisaoIa.RevisaoIa;
  const conversas = yield* Conversas.Conversas;
  const pastas = yield* PastasTrabalho.PastasTrabalho;
  return Effect.gen(function* () {
    if (yield* revisor.ocupada) return true;
    if (yield* pastas.emAndamento) return true;
    if (yield* ia.ocupada) return true;
    return (yield* conversas.listar).some((conversa) => conversa.estado === "respondendo");
  });
});

/**
 * O serviço de atualização sobre as revisões e conversas em curso (a troca espera) e as skills do catálogo,
 * com o download pela proxy do ambiente (a que o desktop resolve e passa ao servidor).
 */
const layerAtualizador = (opcoes: Opcoes) =>
  Layer.effect(
    Atualizador.Atualizador,
    Effect.gen(function* () {
      const catalogo = yield* CatalogoSkills.CatalogoSkills;
      // A troca reinicia o servidor: espera a revisão prévia, a revisão com IA, conversa respondendo (as de
      // tarefa do M1.9 incluídas: são conversas com `tarefa`) e o Desfazer ou a cópia da pasta.
      const ocupado = yield* servidorOcupado;
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
  ).pipe(Layer.provide(layerHttp()));

/** Atualização silenciosa em segundo plano dos harnesses gerenciados (Antigravity e Codex). */
const layerAtualizadorHarnesses = (opcoes: Opcoes) =>
  Layer.effect(
    AtualizadorHarnesses.AtualizadorHarnesses,
    Effect.gen(function* () {
      const preferencias = yield* Preferencias.Preferencias;
      const ocupado = yield* servidorOcupado;
      const h = opcoes.atualizacaoHarnesses;
      return yield* AtualizadorHarnesses.make({
        ocupado,
        desligados: Effect.map(preferencias.ler, (lidas) => lidas.iasDesligadas),
        ...(h?.automatico === undefined ? {} : { automatico: h.automatico }),
        ...(h?.atrasoInicial === undefined ? {} : { atrasoInicial: h.atrasoInicial }),
        ...(h?.intervalo === undefined ? {} : { intervalo: h.intervalo }),
        ...(h?.intervaloOcupado === undefined ? {} : { intervaloOcupado: h.intervaloOcupado }),
      });
    }),
  );

/** As pastas de tarefa e das cópias: as dadas, ou temporárias (removidas com o servidor). */
const layerPastas = (opcoes: Opcoes) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      // Sem a pasta temporária o servidor não sobe: a falha é defeito.
      const temporaria = (prefixo: string) => fs.makeTempDirectoryScoped({ prefix: prefixo }).pipe(Effect.orDie);
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
      }).pipe(Layer.provide(TextosAnexos.layer()));
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

/** O corpo de `POST /revisao-ppc/liberar`: o caminho absoluto do arquivo escolhido no diálogo. */
const lerCorpoLiberacao = HttpServerRequest.schemaBodyJson(Schema.Struct({ arquivo: Schema.String }));

/**
 * O servidor `effect/rpc` do `GrupoApp`, atrás da autenticação, na rota GET `/rpc`, e a emissão de
 * ingressos do WebSocket em `POST /ingresso` (com o `OPTIONS` do CORS).
 */
const layerRotaRpc = Layer.unwrap(
  Effect.gen(function* () {
    const autenticacao = yield* Autenticacao.Autenticacao;
    const liberacao = yield* ArquivosLiberados.ArquivosLiberados;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    // Como o T3 (`WS_RPC_SERVER_OPTIONS`): um defeito num handler não derruba as outras chamadas. A
    // conexão que cai não encerra conversa: elas não dependem da conexão (`Conversas.ts`). O tracing
    // fica ligado: o span do handler herda o `traceId` da interface, que dá o código do erro no log
    // (`codigoDoErro`, em `handlers.ts`).
    yield* RpcServer.make(GrupoApp, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
    );
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
      // O processo principal do desktop libera o arquivo escolhido no diálogo (revisão prévia e anexos).
      HttpRouter.add(
        "POST",
        CAMINHO_LIBERAR_ARQUIVO,
        Effect.gen(function* () {
          const requisicao = yield* HttpServerRequest.HttpServerRequest;
          const recusa = yield* autenticacao.conferirDesktop(requisicao);
          if (Option.isSome(recusa)) return recusa.value;
          const corpo = yield* Effect.option(lerCorpoLiberacao);
          if (Option.isNone(corpo) || !NodePath.isAbsolute(corpo.value.arquivo))
            return HttpServerResponse.empty({ status: 400 });
          yield* liberacao.liberar(corpo.value.arquivo);
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
  const leitura = McpRpc.layerLeitura({ banco: opcoes.banco, canal, etapaRegistrada: true });
  const mcp = McpHttp.layerSobreLeitura();
  const banco = opcoes.bancoConversas === undefined ? Banco.layerMemoria : Banco.layerArquivo(opcoes.bancoConversas);
  const nucleo = Conversas.layer({
    ...(opcoes.ociosidade === undefined ? {} : { ociosidade: opcoes.ociosidade }),
    ...(opcoes.prazoInterrupcao === undefined ? {} : { prazoInterrupcao: opcoes.prazoInterrupcao }),
  }).pipe(
    Layer.provideMerge(layerPastas(opcoes)),
    Layer.provideMerge(ListaViva.layer()),
    Layer.provideMerge(RevisaoIa.layer(opcoes.revisaoIa)),
    Layer.provideMerge(RevisoesPpc.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(RevisorPpc.layer()),
    Layer.provideMerge(CopiasComentadas.layer.pipe(Layer.provide(banco))),
    Layer.provideMerge(ArquivosLiberados.layer({ exigirLiberacao: opcoes.tokenDesktop !== undefined })),
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
  const comAtualizacao = Layer.mergeAll(layerAtualizador(opcoes), layerAtualizadorHarnesses(opcoes)).pipe(
    Layer.provideMerge(nucleo),
  );
  const comRelatos = Layer.mergeAll(Relatos.layer(opcoes.relatos), Diagnostico.layer(opcoes.diagnostico)).pipe(
    Layer.provideMerge(comAtualizacao),
  );
  const handlers = Handlers.layer.pipe(Layer.provide(comRelatos));
  // Sem span HTTP para o `/rpc`: ele dura a conexão inteira e a URL pode trazer o `?ingresso=`; cada
  // chamada RPC já tem o seu span, filho do da interface. Se uma URL com credencial ainda chegar a um span
  // ou a um erro, o `ingresso` e o `token` saem como `REDACTED`.
  const servir = HttpRouter.serve(layerRotaRpc, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpMiddleware.TracerDisabledWhen)(
          (requisicao) => requisicao.url === CAMINHO_RPC || requisicao.url.startsWith(`${CAMINHO_RPC}?`),
        ),
        Layer.succeed(UrlParams.CurrentRedactedNames)([
          ...UrlParams.CurrentRedactedNames.defaultValue(),
          PARAMETRO_INGRESSO,
          "token",
        ]),
      ),
    ),
  );
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
