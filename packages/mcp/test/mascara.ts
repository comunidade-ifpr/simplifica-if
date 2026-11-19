/**
 * Máscara do gabarito do MCP (`testes-gabarito/mcp.json`): o que depende da impressão digital das
 * fontes do banco, que muda com qualquer mudança no código de `packages/kb/src`. Usada pelo
 * `gabarito.ts --comparar` e pelo teste do `simplifica-mcp consultar`.
 */

/**
 * A versão de desenvolvimento da base (`dev-` e 8 hex) e a impressão da consulta nos cursores de
 * paginação (que inclui a versão); o deslocamento do cursor continua conferido.
 */
export function mascarar(json: string): string {
  return json.replace(/\bdev-[0-9a-f]{8}\b/g, "dev-<fontes>").replace(/\beyJkIjo[A-Za-z0-9_-]+/g, (cursor) => {
    try {
      const { d } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { d: number };
      return `<cursor d=${d}>`;
    } catch {
      return cursor;
    }
  });
}
