// @effect-diagnostics nodeBuiltinImport:off -- teste: requisições HTTP cruas (Host, corpo) e a pasta de trabalho no disco
/**
 * O servidor MCP por HTTP local (`src/http.ts`, M1.4), de verdade, em porta efêmera de `127.0.0.1`,
 * com o Client do SDK oficial: `initialize`, `tools/list` (as mesmas ferramentas do stdio) e
 * `tools/call`; o token por sessão (401 sem token, com token desconhecido e com token revogado; duas
 * sessões com tokens diferentes); `chamadas`; as defesas de `Host`, `Origin` e tamanho do corpo; a
 * pasta de trabalho por sessão; e a paridade de uma chamada com o executável stdio.
 */
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import { afterAll, describe, expect, layer } from "@effect/vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import * as Http from "../src/http.ts";
import { INSTRUCOES } from "../src/servidor.ts";
import { diretorioTemporario, limparTemporarios } from "./fixture.ts";
import { criarBancoFixturePpcs, PPC_ENFERMAGEM } from "./fixture-ppcs.ts";

afterAll(limparTemporarios);

const MARKDOWN = [
  "# Projeto Pedagógico do Curso Técnico em Enfermagem",
  "",
  "## 1 Organização curricular",
  "",
  "A organização curricular progride do básico ao específico, conforme a Resolução CNE/CP nº 1/2021, art. 20.",
  "",
].join("\n");

const banco = criarBancoFixturePpcs();
/** A pasta de trabalho de uma sessão, com `PPC.md`. */
const pasta = diretorioTemporario("simplifica-mcp-http-");
NodeFS.writeFileSync(NodePath.join(pasta, "PPC.md"), MARKDOWN);

/** O ambiente do processo stdio, sem herdar SIMPLIFICA_KB do processo de teste. */
const AMBIENTE_STDIO = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const CLI = NodePath.resolve(import.meta.dirname, "../src/cli.ts");
const NODE = process.execPath;

/** O Client do SDK ligado à sessão; fecha com o escopo. */
const conectar = (sessao: Http.SessaoMcp) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const cliente = new Client({ name: "teste-http", version: "0" });
      await cliente.connect(
        new StreamableHTTPClientTransport(new URL(sessao.url), { requestInit: { headers: { ...sessao.cabecalhos } } }),
      );
      return cliente;
    }),
    (cliente) => Effect.promise(() => cliente.close()),
  );

/** Um `initialize` cru, com os cabeçalhos dados: o status e o corpo da resposta. */
const postar = (url: string, cabecalhos: Record<string, string>, corpo?: string) =>
  Effect.promise(
    () =>
      new Promise<{ readonly status: number; readonly corpo: string; readonly autenticar?: string }>(
        (resolve, reject) => {
          const texto =
            corpo ??
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "teste", version: "0" },
              },
            });
          const requisicao = NodeHttp.request(
            url,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "content-length": String(Buffer.byteLength(texto)),
                ...cabecalhos,
              },
            },
            (resposta) => {
              let recebido = "";
              resposta.setEncoding("utf-8").on("data", (parte: string) => (recebido += parte));
              resposta.on("end", () =>
                resolve({
                  status: resposta.statusCode ?? 0,
                  corpo: recebido,
                  ...(resposta.headers["www-authenticate"] === undefined
                    ? {}
                    : { autenticar: resposta.headers["www-authenticate"] }),
                }),
              );
            },
          );
          requisicao.on("error", reject);
          requisicao.end(texto);
        },
      ),
  );

/** O texto do primeiro bloco de `content`. */
const textoDe = (resultado: Awaited<ReturnType<Client["callTool"]>>) =>
  (resultado.content as ReadonlyArray<{ readonly type: string; readonly text?: string }>)[0]?.text ?? "";

