// @effect-diagnostics nodeBuiltinImport:off -- teste: o servidor como processo filho, bancos e diretórios temporários
/**
 * Apoio às suítes transversais (`test/transversal/*.test.ts`):
 *
 * - os bancos: as duas fixtures (`bancosFixture`) e a base real (`BANCO_REAL`, só com `SIMPLIFICA_SMOKE=1`);
 * - as chamadas de cada fonte, tiradas de `AMOSTRAS` (`chamadas`);
 * - a resposta esperada de cada chamada, calculada no próprio processo (`emProcesso`);
 * - uma sessão MCP em stdio com JSON-RPC cru (`sessaoStdio`), que guarda cada linha de resposta como o
 *   servidor a escreveu, para a comparação byte a byte;
 * - o servidor padrão (`servidorPadrao`: o executável de `SIMPLIFICA_MCP_EXE` ou o Node com a CLI) e o
 *   servidor isolado da suíte "sem repositório" (`servidorIsolado`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { conferirBundle } from "../../scripts/construir-executavel.ts";
import { FERRAMENTAS, layerHandlers } from "../../src/ferramentas/toolkit.ts";
import { layerLeituraComPasta } from "../../src/servidor.ts";
import { camadaFerramentas, type FerramentaTestada, mensagemDeErro, responder } from "../apoio.ts";
import { criarBancoFixture, diretorioTemporario } from "../fixture.ts";
import { inserirNormas } from "../fixture-normas.ts";
import { criarBancoFixturePpcs } from "../fixture-ppcs.ts";
import { AMOSTRAS, type Args, type Fixture, type NomeFerramenta } from "./amostras.ts";

export const RAIZ = NodePath.resolve(import.meta.dirname, "../../../..");
export const BANCO_REAL = NodePath.join(RAIZ, "tmp/kb.sqlite");
/** As partes sobre a base real rodam só com `SIMPLIFICA_SMOKE=1` (`pnpm mcp:smoke`). */
export const SMOKE = process.env.SIMPLIFICA_SMOKE === "1";
/** O executável de `pnpm mcp:executavel`, quando a suíte roda contra ele. */
export const EXE = process.env.SIMPLIFICA_MCP_EXE;
const CLI = NodePath.resolve(import.meta.dirname, "../../src/cli.ts");

/** A definição de uma ferramenta pelo nome. */
export function ferramenta(nome: string): FerramentaTestada {
  const f = FERRAMENTAS.find((x) => x.nome === nome);
  if (!f) throw new Error(`ferramenta desconhecida: ${nome}`);
  return f as unknown as FerramentaTestada;
}

/** As duas fixtures, num diretório temporário cada (apague com `limparTemporarios` no `afterAll`). */
export function bancosFixture(): Record<Fixture, string> {
  const normas = criarBancoFixture();
  inserirNormas(normas);
  return { normas, ppcs: criarBancoFixturePpcs() };
}

/** Uma chamada de amostra: a ferramenta, os argumentos e se a entrada é válida. */
export interface Chamada {
  readonly nome: NomeFerramenta;
  readonly args: unknown;
  readonly valida: boolean;
}

/**
 * As chamadas de uma fonte: na fixture `normas` ou `ppcs`, as válidas e as inválidas das ferramentas
 * daquela fixture; na base real (`"real"`), as reais e as inválidas de todas.
 */
export function chamadas(fonte: Fixture | "real"): Chamada[] {
  return (Object.entries(AMOSTRAS) as [NomeFerramenta, (typeof AMOSTRAS)[NomeFerramenta]][]).flatMap(([nome, a]) => {
    if (fonte !== "real" && a.fixture !== fonte) return [];
    const validas = fonte === "real" ? a.reais : a.validas;
    return [
      ...validas.map((args) => ({ nome, args, valida: true })),
      ...a.invalidas.map(([args]) => ({ nome, args, valida: false })),
    ];
  });
}

