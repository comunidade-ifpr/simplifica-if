import { assert, describe, it } from "@effect/vitest";
import { ehNivelClaude, esforcoAcima, esforcoCodex, modelosClaude, modelosCodex } from "../src/modelos.ts";

describe("modelos", () => {
  it("o esforço acima é o próximo nível suportado depois do padrão", () => {
    assert.strictEqual(esforcoAcima("medium", ["low", "medium", "high", "xhigh"]), "high");
    assert.strictEqual(esforcoAcima("medium", ["low", "medium", "xhigh"]), "xhigh");
    assert.strictEqual(esforcoAcima("high", ["low", "medium", "high"]), undefined);
    assert.strictEqual(esforcoAcima("desconhecido", ["low", "high"]), undefined);
  });

  it("o Claude perde a linha default e ganha o xhigh, ou o high sem ele", () => {
    assert.deepStrictEqual(
      modelosClaude([
        { value: "default", resolvedModel: "claude-opus-x", displayName: "Default (recommended)" },
        {
          value: "opus",
          resolvedModel: "claude-opus-x",
          displayName: "Opus",
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        },
        { value: "sonnet", displayName: "Sonnet", supportedEffortLevels: ["low", "medium", "high"] },
        { value: "haiku", displayName: "Haiku" },
      ]),
      [
        { id: "opus", nome: "Opus", padrao: true, esforcoAprofundado: "xhigh" },
        { id: "sonnet", nome: "Sonnet", esforcoAprofundado: "high" },
        { id: "haiku", nome: "Haiku" },
      ],
    );
  });

  it("o Codex perde os modelos ocultos e marca o padrão da conta", () => {
    const base = { hidden: false, isDefault: false, defaultReasoningEffort: "medium" };
    const niveis = (...nomes: ReadonlyArray<string>) => nomes.map((reasoningEffort) => ({ reasoningEffort }));
    assert.deepStrictEqual(
      modelosCodex([
        {
          ...base,
          model: "gpt-a",
          displayName: "GPT A",
          isDefault: true,
          supportedReasoningEfforts: niveis("low", "medium", "high"),
        },
        { ...base, model: "gpt-b", displayName: "GPT B", supportedReasoningEfforts: niveis("medium") },
        { ...base, model: "gpt-c", displayName: "GPT C", hidden: true, supportedReasoningEfforts: niveis("high") },
      ]),
      [
        { id: "gpt-a", nome: "GPT A", padrao: true, esforcoAprofundado: "high" },
        { id: "gpt-b", nome: "GPT B" },
      ],
    );
  });

  it("sem a linha default, ou sem modelo que resolva para ela, o Claude não marca padrão", () => {
    const nomeados = [{ value: "opus", resolvedModel: "claude-opus-x", displayName: "Opus" }];
    assert.deepStrictEqual(modelosClaude(nomeados), [{ id: "opus", nome: "Opus" }]);
    assert.deepStrictEqual(
      modelosClaude([{ value: "default", resolvedModel: "claude-outro", displayName: "Default" }, ...nomeados]),
      [{ id: "opus", nome: "Opus" }],
    );
  });

  it("o Codex recebe o esforço pedido que o modelo anuncia; senão, o padrão do modelo", () => {
    const modelo = {
      model: "gpt-a",
      displayName: "GPT A",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
    };
    assert.strictEqual(esforcoCodex(modelo, "high"), "high");
    assert.strictEqual(esforcoCodex(modelo, undefined), "medium");
    assert.strictEqual(esforcoCodex(modelo, "xhigh"), "medium");
    // Sem o catálogo, o pedido vai como veio e o padrão fica com o Codex.
    assert.strictEqual(esforcoCodex(undefined, "high"), "high");
    assert.strictEqual(esforcoCodex(undefined, undefined), undefined);
  });

  it("só os níveis do Agent SDK passam para o Claude", () => {
    assert.isTrue(ehNivelClaude("xhigh"));
    assert.isFalse(ehNivelClaude("minimal"));
    assert.isFalse(ehNivelClaude(undefined));
  });
});