layer(Http.layer({ banco }), { excludeTestServices: true })("servidor MCP por HTTP local", (it) => {
  it.effect("escuta em 127.0.0.1, numa porta escolhida pelo sistema", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      expect(servidor.porta).toBeGreaterThan(0);
      expect(servidor.url).toBe(`http://127.0.0.1:${servidor.porta}/mcp`);
      const sessao = yield* servidor.abrirSessao({ rotulo: "url" });
      expect(sessao.url).toBe(servidor.url);
      expect(sessao.cabecalhos.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
    }),
  );

  it.effect("initialize, tools/list com as ferramentas do stdio e tools/call", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const cliente = yield* conectar(yield* servidor.abrirSessao({ rotulo: "basico" }));
      expect(cliente.getServerVersion()?.name).toBe("ifpr");
      expect(cliente.getInstructions()).toBe(INSTRUCOES);
      const { tools } = yield* Effect.promise(() => cliente.listTools());
      expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
      expect(tools).toHaveLength(16);
      const resultado = yield* Effect.promise(() => cliente.callTool({ name: "sobre_a_base", arguments: {} }));
      expect(resultado.isError).toBeFalsy();
      expect(resultado.structuredContent).toMatchObject({ base: { canal: "dev" } });
      expect(textoDe(resultado)).toContain("Base de 13/11/2026");
    }),
  );

  it.effect("401 sem token, com token desconhecido e com token revogado", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const semToken = yield* postar(servidor.url, {});
      expect(semToken.status).toBe(401);
      expect(semToken.autenticar).toBe("Bearer");
      const outro = yield* postar(servidor.url, { authorization: `Bearer ${"x".repeat(43)}` });
      expect(outro.status).toBe(401);
      expect(outro.autenticar).toBe('Bearer error="invalid_token"');
      expect(JSON.parse(outro.corpo)).toMatchObject({ error: "invalid_mcp_credential" });

      const escopo = yield* Scope.make();
      const sessao = yield* servidor.abrirSessao({ rotulo: "revogada" }).pipe(Scope.provide(escopo));
      expect((yield* postar(sessao.url, sessao.cabecalhos)).status).toBe(200);
      yield* Scope.close(escopo, Exit.void);
      const revogado = yield* postar(sessao.url, sessao.cabecalhos);
      expect(revogado.status).toBe(401);
      expect(revogado.autenticar).toBe('Bearer error="invalid_token"');
    }),
  );

  it.effect("duas sessões, com tokens diferentes; fechar uma não derruba a outra", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const escopoA = yield* Scope.make();
      const a = yield* servidor.abrirSessao({ rotulo: "a" }).pipe(Scope.provide(escopoA));
      const b = yield* servidor.abrirSessao({ rotulo: "b" });
      expect(a.cabecalhos.Authorization).not.toBe(b.cabecalhos.Authorization);
      const clienteB = yield* conectar(b);
      expect((yield* postar(a.url, a.cabecalhos)).status).toBe(200);
      yield* Scope.close(escopoA, Exit.void);
      expect((yield* postar(a.url, a.cabecalhos)).status).toBe(401);
      const resultado = yield* Effect.promise(() => clienteB.callTool({ name: "sobre_a_base", arguments: {} }));
      expect(resultado.isError).toBeFalsy();
    }),
  );

  it.effect("chamadas: cada chamada de ferramenta, com a sessão e o resultado", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const coleta = yield* servidor.chamadas.pipe(
        Stream.filter((c) => c.sessao === "metricas"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      );
      const cliente = yield* conectar(yield* servidor.abrirSessao({ rotulo: "metricas" }));
      yield* Effect.promise(() => cliente.callTool({ name: "sobre_a_base", arguments: {} }));
      const erro = yield* Effect.promise(() =>
        cliente.callTool({ name: "ficha_curso", arguments: { curso: "nao-existe/curso" } }),
      );
      expect(erro.isError).toBe(true);
      const chamadas = yield* Fiber.join(coleta);
      expect(chamadas.map(({ sessao, ferramenta, falhou }) => ({ sessao, ferramenta, falhou }))).toEqual([
        { sessao: "metricas", ferramenta: "sobre_a_base", falhou: false },
        { sessao: "metricas", ferramenta: "ficha_curso", falhou: true },
      ]);
      for (const c of chamadas) {
        expect(c.inicio).toBeGreaterThan(0);
        expect(c.duracaoMs).toBeGreaterThanOrEqual(0);
      }
    }),
  );

  it.effect("recusa Host que não seja 127.0.0.1 ou localhost na porta do servidor (DNS rebinding)", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const sessao = yield* servidor.abrirSessao({ rotulo: "host" });
      const comHost = (host: string) => postar(sessao.url, { ...sessao.cabecalhos, host });
      expect((yield* comHost(`localhost:${servidor.porta}`)).status).toBe(200);
      expect((yield* comHost(`127.0.0.1:${servidor.porta}`)).status).toBe(200);
      const atacante = yield* comHost(`atacante.exemplo:${servidor.porta}`);
      expect(atacante.status).toBe(403);
      expect(JSON.parse(atacante.corpo)).toMatchObject({ error: "host_nao_permitido" });
      expect((yield* comHost("127.0.0.1")).status).toBe(403);
      expect((yield* comHost(`127.0.0.1:${servidor.porta + 1}`)).status).toBe(403);
    }),
  );

  it.effect("recusa Origin de navegador e corpo grande demais", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const sessao = yield* servidor.abrirSessao({ rotulo: "origem" });
      const origem = yield* postar(sessao.url, { ...sessao.cabecalhos, origin: "http://atacante.exemplo" });
      expect(origem.status).toBe(403);
      const grande = yield* postar(sessao.url, sessao.cabecalhos, " ".repeat(Http.LIMITE_CORPO + 1));
      expect(grande.status).toBe(413);
    }),
  );

  it.effect("pasta de trabalho por sessão: só a sessão com pasta lê o .md", () =>
    Effect.gen(function* () {
      const servidor = yield* Http.ServidorMcpHttp;
      const comPasta = yield* conectar(yield* servidor.abrirSessao({ rotulo: "com-pasta", pastaTrabalho: pasta }));
      const semPasta = yield* conectar(yield* servidor.abrirSessao({ rotulo: "sem-pasta" }));
      const pacote = { name: "pacote_contexto", arguments: { tarefa: "CT-CURR-12", arquivo: "PPC.md" } };
      const lido = yield* Effect.promise(() => comPasta.callTool(pacote));
      expect(lido.isError).toBeFalsy();
      expect(lido.structuredContent).toMatchObject({ dados: { path: "PPC.md" } });
      const recusado = yield* Effect.promise(() => semPasta.callTool(pacote));
      expect(recusado.isError).toBe(true);
      expect(textoDe(recusado)).toContain("não tem pasta de trabalho");
      const daBase = yield* Effect.promise(() =>
        semPasta.callTool({ name: "pacote_contexto", arguments: { tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM } }),
      );
      expect(daBase.isError).toBeFalsy();

      const inexistente = yield* conectar(
        yield* servidor.abrirSessao({ rotulo: "pasta-inexistente", pastaTrabalho: NodePath.join(pasta, "nao-existe") }),
      );
      const semDisco = yield* Effect.promise(() => inexistente.callTool(pacote));
      expect(semDisco.isError).toBe(true);
      expect(textoDe(semDisco)).toContain("pasta de trabalho desta sessão não existe");
    }),
  );
});

describe("paridade com o stdio", () => {
  layer(Http.layer({ banco }), { excludeTestServices: true })("mesma resposta", (it) => {
    it.effect("listar_cursos devolve o mesmo structuredContent e o mesmo texto nos dois transportes", () =>
      Effect.gen(function* () {
        const servidor = yield* Http.ServidorMcpHttp;
        const http = yield* conectar(yield* servidor.abrirSessao({ rotulo: "paridade" }));
        const stdio = yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const cliente = new Client({ name: "teste-stdio", version: "0" });
            await cliente.connect(
              new StdioClientTransport({
                command: NODE,
                args: [CLI, "--banco", banco],
                cwd: diretorioTemporario(),
                env: AMBIENTE_STDIO,
                stderr: "pipe",
              }),
            );
            return cliente;
          }),
          (cliente) => Effect.promise(() => cliente.close()),
        );
        const chamada = { name: "listar_cursos", arguments: {} };
        const [porHttp, porStdio] = yield* Effect.promise(() =>
          Promise.all([http.callTool(chamada), stdio.callTool(chamada)]),
        );
        expect(porHttp.structuredContent).toEqual(porStdio.structuredContent);
        expect(porHttp.content).toEqual(porStdio.content);
      }),
    );
  });
});
