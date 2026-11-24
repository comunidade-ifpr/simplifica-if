/**
 * `kb compilar`: compila o `kb.sqlite` a partir dos arquivos do checkout (`pnpm kb:compilar`).
 *
 *   pnpm kb:compilar [--destino tmp/kb.sqlite] [--versao 2026.11.13] [--commit <sha>] [--canal beta]
 *
 * Sem `--destino`, grava em `KB_SQLITE` ou em `<raiz>/tmp/kb.sqlite`. Compila sempre, sem conferir
 * se o banco já está fresco: usa só o `Compilador`, não a layer do repositório.
 */
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as Digest from "effect/crypto/Digest";
import { CAMINHOS, raizRepositorio } from "../caminhos.ts";
import { CANAIS } from "../canal.ts";
import * as Compilador from "../Compilador.ts";
import { executarPrincipal } from "../principal.ts";
import { Checkout, flagTexto, imprimir } from "./comum.ts";

export const compilar = Command.make(
  "compilar",
  {
    destino: flagTexto("destino", "arquivo do banco (padrão: KB_SQLITE ou tmp/kb.sqlite)"),
    versao: flagTexto("versao", "versão do build gravada em meta, como 2026.11.13"),
    commit: flagTexto("commit", "SHA das fontes gravado em meta"),
    canal: Flag.Literals("canal", CANAIS).pipe(
      Flag.withDescription(`canal gravado em meta: ${CANAIS.join(", ")}`),
      Flag.optional,
    ),
  },
  Effect.fn("kb.compilar")(
    function* ({ destino, versao, commit, canal }) {
      const { raiz } = yield* Checkout;
      const compilador = yield* Compilador.Compilador;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const digest = yield* Digest.Digest;
      const configurado = yield* Config.option(Config.String("KB_SQLITE"));
      const arquivo = Option.isSome(destino)
        ? path.resolve(destino.value)
        : Option.isSome(configurado)
          ? path.resolve(configurado.value)
          : path.join(raiz, ...CAMINHOS.banco.split("/"));
      const inicio = yield* Clock.currentTimeMillis;
      const resumo = yield* compilador.compilar({
        raiz,
        destino: arquivo,
        ...(Option.isSome(versao) ? { versao: versao.value } : {}),
        ...(Option.isSome(commit) ? { commit: commit.value } : {}),
        ...(Option.isSome(canal) ? { canal: canal.value } : {}),
      });
      const fim = yield* Clock.currentTimeMillis;
      const bytes = yield* fs.readFile(resumo.destino);
      const sha = yield* digest.digestHex(Digest.sha256, bytes);
      const tamanho = (bytes.byteLength / 1024 / 1024).toFixed(1);
      const relativo = path.relative(path.resolve("."), resumo.destino) || resumo.destino;
      yield* imprimir([
        `${relativo}: ${tamanho} MB em ${((fim - inicio) / 1000).toFixed(1)} s`,
        `sha256 ${sha}`,
        `fontes ${resumo.fontes} (sha256 ${resumo.fontes_sha256.slice(0, 16)}…)`,
        Object.entries(resumo.contagens)
          .map(([tabela, n]) => `${tabela} ${n}`)
          .join(", "),
      ]);
    },
    Effect.provide([Compilador.layer, Digest.layerWebCrypto]),
  ),
).pipe(Command.withDescription("Compila o kb.sqlite a partir dos arquivos do checkout."));

if (import.meta.main) {
  executarPrincipal(
    "kb compilar",
    Command.run(compilar, { version: "0.1.0" }).pipe(Effect.provideService(Checkout, { raiz: raizRepositorio() })),
  );
}
