#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- script de build, fora do runtime Effect: chama o empacotador e escreve o progresso no terminal
/**
 * Empacota o servidor MCP (`src/cli.ts`) num executável Node SEA, `dist-exe/simplifica-mcp`, como o
 * `build:exe` do T3 Code: `vp pack` (tsdown) num só chunk, com todas as dependências dentro, e o SEA
 * do próprio Node (`--build-sea`).
 *
 *   pnpm mcp:executavel                     # o alvo desta máquina
 *   pnpm mcp:executavel --alvo linux-x64    # outro alvo (baixa o Node da versão fixada)
 *   pnpm mcp:executavel --todos             # darwin-arm64, darwin-x64, linux-x64 e win-x64
 *
 * O executável nativo exige o Node de `engines.node`; os de outra plataforma, Node ≥ 25.7 (o
 * `--build-sea`). Antes do SEA, confere que o bundle só importa módulos internos do Node: o SEA não
 * resolve pacotes, e um import externo só falharia ao rodar.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { parseAst } from "vite-plus";
import { build as empacotar } from "vite-plus/pack";

const PACOTE = NodePath.resolve(import.meta.dirname, "..");
const RAIZ = NodePath.resolve(PACOTE, "../..");
const ENTRADA = NodePath.join(PACOTE, "src", "cli.ts");
const SAIDA = NodePath.join(PACOTE, "dist-exe");
const NOME = "simplifica-mcp";

/** Alvos na nomenclatura do nodejs.org, como no T3. */
export const ALVOS = {
  "darwin-arm64": { platform: "darwin", arch: "arm64" },
  "darwin-x64": { platform: "darwin", arch: "x64" },
  "linux-x64": { platform: "linux", arch: "x64" },
  "win-x64": { platform: "win", arch: "x64" },
} as const;
export type Alvo = keyof typeof ALVOS;

const ehAlvo = (valor: string): valor is Alvo => Object.hasOwn(ALVOS, valor);

function alvoDaMaquina(): Alvo {
  const plataforma = process.platform === "win32" ? "win" : process.platform;
  const alvo = `${plataforma}-${process.arch}`;
  if (!ehAlvo(alvo)) throw new Error(`plataforma sem alvo de executável: ${alvo}`);
  return alvo;
}

function versaoNode(): string {
  const pacote = JSON.parse(NodeFS.readFileSync(NodePath.join(RAIZ, "package.json"), "utf-8")) as {
    engines: { node: string };
  };
  return pacote.engines.node;
}

/** Opções comuns ao bundle e ao executável: um chunk, tudo dentro, nenhuma CLI de módulo importado rodando. */
function opcoesBundle(outDir: string) {
  return {
    entry: { [NOME]: ENTRADA },
    cwd: PACOTE,
    config: false,
    outDir,
    platform: "node",
    format: "esm",
    logLevel: "warn",
    report: false,
    deps: { alwaysBundle: () => true, onlyBundle: false },
    // o SEA embute um arquivo só; nada de import() para outro chunk
    outputOptions: { codeSplitting: false },
    // num bundle, todo módulo é o principal: um `if (import.meta.main)` de CLI de pacote que entre no
    // bundle não pode rodar
    define: { "import.meta.main": "false" },
  } as const;
}

/** Imports de pacotes (não internos do Node) num módulo ES: estáticos, dinâmicos, reexportações e `require`. */
export function importsExternos(codigo: string): string[] {
  const especificadores = new Set<string>();
  const visitar = (no: unknown): void => {
    if (!no || typeof no !== "object") return;
    if (Array.isArray(no)) {
      for (const item of no) visitar(item);
      return;
    }
    const n = no as Record<string, any>;
    let origem: unknown;
    if (
      n.type === "ImportDeclaration" ||
      n.type === "ExportAllDeclaration" ||
      (n.type === "ExportNamedDeclaration" && n.source)
    ) {
      origem = n.source?.value;
    } else if (n.type === "ImportExpression") {
      origem = n.source?.type === "Literal" ? n.source.value : "<import dinâmico calculado>";
    } else if (
      n.type === "CallExpression" &&
      n.callee?.type === "Identifier" &&
      /^_*require$/.test(n.callee.name) &&
      n.arguments?.[0]?.type === "Literal"
    ) {
      origem = n.arguments[0].value;
    }
    if (
      typeof origem === "string" &&
      !NodeModule.isBuiltin(origem) &&
      !origem.startsWith("./") &&
      !origem.startsWith("../")
    ) {
      especificadores.add(origem);
    }
    for (const [chave, valor] of Object.entries(n)) {
      if (chave !== "parent") visitar(valor);
    }
  };
  visitar(parseAst(codigo));
  return [...especificadores].sort();
}

