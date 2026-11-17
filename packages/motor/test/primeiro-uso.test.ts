/**
 * O primeiro uso no motor (M1.8): no login do Codex, só a página oficial da OpenAI vai ao navegador, e o
 * fim é em português; o `claude` só conta como instalado se o `--version` é o do Claude Code.
 */
import { assert, describe, it } from "@effect/vitest";
import { versaoClaudeValida } from "../src/drivers/claude.ts";
import { authUrlOficialCodex, fimLoginCodex } from "../src/drivers/codex.ts";

describe("login do Codex", () => {
  it("aceita só https://auth.openai.com", () => {
    assert.isTrue(authUrlOficialCodex("https://auth.openai.com/oauth/authorize?client_id=x&state=y"));
    for (const url of [
      "http://auth.openai.com/oauth/authorize",
      "https://auth.openai.com.exemplo.com/oauth",
      "https://exemplo.com/?https://auth.openai.com",
      "https://user@auth.openai.com/oauth",
      "https://auth.openai.com:8443/oauth",
      "javascript:alert(1)",
      "não é url",
    ]) {
      assert.isFalse(authUrlOficialCodex(url), url);
    }
  });

  it("o erro da CLI fica no detalhe; a frase é em português", () => {
    assert.deepStrictEqual(fimLoginCodex({ success: true }), { fase: "concluido" });
    const falha = fimLoginCodex({ success: false, error: "Login server error: Login was not completed" });
    assert.strictEqual(falha.fase, "falhou");
    assert.match(falha.mensagem ?? "", /^O login não foi concluído/);
    assert.strictEqual(falha.detalhe, "Login server error: Login was not completed");
    assert.isUndefined(fimLoginCodex({ success: false, error: null }).detalhe);
  });
});

describe("executável do Claude", () => {
  it("só conta como Claude Code o que responde ao --version como ele", () => {
    assert.strictEqual(versaoClaudeValida("2.1.30 (Claude Code)"), "2.1.30");
    assert.strictEqual(versaoClaudeValida("2.2.0-beta.1 (Claude Code)\n"), "2.2.0-beta.1");
    for (const linha of ["", "claude 1.0", "2.1.30", "Usage: claude [options]", "x 2.1.30 (Claude Code)"]) {
      assert.isUndefined(versaoClaudeValida(linha), linha);
    }
  });
});
