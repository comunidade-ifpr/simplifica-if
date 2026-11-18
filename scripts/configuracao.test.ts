import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Configuracao from "./configuracao.ts";

/** Lê `nome` com o provedor do arquivo dado e o ambiente `variaveis` (no lugar do processo). */
const ler = (nome: string, arquivo: string, variaveis: Record<string, string>) =>
  Effect.gen(function* () {
    const provedor = yield* Configuracao.provedor(arquivo).pipe(
      Effect.provideService(Configuracao.Ambiente, ConfigProvider.fromEnv({ env: variaveis })),
    );
    const valor = yield* Config.option(Config.Redacted(nome)).parse(provedor);
    return Option.map(valor, Redacted.value);
  });

describe("configuração dos scripts", () => {
  it.effect("o ambiente prevalece; vazio ou ausente no ambiente cai no arquivo, que nunca vai ao process.env", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const arquivo = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "configuracao-" }), ".env.local");
        yield* fs.writeFileString(arquivo, "A=arquivo-a\nB=arquivo-b\nVAZIA=\n");

        expect(yield* ler("A", arquivo, { A: "ambiente-a" })).toEqual(Option.some("ambiente-a"));
        expect(yield* ler("B", arquivo, {})).toEqual(Option.some("arquivo-b"));
        expect(yield* ler("B", arquivo, { B: "" })).toEqual(Option.some("arquivo-b"));
        expect(yield* ler("VAZIA", arquivo, {})).toEqual(Option.none());
        expect(yield* ler("C", arquivo, {})).toEqual(Option.none());
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("o .env.local ausente é o caso comum; o arquivo exigido (--env-file) ausente é erro", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const inexistente = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "configuracao-" }), "nao-existe.env");

        expect(yield* ler("A", inexistente, { A: "ambiente-a" })).toEqual(Option.some("ambiente-a"));
        const erro = yield* Effect.flip(Configuracao.provedor(inexistente, { exigirArquivo: true }));
        expect(erro).toMatchObject({ _tag: "ArquivoEnvIndisponivel", motivo: "ausente", arquivo: inexistente });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
