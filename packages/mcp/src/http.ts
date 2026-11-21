// @effect-diagnostics nodeBuiltinImport:off -- o servidor HTTP do Node (`createServer`) é a borda deste módulo
/**
 * `@simplifica-if/mcp/http`: o servidor MCP `ifpr` por HTTP local, dentro do processo do app (M1.4).
 * O mesmo Toolkit, as mesmas instruções e o mesmo registro de ferramentas do executável stdio
 * (`servidor.ts`), servidos por `McpServer.layerHttp` em `http://127.0.0.1:<porta>/mcp`. As CLIs dos
 * providers se ligam a ele com um token por sessão (`abrirSessao`), e o app vê cada chamada de
 * ferramenta e cada leitura de recurso `ifpr://` (`chamadas`).
 *
 * Defesas, conferidas nesta ordem, antes de o protocolo MCP ver a requisição:
 *
 * 1. **Interface:** o servidor escuta só em `127.0.0.1`; a porta, se não for dada, é a que o sistema
 *    escolher.
 * 2. **`Host`** (DNS rebinding): só `127.0.0.1:<porta>` e `localhost:<porta>`; outro valor, ou a falta
 *    dele, recebe 403. O T3 não confere o `Host` no `/mcp`; aqui ele é a defesa principal, porque o
 *    servidor não tem outra autenticação de navegador.
 * 3. **Token:** `Authorization: Bearer <token>`. Sem token, com token desconhecido ou revogado: 401,
 *    com `WWW-Authenticate: Bearer` (e `error="invalid_token"` quando veio um token), como no T3, sem
 *    o convite ao OAuth. O token tem 32 bytes do `SecureRandom`; guarda-se só o SHA-256 dele, e a
 *    conferência compara o hash do token recebido com o de todas as sessões abertas por
 *    `Mac.timingSafeEqual`, sem sair no primeiro acerto: o tempo não depende de onde o token difere.
 *    O token vale até fechar o `Scope` de `abrirSessao`.
 * 4. **Tamanho do corpo:** até `LIMITE_CORPO` (1 MiB). Um `Content-Length` maior recebe 413 antes da
 *    leitura; um corpo sem tamanho declarado para no limite do leitor (`MaxBodySize`), como no
 *    `guest/http.ts` do T3. O T3 não limita o corpo do `/mcp`.
 * 5. **`Origin`:** o `layerHttp` do Effect recusa (403) toda requisição com `Origin`, porque nenhuma
 *    origem é permitida; os clientes MCP, que não são navegadores, não o enviam. É o padrão do T3.
 * 6. **Protocolos:** os do stdio (`PROTOCOLOS`). Na `2026-07-28`, cada requisição leva os cabeçalhos
 *    `MCP-Protocol-Version` e `Mcp-Method`, que o `layerHttp` confere contra o corpo.
 *
 * Ficaram de fora, do T3: o OAuth (`McpClientAuthenticator`) e os cabeçalhos `T3-Mode-Limit` e
 * `T3-Sender-Thread`, que servem a ambientes ligados; a expiração do token por inatividade (aqui ele
 * vale enquanto a sessão estiver aberta); e a listagem adiada (`tool_search`).
 *
 * Escopo por sessão: a requisição autorizada leva ao contexto da chamada a `SessaoAtual` (o rótulo e o
 * registro das chamadas, como o `McpInvocationContext` do T3) e, se a sessão tiver pasta de trabalho,
 * a `PastaTrabalho` dela, que vale mais que a pasta global (`pastaTrabalho` da layer).
 *
 * Duas layers: `layer({ banco })` monta o próprio `Leitura` sobre o `kb.sqlite`; `layerSobreLeitura()`
 * pede o `Leitura` ao ambiente, para quem já o tem (o servidor do app, que o usa também no RPC) abrir
 * uma conexão só ao banco.
 *
 * Trechos copiados do T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc., commit a6d9140972), em inglês,
 * marcados com "T3:" abaixo: `normalizeMcpHttpResponse` e `parseBearerToken`.
 */
