// @effect-diagnostics nodeBuiltinImport:off -- teste do processo principal (sem Effect): processos filhos falsos pelo node:child_process
/**
 * As unidades do processo principal que falam com o servidor: o token, a linha de partida, a
 * montagem do comando, dos argumentos e do ambiente (sem o token na linha de comando) e o
 * encerramento (stdin, SIGTERM, SIGKILL), com processos Node falsos no lugar do servidor.
 */
import * as NodeStream from "node:stream";
import * as Schema from "effect/Schema";
import { EnvelopePartida, LinhaPartida } from "@simplifica-if/contratos-app";
import { TAMANHO_MINIMO_TOKEN, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, test } from "vite-plus/test";
import {
  decodificarLinhaPartida,
  FalhaServidor,
  gerarToken,
  iniciarServidor,
  lerPrimeiraLinha,
  montarInicio,
  type Inicio,
} from "../src/servidor.ts";

const LINHA = {
  servidor: "simplifica-if",
  pid: 42,
  porta: 61885,
  rpc: "ws://127.0.0.1:61885/rpc",
  mcp: "http://127.0.0.1:61886/mcp",
};

describe("token", () => {
  test("32 bytes aleatórios em base64url, acima do mínimo do servidor", () => {
    const token = gerarToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token.length).toBeGreaterThanOrEqual(TAMANHO_MINIMO_TOKEN);
    expect(new Set(Array.from({ length: 20 }, gerarToken)).size).toBe(20);
  });
});

describe("linha de partida", () => {
  test("decodifica a linha do servidor, que o schema do contrato também aceita", () => {
    const texto = JSON.stringify(LINHA);
    expect(decodificarLinhaPartida(texto)).toEqual(LINHA);
    expect(Schema.decodeSync(Schema.fromJsonString(LinhaPartida))(texto)).toEqual(LINHA);
  });

  test("recusa o que não é a linha do servidor, sem repetir a linha", () => {
    expect(() => decodificarLinhaPartida("pronto")).toThrow(FalhaServidor);
    expect(() => decodificarLinhaPartida(JSON.stringify({ ...LINHA, servidor: "outro" }))).toThrow(/não é do servidor/);
    expect(() => decodificarLinhaPartida(JSON.stringify({ ...LINHA, porta: 0 }))).toThrow(/porta/);
    expect(() => decodificarLinhaPartida(JSON.stringify({ ...LINHA, rpc: "ws://0.0.0.0:61885/rpc" }))).toThrow(
      /127\.0\.0\.1/,
    );
    try {
      decodificarLinhaPartida('{"segredo": "xyz"}');
    } catch (erro) {
      expect(String(erro)).not.toContain("xyz");
    }
  });

  test("lê a primeira linha mesmo partida em pedaços, e descarta o resto", async () => {
    const entrada = new NodeStream.PassThrough();
    const linha = lerPrimeiraLinha(entrada, 5_000);
    entrada.write('{"servidor":');
    entrada.write('"simplifica-if"}\r\nlog depois\n');
    expect(await linha).toBe('{"servidor":"simplifica-if"}');
  });

  test("falha se a saída acabar antes da linha ou se o prazo passar", async () => {
    const curta = new NodeStream.PassThrough();
    const semLinha = lerPrimeiraLinha(curta, 5_000);
    curta.end("meia linha");
    await expect(semLinha).rejects.toThrow(/antes da linha de partida/);
    await expect(lerPrimeiraLinha(new NodeStream.PassThrough(), 10)).rejects.toThrow(/não ficou pronto/);
  });
});

