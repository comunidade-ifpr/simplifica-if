/**
 * Execução de uma pergunta pelo agente real: `claude -p` com cwd na raiz do repositório, só
 * ferramentas de leitura e saída `stream-json`. O resto é negado (`--permission-mode dontAsk`).
 *
 * O agente lê arquivos escolhidos por ele, então o harness não confia na configuração para conter
 * segredos: o processo filho recebe um ambiente mínimo (lista explícita, sem o que os `.env*` do
 * repositório definem) e as regras de `REGRAS_NEGADAS` vão sempre em `--disallowedTools`, qualquer que seja o
 * `config.yaml`.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as interpretarEnv } from "dotenv";
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

/** Chaves definidas nos arquivos `.env*` de `diretorio` (um runtime que os carrega sozinho as põe no process.env). */
export function chavesArquivosEnv(diretorio: string): Set<string> {
  const chaves = new Set<string>();
  let nomes: string[];
  try {
    nomes = readdirSync(diretorio).filter((nome) => /^\.env(?:\.|$)/u.test(nome));
  } catch {
    return chaves;
  }
  for (const nome of nomes) {
    try {
      for (const chave of Object.keys(interpretarEnv(readFileSync(path.join(diretorio, nome))))) chaves.add(chave);
    } catch {
      // arquivo ilegível ou diretório com o mesmo nome: nada a excluir
    }
  }
  return chaves;
}

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
  binario?: string | undefined;
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
  codigo: number | null;
}

export async function executarPergunta(texto: string, cwd: string, opcoes: OpcoesExecucao): Promise<ExecucaoBruta> {
  const binario = opcoes.binario ?? process.env.CLAUDE_BIN ?? "claude";
  const processo = spawn(binario, argumentosClaude(texto, opcoes), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: ambienteClaude(process.env, new Set([...chavesArquivosEnv(cwd), ...chavesArquivosEnv(process.cwd())])),
  });
  const limite = setTimeout(() => processo.kill(), opcoes.config.timeout_s * 1000);
  let saida = "";
  let stderr = "";
  processo.stdout.setEncoding("utf-8").on("data", (parte: string) => (saida += parte));
  processo.stderr.setEncoding("utf-8").on("data", (parte: string) => (stderr += parte));
  const codigo = await new Promise<number | null>((resolve, reject) => {
    processo.once("error", reject);
    processo.once("close", (saidaProcesso) => resolve(saidaProcesso));
  });
  clearTimeout(limite);
  return { execucao: lerStreamJson(saida), saida, stderr, codigo };
}
