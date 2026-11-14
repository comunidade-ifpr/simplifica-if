// @effect-diagnostics nodeBuiltinImport:off -- script de desenvolvimento, sem runtime Effect
/**
 * O app em desenvolvimento: constrói o processo principal e o preload, garante o Electron e o abre
 * sobre `dist/app`. O processo principal inicia o servidor com este Node (`SIMPLIFICA_NODE`, o Node 26
 * do repositório) e `apps/server/src/bin.ts`, e a janela carrega o dev server do `apps/web`
 * (`SIMPLIFICA_WEB_URL`; padrão `http://localhost:5190`, o `PORTA_DEV` do `apps/web/vite.config.ts`). Com `SIMPLIFICA_WEB_URL=`
 * vazio, a janela carrega o build em `dist/app/web` (`pnpm --filter @simplifica-if/desktop build`).
 *
 *   pnpm --filter @simplifica-if/web dev          # num terminal
 *   pnpm --filter @simplifica-if/desktop dev      # noutro
 *
 * Os argumentos seguintes vão ao Electron (por exemplo, `--remote-debugging-port=9333`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { construir, DIST_APP, PACOTE } from "./construir.ts";

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

if (import.meta.main) {
  await construir({ soProcessoPrincipal: true, web: false });
  const electron = garantirElectron();
  const ambiente: Record<string, string | undefined> = {
    ...process.env,
    SIMPLIFICA_NODE: process.execPath,
    SIMPLIFICA_WEB_URL: process.env.SIMPLIFICA_WEB_URL ?? URL_WEB_PADRAO,
  };
  delete ambiente.ELECTRON_RUN_AS_NODE;
  const filho = NodeChildProcess.spawn(electron, [DIST_APP, ...process.argv.slice(2)], {
    cwd: PACOTE,
    env: ambiente,
    stdio: "inherit",
  });
  for (const sinal of ["SIGINT", "SIGTERM"] as const) process.on(sinal, () => filho.kill(sinal));
  filho.on("exit", (codigo) => process.exit(codigo ?? 0));
}
