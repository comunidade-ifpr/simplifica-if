#!/usr/bin/env node
/**
 * Ponte stdio → HTTP do MCP (a `acp-mcp-bridge` do T3), para agentes ACP que não anunciam MCP por
 * HTTP, como o `agy` 1.5.9. O driver do Antigravity a passa como servidor stdio, com a URL e o
 * `Authorization` em `T3_ACP_MCP_ENDPOINT` e `T3_ACP_MCP_AUTHORIZATION`, nunca na linha de comando.
 */
import { runAcpMcpCliFastPath } from "../src/t3/AcpMcpStdioBridge.ts";

await runAcpMcpCliFastPath("acp-mcp-bridge", []);
