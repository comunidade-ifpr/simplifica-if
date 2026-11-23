// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off globalFetch:off -- script de desenvolvimento, sem runtime Effect
/**
 * O app em desenvolvimento, num comando só: constrói o processo principal e o preload, recompila a
 * base se ela estiver velha, garante o Electron, garante a interface e abre o Electron sobre `dist/app`. O processo principal inicia o
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
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { construir, DIST_APP, PACOTE, RAIZ } from "./construir.ts";

/** A URL padrão do dev server do `apps/web`. */
export const URL_WEB_PADRAO = "http://localhost:5190";

export function garantirElectron(): string {
  const resultado = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(PACOTE, "scripts", "t3", "ensure-electron-runtime.mjs")],
    { cwd: PACOTE, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (resultado.status !== 0) throw new Error("não foi possível preparar o Electron");
  return resultado.stdout.trim().split("\n").at(-1)!;
}

/**
 * No macOS, o nome no menu e o ícone no Dock vêm do `Info.plist` do pacote, não de `app.setName`: sem
 * isto, o desenvolvimento aparece como "Electron", com o ícone do Electron. Por isso o Electron roda de
 * uma cópia do `Electron.app` (clonada no APFS, sem ocupar espaço) com o nome, o identificador e o ícone
 * do app, refeita quando muda o Electron ou o ícone. Mudar o `Info.plist` invalida a assinatura do
 * pacote, que o macOS exige no arm64: a cópia é reassinada ad hoc.
 */
export function pacoteDev(electron: string): string {
  if (process.platform !== "darwin") return electron;
  const origem = NodePath.resolve(electron, "..", "..", "..");
  const icone = NodePath.join(PACOTE, "recursos", "icone.icns");
  const pasta = NodePath.join(PACOTE, "dist", "electron-dev");
  const destino = NodePath.join(pasta, "Simplifica IF (dev).app");
  const carimbo = NodePath.join(pasta, "carimbo");
  const hash = NodeCrypto.createHash("sha256")
    .update(NodeFS.readFileSync(NodePath.join(origem, "Contents", "Info.plist")))
    .update(NodeFS.readFileSync(icone))
    .digest("hex");
  const executavel = NodePath.join(destino, "Contents", "MacOS", NodePath.basename(electron));
  if (NodeFS.existsSync(executavel) && NodeFS.existsSync(carimbo) && NodeFS.readFileSync(carimbo, "utf8") === hash) {
    return executavel;
  }
  const rodar = (comando: string, args: ReadonlyArray<string>): string => {
    const r = NodeChildProcess.spawnSync(comando, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    if (r.status !== 0) throw new Error(`${comando} ${args.join(" ")} falhou`);
    return r.stdout.trim();
  };
  NodeFS.rmSync(pasta, { recursive: true, force: true });
  NodeFS.mkdirSync(pasta, { recursive: true });
  rodar("cp", ["-cR", origem, destino]);
  const plist = NodePath.join(destino, "Contents", "Info.plist");
  for (const [chave, valor] of [
    ["CFBundleName", "Simplifica IF"],
    ["CFBundleDisplayName", "Simplifica IF"],
    ["CFBundleIdentifier", "br.edu.ifpr.simplifica.dev"],
  ] as const) {
    rodar("plutil", ["-replace", chave, "-string", valor, plist]);
  }
  const arquivoIcone = rodar("plutil", ["-extract", "CFBundleIconFile", "raw", plist]);
  NodeFS.copyFileSync(icone, NodePath.join(destino, "Contents", "Resources", arquivoIcone));
  rodar("codesign", ["--force", "--deep", "--sign", "-", destino]);
  NodeFS.writeFileSync(carimbo, hash);
  return executavel;
}

/**
 * Deixa o `tmp/kb.sqlite` em dia com as fontes e com o esquema do código: o servidor do app só abre a
 * base, não a recompila. Uma consulta da CLI `kb` faz a conferência (e a compilação, se preciso). Com
 * `SIMPLIFICA_KB`, a base é de quem a passou.
 */
export function garantirBase(): void {
  if (process.env.SIMPLIFICA_KB?.trim()) return;
  const r = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(RAIZ, "packages", "mcp", "src", "kb.ts"), "sobre-a-base"],
    { cwd: RAIZ, stdio: ["ignore", "ignore", "inherit"] },
  );
  if (r.status !== 0) throw new Error("não foi possível compilar a base (tmp/kb.sqlite); veja a mensagem acima");
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
  // O `vp` direto, sem o `pnpm --filter … dev` na frente: ao encerrar, o pnpm acusaria o sinal como
  // falha (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`) depois de o app fechar normalmente.
  const pastaWeb = NodePath.join(RAIZ, "apps", "web");
  const web = NodeChildProcess.spawn(NodePath.join(pastaWeb, "node_modules", ".bin", "vp"), ["dev"], {
    cwd: pastaWeb,
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
    garantirBase();
    const electron = pacoteDev(garantirElectron());
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