/** Rótulo curto de uma chamada, para as mensagens de falha. */
export const rotulo = (c: { readonly nome: string; readonly args: unknown }) =>
  `${c.nome} ${JSON.stringify(c.args).slice(0, 120)}`;

/** O `result` do `tools/call`, como a IA o recebe. */
export interface Resultado {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

/** A resposta de uma chamada neste processo, no formato do `tools/call`. */
const umResultado = (c: Chamada) =>
  Effect.gen(function* () {
    const f = ferramenta(c.nome);
    if (!c.valida) {
      const texto = yield* mensagemDeErro(f, c.args);
      const erro: Resultado = { content: [{ type: "text", text: texto }], isError: true };
      return erro;
    }
    const { resposta, texto } = yield* responder(f, c.args);
    const valido: Resultado = { content: [{ type: "text", text: texto }], structuredContent: resposta };
    return valido;
  });

/**
 * Os handlers e o `Leitura` sobre `banco` com a pasta de trabalho `pasta`, no sistema de arquivos do
 * Node, como o servidor os monta (`layerStdio`). Sem pasta (`camadaFerramentas`), `arquivo` é recusado.
 */
export const camadaComPasta = (banco: string, pasta: string) =>
  layerHandlers.pipe(
    Layer.provideMerge(layerLeituraComPasta({ banco, canal: "dev", pastaTrabalho: pasta })),
    Layer.provide(NodeServices.layer),
  );

/**
 * A resposta de cada chamada, calculada neste processo sobre o banco `banco` (com a pasta de trabalho
 * `pasta`, se houver), no formato do `tools/call`.
 */
export function emProcesso(banco: string, lista: ReadonlyArray<Chamada>, pasta?: string): Promise<Resultado[]> {
  const camada = pasta === undefined ? camadaFerramentas(banco) : camadaComPasta(banco, pasta);
  return Effect.runPromise(Effect.forEach(lista, umResultado).pipe(Effect.provide(camada)));
}

/* ================================================================== servidor em stdio */

/** Como iniciar o servidor: comando, argumentos, diretório e ambiente. */
export interface Servidor {
  readonly comando: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Uma sessão inteira: as linhas de resposta como o servidor as escreveu, e o stderr. */
export interface Sessao {
  readonly initialize: string;
  readonly tools: string;
  /** Uma linha por chamada, na ordem das chamadas. */
  readonly respostas: ReadonlyArray<string>;
  readonly stderr: string;
}

/** Ambiente mínimo do filho: sem herdar `SIMPLIFICA_KB` nem o `PATH` com o Node do teste. */
export function ambienteMinimo(casa: string): Record<string, string> {
  // oxlint-disable-next-line simplifica-if/no-global-process-runtime -- teste fora do runtime Effect: o ambiente mínimo do filho depende do sistema
  if (NodeOS.platform() === "win32") {
    const sistema = process.env.SystemRoot ?? "C:\\Windows";
    return { SystemRoot: sistema, PATH: `${sistema}\\System32`, USERPROFILE: casa, HOME: casa };
  }
  return { PATH: "/usr/bin:/bin", HOME: casa };
}

/**
 * Abre o servidor, faz o `initialize`, o `tools/list` e as chamadas (todas enviadas de uma vez; as
 * respostas são casadas pelo `id`) e fecha o processo. Falha se o servidor sair antes de responder.
 */
export function sessaoStdio(servidor: Servidor, lista: ReadonlyArray<Chamada>): Promise<Sessao> {
  const processo = NodeChildProcess.spawn(servidor.comando, [...servidor.args], {
    cwd: servidor.cwd,
    env: { ...servidor.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let resto = "";
  const pendentes = new Map<number, { resolve: (linha: string) => void; reject: (erro: Error) => void }>();
  processo.stderr.setEncoding("utf-8").on("data", (parte: string) => (stderr += parte));
  processo.stdout.setEncoding("utf-8").on("data", (parte: string) => {
    resto += parte;
    for (let fim = resto.indexOf("\n"); fim >= 0; fim = resto.indexOf("\n")) {
      const linha = resto.slice(0, fim);
      resto = resto.slice(fim + 1);
      if (!linha.trim()) continue;
      const id = (JSON.parse(linha) as { id?: number }).id;
      if (id === undefined) continue;
      pendentes.get(id)?.resolve(linha);
      pendentes.delete(id);
    }
  });
  const encerrado = new Promise<void>((resolve) => processo.once("close", () => resolve()));
  const falhar = (motivo: string) => {
    for (const p of pendentes.values()) p.reject(new Error(`${motivo}\nstderr do servidor:\n${stderr}`));
    pendentes.clear();
  };
  processo.once("error", (erro) => falhar(`o servidor não iniciou: ${erro.message}`));
  processo.once("exit", (codigo) => falhar(`o servidor saiu com o código ${codigo} antes de responder`));
  const enviar = (mensagem: object) => processo.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...mensagem })}\n`);
  const pedir = (id: number, method: string, params: object) =>
    new Promise<string>((resolve, reject) => {
      pendentes.set(id, { resolve, reject });
      enviar({ id, method, params });
    });

  return (async () => {
    try {
      const initialize = await pedir(0, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "transversal", version: "0" },
      });
      enviar({ method: "notifications/initialized" });
      const tools = await pedir(1, "tools/list", {});
      const respostas = await Promise.all(
        lista.map((c, i) => pedir(i + 2, "tools/call", { name: c.nome, arguments: c.args })),
      );
      return { initialize, tools, respostas, stderr };
    } finally {
      processo.stdin.end();
      processo.kill();
      await encerrado;
    }
  })();
}

/** O `result` de uma linha de resposta do `tools/call`. */
export function resultado(linha: string): Resultado {
  const mensagem = JSON.parse(linha) as { result?: Resultado; error?: unknown };
  if (!mensagem.result) throw new Error(`resposta sem result: ${linha.slice(0, 300)}`);
  return mensagem.result;
}

/** Forma comparável de um resultado do `tools/call`: erro, texto e `structuredContent`, serializados. */
export const comparavel = (r: Resultado) =>
  JSON.stringify({ isError: r.isError === true, content: r.content, structuredContent: r.structuredContent });

/** O servidor de sempre sobre `banco`: o executável de `SIMPLIFICA_MCP_EXE`, ou o Node com a CLI. */
export function servidorPadrao(banco: string): Servidor {
  const cwd = diretorioTemporario("simplifica-mcp-proc-");
  return {
    comando: EXE ?? process.execPath,
    // na data_referencia, como a consulta no processo do teste, com que se compara
    args: [...(EXE ? [] : [CLI]), "--banco", banco, "--vigencia-na-referencia"],
    cwd,
    env: ambienteMinimo(cwd),
  };
}

/* ================================================================== servidor isolado */

/**
 * Gancho de pré-carga do servidor isolado em Node. O `realpath` em JavaScript do Node (que o
 * `FileSystem` do Effect usa fora do Windows) faz `lstat` de cada diretório acima do caminho, e o
 * modelo de permissões trata isso como leitura fora da pasta; a versão nativa resolve o mesmo caminho
 * sem tocar nos ancestrais. O gancho só troca uma pela outra.
 */
const GANCHO = `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
fs.realpath = fs.realpath.native;
fs.promises.realpath = async (caminho, opcoes) => fs.realpathSync.native(caminho, opcoes);
syncBuiltinESMExports();
`;

/** Como o servidor isolado roda: o executável, ou o bundle no Node com o modelo de permissões. */
export type ModoIsolado = "executavel" | "node-com-permissoes";

/** Arquivos a pôr na pasta isolada, além do `kb.sqlite`: conteúdo, ou `{ link }` para um link simbólico. */
export type ArquivosDaPasta = Readonly<Record<string, string | { readonly link: string }>>;

/** O servidor isolado de `servidorIsolado`. */
export interface ServidorIsolado {
  readonly modo: ModoIsolado;
  readonly preparar: (banco: string, arquivos?: ArquivosDaPasta) => Servidor & { readonly pasta: string };
}

/**
 * O servidor sem o repositório. Cada banco vai, sozinho (ou com os `arquivos` pedidos), para uma pasta
 * vazia (`pasta`), que é o diretório atual, a pasta de trabalho e o `HOME` do servidor, com o `PATH`
 * mínimo.
 *
 * - Com `SIMPLIFICA_MCP_EXE`: o executável, que não precisa de Node nem de `node_modules`.
 * - Sem ele: o bundle de `pnpm mcp:executavel` (um arquivo só, sem import externo) no Node deste
 *   processo, com `--permission`: o servidor só pode ler a pasta do banco, o bundle e o gancho, e não
 *   pode escrever nada nem abrir processos. Qualquer leitura fora disso falha com `ERR_ACCESS_DENIED`.
 */
export async function servidorIsolado(): Promise<ServidorIsolado> {
  const pastaIsolada = (banco: string, arquivos: ArquivosDaPasta) => {
    const pasta = NodeFS.realpathSync(diretorioTemporario("simplifica-mcp-sem-repo-"));
    NodeFS.copyFileSync(banco, NodePath.join(pasta, "kb.sqlite"));
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      const destino = NodePath.join(pasta, nome);
      NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
      if (typeof conteudo === "string") NodeFS.writeFileSync(destino, conteudo);
      else NodeFS.symlinkSync(conteudo.link, destino);
    }
    return pasta;
  };
  if (EXE) {
    return {
      modo: "executavel",
      preparar: (banco, arquivos = {}) => {
        const pasta = pastaIsolada(banco, arquivos);
        return {
          comando: EXE,
          args: ["--banco", "kb.sqlite", "--vigencia-na-referencia"],
          cwd: pasta,
          env: ambienteMinimo(pasta),
          pasta,
        };
      },
    };
  }
  const codigo = NodeFS.realpathSync(diretorioTemporario("simplifica-mcp-bundle-"));
  const gerado = await conferirBundle();
  const bundle = NodePath.join(codigo, NodePath.basename(gerado));
  NodeFS.copyFileSync(gerado, bundle);
  NodeFS.rmSync(NodePath.dirname(gerado), { recursive: true, force: true });
  const gancho = NodePath.join(codigo, "realpath-nativo.mjs");
  NodeFS.writeFileSync(gancho, GANCHO);
  return {
    modo: "node-com-permissoes",
    preparar: (banco, arquivos = {}) => {
      const pasta = pastaIsolada(banco, arquivos);
      return {
        comando: process.execPath,
        args: [
          "--permission",
          `--allow-fs-read=${pasta}`,
          `--allow-fs-read=${bundle}`,
          `--allow-fs-read=${gancho}`,
          `--import=${NodeURL.pathToFileURL(gancho).href}`,
          bundle,
          "--banco",
          "kb.sqlite",
          "--vigencia-na-referencia",
        ],
        cwd: pasta,
        env: ambienteMinimo(pasta),
        pasta,
      };
    },
  };
}

/**
 * O que há na pasta isolada, em caminhos relativos, recursivamente. Fica de fora só o cache que a
 * emulação x86 do Docker no Apple Silicon (Rosetta) grava no `HOME` de qualquer processo emulado
 * (`.cache/rosetta`), que aparece ao reproduzir o job Linux x64 num Mac e não existe no runner.
 */
export function conteudoDaPasta(pasta: string): string[] {
  const rosetta = NodePath.join(".cache", "rosetta");
  return (NodeFS.readdirSync(pasta, { recursive: true }) as string[])
    .filter((nome) => nome !== ".cache" && nome !== rosetta && !nome.startsWith(`${rosetta}${NodePath.sep}`))
    .sort();
}

/** Os argumentos de uma amostra, com o cursor da página. */
export const comCursor = (args: Args, cursor: string | undefined): Args => (cursor ? { ...args, cursor } : args);
