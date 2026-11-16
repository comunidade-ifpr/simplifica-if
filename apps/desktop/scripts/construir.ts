// @effect-diagnostics nodeBuiltinImport:off -- script de build, sem runtime Effect (como os scripts do pacote mcp)
/**
 * Os bundles do app desktop, como o `build` do `apps/desktop` do T3 (`vp pack`, tsdown):
 *
 * - `dist/app/main.cjs` e `dist/app/preload.cjs`: o processo principal e o preload, em CommonJS (o
 *   preload com `sandbox` não resolve imports: sai num arquivo só, com só o `electron` de fora);
 * - `dist/app/web/`: o build do `apps/web` (`pnpm --filter @simplifica-if/web build`) ou, sem ele, a
 *   página provisória de `src/provisoria/`;
 * - `dist/app/package.json`: o manifesto mínimo do app (sem dependências: tudo vai nos bundles);
 * - `dist/recursos/servidor/`: o servidor local (`apps/server/src/bin.ts`) em ESM e o Worker da revisão
 *   prévia (`trabalhador-ppc.mjs`, de `apps/server/src/revisao-ppc/trabalhador.ts`), com as dependências
 *   dentro, menos:
 *   - os opcionais nativos do `ws` (`bufferutil`, `utf-8-validate`), que ficam de fora e não se
 *     instalam; o `ws` os carrega num `try` e segue sem eles;
 *   - o `undici`, que o `effect` carrega com `import()` dinâmico e usa pelos exports nomeados de um
 *     módulo CommonJS, que o bundle não reproduz (`_.Agent is not a constructor`). Vai copiado em
 *     `servidor/node_modules/undici`, como o T3 deixa o `undici` fora do bundle da CLI.
 * - `dist/recursos/skills/`: as skills do app (`skills.ts`): só as de `.agents/skills` com bloco
 *   `simplifica:` válido e só os arquivos listados nele; o servidor empacotado as lê por `--pasta-skills`.
 *
 *   node scripts/construir.ts                       # tudo
 *   node scripts/construir.ts --so-processo-principal   # só main e preload (o `dev` usa)
 *   node scripts/construir.ts --sem-web             # não constrói o apps/web; usa o build que houver ou a provisória
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { build as empacotar } from "vite-plus/pack";
import { copiarSkills } from "./skills.ts";

export const PACOTE = NodePath.resolve(import.meta.dirname, "..");
export const RAIZ = NodePath.resolve(PACOTE, "../..");
export const DIST = NodePath.join(PACOTE, "dist");
export const DIST_APP = NodePath.join(DIST, "app");
export const DIST_RECURSOS = NodePath.join(DIST, "recursos");
const WEB = NodePath.join(RAIZ, "apps", "web");

/** Ficam fora do bundle do servidor: os opcionais nativos do `ws` e o `undici` (copiado ao lado). */
export const EXTERNOS_SERVIDOR = ["bufferutil", "utf-8-validate", "undici"];

/** Os externos que vão copiados em `servidor/node_modules` (sem dependências próprias). */
const COPIADOS_SERVIDOR = ["undici"];

const ehExterno = (id: string) => EXTERNOS_SERVIDOR.some((nome) => id === nome || id.startsWith(`${nome}/`));

async function construirProcessoPrincipal(): Promise<void> {
  const comum = {
    cwd: PACOTE,
    config: false,
    outDir: DIST_APP,
    platform: "node",
    format: "cjs",
    logLevel: "warn",
    report: false,
    sourcemap: true,
    outExtensions: () => ({ js: ".cjs" }),
    outputOptions: { codeSplitting: false },
    deps: {
      neverBundle: (id: string) => id === "electron" || id.startsWith("electron/"),
      alwaysBundle: (id: string) => !id.startsWith("node:") && id !== "electron" && !id.startsWith("electron/"),
      onlyBundle: false,
    },
  } as const;
  await empacotar({ ...comum, entry: { main: NodePath.join(PACOTE, "src", "main.ts") }, clean: false });
  await empacotar({ ...comum, entry: { preload: NodePath.join(PACOTE, "src", "preload.ts") }, clean: false });
}