import * as NodeHttp from "node:http";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { McpServer } from "effect/ai";
import { HttpIncomingMessage, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import type { Canal } from "@simplifica-if/kb/canal";
import { EntradaInvalida } from "./contratos.ts";
import * as PastaTrabalho from "./leitura/PastaTrabalho.ts";
import * as SessaoAtual from "./SessaoAtual.ts";
import { INSTRUCOES, layerLeitura, layerRegistro, NOME_SERVIDOR, PROTOCOLOS, VERSAO_PACOTE } from "./servidor.ts";

/** O caminho do endpoint MCP. */
export const CAMINHO = "/mcp";

/** Maior corpo de requisição aceito. A maior entrada das ferramentas (`resolver_citacoes`) tem 12 mil caracteres. */
export const LIMITE_CORPO = 1024 * 1024;

/** Endereço e cabeçalhos com que uma CLI de provider se liga ao servidor numa sessão. */
export interface SessaoMcp {
  /** `http://127.0.0.1:<porta>/mcp` */
  readonly url: string;
  /** `{ Authorization: "Bearer <token>" }` */
  readonly cabecalhos: Readonly<Record<string, string>>;
}

export type { TipoChamada } from "./SessaoAtual.ts";

/**
 * Uma chamada de ferramenta (`tools/call`) ou uma leitura de recurso (`resources/read`), para o app
 * (leitor, métricas). A leitura de recurso traz `tipo: "recurso"` e, em `ferramenta`, o URI pedido,
 * como o provider o mandou (`ifpr://cnct/tecnico-em-enfermagem`); a chamada de ferramenta vem sem
 * `tipo`, como antes.
 */
export interface ChamadaFerramenta {
  /** O rótulo da sessão. */
  readonly sessao: string;
  /** O nome da ferramenta; numa leitura de recurso, o URI. */
  readonly ferramenta: string;
  /** `recurso` numa leitura de recurso; ausente (o padrão, `ferramenta`) numa chamada de ferramenta. */
  readonly tipo?: SessaoAtual.TipoChamada;
  /** Milissegundos do `Clock` no início da chamada. */
  readonly inicio: number;
  readonly duracaoMs: number;
  readonly falhou: boolean;
  /**
   * O começo do texto do resultado, numa linha, até 300 caracteres (`LIMITE_RESUMO`); na leitura de
   * recurso que falhou, o da mensagem de erro. Serve a quem não recebe o resultado pelo provider (o
   * `agy` não o manda pelo ACP).
   */
  readonly resumo?: string;
}

/** O servidor HTTP não abriu: porta ocupada, sem permissão ou interface indisponível. */
export class ServidorMcpNaoAbriu extends Schema.TaggedError<ServidorMcpNaoAbriu>()("ServidorMcpNaoAbriu", {
  porta: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.porta === 0
      ? "não foi possível abrir o servidor MCP em 127.0.0.1"
      : `não foi possível abrir o servidor MCP em 127.0.0.1:${this.porta} (a porta pode estar em uso)`;
  }
}

export class ServidorMcpHttp extends Context.Service<
  ServidorMcpHttp,
  {
    /** `http://127.0.0.1:<porta>/mcp` */
    readonly url: string;
    /** A porta em que o servidor escuta. */
    readonly porta: number;
    /**
     * Token novo para uma sessão; ele vale até fechar o Scope. `pastaTrabalho` é a pasta da qual o
     * pacote_contexto pode ler arquivos nessa sessão.
     */
    readonly abrirSessao: (entrada: {
      readonly rotulo: string;
      readonly pastaTrabalho?: string;
    }) => Effect.Effect<SessaoMcp, never, Scope.Scope>;
    /**
     * As chamadas de ferramenta e as leituras de recurso de todas as sessões, a partir de quando se
     * assina o stream.
     */
    readonly chamadas: Stream.Stream<ChamadaFerramenta>;
  }
>()("@simplifica-if/mcp/http/ServidorMcpHttp") {}

/* ================================================================== sessões */

/** Uma sessão aberta: o hash do token e o que a requisição leva ao contexto da chamada. */
interface Sessao {
  readonly hash: Uint8Array;
  readonly sessaoAtual: SessaoAtual.SessaoAtual["Service"];
  readonly pasta: Option.Option<PastaTrabalho.PastaTrabalho["Service"]>;
}

/** As sessões abertas, compartilhadas entre o `ServidorMcpHttp` e a autorização das requisições. */
class Sessoes extends Context.Service<
  Sessoes,
  {
    readonly porta: number;
    readonly abertas: Ref.Ref<ReadonlyArray<Sessao>>;
    readonly chamadas: PubSub.PubSub<ChamadaFerramenta>;
    readonly hashDoToken: (token: string) => Effect.Effect<Uint8Array>;
    /** A pasta das sessões abertas sem pasta própria (`pastaTrabalho` da layer). */
    readonly pastaPadrao: Option.Option<PastaTrabalho.PastaTrabalho["Service"]>;
  }
>()("@simplifica-if/mcp/http/Sessoes") {}

const makeSessoes = Effect.fnUntraced(function* (pastaTrabalho: string | undefined) {
  const servidor = yield* HttpServer.HttpServer;
  const digest = yield* Digest.Digest;
  const endereco = servidor.address;
  const porta = NetAddress.isInetAddress(endereco) ? endereco.port : 0;
  const chamadas = yield* Effect.acquireRelease(PubSub.unbounded<ChamadaFerramenta>(), PubSub.shutdown);
  const abertas = yield* Ref.make<ReadonlyArray<Sessao>>([]);
  // Um defeito do WebCrypto não é recuperável aqui: sem SHA-256 não há como conferir token.
  const hashDoToken = (token: string) =>
    digest.digest(Digest.sha256, new TextEncoder().encode(token)).pipe(Effect.orDie);
  const pastaPadrao =
    pastaTrabalho === undefined ? Option.none() : Option.some(yield* PastaTrabalho.make({ pasta: pastaTrabalho }));
  return Sessoes.of({ porta, abertas, chamadas, hashDoToken, pastaPadrao });
});

/** A sessão do token, comparando o hash dele com o de todas as sessões, sem sair no primeiro acerto. */
const sessaoDoToken = Effect.fnUntraced(function* (sessoes: Sessoes["Service"], token: string) {
  const hash = yield* sessoes.hashDoToken(token);
  let achada: Sessao | undefined;
  for (const sessao of yield* Ref.get(sessoes.abertas)) {
    if (Mac.timingSafeEqual(sessao.hash, hash) && achada === undefined) achada = sessao;
  }
  return achada;
});

/**
 * Uma `PastaTrabalho` que recusa todo `arquivo`: a da sessão cuja pasta não existe. `abrirSessao` não
 * falha por isso; a IA recebe o motivo na chamada que pedir um arquivo.
 */
const pastaInexistente = (pasta: string): PastaTrabalho.PastaTrabalho["Service"] =>
  PastaTrabalho.PastaTrabalho.of({
    pasta,
    lerMarkdown: Effect.fn("PastaTrabalho.lerMarkdown")(function* () {
      return yield* new EntradaInvalida({
        mensagem: `arquivo: a pasta de trabalho desta sessão não existe ou não é uma pasta (${pasta}); use ppc, com um PPC da base`,
      });
    }),
  });

const make = Effect.gen(function* () {
  const sessoes = yield* Sessoes;
  const random = yield* SecureRandom.SecureRandom;
  const contexto = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const url = `http://127.0.0.1:${sessoes.porta}${CAMINHO}`;

  const abrirSessao = Effect.fn("ServidorMcpHttp.abrirSessao")(function* (entrada: {
    readonly rotulo: string;
    readonly pastaTrabalho?: string;
  }) {
    const token = Base64Url.encode(yield* random.randomBytes(32));
    const hash = yield* sessoes.hashDoToken(token);
    const pasta =
      entrada.pastaTrabalho === undefined
        ? Option.none()
        : Option.some(
            yield* PastaTrabalho.make({ pasta: entrada.pastaTrabalho }).pipe(
              Effect.provideContext(contexto),
              Effect.catchTags({
                PastaTrabalhoInvalida: (erro) =>
                  Effect.as(
                    Effect.logWarning(`sessão MCP "${entrada.rotulo}": ${erro.message}`),
                    pastaInexistente(erro.pasta),
                  ),
              }),
            ),
          );
    const sessao: Sessao = {
      hash,
      pasta,
      sessaoAtual: SessaoAtual.SessaoAtual.of({
        rotulo: entrada.rotulo,
        registrarChamada: Effect.fn("SessaoAtual.registrarChamada")(function* (chamada) {
          yield* PubSub.publish(sessoes.chamadas, { sessao: entrada.rotulo, ...chamada });
        }),
      }),
    };
    yield* Effect.acquireRelease(
      Ref.update(sessoes.abertas, (abertas) => [...abertas, sessao]),
      () => Ref.update(sessoes.abertas, (abertas) => abertas.filter((aberta) => aberta !== sessao)),
    );
    const resultado: SessaoMcp = { url, cabecalhos: { Authorization: `Bearer ${token}` } };
    return resultado;
  });

  return ServidorMcpHttp.of({
    url,
    porta: sessoes.porta,
    abrirSessao,
    chamadas: Stream.fromPubSub(sessoes.chamadas),
  });
});

/* ================================================================== autorização */

// T3: apps/server/src/mcp/McpHttpServer.ts (normalizeMcpHttpResponse)
const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty ? HttpServerResponse.setStatus(response, 202) : response;
};

