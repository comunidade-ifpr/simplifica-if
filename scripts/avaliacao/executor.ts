/**
 * Execução de uma pergunta pelo agente real: `claude -p` com cwd na raiz do repositório, só
 * ferramentas de leitura e saída `stream-json`. O resto é negado (`--permission-mode dontAsk`).
 *
 * O processo sobe pelo `ChildProcessSpawner` do `effect/process`, dentro de um escopo: passado o
 * prazo (`timeout_s`), ele é morto e a saída parcial fica no registro; se a execução for
 * interrompida (Ctrl-C no `avaliar.ts`), o fechamento do escopo mata o processo filho.
 *
 * O agente lê arquivos escolhidos por ele, então o harness não confia na configuração para conter
 * segredos: o processo filho recebe um ambiente mínimo (lista explícita, sem o que os `.env*` do
 * repositório definem) e as regras de `REGRAS_NEGADAS` vão sempre em `--disallowedTools`, qualquer que seja o
 * `config.yaml`.
 */
import { parse as interpretarEnv } from "dotenv";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type { ConfigAvaliacao } from "./esquema.ts";
import { lerStreamJson, type Execucao } from "./stream.ts";

/**
 * Variáveis que o `claude` precisa para rodar e autenticar. Na assinatura (macOS), a credencial fica
 * no Keychain e basta `HOME`/`USER`; com chave de API ou token, valem `ANTHROPIC_API_KEY` ou
 * `CLAUDE_CODE_OAUTH_TOKEN`, que só passam quando vêm do shell, não de um `.env*` do repositório.
 */
export const VARIAVEIS_AMBIENTE_CLAUDE = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "XDG_CONFIG_HOME",
  "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
] as const;

/**
 * Negadas sempre (`--disallowedTools`; negar prevalece sobre pré-aprovar). Bash fica de fora: um
 * `jq -R . .env.local` ou `jq -n env` contorna as regras de leitura, e um `node --env-file` no
 * subprocesso leria o `.env.local`. As regras de Read valem também para Grep e Glob.
 */
export const REGRAS_NEGADAS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Read(./.env*)",
  "Read(./**/.env*)",
  "Read(~/.ssh/**)",
  "Read(~/.aws/**)",
  "Read(~/.gnupg/**)",
  "Read(~/.config/**)",
  "Read(~/.claude/**)",
  "Read(~/.claude.json)",
  "Read(~/.netrc)",
  "Read(~/.npmrc)",
  "Read(//etc/**)",
] as const;

/**
 * Chaves definidas nos arquivos `.env*` de `diretorio` (um runtime que os carrega sozinho as põe no
 * process.env). Diretório ausente ou arquivo ilegível: nada a excluir.
 */
export const chavesArquivosEnv = Effect.fn("Avaliacao.chavesArquivosEnv")(function* (diretorio: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const chaves = new Set<string>();
  const nomes = yield* fs.readDirectory(diretorio).pipe(
    Effect.map((todos) => todos.filter((nome) => /^\.env(?:\.|$)/u.test(nome)).sort()),
    Effect.catchTags({ PlatformError: () => Effect.succeed([] as string[]) }),
  );
  for (const nome of nomes) {
    const conteudo = yield* fs.readFile(path.join(diretorio, nome)).pipe(
      Effect.asSome,
      // diretório com o mesmo nome ou arquivo ilegível: nada a excluir
      Effect.catchTags({ PlatformError: () => Effect.succeed(Option.none<Uint8Array>()) }),
    );
    if (Option.isNone(conteudo)) continue;
    for (const chave of Object.keys(interpretarEnv(Buffer.from(conteudo.value)))) chaves.add(chave);
  }
  return chaves;
});

/**
 * Ambiente do processo filho: só as variáveis de `VARIAVEIS_AMBIENTE_CLAUDE` presentes em `origem`,
 * menos as que algum `.env*` define (um runtime que carrega `.env*` sozinho as põe no process.env; não
 * vêm do shell do usuário).
 */
export function ambienteClaude(
  origem: Record<string, string | undefined>,
  excluir: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const ambiente: Record<string, string> = {};
  for (const nome of VARIAVEIS_AMBIENTE_CLAUDE) {
    const valor = origem[nome];
    if (valor !== undefined && !excluir.has(nome)) ambiente[nome] = valor;
  }
  return ambiente;
}

export interface OpcoesExecucao {
  config: ConfigAvaliacao;
  /** Sobrescreve `config.modelo` (opção `--modelo`). */
  modelo?: string | undefined;
  /** Executável do `claude`; sem ele, `CLAUDE_BIN` do ambiente ou `claude`. */
  binario?: string | undefined;
  /** Ambiente de onde sai o do processo filho (padrão: `process.env`). */
  ambiente?: Record<string, string | undefined> | undefined;
}

