// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off globalFetch:off -- script de desenvolvimento, sem runtime Effect
/**
 * O app em desenvolvimento, num comando só: constrói o processo principal e o preload, garante o
 * Electron, garante a interface e abre o Electron sobre `dist/app`. O processo principal inicia o
 * servidor com este Node (`SIMPLIFICA_NODE`, o Node 26 do repositório) e `apps/server/src/bin.ts`.
 *
 * A interface é o dev server do `apps/web` (`SIMPLIFICA_WEB_URL`; padrão `http://localhost:5190`, o
 * `PORTA_DEV` do `apps/web/vite.config.ts`). Se ele já responde (outro terminal com
 * `pnpm --filter @simplifica-if/web dev`), é reaproveitado; senão, este script o inicia, espera ficar
 * pronto e o encerra junto com o Electron. Com `SIMPLIFICA_WEB_URL=` vazio, a janela carrega o build em
 * `dist/app/web` (`pnpm --filter @simplifica-if/desktop build`).
 *
 *   pnpm app:dev                                  # na raiz; o mesmo que pnpm --filter @simplifica-if/desktop dev
 *
 * Os argumentos seguintes vão ao Electron (por exemplo, `--remote-debugging-port=9333`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { construir, DIST_APP, PACOTE, RAIZ } from "./construir.ts";

/** A URL padrão do dev server do `apps/web`. */
export const URL_WEB_PADRAO = "http://localhost:5190";

function garantirElectron(): string {
  const resultado = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(PACOTE, "scripts", "t3", "ensure-electron-runtime.mjs")],
    { cwd: PACOTE, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (resultado.status !== 0) throw new Error("não foi possível preparar o Electron");
  return resultado.stdout.trim().split("\n").at(-1)!;
}

/** Prazo para o dev server da interface responder depois de iniciado. */
const PRAZO_WEB_MS = 60_000;

async function responde(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inicia o dev server do `apps/web` (`vp dev`) e espera ele responder em `url`. Num grupo de processos
 * próprio (fora do Windows), para encerrar o `vp` e os filhos dele de uma vez.
 */
async function iniciarWeb(url: string): Promise<NodeChildProcess.ChildProcess> {
  console.error(`[dev] a interface não responde em ${url}; iniciando o apps/web (vp dev)…`);
  const web = NodeChildProcess.spawn("pnpm", ["--filter", "@simplifica-if/web", "dev"], {
    cwd: RAIZ,
    stdio: "inherit",
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });
  let saiu: string | undefined;
  web.once("exit", (codigo, sinal) => (saiu = `saiu com ${sinal ?? `código ${codigo}`}`));
  web.once("error", (erro) => (saiu = erro.message));
  const limite = Date.now() + PRAZO_WEB_MS;
  while (Date.now() < limite) {
    if (saiu !== undefined) {
      throw new Error(
        `o dev server da interface ${saiu}. A porta ${new URL(url).port} pode estar ocupada; veja a mensagem acima.`,
      );
    }
    if (await responde(url)) return web;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  encerrar(web);
  throw new Error(`o dev server da interface não respondeu em ${url} em ${PRAZO_WEB_MS / 1000} s`);
}

function encerrar(filho: NodeChildProcess.ChildProcess, sinal: NodeJS.Signals = "SIGTERM"): void {
  if (filho.exitCode !== null || filho.pid === undefined) return;
  try {
    if (process.platform !== "win32") process.kill(-filho.pid, sinal);
    else filho.kill(sinal);
  } catch {
    // já saiu
  }
}

if (import.meta.main) {
  const urlWeb = process.env.SIMPLIFICA_WEB_URL ?? URL_WEB_PADRAO;
  let web: NodeChildProcess.ChildProcess | undefined;
  try {
    await construir({ soProcessoPrincipal: true, web: false });
    const electron = garantirElectron();
    if (urlWeb !== "" && !(await responde(urlWeb))) {
      // Só o dev server padrão é iniciado aqui; outra URL é responsabilidade de quem a passou.
      if (urlWeb === URL_WEB_PADRAO) web = await iniciarWeb(urlWeb);
      else console.error(`[dev] a interface não responde em ${urlWeb} (SIMPLIFICA_WEB_URL); inicie-a antes`);
    }
    const ambiente: Record<string, string | undefined> = {
      ...process.env,
      SIMPLIFICA_NODE: process.execPath,
      SIMPLIFICA_WEB_URL: urlWeb,
    };
    delete ambiente.ELECTRON_RUN_AS_NODE;
    const filho = NodeChildProcess.spawn(electron, [DIST_APP, ...process.argv.slice(2)], {
      cwd: PACOTE,
      env: ambiente,
      stdio: "inherit",
    });
    for (const sinal of ["SIGINT", "SIGTERM"] as const) {
      process.on(sinal, () => {
        filho.kill(sinal);
        if (web) encerrar(web, sinal);
      });
    }
    filho.on("exit", (codigo) => {
      if (web) encerrar(web);
      process.exit(codigo ?? 0);
    });
  } catch (erro) {
    if (web) encerrar(web);
    console.error(`[dev] ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exit(1);
  }
}
