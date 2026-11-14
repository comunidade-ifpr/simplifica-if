#!/usr/bin/env node
/**
 * Ponto de entrada do servidor local, como o `bin.ts` e o `binMain.ts` do T3:
 *
 * - `ponte-mcp`: a ponte stdio → HTTP do MCP (`runAcpMcpCliFastPath`, o `acp-mcp-bridge` do T3), que o
 *   `agy` abre a cada sessão. Caminho rápido: carrega só a ponte, sem a CLI do servidor;
 * - o resto: a CLI do servidor (`cli.ts`).
 */
import { SUBCOMANDO_PONTE } from "./constantes.ts";

// T3: apps/server/src/bin.ts (ignoreOutputError)
// Logs go to stdout and stderr, which may be a closed desktop launcher pipe or a log file on
// a full disk. Node emits a failed write as an unhandled stream error that crashes the process
// and skips shutdown, so drop the line instead.
function ignoreOutputError(): void {}
process.stdout.on("error", ignoreOutputError);
process.stderr.on("error", ignoreOutputError);

if (process.argv[2] === SUBCOMANDO_PONTE) {
  const { runAcpMcpCliFastPath } = await import("@simplifica-if/motor/t3/AcpMcpStdioBridge");
  await runAcpMcpCliFastPath("acp-mcp-bridge", process.argv.slice(3));
} else {
  const { executar } = await import("./cli.ts");
  executar();
}
