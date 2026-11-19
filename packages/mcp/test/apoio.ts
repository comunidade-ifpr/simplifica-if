/**
 * Apoio aos testes das ferramentas:
 *
 * - `camadaFerramentas(banco)`: os handlers do Toolkit sobre o `Leitura` de um banco de fixture;
 * - `responder(ferramenta, args)`: o caminho de uma chamada MCP sem o protocolo (a entrada conferida
 *   com a mensagem do transporte, o handler do Toolkit e o texto para a IA), com a `Resposta`;
 * - `saidaValida(ferramenta, resposta)`: a resposta passa no `outputSchema` (objetos fechados);
 * - `conectarEmMemoria(banco)`: o Client do SDK oficial ligado ao servidor por HTTP em memória
 *   (`McpServer.layerHttp` e `HttpRouter.toWebHandler`), como teste de conformidade independente.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpServer } from "effect/ai";
import { HttpRouter } from "effect/http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Canal } from "@simplifica-if/kb/canal";
import type { Resposta } from "../src/contratos.ts";
import { chamarFerramenta } from "../src/ferramentas/registrar.ts";
import { layerHandlers } from "../src/ferramentas/toolkit.ts";
import { INSTRUCOES, layerLeitura, layerRegistro, NOME_SERVIDOR, PROTOCOLOS, VERSAO_PACOTE } from "../src/servidor.ts";
import { OPCOES_ENTRADA } from "../src/validacao.ts";

/** O que os testes usam de uma ferramenta (qualquer uma de `FERRAMENTAS`). */
export interface FerramentaTestada<D extends Schema.Top = Schema.Top> {
  readonly nome: string;
  readonly entrada: Schema.Decoder<unknown>;
  readonly dados: D;
  readonly saida: Schema.Top;
  // Método, e não propriedade: os parâmetros de método são bivariantes, e uma ferramenta concreta
  // (com a `Resposta` dos dados dela) serve onde se pede `FerramentaTestada` de qualquer schema.
  textoCompleto(resposta: Resposta<D["Type"]>): string;
}

/** Os handlers do Toolkit e o `Leitura` sobre o banco em `banco`. */
export const camadaFerramentas = (banco: string, canal: Canal = "dev") =>
  layerHandlers.pipe(Layer.provideMerge(layerLeitura({ banco, canal })));

/** Uma chamada como o transporte a faz (`chamarFerramenta`), sem o protocolo: a `Resposta` e o texto para a IA. */
export const responder = <D extends Schema.Top>(ferramenta: FerramentaTestada<D>, args: unknown) =>
  chamarFerramenta(ferramenta.nome, args).pipe(
    Effect.map((resultado) => {
      const resposta = resultado as Resposta<D["Type"]>;
      return { resposta, texto: ferramenta.textoCompleto(resposta) };
    }),
  );

/** A mensagem do erro de uma chamada que falha (entrada inválida, ID desconhecido, cursor). */
export const mensagemDeErro = (ferramenta: FerramentaTestada, args: unknown) =>
  responder(ferramenta, args).pipe(
    Effect.flip,
    Effect.map((erro) => (erro instanceof Error ? erro.message : String(erro))),
  );

/** A resposta passa no `outputSchema` da ferramenta, com objetos fechados. */
export function saidaValida(ferramenta: FerramentaTestada, resposta: unknown): boolean {
  return Exit.isSuccess(
    // oxlint-disable-next-line simplifica-if/no-inline-schema-compile -- o schema muda a cada ferramenta testada; o custo de compilar é só do teste
    Schema.decodeUnknownExit(ferramenta.saida as Schema.Decoder<unknown>)(resposta, OPCOES_ENTRADA),
  );
}

/**
 * O Client do SDK oficial ligado ao servidor `ifpr` sobre o banco `banco`, por HTTP em memória
 * (`McpServer.layerHttp` num `HttpRouter`, servido por `toWebHandler`). Fecha no fim do escopo.
 */
export const conectarEmMemoria = (
  banco: string,
  opcoes: { readonly canal?: Canal; readonly negociacao?: "legacy" | "auto" } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const servidor = HttpRouter.toWebHandler(
        McpServer.layerHttp({
          name: NOME_SERVIDOR,
          version: VERSAO_PACOTE,
          instructions: INSTRUCOES,
          protocols: PROTOCOLOS,
          path: "/mcp",
          registrations: layerRegistro,
        }).pipe(Layer.provide(layerLeitura({ banco, canal: opcoes.canal ?? "dev" }))),
        { disableLogger: true },
      );
      const cliente = new Client(
        { name: "teste", version: "0" },
        { versionNegotiation: { mode: opcoes.negociacao ?? "legacy" } },
      );
      await cliente.connect(
        new StreamableHTTPClientTransport(new URL("http://ifpr.teste/mcp"), {
          fetch: (url, init) => servidor.handler(new Request(url, init)),
        }),
      );
      return { cliente, servidor };
    }),
    ({ cliente, servidor }) =>
      Effect.promise(async () => {
        await cliente.close();
        await servidor.dispose();
      }),
  ).pipe(Effect.map(({ cliente }) => cliente));
