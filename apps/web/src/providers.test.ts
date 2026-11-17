import { assert, describe, it } from "@effect/vitest";
import { comandoInstalarClaude } from "./components/PassoClaude.tsx";
import { orientacao } from "./providers.ts";

describe("orientacao", () => {
  it("sem operação no app, um texto genérico em português, sem comando", () => {
    const geral = orientacao("antigravity", "entrar");
    assert.match(geral.texto, /^O app ainda não faz o login do Gemini \(Antigravity\)/);
    assert.isUndefined(geral.comando);
  });
});

describe("passo guiado do Claude", () => {
  it("o comando do instalador oficial de cada sistema", () => {
    assert.strictEqual(comandoInstalarClaude(false), "curl -fsSL https://claude.ai/install.sh | bash");
    assert.strictEqual(comandoInstalarClaude(true), "irm https://claude.ai/install.ps1 | iex");
  });
});
