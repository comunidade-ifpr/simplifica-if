import { assert, describe, it } from "@effect/vitest";
import { orientacao } from "./providers.ts";

describe("orientacao", () => {
  it("Claude: instalador oficial e login com `claude`", () => {
    const instalar = orientacao("claude", "instalar");
    assert.match(instalar.texto, /instalador oficial/);
    assert.strictEqual(instalar.comando, "claude");
    assert.strictEqual(orientacao("claude", "entrar").comando, "claude");
  });

  it("Codex: login com `codex login`", () => {
    assert.strictEqual(orientacao("codex", "entrar").comando, "codex login");
  });

  it("sem orientação própria, um texto genérico em português, sem comando", () => {
    const geral = orientacao("antigravity", "entrar");
    assert.match(geral.texto, /^O app ainda não faz o login do Gemini \(Antigravity\)/);
    assert.isUndefined(geral.comando);
  });
});
