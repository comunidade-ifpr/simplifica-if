import type { ModeloProvider } from "@simplifica-if/contratos-app";
import { assert, describe, it } from "@effect/vitest";
import { comModelo, comRaciocinio, dicaDoModelo, modeloEfetivo, rotuloDaEscolha } from "./modelos.ts";

const MODELOS: ReadonlyArray<ModeloProvider> = [
  { id: "opus", nome: "Opus", esforcoAprofundado: "xhigh" },
  { id: "sonnet", nome: "Sonnet", padrao: true, esforcoAprofundado: "high" },
  { id: "haiku", nome: "Haiku" },
];

describe("escolha do modelo", () => {
  it("sem escolha vale o padrão da conta", () => {
    assert.strictEqual(modeloEfetivo(MODELOS, undefined)?.id, "sonnet");
    assert.strictEqual(modeloEfetivo(MODELOS, "opus")?.id, "opus");
    assert.strictEqual(modeloEfetivo([{ id: "a", nome: "A" }], undefined), undefined);
  });

  it("o raciocínio aprofundado usa o nível do modelo que vale", () => {
    assert.deepStrictEqual(comRaciocinio({ provider: "claude" }, MODELOS, true), {
      provider: "claude",
      esforco: "high",
    });
    assert.deepStrictEqual(comRaciocinio({ provider: "claude", modelo: "opus" }, MODELOS, true), {
      provider: "claude",
      modelo: "opus",
      esforco: "xhigh",
    });
    assert.deepStrictEqual(comRaciocinio({ provider: "claude", modelo: "opus", esforco: "xhigh" }, MODELOS, false), {
      provider: "claude",
      modelo: "opus",
    });
  });

  it("trocar o modelo acompanha o nível ou volta ao normal", () => {
    const aprofundado = { provider: "claude", modelo: "opus", esforco: "xhigh" } as const;
    assert.deepStrictEqual(comModelo(aprofundado, MODELOS, "sonnet"), {
      provider: "claude",
      modelo: "sonnet",
      esforco: "high",
    });
    assert.deepStrictEqual(comModelo(aprofundado, MODELOS, "haiku"), { provider: "claude", modelo: "haiku" });
    assert.deepStrictEqual(comModelo(aprofundado, MODELOS, undefined), { provider: "claude", esforco: "high" });
    assert.deepStrictEqual(comModelo({ provider: "claude" }, MODELOS, "opus"), { provider: "claude", modelo: "opus" });
  });

  it("o botão mostra o modelo e o raciocínio escolhidos", () => {
    assert.strictEqual(rotuloDaEscolha({ provider: "claude" }, MODELOS), "Sonnet");
    assert.strictEqual(rotuloDaEscolha({ provider: "claude", esforco: "high" }, MODELOS), "Sonnet · Aprofundado");
    assert.strictEqual(rotuloDaEscolha({ provider: "claude" }, [{ id: "a", nome: "A" }]), "Automático");
    assert.strictEqual(rotuloDaEscolha({ provider: "claude", modelo: "opus" }, MODELOS), "Opus");
    assert.strictEqual(
      rotuloDaEscolha({ provider: "claude", modelo: "opus", esforco: "xhigh" }, MODELOS),
      "Opus · Aprofundado",
    );
  });

  it("o padrão da conta é o recomendado; os outros nomes conhecidos ganham observação", () => {
    assert.strictEqual(dicaDoModelo({ id: "sonnet", nome: "Sonnet", padrao: true }), "recomendado");
    assert.strictEqual(dicaDoModelo({ id: "fable", nome: "Fable" }), "o mais capaz, gasta mais do plano");
    assert.strictEqual(dicaDoModelo({ id: "opus", nome: "Opus" }), "tarefas longas e difíceis");
    assert.strictEqual(dicaDoModelo({ id: "mini", nome: "GPT-5 mini" }), "mais rápido");
    assert.strictEqual(dicaDoModelo({ id: "flash", nome: "Gemini 3.8 Flash" }), "mais rápido");
    assert.strictEqual(dicaDoModelo({ id: "gpt", nome: "GPT-5" }), undefined);
  });
});