async function construirServidor(): Promise<void> {
  const saida = NodePath.join(DIST_RECURSOS, "servidor");
  NodeFS.rmSync(saida, { recursive: true, force: true });
  const comum = {
    cwd: NodePath.join(RAIZ, "apps", "server"),
    config: false,
    outDir: saida,
    platform: "node",
    format: "esm",
    logLevel: "warn",
    report: false,
    deps: {
      alwaysBundle: (id: string) => !ehExterno(id),
      neverBundle: ehExterno,
      onlyBundle: false,
    },
    // Num bundle, todo módulo é o principal: o `if (import.meta.main)` das CLIs dos pacotes não pode rodar.
    define: { "import.meta.main": "false" },
  } as const;
  await empacotar({ ...comum, entry: { bin: NodePath.join(RAIZ, "apps", "server", "src", "bin.ts") }, clean: true });
  // O Worker da revisão prévia (`AnalisePpc.ts` o procura em `./trabalhador-ppc.mjs`), num bundle à
  // parte, sem pedaços compartilhados com o do servidor.
  await empacotar({
    ...comum,
    entry: { "trabalhador-ppc": NodePath.join(RAIZ, "apps", "server", "src", "revisao-ppc", "trabalhador.ts") },
    clean: false,
    outputOptions: { codeSplitting: false },
  });
  // O pacote como o pnpm o resolve a partir do servidor (o undici do @effect/platform-node).
  const platformNode = NodeFS.realpathSync(NodePath.join(RAIZ, "node_modules", "@effect", "platform-node"));
  const requerer = NodeModule.createRequire(NodePath.join(platformNode, "package.json"));
  for (const nome of COPIADOS_SERVIDOR) {
    const origem = NodePath.dirname(requerer.resolve(`${nome}/package.json`));
    NodeFS.cpSync(origem, NodePath.join(saida, "node_modules", nome), {
      recursive: true,
      dereference: true,
      filter: (arquivo) =>
        !/^(docs|types|scripts)([\\/]|$)/.test(NodePath.relative(origem, arquivo)) && !arquivo.endsWith(".d.ts"),
    });
  }
}

function copiarWeb(construirWeb: boolean): string {
  const destino = NodePath.join(DIST_APP, "web");
  NodeFS.rmSync(destino, { recursive: true, force: true });
  const temWeb = NodeFS.existsSync(NodePath.join(WEB, "package.json"));
  if (temWeb && construirWeb) {
    const resultado = NodeChildProcess.spawnSync("pnpm", ["--filter", "@simplifica-if/web", "build"], {
      cwd: RAIZ,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (resultado.status !== 0) throw new Error("o build do apps/web falhou");
  }
  const buildWeb = NodePath.join(WEB, "dist");
  if (NodeFS.existsSync(NodePath.join(buildWeb, "index.html"))) {
    NodeFS.cpSync(buildWeb, destino, { recursive: true });
    return "apps/web/dist";
  }
  NodeFS.cpSync(NodePath.join(PACOTE, "src", "provisoria"), destino, { recursive: true });
  return "página provisória (src/provisoria)";
}

function escreverManifesto(): void {
  const pacote = JSON.parse(NodeFS.readFileSync(NodePath.join(PACOTE, "package.json"), "utf-8")) as {
    version: string;
    description: string;
  };
  const manifesto = {
    name: "simplifica-if",
    productName: "Simplifica IF",
    version: pacote.version,
    description: pacote.description,
    author: "Instituto Federal do Paraná",
    license: "UNLICENSED",
    private: true,
    main: "main.cjs",
  };
  NodeFS.writeFileSync(NodePath.join(DIST_APP, "package.json"), `${JSON.stringify(manifesto, null, 2)}\n`);
}

export async function construir(opcoes: { readonly soProcessoPrincipal: boolean; readonly web: boolean }) {
  NodeFS.mkdirSync(DIST_APP, { recursive: true });
  await construirProcessoPrincipal();
  escreverManifesto();
  if (opcoes.soProcessoPrincipal) return;
  await construirServidor();
  const skills = await copiarSkills(NodePath.join(RAIZ, ".agents", "skills"), NodePath.join(DIST_RECURSOS, "skills"));
  const web = copiarWeb(opcoes.web);
  process.stderr.write(
    `bundles em ${NodePath.relative(RAIZ, DIST)} (interface: ${web}; skills: ${skills.join(", ") || "nenhuma"})\n`,
  );
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: { "so-processo-principal": { type: "boolean" }, "sem-web": { type: "boolean" } },
  });
  await construir({ soProcessoPrincipal: values["so-processo-principal"] === true, web: values["sem-web"] !== true });
}
