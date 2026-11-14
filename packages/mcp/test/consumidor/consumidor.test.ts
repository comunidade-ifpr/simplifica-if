/**
 * Um consumidor do pacote como o fork do T3: importa só pelos especificadores públicos
 * (`@simplifica-if/mcp/toolkit`, `/rpc`, `/contratos`, resolvidos pela autorreferência do `exports`
 * do package.json) e monta as ferramentas do IFPR num `McpServer.layerHttp` em `/mcp/ifpr`, ao lado
 * de um segundo `McpServer.layerHttp` "T3" em `/mcp`, com uma ferramenta própria, no mesmo
 * `HttpRouter`. O endpoint ifpr leva `Layer.fresh`, como documentado em `src/toolkit.ts`, para ter um
 * registro de ferramentas próprio. O Client do SDK oficial liga-se aos dois endpoints por HTTP em
 * memória (`HttpRouter.toWebHandler`).
 */
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpServer, Tool, Toolkit } from "effect/ai";
import { HttpRouter } from "effect/http";
import { RpcTest } from "effect/rpc";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Resposta } from "@simplifica-if/mcp/contratos";
import { GrupoLeitura, layerHandlersRpc } from "@simplifica-if/mcp/rpc";
import {
  FERRAMENTAS,
  INSTRUCOES,
  layerHandlers,
  layerLeitura,
  NOME_SERVIDOR,
  PROTOCOLOS,
  registrarFerramentas,
  VERSAO_PACOTE,
} from "@simplifica-if/mcp/toolkit";
import { criarBancoFixturePpcs } from "../fixture-ppcs.ts";
import { limparTemporarios } from "../fixture.ts";

afterEach(limparTemporarios);

/* ---------- o lado "T3": um toolkit próprio, registrado pelo `McpServer.registerToolkit` */

const Eco = Tool.make("eco_t3", {
  description: "Devolve o texto recebido (ferramenta do T3 no teste).",
  parameters: Schema.Struct({ texto: Schema.String }),
  success: Schema.String,
});
const ToolkitT3 = Toolkit.make(Eco);
const layerHandlersT3 = ToolkitT3.toLayer({ eco_t3: ({ texto }) => Effect.succeed(texto) });

const NOME_T3 = "t3";
const INSTRUCOES_T3 = "Ferramentas do T3 (teste do consumidor).";

/** Os dois endpoints no mesmo `HttpRouter`; o ifpr com `Layer.fresh` e o `Leitura` sobre `banco`. */
const layerServidores = (banco: string) =>
  Layer.mergeAll(
    McpServer.layerHttp({
      name: NOME_SERVIDOR,
      version: VERSAO_PACOTE,
      instructions: INSTRUCOES,
      protocols: PROTOCOLOS,
      path: "/mcp/ifpr",
      registrations: Layer.effectDiscard(registrarFerramentas).pipe(Layer.provide(layerHandlers)),
    }).pipe(Layer.fresh, Layer.provide(layerLeitura({ banco, canal: "dev" }))),
    McpServer.layerHttp({
      name: NOME_T3,
      version: "0.0.0",
      instructions: INSTRUCOES_T3,
      protocols: PROTOCOLOS,
      path: "/mcp",
      registrations: Layer.effectDiscard(McpServer.registerToolkit(ToolkitT3)).pipe(Layer.provide(layerHandlersT3)),
    }),
  );

/** O servidor em memória e um Client do SDK oficial em cada endpoint; fecha tudo no fim do escopo. */
const conectar = (banco: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const servidor = HttpRouter.toWebHandler(layerServidores(banco), { disableLogger: true });
      const fetch = (url: string | URL, init?: RequestInit) => servidor.handler(new Request(url, init));
      const ligar = async (caminho: string) => {
        const cliente = new Client({ name: "consumidor", version: "0" }, { versionNegotiation: { mode: "legacy" } });
        await cliente.connect(new StreamableHTTPClientTransport(new URL(`http://fork.teste${caminho}`), { fetch }));
        return cliente;
      };
      const ifpr = await ligar("/mcp/ifpr");
      const t3 = await ligar("/mcp");
      return { ifpr, t3, servidor };
    }),
    ({ ifpr, t3, servidor }) =>
      Effect.promise(async () => {
        await ifpr.close();
        await t3.close();
        await servidor.dispose();
      }),
  );

describe("consumidor pelos especificadores públicos", () => {
  it.effect("cada endpoint lista só as próprias ferramentas, com o nome e as instruções dele", () =>
    Effect.gen(function* () {
      const { ifpr, t3 } = yield* conectar(criarBancoFixturePpcs());
      const [listaIfpr, listaT3] = yield* Effect.promise(() => Promise.all([ifpr.listTools(), t3.listTools()]));

      expect(listaIfpr.tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
      expect(FERRAMENTAS).toHaveLength(15);
      expect(listaT3.tools.map((t) => t.name)).toEqual(["eco_t3"]);

      expect(ifpr.getServerVersion()).toMatchObject({ name: NOME_SERVIDOR, version: VERSAO_PACOTE });
      expect(ifpr.getInstructions()).toBe(INSTRUCOES);
      expect(t3.getServerVersion()).toMatchObject({ name: NOME_T3, version: "0.0.0" });
      expect(t3.getInstructions()).toBe(INSTRUCOES_T3);
    }).pipe(Effect.scoped),
  );

  it.effect("sobre_a_base no ifpr: Markdown no content e structuredContent no schema de Resposta", () =>
    Effect.gen(function* () {
      const { ifpr, t3 } = yield* conectar(criarBancoFixturePpcs());
      const r = yield* Effect.promise(() => ifpr.callTool({ name: "sobre_a_base", arguments: {} }));
      expect(r.isError).toBeFalsy();
      const [bloco] = r.content as ReadonlyArray<{ type: string; text?: string }>;
      expect(bloco?.type).toBe("text");
      expect(bloco?.text).toMatch(/^Base de conhecimento do IFPR, versão `dev-/u);
      expect(bloco?.text).toContain("Campi (o ID entre crases é o valor do filtro `campus`): [");

      const sobre = FERRAMENTAS.find((f) => f.nome === "sobre_a_base")!;
      const decodificar = Schema.decodeUnknownExit(Resposta(sobre.dados) as unknown as Schema.Decoder<unknown>);
      expect(Exit.isSuccess(decodificar(r.structuredContent, { onExcessProperty: "error" }))).toBe(true);

      // A ferramenta do T3 continua no endpoint dele e responde lá.
      const eco = yield* Effect.promise(() => t3.callTool({ name: "eco_t3", arguments: { texto: "olá" } }));
      expect(eco.isError).toBeFalsy();
    }).pipe(Effect.scoped),
  );

  it.effect("GrupoLeitura de /rpc é usável com o RpcTest", () =>
    Effect.gen(function* () {
      const cliente = yield* RpcTest.makeClient(GrupoLeitura);
      const r = yield* cliente.sobreABase({});
      expect(r.base.canal).toBe("dev");
      expect(r.dados.campi.map((c) => c.id)).toContain("curitiba");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerHandlersRpc.pipe(Layer.provideMerge(layerLeitura({ banco: criarBancoFixturePpcs(), canal: "dev" }))),
      ),
    ),
  );
});