describe("montarInicio", () => {
  const TOKEN = gerarToken();
  const base = {
    banco: "/base/kb.sqlite",
    pastaEstado: "/estado",
    origens: ["simplifica://app"],
    token: TOKEN,
    ambiente: { PATH: "/usr/bin", HOME: "/home/x", [VARIAVEL_TOKEN]: "herdado-".repeat(8), INDEFINIDA: undefined },
  };

  test("desenvolvimento: o Node com o bin.ts; o token só no envelope", () => {
    const inicio = montarInicio({
      ...base,
      executor: { tipo: "node", node: "/usr/local/bin/node", bin: "/repo/apps/server/src/bin.ts" },
      ambiente: { ...base.ambiente, ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(inicio.comando).toBe("/usr/local/bin/node");
    expect(inicio.argumentos).toEqual([
      "/repo/apps/server/src/bin.ts",
      "--banco",
      "/base/kb.sqlite",
      "--pasta-estado",
      "/estado",
    ]);
    expect(inicio.ambiente).toEqual({ PATH: "/usr/bin", HOME: "/home/x" });
    const envelope = Schema.decodeSync(Schema.fromJsonString(EnvelopePartida))(inicio.envelope.trimEnd());
    expect(envelope).toEqual({ token: TOKEN, origens: ["simplifica://app"] });
    // Com o segredo do processo principal, ele vai no envelope (e só nele).
    const comSegredo = montarInicio({
      ...base,
      tokenDesktop: "segredo-do-processo-principal-0123456789",
      executor: { tipo: "node", node: "/usr/local/bin/node", bin: "/repo/apps/server/src/bin.ts" },
    });
    expect(Schema.decodeSync(Schema.fromJsonString(EnvelopePartida))(comSegredo.envelope.trimEnd())).toEqual({
      token: TOKEN,
      origens: ["simplifica://app"],
      tokenDesktop: "segredo-do-processo-principal-0123456789",
    });
    expect(JSON.stringify([comSegredo.argumentos, comSegredo.ambiente])).not.toContain("segredo");
    expect(inicio.envelope.endsWith("\n")).toBe(true);
    expect(inicio.envelope.indexOf("\n")).toBe(inicio.envelope.length - 1);
  });

  test("app empacotado: o Electron como Node sobre o bundle", () => {
    const electron = "/Applications/Simplifica IF.app/Contents/MacOS/Simplifica IF";
    const bundle = "/Applications/Simplifica IF.app/Contents/Resources/servidor/bin.mjs";
    const inicio = montarInicio({ ...base, executor: { tipo: "electron", electron, bundle } });
    expect(inicio.comando).toBe(electron);
    expect(inicio.argumentos[0]).toBe(bundle);
    expect(inicio.argumentos).not.toContain("--pasta-skills");
    const comSkills = montarInicio({
      ...base,
      executor: { tipo: "electron", electron, bundle },
      pastaSkills: "/r/skills",
    });
    expect(comSkills.argumentos.slice(-2)).toEqual(["--pasta-skills", "/r/skills"]);
    expect(inicio.ambiente.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  test("o token não aparece no comando, nos argumentos nem no ambiente", () => {
    for (const executor of [
      { tipo: "node", node: "node", bin: "bin.ts" },
      { tipo: "electron", electron: "electron", bundle: "bin.mjs" },
    ] as const) {
      const inicio = montarInicio({ ...base, executor });
      const fora = [
        inicio.comando,
        ...inicio.argumentos,
        ...Object.keys(inicio.ambiente),
        ...Object.values(inicio.ambiente),
      ];
      expect(fora.some((texto) => texto.includes(TOKEN))).toBe(false);
      expect(inicio.ambiente[VARIAVEL_TOKEN]).toBeUndefined();
      expect(inicio.envelope).toContain(TOKEN);
    }
  });
});

describe("iniciarServidor e encerramento", () => {
  /** Um "servidor" falso: um Node com o script dado, que recebe o envelope no stdin. */
  const falso = (script: string): Inicio => ({
    comando: process.execPath,
    argumentos: ["-e", script],
    ambiente: { PATH: process.env.PATH ?? "" },
    cwd: undefined,
    envelope: `${JSON.stringify({ token: gerarToken(), origens: [] })}\n`,
  });

  /** Lê o envelope, anuncia a linha de partida e reage ao fim do stdin conforme `aoFim`. */
  const servidorFalso = (aoFim: string, extra = "") => `
    const linhas = require("node:readline").createInterface({ input: process.stdin });
    let primeira = true;
    linhas.on("line", (linha) => {
      if (!primeira) return;
      primeira = false;
      const { token } = JSON.parse(linha);
      if (token.length < 32) process.exit(3);
      process.stdout.write(JSON.stringify({ servidor: "simplifica-if", pid: process.pid, porta: 4321, rpc: "ws://127.0.0.1:4321/rpc", mcp: "http://127.0.0.1:4322/mcp" }) + "\\n");
      process.stderr.write("log do servidor\\n");
    });
    linhas.on("close", () => { ${aoFim} });
    ${extra}
    setInterval(() => {}, 1000);
  `;

  test("lê a linha de partida e sai quando o stdin fecha", async () => {
    const logs: Array<string> = [];
    const servidor = await iniciarServidor(falso(servidorFalso("process.exit(0)")), { aoStderr: (p) => logs.push(p) });
    expect(servidor.linha.porta).toBe(4321);
    expect(servidor.linha.pid).toBe(servidor.pid);
    expect(await servidor.encerrar()).toBe("stdin");
    expect(await servidor.saida).toEqual({ codigo: 0, sinal: null });
    expect(logs.join("")).toContain("log do servidor");
    // Chamadas repetidas: a mesma resposta.
    expect(await servidor.encerrar()).toBe("stdin");
  });

  test("se o stdin fechado não basta, SIGTERM", async () => {
    const servidor = await iniciarServidor(falso(servidorFalso("")), { prazoEncerramentoMs: 200 });
    expect(await servidor.encerrar()).toBe("sigterm");
    expect((await servidor.saida).sinal).toBe("SIGTERM");
  });

  test.skipIf(process.platform === "win32")("se nem o SIGTERM basta, SIGKILL", async () => {
    const servidor = await iniciarServidor(falso(servidorFalso("", 'process.on("SIGTERM", () => {});')), {
      prazoEncerramentoMs: 200,
      prazoSigtermMs: 200,
    });
    expect(await servidor.encerrar()).toBe("sigkill");
    expect((await servidor.saida).sinal).toBe("SIGKILL");
  });

  test("um servidor que sai antes de ficar pronto: falha com o stderr", async () => {
    const erro = await iniciarServidor(
      falso('process.stderr.write("sem token: passe o envelope\\n"); process.exit(1)'),
    ).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(FalhaServidor);
    expect(String(erro)).toContain("sem token: passe o envelope");
  });

  test("um servidor que não fica pronto no prazo é encerrado", async () => {
    const erro = await iniciarServidor(falso("setInterval(() => {}, 1000)"), {
      prazoPartidaMs: 200,
      prazoEncerramentoMs: 200,
    }).catch((e: unknown) => e);
    expect(String(erro)).toMatch(/não ficou pronto/);
  });

  test("um executável que não existe", async () => {
    const inicio = { ...falso(""), comando: "/nao/existe/node" };
    await expect(iniciarServidor(inicio)).rejects.toThrow(/não foi possível iniciar o servidor/);
  });
});