/** Gera o bundle num diretório temporário e confere os imports; devolve o caminho do `.mjs`. */
async function conferirBundle(): Promise<string> {
  const temporario = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-mcp-bundle-"));
  await empacotar(opcoesBundle(temporario));
  const arquivos = NodeFS.readdirSync(temporario).filter((nome) => /\.m?js$/.test(nome));
  if (arquivos.length !== 1) throw new Error(`o bundle deveria ter um só chunk; saiu: ${arquivos.join(", ")}`);
  const bundle = NodePath.join(temporario, arquivos[0]!);
  const externos = importsExternos(NodeFS.readFileSync(bundle, "utf-8"));
  if (externos.length) {
    throw new Error(`o bundle importa pacotes que o SEA não resolve: ${externos.join(", ")}`);
  }
  return bundle;
}

/** Assinatura ad hoc no macOS, se a que veio do SEA não for válida (a definitiva é decisão do app). */
function assinarSePreciso(executavel: string): void {
  if (process.platform !== "darwin") return;
  if (NodeChildProcess.spawnSync("codesign", ["--verify", executavel], { stdio: "ignore" }).status === 0) return;
  const assinatura = NodeChildProcess.spawnSync("codesign", ["--sign", "-", "--force", executavel], {
    encoding: "utf-8",
  });
  if (assinatura.status !== 0) throw new Error(`codesign falhou: ${assinatura.stderr}`);
}

async function construir(alvo: Alvo): Promise<string> {
  const nativo = alvo === alvoDaMaquina();
  const versao = versaoNode();
  if (nativo && process.versions.node !== versao) {
    throw new Error(`o executável nativo exige o Node ${versao} (engines.node); este é o ${process.versions.node}`);
  }
  // cada alvo num diretório próprio: o tsdown limpa o diretório do executável a cada build
  const trabalho = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-mcp-exe-"));
  const exeDir = NodePath.join(trabalho, "exe");
  try {
    await empacotar({
      ...opcoesBundle(NodePath.join(trabalho, "bundle")),
      exe: {
        fileName: NOME,
        outDir: exeDir,
        seaConfig: { useCodeCache: false },
        ...(nativo ? {} : { targets: [{ ...ALVOS[alvo], nodeVersion: versao }] }),
      },
    });
    // o nativo sai como `simplifica-mcp`; nos outros, o tsdown acrescenta o alvo (e `.exe` no Windows)
    const gerados = NodeFS.readdirSync(exeDir).filter((arquivo) => arquivo.startsWith(NOME));
    if (gerados.length !== 1) throw new Error(`esperava um executável de ${alvo}; saíram: ${gerados.join(", ")}`);
    NodeFS.mkdirSync(SAIDA, { recursive: true });
    const executavel = NodePath.join(SAIDA, gerados[0]!);
    // cópia, não rename: o diretório temporário pode estar em outro volume
    NodeFS.copyFileSync(NodePath.join(exeDir, gerados[0]!), executavel);
    NodeFS.chmodSync(executavel, 0o755);
    if (alvo.startsWith("darwin")) assinarSePreciso(executavel);
    return executavel;
  } finally {
    NodeFS.rmSync(trabalho, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: { alvo: { type: "string", multiple: true }, todos: { type: "boolean" } },
    allowPositionals: false,
  });
  const pedidos = values.todos ? (Object.keys(ALVOS) as Alvo[]) : (values.alvo ?? [alvoDaMaquina()]);
  for (const alvo of pedidos) {
    if (!ehAlvo(alvo)) throw new Error(`alvo desconhecido: ${alvo} (use ${Object.keys(ALVOS).join(", ")})`);
  }
  const bundle = await conferirBundle();
  console.log(`bundle conferido: só módulos internos do Node (${(NodeFS.statSync(bundle).size / 1024).toFixed(0)} kB)`);
  NodeFS.rmSync(NodePath.dirname(bundle), { recursive: true, force: true });
  for (const alvo of pedidos as Alvo[]) {
    const executavel = await construir(alvo);
    const megabytes = (NodeFS.statSync(executavel).size / 1024 / 1024).toFixed(1);
    console.log(`${alvo}: ${NodePath.relative(RAIZ, executavel)} (${megabytes} MB)`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main();
