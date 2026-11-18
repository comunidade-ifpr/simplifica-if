import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { aplicarGerados, mensagensDivergencias } from "./gerados.ts";

/** Pasta temporária com `a.txt` em dia, `b.txt` desatualizado, `c.txt` ausente e `velho.txt` sobrando. */
const preparar = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "gerados-teste-" });
  const pasta = path.join(raiz, "gerada");
  yield* fs.makeDirectory(pasta);
  yield* fs.writeFileString(path.join(pasta, "a.txt"), "a\n");
  yield* fs.writeFileString(path.join(pasta, "b.txt"), "antigo\n");
  yield* fs.writeFileString(path.join(pasta, "velho.txt"), "x");
  yield* fs.writeFileString(path.join(pasta, "outro.md"), "fica");
  yield* fs.writeFileString(path.join(raiz, "legado.txt"), "x");
  const arquivos = [
    { caminho: path.join(pasta, "a.txt"), texto: "a\n" },
    { caminho: path.join(pasta, "b.txt"), texto: "b\n" },
    { caminho: path.join(raiz, "nova", "c.txt"), texto: "c\n" },
  ];
  const opcoes = { raiz, extrasEm: [{ pasta, sufixo: ".txt" }], obsoletos: [path.join(raiz, "legado.txt")] };
  return { fs, path, raiz, pasta, arquivos, opcoes };
});

describe("aplicarGerados", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("conferindo, acusa ausente, desatualizado e sobras sem mudar o disco", () =>
      Effect.gen(function* () {
        const { fs, path, raiz, pasta, arquivos, opcoes } = yield* preparar;
        const divergencias = yield* aplicarGerados(arquivos, { modo: "verificar", ...opcoes });
        expect(mensagensDivergencias(divergencias, "node gerar.ts")).toEqual([
          "gerada/b.txt está desatualizado; rode node gerar.ts",
          "nova/c.txt ausente; rode node gerar.ts",
          "legado.txt não é mais gerado; rode node gerar.ts",
          "gerada/velho.txt não é mais gerado; rode node gerar.ts",
        ]);
        expect(yield* fs.readFileString(path.join(pasta, "b.txt"))).toBe("antigo\n");
        expect(yield* fs.exists(path.join(raiz, "nova"))).toBe(false);
        expect(yield* fs.exists(path.join(pasta, "velho.txt"))).toBe(true);
      }).pipe(Effect.scoped),
    );

    it.effect("gravando, corrige as mesmas divergências e depois não sobra nenhuma", () =>
      Effect.gen(function* () {
        const { fs, path, raiz, pasta, arquivos, opcoes } = yield* preparar;
        const gravadas = yield* aplicarGerados(arquivos, { modo: "gravar", ...opcoes });
        expect(gravadas.map((divergencia) => divergencia.arquivo)).toEqual([
          "gerada/b.txt",
          "nova/c.txt",
          "legado.txt",
          "gerada/velho.txt",
        ]);
        expect(yield* fs.readFileString(path.join(pasta, "b.txt"))).toBe("b\n");
        expect(yield* fs.readFileString(path.join(raiz, "nova", "c.txt"))).toBe("c\n");
        expect((yield* fs.readDirectory(pasta)).sort()).toEqual(["a.txt", "b.txt", "outro.md"]);
        expect(yield* fs.exists(path.join(raiz, "legado.txt"))).toBe(false);
        expect(yield* aplicarGerados(arquivos, { modo: "verificar", ...opcoes })).toEqual([]);
      }).pipe(Effect.scoped),
    );
  });
});
