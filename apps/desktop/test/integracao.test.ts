// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- teste do processo principal (sem Effect): o servidor real como processo filho
/**
 * O servidor de verdade, iniciado como o processo principal o inicia (`montarInicio` e
 * `iniciarServidor`), sobre o banco de fixture do servidor e uma pasta de estado temporária. Nenhum
 * provider é chamado. Confere a linha de partida, a conexão pelo token (o `POST /ingresso`, que a
 * interface usa antes do WebSocket), as origens e o encerramento pelo stdin.
 *
 * - `apps/server/src/bin.ts` com este Node, como no desenvolvimento;
 * - o bundle (`dist/recursos/servidor/bin.mjs`) com o Electron como Node, como no app empacotado, se
 *   o bundle e o Electron existirem (`pnpm --filter @simplifica-if/desktop build` e `garantir-electron`).
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { bancoFixture, diretorioTemporario, limparTemporarios } from "../../server/test/apoio.ts";
import { ORIGEM_APP } from "../src/configuracao.ts";
import { gerarToken, iniciarServidor, montarInicio, type Executor } from "../src/servidor.ts";

afterAll(limparTemporarios);

const PACOTE = NodePath.resolve(import.meta.dirname, "..");
const RAIZ = NodePath.resolve(PACOTE, "../..");
const BUNDLE = NodePath.join(PACOTE, "dist", "recursos", "servidor", "bin.mjs");

/** O executável do Electron instalado, se o runtime já foi baixado. */
function electronInstalado(): string | undefined {
  try {
    const requerer = NodeModule.createRequire(NodePath.join(PACOTE, "package.json"));
    const pasta = NodePath.dirname(requerer.resolve("electron/package.json"));
    const relativo = NodeFS.readFileSync(NodePath.join(pasta, "path.txt"), "utf-8").trim();
    const executavel = NodePath.join(pasta, "dist", relativo);
    return NodeFS.existsSync(executavel) ? executavel : undefined;
  } catch {
    return undefined;
  }
}

const ELECTRON = electronInstalado();
const banco = bancoFixture();

/** O ambiente do teste, sem nada que mude o servidor (o token, a base, o estado). */
function ambiente(): Record<string, string | undefined> {
  const copia = { ...process.env };
  for (const chave of ["SIMPLIFICA_SERVIDOR_TOKEN", "SIMPLIFICA_KB", "SIMPLIFICA_ESTADO", "ELECTRON_RUN_AS_NODE"]) {
    delete copia[chave];
  }
  return copia;
}

async function conferir(executor: Executor): Promise<void> {
  const token = gerarToken();
  const inicio = montarInicio({
    executor,
    banco,
    pastaEstado: diretorioTemporario("simplifica-desktop-estado-"),
    origens: [ORIGEM_APP],
    token,
    ambiente: ambiente(),
    cwd: RAIZ,
  });
  const servidor = await iniciarServidor(inicio, { aoStderr: () => undefined });
  try {
    expect(servidor.linha.servidor).toBe("simplifica-if");
    expect(servidor.linha.pid).toBe(servidor.pid);
    expect(servidor.linha.rpc).toBe(`ws://127.0.0.1:${servidor.linha.porta}/rpc`);
    const ingresso = `http://127.0.0.1:${servidor.linha.porta}/ingresso`;

    // Com o token e a origem da janela: o ingresso do WebSocket.
    const aceito = await fetch(ingresso, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: ORIGEM_APP },
    });
    expect(aceito.status).toBe(200);
    expect(aceito.headers.get("access-control-allow-origin")).toBe(ORIGEM_APP);
    const corpo = (await aceito.json()) as { ingresso: string; expiraEm: number };
    expect(corpo.ingresso.length).toBeGreaterThan(20);

    // Sem token, com outro token ou de outra origem: recusado.
    expect((await fetch(ingresso, { method: "POST" })).status).toBe(401);
    expect(
      (await fetch(ingresso, { method: "POST", headers: { authorization: `Bearer ${gerarToken()}` } })).status,
    ).toBe(401);
    expect(
      (
        await fetch(ingresso, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, origin: "https://exemplo.com" },
        })
      ).status,
    ).toBe(403);
  } finally {
    // O app sai: o stdin fechado basta.
    expect(await servidor.encerrar()).toBe("stdin");
  }
  expect((await servidor.saida).codigo).toBe(0);
}

describe("servidor real", () => {
  test("desenvolvimento: Node com o bin.ts", async () => {
    await conferir({
      tipo: "node",
      node: process.execPath,
      bin: NodePath.join(RAIZ, "apps", "server", "src", "bin.ts"),
    });
  });

  test.skipIf(ELECTRON === undefined || !NodeFS.existsSync(BUNDLE))(
    "app empacotado: o Electron como Node sobre o bundle",
    async () => {
      await conferir({ tipo: "electron", electron: ELECTRON!, bundle: BUNDLE });
    },
  );
});
