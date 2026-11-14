/**
 * O ingresso do WebSocket, como o `wsTicket` do T3: o navegador não manda cabeçalho no WebSocket, então
 * a interface troca o token (`Authorization: Bearer`) por um ingresso de uso único em `POST /ingresso`
 * e abre `ws://127.0.0.1:<porta>/rpc?ingresso=…`. Cada conexão, e cada reconexão, compra um ingresso
 * novo; o token nunca vai numa URL. Ver `apps/server/src/Autenticacao.ts`.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { CAMINHO_INGRESSO, CAMINHO_RPC, Ingresso, PARAMETRO_INGRESSO } from "@simplifica-if/contratos-app";
import type { CredenciaisServidor } from "../ponte-desktop.ts";

/** Por que a conexão com o servidor local não abriu ou caiu. */
export const MotivoFalha = Schema.Literals([
  /** Sem credenciais: nem ponte do desktop, nem parâmetros na URL, nem variáveis `VITE_`. */
  "sem-servidor",
  /** A ponte do desktop não entregou as credenciais. */
  "ponte",
  /** O servidor não respondeu (fora do ar, porta errada). */
  "indisponivel",
  /** O servidor recusou o token (401). */
  "token-recusado",
  /** O servidor recusou a origem da página ou o `Host` (403). */
  "origem-recusada",
  /** O WebSocket não abriu ou caiu. */
  "conexao-caiu",
  /** Resposta inesperada. */
  "resposta-invalida",
]);
export type MotivoFalha = typeof MotivoFalha.Type;

export class FalhaConexao extends Schema.TaggedError<FalhaConexao>()("FalhaConexao", {
  motivo: MotivoFalha,
  detalhe: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    return mensagemFalha(this.motivo);
  }
}

/** A explicação de cada motivo, para a pessoa que usa o app. */
export function mensagemFalha(motivo: MotivoFalha): string {
  switch (motivo) {
    case "sem-servidor":
      return "Não há servidor do Simplifica IF configurado.";
    case "ponte":
      return "O aplicativo não informou onde está o servidor local.";
    case "indisponivel":
      return "O servidor local não respondeu.";
    case "token-recusado":
      return "O servidor local recusou a credencial desta janela.";
    case "origem-recusada":
      return "O servidor local não aceita conexões a partir deste endereço.";
    case "conexao-caiu":
      return "A conexão com o servidor local caiu.";
    case "resposta-invalida":
      return "O servidor local respondeu de um jeito inesperado.";
  }
}

const decodificarIngresso = HttpClientResponse.schemaBodyJson(Ingresso);

/** Compra um ingresso com o token: `POST <urlServidor>/ingresso`. */
export const comprarIngresso = Effect.fn("Ingresso.comprar")(function* (credenciais: CredenciaisServidor) {
  const cliente = yield* HttpClient.HttpClient;
  const pedido = HttpClientRequest.post(`${credenciais.urlServidor}${CAMINHO_INGRESSO}`).pipe(
    HttpClientRequest.bearerToken(credenciais.token),
  );
  const resposta = yield* cliente
    .execute(pedido)
    .pipe(Effect.mapError((erro) => new FalhaConexao({ motivo: "indisponivel", detalhe: erro.message })));
  if (resposta.status === 401) return yield* new FalhaConexao({ motivo: "token-recusado" });
  if (resposta.status === 403) return yield* new FalhaConexao({ motivo: "origem-recusada" });
  if (resposta.status !== 200) {
    return yield* new FalhaConexao({ motivo: "resposta-invalida", detalhe: `status ${resposta.status}` });
  }
  return yield* decodificarIngresso(resposta).pipe(
    Effect.mapError((erro) => new FalhaConexao({ motivo: "resposta-invalida", detalhe: erro.message })),
  );
});

/** A URL do WebSocket do RPC com o ingresso: `ws://127.0.0.1:<porta>/rpc?ingresso=…`. */
export function urlRpc(urlServidor: string, ingresso: string): string {
  const url = new URL(CAMINHO_RPC, urlServidor);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(PARAMETRO_INGRESSO, ingresso);
  return url.toString();
}
