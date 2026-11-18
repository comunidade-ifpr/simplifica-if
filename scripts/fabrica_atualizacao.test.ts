/**
 * A fábrica sem rede nem chave real: a árvore sai do commit (um repositório git temporário), os
 * comandos `gh` são montados por função pura e só mostrados sem `--executar`, e o par minisign é gerado
 * numa pasta temporária.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import { lerChaveSecreta } from "@simplifica-if/atualizacao/minisign";
import * as Configuracao from "./configuracao.ts";
import {
  arvoreDoCommit,
  comandoFabrica,
  comandosPublicacao,
  comandosPublicacaoApp,
  gerarChave,
  textoComando,
} from "./fabrica_atualizacao.ts";
import * as Git from "./git.ts";

const servicos = Layer.mergeAll(NodeServices.layer, Configuracao.layerAmbiente({ HOME: "/home/falso" }));

const pastaTemporaria = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-fabrica-" });
});

/** Console que guarda o que o programa escreve no stdout. */
const capturarSaida = (saida: string[]) => {
  const ignorar = () => {};
  return Effect.provideService(Console.Console, {
    ...globalThis.console,
    error: ignorar,
    warn: ignorar,
    log: (...partes: ReadonlyArray<unknown>) => saida.push(partes.join(" ")),
  });
};

describe("comandos gh da publicação", () => {
  it("base: release da versão, release do canal (pode já existir) e o manifesto trocado nele", () => {
    const comandos = comandosPublicacao({
      canal: "beta",
      versao: "2026.11.20",
      repositorio: "dono/repo",
      pacotes: ["/f/base.sqlite.zst", "/f/skills.tar.zst"],
      manifesto: ["/f/beta.json", "/f/beta.json.minisig"],
    });
    expect(comandos.map((comando) => textoComando(comando.args))).toEqual([
      '$ gh release create base-2026.11.20 /f/base.sqlite.zst /f/skills.tar.zst --repo dono/repo --title "Base 2026.11.20" --notes "Base de conhecimento 2026.11.20." --latest=false',
      '$ gh release create canal-beta --repo dono/repo --prerelease --latest=false --title "Canal beta" --notes "Manifesto do canal. Não apague: o app procura aqui."',
      "$ gh release upload canal-beta /f/beta.json /f/beta.json.minisig --clobber --repo dono/repo",
    ]);
    expect(comandos.map((comando) => comando.podeJaExistir === true)).toEqual([false, true, false]);
  });

  it("promoção (sem pacotes): não recria o release da versão", () => {
    const comandos = comandosPublicacao({
      canal: "estavel",
      versao: "2026.11.20",
      repositorio: "dono/repo",
      pacotes: [],
      manifesto: ["/f/estavel.json", "/f/estavel.json.minisig"],
    });
    expect(comandos.map((comando) => comando.args.slice(0, 4).join(" "))).toEqual([
      "gh release create canal-estavel",
      "gh release upload canal-estavel",
    ]);
  });

  it("app: instaladores no release app-v<versao> e os yml no release do canal", () => {
    const comandos = comandosPublicacaoApp({
      canal: "beta",
      versao: "0.2.0",
      repositorio: "dono/repo",
      instaladores: ["/p/Simplifica-IF-0.2.0-arm64.dmg"],
      ymls: ["/s/latest-mac.yml"],
    });
    expect(comandos.map((comando) => textoComando(comando.args))).toEqual([
      '$ gh release create app-v0.2.0 /p/Simplifica-IF-0.2.0-arm64.dmg --repo dono/repo --title "Simplifica IF 0.2.0" --notes "Instaladores do app." --latest=false',
      "$ gh release upload canal-beta /s/latest-mac.yml --clobber --repo dono/repo",
    ]);
  });
});

