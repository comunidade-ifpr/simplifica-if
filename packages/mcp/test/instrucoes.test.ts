/** O módulo gerado das instruções corresponde a `instrucoes.md` (`pnpm mcp:instrucoes --check`). */
import { describe, expect, test } from "vite-plus/test";
import { instrucoesAtualizadas } from "../scripts/gerar-instrucoes.ts";

describe("instruções do servidor", () => {
  test("src/instrucoes.gerado.ts corresponde a instrucoes.md (rode pnpm mcp:instrucoes)", () => {
    expect(instrucoesAtualizadas()).toBe(true);
  });
});
