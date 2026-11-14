/**
 * As conversas órfãs, com o `TestClock`: a conversa do cliente que caiu se encerra no fim da
 * tolerância; a que outro cliente usa antes disso (a interface que recarregou) continua aberta. O
 * `Conversas` de verdade, sobre o motor com drivers falsos e o MCP HTTP do banco de fixture.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import * as Conversas from "../src/Conversas.ts";
import { bancoFixture, diretorioTemporario, layerDriversFalsos, limparTemporarios, type Registro } from "./apoio.ts";

afterAll(limparTemporarios);

const registro: Registro = { configs: [], encerradas: 0 };
const pasta = diretorioTemporario("simplifica-conversas-");
const TOLERANCIA = Conversas.TOLERANCIA_ORFA;

const camada = Conversas.layer().pipe(
  Layer.provideMerge(Motor.layer),
  Layer.provide(McpHttp.layer({ banco: bancoFixture() })),
  Layer.provide(layerDriversFalsos(registro)),
  Layer.provide(NodeServices.layer),
);

/** Avança o relógio e deixa rodar o que acordou (o prazo e o encerramento que ele faz). */
const avancar = (duracao: Duration.Input) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(duracao);
    for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
  });

/** Se a sessão ainda existe no motor (a interrupção falha com `SessaoDesconhecida` depois de encerrada). */
const existe = (sessao: string) =>
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    const saida = yield* Effect.exit(motor.interromper(sessao));
    return !JSON.stringify(saida).includes("SessaoDesconhecida");
  });

layer(camada)("conversas órfãs", (it) => {
  it.effect("a conversa do cliente que caiu se encerra no fim da tolerância, e só ela", () =>
    Effect.gen(function* () {
      const conversas = yield* Conversas.Conversas;
      const orfa = yield* conversas.iniciar(1, { provider: "claude", pastaTrabalho: pasta });
      const deOutro = yield* conversas.iniciar(2, { provider: "claude", pastaTrabalho: pasta });
      const antes = registro.encerradas;

      yield* conversas.clienteSaiu(1);
      yield* avancar(Duration.subtract(TOLERANCIA, Duration.seconds(1)));
      assert.strictEqual(registro.encerradas, antes);
      assert.isTrue(yield* existe(orfa));

      yield* avancar(Duration.seconds(1));
      assert.strictEqual(registro.encerradas, antes + 1);
      assert.isFalse(yield* existe(orfa));
      assert.isTrue(yield* existe(deOutro));
      const encerrar = yield* Effect.flip(conversas.encerrar(orfa));
      assert.strictEqual(encerrar._tag, "SessaoDesconhecida");

      yield* conversas.encerrar(deOutro);
    }),
  );

  it.effect("o cliente que usa a conversa órfã antes do prazo a adota, e o prazo se cancela", () =>
    Effect.gen(function* () {
      const conversas = yield* Conversas.Conversas;
      const sessao = yield* conversas.iniciar(1, { provider: "claude", pastaTrabalho: pasta });
      const antes = registro.encerradas;

      yield* conversas.clienteSaiu(1);
      yield* avancar(Duration.seconds(5));
      // A interface recarregou: o novo cliente (3) usa a conversa.
      yield* conversas.interromper(3, sessao);
      yield* avancar(Duration.times(TOLERANCIA, 3));
      assert.strictEqual(registro.encerradas, antes);
      assert.isTrue(yield* existe(sessao));

      // O cliente antigo não é mais o dono; quando o novo cai, o prazo recomeça.
      yield* conversas.clienteSaiu(1);
      yield* avancar(Duration.times(TOLERANCIA, 2));
      assert.isTrue(yield* existe(sessao));
      yield* conversas.clienteSaiu(3);
      yield* avancar(TOLERANCIA);
      assert.strictEqual(registro.encerradas, antes + 1);
      assert.isFalse(yield* existe(sessao));
    }),
  );
});
