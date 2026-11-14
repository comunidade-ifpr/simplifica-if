/**
 * Quem pode abrir o WebSocket do RPC. O servidor local escuta só em `127.0.0.1`, mas qualquer
 * processo da máquina e qualquer página aberta no navegador alcançam essa interface; por isso cada
 * conexão passa por três conferências, nesta ordem, antes do upgrade:
 *
 * 1. **`Host`** (DNS rebinding): só `127.0.0.1:<porta>` e `localhost:<porta>`. Uma página de outro
 *    domínio que resolva para 127.0.0.1 manda o próprio domínio no `Host` e recebe 403.
 * 2. **`Origin`:** sem `Origin` (o Node, o processo principal do Electron), passa; com `Origin`, só as
 *    origens dadas pelo processo pai (`EnvelopePartida.origens`), como as `trustedBrowserOrigins` do
 *    `EnvironmentAuth` do T3. Outra origem recebe 403.
 * 3. **Credencial:** o token que o processo pai gerou e passou ao servidor, em
 *    `Authorization: Bearer <token>`, ou um ingresso, no parâmetro `?ingresso=`, para o navegador, que
 *    não manda cabeçalho no WebSocket. Sem credencial ou com uma errada: 401. Guarda-se só o SHA-256
 *    do token, comparado com `Mac.timingSafeEqual`, como o `@simplifica-if/mcp/http`.
 *
 * **Ingresso** (o `wsTicket` do T3): o cliente do navegador faz `POST /ingresso` com o token no
 * `Authorization` e recebe um ingresso de 32 bytes aleatórios, que abre uma conexão só, em até
 * `VALIDADE_INGRESSO_MS` (1 minuto). Assim o token, que vale enquanto o servidor viver, não vai na URL
 * do WebSocket (histórico, logs, ferramentas do navegador). O `POST /ingresso` passa pelas mesmas
 * conferências de `Host` e `Origin`; como o pedido vem de outra origem com `Authorization`, o navegador
 * faz antes um `OPTIONS` (CORS), que só as origens permitidas recebem. O T3 emite o ticket por 5
 * minutos, assinado e, com DPoP, ligado à chave do cliente; aqui ele é aleatório, guardado só pelo
 * hash na memória do servidor e gasto no primeiro uso.
 *
 * O T3 troca o token do desktop por sessões (`SessionStore`, `PairingGrantStore`, DPoP), porque o
 * servidor dele aceita outros dispositivos. Aqui o único cliente é o app no mesmo computador, e o token
 * vale enquanto o processo viver.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpServer, type HttpServerRequest, HttpServerResponse } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { type Ingresso, PARAMETRO_INGRESSO, VALIDADE_INGRESSO_MS } from "@simplifica-if/contratos-app";

/** Cabeçalhos aceitos no `POST /ingresso` vindo do navegador (`httpCors.ts` do T3, sem `dpop`). */
export const CABECALHOS_CORS = ["authorization", "b3", "traceparent", "content-type"] as const;

const SEM_CACHE = { "cache-control": "no-store" } as const;

const recusa = (status: 401 | 403, erro: string, mensagem: string) =>
  HttpServerResponse.jsonUnsafe(
    { error: erro, message: mensagem },
    { status, headers: status === 401 ? { ...SEM_CACHE, "www-authenticate": "Bearer" } : SEM_CACHE },
  );

const hostRecusado = recusa(403, "host_nao_permitido", "o servidor do Simplifica IF só atende em 127.0.0.1");
const origemRecusada = recusa(403, "origem_nao_permitida", "origem não permitida no servidor do Simplifica IF");
const credencialRecusada = recusa(
  401,
  "credencial_invalida",
  "token ou ingresso ausente ou inválido para o servidor do Simplifica IF",
);

