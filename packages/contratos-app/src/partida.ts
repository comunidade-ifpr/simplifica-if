/**
 * A partida do servidor local e a autenticação do WebSocket.
 *
 * - `EnvelopePartida`: o que o processo pai (o desktop) escreve numa linha no stdin do servidor, como
 *   o `DesktopBackendBootstrap` do T3: o token do RPC e as origens permitidas.
 * - `LinhaPartida`: a linha JSON que o servidor imprime no stdout quando está pronto, com a porta e as
 *   URLs do RPC e do MCP.
 *
 * Autenticação do WebSocket: `Authorization: Bearer <token>` ou, para o navegador, que não manda
 * cabeçalho no WebSocket, um ingresso de curta duração na URL (`?ingresso=`, `PARAMETRO_INGRESSO`),
 * como o `wsTicket` do T3: o cliente o pede com o token em `POST /ingresso` (`CAMINHO_INGRESSO`) e o
 * usa uma vez, em até `VALIDADE_INGRESSO_MS`. O token, que vale enquanto o servidor viver, nunca vai
 * na URL.
 */
import * as Schema from "effect/Schema";

/** O caminho do WebSocket do RPC. */
export const CAMINHO_RPC = "/rpc";

/** O caminho que troca o token (`Authorization: Bearer`) por um ingresso do WebSocket (`POST`). */
export const CAMINHO_INGRESSO = "/ingresso";

/** O parâmetro da URL do WebSocket com o ingresso, para o cliente que não manda cabeçalho (navegador). */
export const PARAMETRO_INGRESSO = "ingresso";

/** Por quanto tempo o ingresso vale depois de emitido; ele vale também para uma conexão só. */
export const VALIDADE_INGRESSO_MS = 60_000;

/** A resposta de `POST /ingresso`. */
export const Ingresso = Schema.Struct({
  ingresso: Schema.String,
  /** Milissegundos desde a época Unix em que o ingresso deixa de valer. */
  expiraEm: Schema.Number,
});
export type Ingresso = typeof Ingresso.Type;

/** A variável de ambiente com o token, a alternativa ao `EnvelopePartida` no stdin. */
export const VARIAVEL_TOKEN = "SIMPLIFICA_SERVIDOR_TOKEN";

/** Menor token aceito: 32 caracteres (o desktop gera 32 bytes aleatórios, em base64url). */
export const TAMANHO_MINIMO_TOKEN = 32;

export const TokenServidor = Schema.String.check(Schema.isMinLength(TAMANHO_MINIMO_TOKEN));

/**
 * A primeira linha do stdin do servidor, em JSON, escrita pelo processo pai. Com ela, o stdin vira o
 * cordão do pai: quando ele fecha, o servidor se encerra.
 */
export const EnvelopePartida = Schema.Struct({
  token: TokenServidor,
  /**
   * Origens (`Origin`) aceitas no WebSocket, como `app://simplifica`. Sem elas, só clientes que não
   * mandam `Origin` (o Node, o processo principal do Electron) se conectam.
   */
  origens: Schema.optionalKey(Schema.Array(Schema.String)),
  /**
   * O segredo do processo principal do desktop, que a janela nunca recebe. Com ele, a revisão prévia
   * só revisa arquivos que o processo principal liberou (`CAMINHO_LIBERAR_ARQUIVO`), os escolhidos no
   * diálogo do sistema; sem ele (desenvolvimento, navegador), aceita qualquer `.docx`.
   */
  tokenDesktop: Schema.optionalKey(TokenServidor),
});
export type EnvelopePartida = typeof EnvelopePartida.Type;

/** `POST` com `Authorization: Bearer <tokenDesktop>` e `{ "arquivo": "<caminho absoluto>" }`: libera o arquivo. */
export const CAMINHO_LIBERAR_ARQUIVO = "/revisao-ppc/liberar";

/** A linha JSON que o servidor imprime no stdout quando está pronto; é a única coisa no stdout. */
export const LinhaPartida = Schema.Struct({
  servidor: Schema.Literal("simplifica-if"),
  pid: Schema.Number,
  porta: Schema.Number,
  /** `ws://127.0.0.1:<porta>/rpc` */
  rpc: Schema.String,
  /** `http://127.0.0.1:<porta MCP>/mcp`, o servidor MCP `ifpr` das sessões. */
  mcp: Schema.String,
});
export type LinhaPartida = typeof LinhaPartida.Type;
