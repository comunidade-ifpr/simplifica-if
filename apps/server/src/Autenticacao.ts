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
 * 3. **Token:** o que o processo pai gerou e passou ao servidor, em `Authorization: Bearer <token>` ou,
 *    para o navegador, que não manda cabeçalho no WebSocket, no parâmetro `?token=` (o `wsTicket` do
 *    T3). Sem token ou com token errado: 401. Guarda-se só o SHA-256 do token, e a conferência compara
 *    os hashes com `Mac.timingSafeEqual`, como o `@simplifica-if/mcp/http`.
 *
 * O T3 troca o token do desktop por sessões e tickets de curta duração (`SessionStore`,
 * `PairingGrantStore`, DPoP), porque o servidor dele aceita outros dispositivos. Aqui o único cliente é
 * o app no mesmo computador, e o token vale enquanto o processo viver.
 */
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { PARAMETRO_TOKEN } from "@simplifica-if/contratos-app";

const SEM_CACHE = { "cache-control": "no-store" } as const;

const recusa = (status: 401 | 403, erro: string, mensagem: string) =>
  HttpServerResponse.jsonUnsafe(
    { error: erro, message: mensagem },
    { status, headers: status === 401 ? { ...SEM_CACHE, "www-authenticate": "Bearer" } : SEM_CACHE },
  );

/** O token da requisição: o cabeçalho `Authorization: Bearer` ou, sem ele, o parâmetro `?token=`. */
export function tokenDaRequisicao(requisicao: HttpServerRequest.HttpServerRequest): string | undefined {
  const cabecalho = requisicao.headers["authorization"];
  if (typeof cabecalho === "string" && /^Bearer /i.test(cabecalho)) {
    const token = cabecalho.slice("Bearer ".length).trim();
    return token.length > 0 ? token : undefined;
  }
  const consulta = requisicao.url.indexOf("?");
  if (consulta < 0) return undefined;
  const token = new URLSearchParams(requisicao.url.slice(consulta + 1)).get(PARAMETRO_TOKEN);
  return token === null || token.length === 0 ? undefined : token;
}

export class Autenticacao extends Context.Service<
  Autenticacao,
  {
    /** A resposta de recusa (403 ou 401), ou nada se a conexão pode seguir para o upgrade. */
    readonly conferir: (
      requisicao: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<Option.Option<HttpServerResponse.HttpServerResponse>>;
  }
>()("@simplifica-if/server/Autenticacao") {}

/**
 * `token` é o do processo pai; `origens`, as origens de navegador aceitas. A porta, para o `Host`, é a
 * do `HttpServer` do ambiente.
 */
export const layer = (opcoes: { readonly token: Redacted.Redacted<string>; readonly origens: ReadonlyArray<string> }) =>
  Layer.effect(
    Autenticacao,
    Effect.gen(function* () {
      const digest = yield* Digest.Digest;
      const endereco = (yield* HttpServer.HttpServer).address;
      const porta = NetAddress.isInetAddress(endereco) ? endereco.port : 0;
      // Um defeito do WebCrypto não é recuperável aqui: sem SHA-256 não há como conferir token.
      const hashDe = (texto: string) =>
        digest.digest(Digest.sha256, new TextEncoder().encode(texto)).pipe(Effect.orDie);
      const esperado = yield* hashDe(Redacted.value(opcoes.token));
      const hosts = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);
      const origens = new Set(opcoes.origens);

      const conferir = Effect.fn("Autenticacao.conferir")(function* (requisicao: HttpServerRequest.HttpServerRequest) {
        const host = requisicao.headers["host"]?.toLowerCase();
        if (host === undefined || !hosts.has(host)) {
          return Option.some(recusa(403, "host_nao_permitido", "o servidor do Simplifica IF só atende em 127.0.0.1"));
        }
        const origem = requisicao.headers["origin"];
        if (origem !== undefined && !origens.has(origem)) {
          return Option.some(recusa(403, "origem_nao_permitida", "origem não permitida no servidor do Simplifica IF"));
        }
        const token = tokenDaRequisicao(requisicao);
        const valido = token !== undefined && Mac.timingSafeEqual(yield* hashDe(token), esperado);
        if (!valido) {
          yield* Effect.logDebug("conexão RPC recusada: token ausente ou inválido");
          return Option.some(
            recusa(401, "token_invalido", "token ausente ou inválido para o servidor do Simplifica IF"),
          );
        }
        return Option.none();
      });

      return Autenticacao.of({ conferir });
    }),
  );