// T3: apps/server/src/auth/EnvironmentAuth.ts (parseBearerToken)
const AUTHORIZATION_PREFIX = "Bearer ";
function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers["authorization"];
  if (typeof header !== "string" || !/^Bearer /i.test(header)) {
    return null;
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

const SEM_CACHE = { "cache-control": "no-store" } as const;

/** 401, com o desafio `Bearer` (o formato do `unauthorized` do T3, sem o convite ao OAuth). */
const naoAutorizado = (veioToken: boolean) =>
  HttpServerResponse.jsonUnsafe(
    {
      error: "invalid_mcp_credential",
      message: "credencial ausente ou inválida para o servidor MCP do Simplifica IF",
    },
    {
      status: 401,
      headers: { ...SEM_CACHE, "www-authenticate": veioToken ? 'Bearer error="invalid_token"' : "Bearer" },
    },
  );

const hostRecusado = HttpServerResponse.jsonUnsafe(
  { error: "host_nao_permitido", message: "o servidor MCP do Simplifica IF só atende em 127.0.0.1" },
  { status: 403, headers: SEM_CACHE },
);

const corpoGrandeDemais = HttpServerResponse.jsonUnsafe(
  { error: "corpo_grande_demais", message: `a requisição passa de ${LIMITE_CORPO} bytes` },
  { status: 413, headers: SEM_CACHE },
);

/** A requisição MCP, que pede a sessão ao contexto. */
type EfeitoAutorizado = Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, SessaoAtual.SessaoAtual>;

/** O middleware de autorização: a requisição MCP, com a sessão, ou a resposta de recusa. */
type Autorizacao = (
  httpEffect: EfeitoAutorizado,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, HttpServerRequest.HttpServerRequest>;

/** Confere `Host`, tamanho do corpo e token; a requisição aceita leva a sessão ao contexto da chamada. */
const makeAutorizacao = Effect.gen(function* () {
  const sessoes = yield* Sessoes;
  const hosts = new Set([`127.0.0.1:${sessoes.porta}`, `localhost:${sessoes.porta}`]);
  // Sem span: o do servidor HTTP já cobre a requisição, e um aqui envolveria a chamada da ferramenta.
  return Effect.fnUntraced(function* (httpEffect: EfeitoAutorizado) {
    const requisicao = yield* HttpServerRequest.HttpServerRequest;
    const host = requisicao.headers["host"]?.toLowerCase();
    if (host === undefined || !hosts.has(host)) return hostRecusado;
    if (Number(requisicao.headers["content-length"] ?? "0") > LIMITE_CORPO) return corpoGrandeDemais;
    const token = parseBearerToken(requisicao);
    const sessao = token === null ? undefined : yield* sessaoDoToken(sessoes, token);
    if (sessao === undefined) {
      yield* Effect.logDebug("requisição MCP recusada: token ausente ou desconhecido");
      return naoAutorizado(token !== null);
    }
    const comSessao = httpEffect.pipe(
      Effect.provideService(SessaoAtual.SessaoAtual, sessao.sessaoAtual),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(LIMITE_CORPO)),
    );
    const pasta = Option.orElse(sessao.pasta, () => sessoes.pastaPadrao);
    const comPasta = Option.isSome(pasta)
      ? Effect.provideService(comSessao, PastaTrabalho.PastaTrabalho, pasta.value)
      : comSessao;
    return yield* Effect.map(comPasta, normalizeMcpHttpResponse);
  }) satisfies Autorizacao;
});

const layerAutorizacao = HttpRouter.middleware<{ provides: SessaoAtual.SessaoAtual }>()(makeAutorizacao).layer;

/* ================================================================== layer */

/**
 * O servidor MCP `ifpr` por HTTP em `127.0.0.1`, sobre o `Leitura` do ambiente: quem já tem o serviço
 * (o servidor do app, que o usa também no RPC de leitura) monta uma conexão só ao `kb.sqlite`.
 *
 * - `porta`: a porta; sem ela (ou com 0), a que o sistema escolher;
 * - `pastaTrabalho`: a pasta de onde o `pacote_contexto` lê um `.md` nas sessões abertas sem pasta
 *   própria; sem ela, essas sessões não leem arquivo nenhum. A pasta vai ao contexto de cada
 *   requisição, como a da sessão; o `Leitura` do ambiente não precisa tê-la.
 *
 * O servidor fecha com o escopo da layer.
 */
export const layerSobreLeitura = (opcoes: { readonly porta?: number; readonly pastaTrabalho?: string } = {}) => {
  const porta = opcoes.porta ?? 0;
  const mcp = McpServer.layerHttp({
    name: NOME_SERVIDOR,
    version: VERSAO_PACOTE,
    instructions: INSTRUCOES,
    path: CAMINHO,
    protocols: PROTOCOLOS,
    allowSessionTermination: true,
    registrations: layerRegistro,
  }).pipe(Layer.provide(layerAutorizacao));
  const servir = HttpRouter.serve(mcp, { disableLogger: true, disableListenLog: true });
  const node = Layer.effect(
    HttpServer.HttpServer,
    NodeHttpServer.make(() => NodeHttp.createServer(), { host: "127.0.0.1", port: porta }).pipe(
      Effect.mapError((erro) => new ServidorMcpNaoAbriu({ porta, cause: erro })),
    ),
  );
  return Layer.effect(ServidorMcpHttp, make).pipe(
    Layer.provide(servir),
    Layer.provide(Layer.effect(Sessoes, makeSessoes(opcoes.pastaTrabalho))),
    Layer.provide(node),
    Layer.provide(
      Layer.mergeAll(NodeHttpServer.layerHttpServices, NodeCrypto.layerDigest, NodeCrypto.layerSecureRandom),
    ),
  );
};

/**
 * O servidor MCP `ifpr` por HTTP em `127.0.0.1`, sobre o `kb.sqlite` em `banco`, só leitura: o
 * `layerSobreLeitura` com um `Leitura` próprio.
 *
 * - `porta` e `pastaTrabalho`: como em `layerSobreLeitura`;
 * - `canal`: o canal da base quando o banco não registra um (padrão: `dev`, como a CLI).
 */
export const layer = (opcoes: {
  readonly banco: string;
  readonly porta?: number;
  readonly canal?: Canal;
  readonly pastaTrabalho?: string;
}) =>
  layerSobreLeitura({
    ...(opcoes.porta === undefined ? {} : { porta: opcoes.porta }),
    ...(opcoes.pastaTrabalho === undefined ? {} : { pastaTrabalho: opcoes.pastaTrabalho }),
  }).pipe(Layer.provide(layerLeitura({ banco: opcoes.banco, canal: opcoes.canal ?? "dev" })));
