import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import * as AcpErrors from "@simplifica-if/effect-acp/errors";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { aplicarEscolha, sondarModelos } from "../src/acp/opcoes-sessao.ts";

/** Os níveis de cada modelo e o padrão dele, como o `agy` 1.5.9 respondeu em 19/11/2026. */
const NIVEIS: Readonly<Record<string, { readonly padrao: string; readonly niveis: ReadonlyArray<string> }>> = {
  neon: { padrao: "high", niveis: ["low", "medium", "high", "xhigh"] },
  argon: { padrao: "high", niveis: ["low", "medium", "high"] },
  // Sem raciocínio: é passando por ele que a sondagem lê o nível próprio dos outros.
  orquestrador: { padrao: "", niveis: [] },
  flash: { padrao: "medium", niveis: ["low", "medium", "high"] },
};

/**
 * Um agente ACP que guarda o modelo e o nível da sessão como o `agy`: ao trocar de modelo, o nível
 * continua se o modelo novo o aceita; senão, vai o padrão do modelo novo.
 */
function agenteDeTeste(
  inicial = { modelo: "neon", nivel: "high" },
  falharEm?: string,
  oferecidos: ReadonlyArray<string> = Object.keys(NIVEIS),
) {
  const estado = { ...inicial };
  const pedidos: Array<readonly [string, string]> = [];
  const opcoes = (): ReadonlyArray<AcpSchema.SessionConfigOption> => [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: estado.modelo,
      options: oferecidos.map((value) => ({ value, name: value.toUpperCase() })),
    },
    ...(NIVEIS[estado.modelo]!.niveis.length === 0
      ? []
      : [
          {
            id: "thought_level",
            name: "Thinking Level",
            category: "thought_level" as const,
            type: "select" as const,
            currentValue: estado.nivel,
            options: NIVEIS[estado.modelo]!.niveis.map((value) => ({ value, name: value })),
          },
        ]),
  ];
  return {
    estado,
    pedidos,
    sessao: () => ({ sessionId: "s1", configOptions: opcoes() }),
    agente: {
      setSessionConfigOption: (pedido: AcpSchema.SetSessionConfigOptionRequest) =>
        Effect.suspend(() => {
          const valor = String(pedido.value);
          pedidos.push([pedido.configId, valor]);
          if (valor === falharEm) return Effect.fail(AcpErrors.AcpRequestError.invalidParams("falha de teste"));
          if (pedido.configId === "model") {
            estado.modelo = valor;
            const novo = NIVEIS[valor]!;
            if (!novo.niveis.includes(estado.nivel)) estado.nivel = novo.padrao;
          } else {
            estado.nivel = valor;
          }
          return Effect.succeed({ configOptions: opcoes() });
        }),
      setSessionModel: () => Effect.die("a API antiga não é usada com configOptions"),
    },
  };
}

