/**
 * Chamadas reais aos três providers, com a assinatura do usuário. Só rodam com
 * `SIMPLIFICA_POC_REAL=1` (e `tmp/kb.sqlite` compilado):
 *
 *   SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/motor test real
 *
 * Cada provider recebe a pergunta do CNCT uma vez; o teste confere que o turno termina, que alguma
 * ferramenta `ifpr` foi chamada e que a resposta traz 1.200 horas.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Drivers from "../src/drivers/index.ts";
import * as Motor from "../src/Motor.ts";

const REAL = process.env.SIMPLIFICA_POC_REAL === "1";
const RAIZ = new URL("../../..", import.meta.url).pathname;
const PERGUNTA = "Qual a carga horária mínima do Técnico em Enfermagem no CNCT? Cite a fonte.";

/** A mesma pasta de estado do harness, onde estão a instalação e o login do Antigravity. */
const PASTA_ESTADO =
  process.env.SIMPLIFICA_ESTADO ??
  `${process.env.HOME ?? ""}/${process.platform === "darwin" ? "Library/Application Support/simplifica-if-poc" : ".simplifica-if-poc"}`;

const camada = Motor.layer.pipe(
  Layer.provide(Drivers.layerNode({ ambiente: process.env, pastaEstado: PASTA_ESTADO })),
  Layer.provideMerge(NodeServices.layer),
);

describe.skipIf(!REAL)("providers reais", () => {
  for (const provider of ["claude", "codex", "antigravity"] as const) {
    it.effect(
      `${provider}: pergunta do CNCT com o simplifica-mcp`,
      () =>
        Effect.gen(function* () {
          const motor = yield* Motor.Motor;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const estado = yield* motor.detectar(provider);
          assert.isTrue(estado.autenticado, estado.mensagem);
          const pasta = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-motor-" }));
          const sessao = yield* motor.iniciarSessao({
            provider,
            pastaTrabalho: pasta,
            servidoresMcp: [
              {
                nome: "ifpr",
                comando: process.execPath,
                argumentos: [path.join(RAIZ, "packages/mcp/src/cli.ts"), "--banco", path.join(RAIZ, "tmp/kb.sqlite")],
                preAprovado: true,
              },
            ],
          });
          const eventos = yield* Stream.runCollect(motor.enviarMensagem(sessao, PERGUNTA));
          yield* motor.encerrar(sessao);
          const ferramentas = eventos.flatMap((e) => (e._tag === "FerramentaIniciada" ? [e.nome] : []));
          const texto = eventos.flatMap((e) => (e._tag === "TextoFinal" ? [e.texto] : [])).join("\n");
          assert.isTrue(
            ferramentas.some((nome) => nome.startsWith("ifpr.")),
            ferramentas.join(", "),
          );
          assert.match(texto, /1\.200/);
          assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
        }).pipe(Effect.scoped, Effect.provide(camada)),
      300_000,
    );
  }
});
