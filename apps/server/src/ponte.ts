/**
 * O comando da ponte stdio → HTTP do MCP (`ponte-mcp`), que o driver do Antigravity passa ao `agy`:
 * este mesmo executável com o subcomando, como o `selfInvocationArgs` do T3 (`acp-mcp-bridge`).
 *
 * - **Desenvolvimento:** `node apps/server/src/bin.ts ponte-mcp` (o Node e o script que rodam agora).
 * - **App empacotado:** o executável do Electron e o bundle do servidor (`<Resources>/servidor/bin.mjs
 *   ponte-mcp`); o driver põe `ELECTRON_RUN_AS_NODE=1` no ambiente da ponte, e o Electron roda como Node.
 * - **Executável único (SEA):** o próprio binário com o subcomando.
 *
 * O caminho do script vem do `argv[1]` do processo, resolvido para absoluto, e não do
 * `import.meta.url`: no bundle, os módulos não ficam onde estavam no repositório.
 */
import * as Effect from "effect/Effect";
import { resolveSelfInvocation, selfInvocationArgs } from "@simplifica-if/motor/t3/nodeRuntime";
import { SUBCOMANDO_PONTE } from "./constantes.ts";

export const comandoPonte = Effect.fn("servidor.comandoPonte")(function* () {
  const invocacao = yield* resolveSelfInvocation();
  return { comando: invocacao.command, argumentos: [...selfInvocationArgs(invocacao, [SUBCOMANDO_PONTE])] };
});