describe("opções de sessão ACP", () => {
  it.effect("a sondagem lista os modelos com o padrão, o nível próprio de cada um e o logo acima", () =>
    Effect.gen(function* () {
      const { agente, sessao } = agenteDeTeste();
      assert.deepStrictEqual(yield* sondarModelos(agente, sessao()), [
        { id: "neon", nome: "NEON", padrao: true, esforcoAprofundado: "xhigh" },
        { id: "argon", nome: "ARGON", esforcoNormal: "high" },
        { id: "orquestrador", nome: "ORQUESTRADOR" },
        // Numa sessão nova o Flash herda o `high` do padrão; o nível próprio dele é o `medium`.
        { id: "flash", nome: "FLASH", esforcoNormal: "medium", esforcoAprofundado: "high" },
      ]);
    }),
  );

  it.effect("sem um modelo sem raciocínio, o normal é o nível herdado do padrão", () =>
    Effect.gen(function* () {
      const { agente, sessao } = agenteDeTeste(undefined, undefined, ["neon", "argon", "flash"]);
      assert.deepStrictEqual(yield* sondarModelos(agente, sessao()), [
        { id: "neon", nome: "NEON", padrao: true, esforcoAprofundado: "xhigh" },
        { id: "argon", nome: "ARGON" },
        { id: "flash", nome: "FLASH" },
      ]);
    }),
  );

  it.effect("a ordem dos modelos não muda o resultado: a sondagem volta ao começo antes de cada um", () =>
    Effect.gen(function* () {
      const { agente, sessao, pedidos } = agenteDeTeste();
      yield* sondarModelos(agente, sessao());
      assert.deepStrictEqual(pedidos.slice(0, 3), [
        ["model", "neon"],
        ["thought_level", "high"],
        ["model", "argon"],
      ]);
    }),
  );

  it.effect("sem configOptions, os modelos vêm da API antiga, sem raciocínio", () =>
    Effect.gen(function* () {
      const { agente } = agenteDeTeste();
      const modelos = yield* sondarModelos(agente, {
        sessionId: "s1",
        models: {
          currentModelId: "a",
          availableModels: [
            { modelId: "a", name: "A" },
            { modelId: "b", name: "B" },
          ],
        },
      });
      assert.deepStrictEqual(modelos, [
        { id: "a", nome: "A", padrao: true },
        { id: "b", nome: "B" },
      ]);
    }),
  );

  it.effect("aplica o modelo e, depois, o esforço que o modelo oferece", () =>
    Effect.gen(function* () {
      const { agente, sessao, estado, pedidos } = agenteDeTeste();
      yield* aplicarEscolha(agente, sessao(), { modelo: "flash", esforco: "low" });
      assert.deepStrictEqual(estado, { modelo: "flash", nivel: "low" });
      assert.deepStrictEqual(pedidos, [
        ["model", "flash"],
        ["thought_level", "low"],
      ]);
    }),
  );

  it.effect("sem escolha, não pede nada; o esforço que o modelo não oferece é ignorado", () =>
    Effect.gen(function* () {
      const { agente, sessao, estado, pedidos } = agenteDeTeste();
      yield* aplicarEscolha(agente, sessao(), {});
      yield* aplicarEscolha(agente, sessao(), { modelo: "neon", esforco: "high" });
      assert.deepStrictEqual(pedidos, []);
      yield* aplicarEscolha(agente, sessao(), { modelo: "argon", esforco: "xhigh" });
      assert.deepStrictEqual(estado, { modelo: "argon", nivel: "high" });
    }),
  );

  it.effect("o modelo que o agente não oferece falha antes de qualquer pedido", () =>
    Effect.gen(function* () {
      const { agente, sessao, pedidos } = agenteDeTeste();
      const erro = yield* Effect.flip(aplicarEscolha(agente, sessao(), { modelo: "outro" }));
      assert.strictEqual(erro._tag, "ModeloAcpIndisponivel");
      assert.deepStrictEqual(pedidos, []);
    }),
  );

  it.effect("depois da falha num modelo, ele e os seguintes entram sem raciocínio, sem mais pedidos", () =>
    Effect.gen(function* () {
      const { agente, sessao, pedidos } = agenteDeTeste(undefined, "argon");
      const modelos = yield* sondarModelos(agente, sessao());
      assert.deepStrictEqual(
        modelos.map((modelo) => [modelo.id, modelo.esforcoAprofundado]),
        [
          ["neon", "xhigh"],
          ["argon", undefined],
          ["orquestrador", undefined],
          ["flash", undefined],
        ],
      );
      assert.strictEqual(pedidos.length, 3);
    }),
  );

  it.effect("na retomada, a sessão já vem com o modelo e o nível: nada se pede de novo", () =>
    Effect.gen(function* () {
      const { agente, sessao, pedidos } = agenteDeTeste({ modelo: "flash", nivel: "low" });
      yield* aplicarEscolha(agente, sessao(), { modelo: "flash" });
      yield* aplicarEscolha(agente, sessao(), { modelo: "flash", esforco: "low" });
      assert.deepStrictEqual(pedidos, []);
    }),
  );

  it.effect("o esforço sem modelo vale para o modelo da sessão", () =>
    Effect.gen(function* () {
      const { agente, sessao, estado } = agenteDeTeste();
      yield* aplicarEscolha(agente, sessao(), { esforco: "xhigh" });
      assert.deepStrictEqual(estado, { modelo: "neon", nivel: "xhigh" });
    }),
  );

  it.effect("sem configOptions, o modelo vai pela API antiga", () =>
    Effect.gen(function* () {
      const trocas: Array<string> = [];
      const agente = {
        setSessionConfigOption: () => Effect.die("a sessão não tem configOptions"),
        setSessionModel: (pedido: AcpSchema.SetSessionModelRequest) =>
          Effect.sync(() => {
            trocas.push(pedido.modelId);
            return {};
          }),
      };
      const sessao = {
        sessionId: "s1",
        models: {
          currentModelId: "a",
          availableModels: [
            { modelId: "a", name: "A" },
            { modelId: "b", name: "B" },
          ],
        },
      };
      yield* aplicarEscolha(agente, sessao, { modelo: "a" });
      yield* aplicarEscolha(agente, sessao, { modelo: "b" });
      assert.deepStrictEqual(trocas, ["b"]);
      assert.strictEqual(
        (yield* Effect.flip(aplicarEscolha(agente, sessao, { modelo: "c" })))._tag,
        "ModeloAcpIndisponivel",
      );
    }),
  );
});