export function argumentosClaude(texto: string, opcoes: OpcoesExecucao): string[] {
  const { config } = opcoes;
  const argumentos = [
    "-p",
    texto,
    "--model",
    opcoes.modelo ?? config.modelo,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(config.max_turns),
    "--tools",
    config.ferramentas.join(","),
    "--allowedTools",
    ...config.ferramentas_permitidas,
    "--disallowedTools",
    ...REGRAS_NEGADAS,
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  if (config.max_budget_usd_por_execucao !== undefined) {
    argumentos.push("--max-budget-usd", String(config.max_budget_usd_por_execucao));
  }
  if (config.fontes_configuracao) {
    argumentos.push("--setting-sources", config.fontes_configuracao.join(","));
  }
  if (config.instrucao_sistema.trim() !== "") {
    argumentos.push("--append-system-prompt", config.instrucao_sistema.trim());
  }
  return argumentos;
}

/** Linha de comando legível (para `--dry-run`), com aspas simples onde precisa. */
export function comandoLegivel(binario: string, argumentos: readonly string[]): string {
  const citar = (valor: string) => (/^[\w@%+=:,./-]+$/u.test(valor) ? valor : `'${valor.replace(/'/gu, `'\\''`)}'`);
  return [binario, ...argumentos].map(citar).join(" ");
}

export interface ExecucaoBruta {
  execucao: Execucao;
  saida: string;
  stderr: string;
  /** Código de saída; `null` quando o processo foi morto (prazo esgotado ou sinal). */
  codigo: number | null;
}

/** Depois do SIGTERM (prazo ou interrupção), quanto esperar antes do SIGKILL. */
export const ESPERA_ATE_SIGKILL = Duration.seconds(5);

/** O `claude` não subiu ou a leitura da saída dele falhou (`motivo` é a razão do sistema, como `NotFound`). */
export class FalhaAoExecutarClaude extends Schema.TaggedError<FalhaAoExecutarClaude>()("FalhaAoExecutarClaude", {
  binario: Schema.String,
  motivo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível executar ${this.binario} (${this.motivo})`;
  }
}

export const ehFalhaAoExecutarClaude = Schema.is(FalhaAoExecutarClaude);

const textoDe = (fluxo: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  Stream.mkString(Stream.decodeText(fluxo));

/**
 * Roda `claude -p` com `texto` em `cwd` e devolve o stream-json lido, a saída bruta, o stderr e o
 * código de saída. Esgotado `config.timeout_s`, o processo é morto e o código fica `null`.
 */
export const executarPergunta = Effect.fn("Avaliacao.executarPergunta")(function* (
  texto: string,
  cwd: string,
  opcoes: OpcoesExecucao,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const origem = opcoes.ambiente ?? process.env;
  const binario = opcoes.binario ?? origem.CLAUDE_BIN ?? "claude";
  const excluir = new Set([...(yield* chavesArquivosEnv(cwd)), ...(yield* chavesArquivosEnv(path.resolve()))]);
  const comando = ChildProcess.make(binario, argumentosClaude(texto, opcoes), {
    cwd,
    env: ambienteClaude(origem, excluir),
    extendEnv: false,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    forceKillAfter: ESPERA_ATE_SIGKILL,
  });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const processo = yield* spawner.spawn(comando);
      const fibraSaida = yield* Effect.forkScoped(textoDe(processo.stdout));
      const fibraStderr = yield* Effect.forkScoped(textoDe(processo.stderr));
      const fim = yield* processo.exitCode.pipe(
        Effect.map((codigo): number | null => codigo),
        // sem código: o processo terminou por sinal
        Effect.catchTags({ PlatformError: () => Effect.succeed(null) }),
        Effect.timeoutOption(Duration.seconds(opcoes.config.timeout_s)),
      );
      if (Option.isNone(fim)) yield* Effect.ignore(processo.kill({ forceKillAfter: ESPERA_ATE_SIGKILL }));
      const saida = yield* Fiber.join(fibraSaida);
      const stderr = yield* Fiber.join(fibraStderr);
      const codigo = Option.isSome(fim) ? fim.value : null;
      return { execucao: lerStreamJson(saida), saida, stderr, codigo } satisfies ExecucaoBruta;
    }),
  ).pipe(
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.fail(new FalhaAoExecutarClaude({ binario, motivo: erro.reason._tag, cause: erro })),
    }),
  );
});