// processo filho e arquivos reais: `it.live`, sem o TestClock
describe("fábrica da atualização", () => {
  it.live("a árvore sai do commit: sem não rastreados, ignorados e mudanças fora do commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const repo = yield* pastaTemporaria;
        const git = (...args: string[]) =>
          Git.executar(["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        yield* git("init", "-q");
        for (const pasta of ["base-conhecimento", "packages/kb", ".agents/skills"]) {
          yield* fs.makeDirectory(path.join(repo, pasta), { recursive: true });
          yield* fs.writeFileString(path.join(repo, pasta, "LEIAME"), "x\n");
        }
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "norma.md"), "texto do commit\n");
        yield* fs.writeFileString(path.join(repo, ".gitignore"), "base-conhecimento/ignorado.md\n");
        yield* git("add", ".");
        yield* git("commit", "-q", "-m", "x");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "norma.md"), "editado no disco\n");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "novo.md"), "não rastreado\n");
        yield* fs.writeFileString(path.join(repo, "base-conhecimento", "ignorado.md"), "ignorado\n");

        const arvore = yield* arvoreDoCommit("HEAD", path.join(yield* pastaTemporaria, "arvore"), repo);

        expect((yield* fs.readDirectory(path.join(arvore, "base-conhecimento"))).sort()).toEqual([
          "LEIAME",
          "norma.md",
        ]);
        expect(yield* fs.readFileString(path.join(arvore, "base-conhecimento", "norma.md"))).toBe("texto do commit\n");
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("publicar sem --executar só mostra os comandos gh, com os pacotes da saída do canal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const raiz = yield* pastaTemporaria;
        const saidaCanal = path.join(raiz, "tmp", "fabrica", "beta-2026.11.20");
        yield* fs.makeDirectory(saidaCanal, { recursive: true });
        for (const nome of ["beta.json", "beta.json.minisig", "base-2026.11.20.sqlite.zst"]) {
          yield* fs.writeFileString(path.join(saidaCanal, nome), "x");
        }
        const saida: string[] = [];
        const executar = (argv: ReadonlyArray<string>) =>
          Command.runWith(comandoFabrica({ raiz, node: "node" }), { version: "teste" })(argv).pipe(
            capturarSaida(saida),
            Effect.exit,
          );

        const exit = yield* executar(["publicar", "--versao", "2026.11.20", "--repositorio", "dono/repo"]);

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(saida).toEqual([
          `$ gh release create base-2026.11.20 ${path.join(saidaCanal, "base-2026.11.20.sqlite.zst")} --repo dono/repo --title "Base 2026.11.20" --notes "Base de conhecimento 2026.11.20." --latest=false`,
          '$ gh release create canal-beta --repo dono/repo --prerelease --latest=false --title "Canal beta" --notes "Manifesto do canal. Não apague: o app procura aqui."',
          `$ gh release upload canal-beta ${path.join(saidaCanal, "beta.json")} ${path.join(saidaCanal, "beta.json.minisig")} --clobber --repo dono/repo`,
          "\n(só mostrei os comandos; rode de novo com --executar para publicar)",
        ]);

        // Repositório inválido e canal sem saída são recusados antes de qualquer comando.
        saida.length = 0;
        expect(Exit.isFailure(yield* executar(["publicar", "--versao", "2026.11.20", "--repositorio", "x"]))).toBe(
          true,
        );
        const semSaida = yield* executar(["publicar", "--versao", "2000.01.01", "--repositorio", "dono/repo"]);
        expect(semSaida).toMatchObject({ _tag: "Failure" });
        expect(saida.filter((linha) => linha.startsWith("$ gh"))).toEqual([]);
      }),
    ).pipe(Effect.provide(servicos)),
  );

  it.live("gerar-chave grava o par fora do repositório e não sobrescreve uma chave existente", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const raiz = yield* pastaTemporaria;
        const pasta = path.join(yield* pastaTemporaria, "chave");
        const saida: string[] = [];

        yield* gerarChave(pasta, raiz).pipe(capturarSaida(saida));

        const secreta = path.join(pasta, "simplifica-fabrica.key");
        expect(((yield* fs.stat(secreta)).mode & 0o777).toString(8)).toBe("600");
        expect(lerChaveSecreta(yield* fs.readFileString(secreta)).chave).toHaveLength(32);
        expect(saida[0]).toBe(`chave secreta: ${secreta} (sem senha)`);
        expect(saida[2]).toBe((yield* fs.readFileString(path.join(pasta, "simplifica-fabrica.pub"))).split("\n")[1]);

        expect(yield* Effect.flip(gerarChave(pasta, raiz))).toMatchObject({
          _tag: "ChaveIndisponivel",
          motivo: "ja-existe",
        });
        expect(yield* Effect.flip(gerarChave(path.join(raiz, "chave"), raiz))).toMatchObject({
          _tag: "ChaveIndisponivel",
          motivo: "dentro-do-repositorio",
        });
      }),
    ).pipe(Effect.provide(servicos)),
  );
});
