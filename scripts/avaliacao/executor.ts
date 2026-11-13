/**
 * Execução de uma pergunta pelo agente real: `claude -p` com cwd na raiz do repositório, só
 * ferramentas de leitura e saída `stream-json`. O resto é negado (`--permission-mode dontAsk`).
 */
import type { ConfigAvaliacao } from "./esquema.ts";
import { lerStreamJson, type Execucao } from "./stream.ts";

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
  const processo = Bun.spawn([binario, ...argumentosClaude(texto, opcoes)], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const limite = setTimeout(() => processo.kill(), opcoes.config.timeout_s * 1000);
  const [saida, stderr, codigo] = await Promise.all([
    new Response(processo.stdout).text(),
    new Response(processo.stderr).text(),
    processo.exited,
  ]);
  clearTimeout(limite);
  return { execucao: lerStreamJson(saida), saida, stderr, codigo };
}