/** O token do cabeçalho `Authorization: Bearer`, se houver. */
export function tokenDaRequisicao(requisicao: HttpServerRequest.HttpServerRequest): string | undefined {
  const cabecalho = requisicao.headers["authorization"];
  if (typeof cabecalho !== "string" || !/^Bearer /i.test(cabecalho)) return undefined;
  const token = cabecalho.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

/** O ingresso do parâmetro `?ingresso=` da URL, se houver. */
export function ingressoDaRequisicao(requisicao: HttpServerRequest.HttpServerRequest): string | undefined {
  const consulta = requisicao.url.indexOf("?");
  if (consulta < 0) return undefined;
  const ingresso = new URLSearchParams(requisicao.url.slice(consulta + 1)).get(PARAMETRO_INGRESSO);
  return ingresso === null || ingresso.length === 0 ? undefined : ingresso;
}

export class Autenticacao extends Context.Service<
  Autenticacao,
  {
    /** Antes do upgrade do `/rpc`: a resposta de recusa (403 ou 401), ou nada se a conexão pode seguir. */
    readonly conferir: (
      requisicao: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<Option.Option<HttpServerResponse.HttpServerResponse>>;
    /** `POST /ingresso`: um ingresso novo (`Ingresso`) para quem tem o token, ou a recusa. */
    readonly emitirIngresso: (
      requisicao: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
    /** `OPTIONS /ingresso`: a resposta do CORS, que só as origens permitidas recebem. */
    readonly preflightIngresso: (
      requisicao: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
  }
>()("@simplifica-if/server/Autenticacao") {}

/**
 * `token` é o do processo pai; `origens`, as origens de navegador aceitas; `porta`, a do servidor, para
 * o `Host`. Pede o `Digest` e o `SecureRandom`.
 */
export const make = Effect.fnUntraced(function* (opcoes: {
  readonly token: Redacted.Redacted<string>;
  readonly origens: ReadonlyArray<string>;
  readonly porta: number;
}) {
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  // Um defeito do WebCrypto não é recuperável aqui: sem SHA-256 não há como conferir credencial.
  const hashDe = (texto: string) => digest.digest(Digest.sha256, new TextEncoder().encode(texto)).pipe(Effect.orDie);
  const esperado = yield* hashDe(Redacted.value(opcoes.token));
  const hosts = new Set([`127.0.0.1:${opcoes.porta}`, `localhost:${opcoes.porta}`]);
  const origens = new Set(opcoes.origens);
  /** Os ingressos emitidos e ainda não usados: o hash (em base64url) e quando expiram. */
  const ingressos = new Map<string, number>();

  /** `Host` e `Origin`: a recusa, se houver, e a origem permitida (para o CORS). */
  const conferirHostEOrigem = (requisicao: HttpServerRequest.HttpServerRequest) => {
    const host = requisicao.headers["host"]?.toLowerCase();
    if (host === undefined || !hosts.has(host)) return { recusa: hostRecusado } as const;
    const origem = requisicao.headers["origin"];
    if (origem !== undefined && !origens.has(origem)) return { recusa: origemRecusada } as const;
    return { origem } as const;
  };

  const tokenValido = Effect.fnUntraced(function* (token: string | undefined) {
    return token !== undefined && Mac.timingSafeEqual(yield* hashDe(token), esperado);
  });

  const descartarVencidos = (agora: number) => {
    for (const [chave, expiraEm] of ingressos) if (expiraEm <= agora) ingressos.delete(chave);
  };

  /** Gasta o ingresso: vale se foi emitido, não venceu e não foi usado. */
  const gastarIngresso = Effect.fnUntraced(function* (ingresso: string) {
    const chave = Base64Url.encode(yield* hashDe(ingresso));
    const agora = yield* Clock.currentTimeMillis;
    descartarVencidos(agora);
    const expiraEm = ingressos.get(chave);
    ingressos.delete(chave);
    return expiraEm !== undefined && agora < expiraEm;
  });

  const cors = (origem: string | undefined): Record<string, string> =>
    origem === undefined ? {} : { "access-control-allow-origin": origem, vary: "origin" };

  const conferir = Effect.fn("Autenticacao.conferir")(function* (requisicao: HttpServerRequest.HttpServerRequest) {
    const conferido = conferirHostEOrigem(requisicao);
    if (conferido.recusa !== undefined) return Option.some(conferido.recusa);
    const token = tokenDaRequisicao(requisicao);
    if (token !== undefined) {
      if (yield* tokenValido(token)) return Option.none();
    } else {
      const ingresso = ingressoDaRequisicao(requisicao);
      if (ingresso !== undefined && (yield* gastarIngresso(ingresso))) return Option.none();
    }
    yield* Effect.logDebug("conexão RPC recusada: credencial ausente ou inválida");
    return Option.some(credencialRecusada);
  });

  const emitirIngresso = Effect.fn("Autenticacao.emitirIngresso")(function* (
    requisicao: HttpServerRequest.HttpServerRequest,
  ) {
    const conferido = conferirHostEOrigem(requisicao);
    if (conferido.recusa !== undefined) return conferido.recusa;
    if (!(yield* tokenValido(tokenDaRequisicao(requisicao)))) {
      yield* Effect.logDebug("ingresso recusado: token ausente ou inválido");
      return HttpServerResponse.setHeaders(credencialRecusada, cors(conferido.origem));
    }
    const ingresso = Base64Url.encode(yield* random.randomBytes(32));
    const agora = yield* Clock.currentTimeMillis;
    descartarVencidos(agora);
    const expiraEm = agora + VALIDADE_INGRESSO_MS;
    ingressos.set(Base64Url.encode(yield* hashDe(ingresso)), expiraEm);
    const corpo: Ingresso = { ingresso, expiraEm };
    return HttpServerResponse.jsonUnsafe(corpo, { headers: { ...SEM_CACHE, ...cors(conferido.origem) } });
  });

  const preflightIngresso = (requisicao: HttpServerRequest.HttpServerRequest) =>
    Effect.sync(() => {
      const conferido = conferirHostEOrigem(requisicao);
      if (conferido.recusa !== undefined) return conferido.recusa;
      return HttpServerResponse.empty({
        status: 204,
        headers: {
          ...cors(conferido.origem),
          "access-control-allow-methods": "POST",
          // Como o T3 (`browserApiCorsAllowedHeaders`): o `HttpClient` do Effect na interface manda os
          // cabeçalhos de rastreamento (`traceparent`, `b3`) junto com o token.
          "access-control-allow-headers": CABECALHOS_CORS.join(", "),
          "access-control-max-age": "600",
        },
      });
    });

  return Autenticacao.of({ conferir, emitirIngresso, preflightIngresso });
});

/** O `make`, com a porta do `HttpServer` do ambiente. */
export const layer = (opcoes: { readonly token: Redacted.Redacted<string>; readonly origens: ReadonlyArray<string> }) =>
  Layer.effect(
    Autenticacao,
    Effect.gen(function* () {
      const endereco = (yield* HttpServer.HttpServer).address;
      const porta = NetAddress.isInetAddress(endereco) ? endereco.port : 0;
      return yield* make({ ...opcoes, porta });
    }),
  );
