// @effect-diagnostics nodeBuiltinImport:off -- monta a raiz sintética e o banco de meta com node:fs e node:sqlite síncronos, como o estadoDoBanco que está sob teste
/** Frescor do banco (`estadoDoBanco`) sobre uma raiz sintética, sem compilar a base; compilação com erro. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it, test } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Compilador from "../Compilador.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, estadoDoBanco, hashConteudo, hashLista } from "./fontes.ts";

const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kb-frescor-"));
afterAll(() => NodeFS.rmSync(raiz, { recursive: true, force: true }));

/** Instante fixo (ms desde a época), dado em ISO. */
const instante = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));

function escrever(relativo: string, conteudo: string, mtime: number): void {
  const arquivo = NodePath.join(raiz, relativo);
  NodeFS.mkdirSync(NodePath.dirname(arquivo), { recursive: true });
  NodeFS.writeFileSync(arquivo, conteudo);
  NodeFS.utimesSync(arquivo, mtime / 1000, mtime / 1000);
}

function banco(caminho: string, mtime: number): void {
  NodeFS.rmSync(caminho, { force: true });
  const arquivos = arquivosFonte(raiz);
  const db = new NodeSqlite.DatabaseSync(caminho);
  db.exec("CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO meta VALUES (?, ?)");
  ins.run("versao_esquema", String(VERSAO_ESQUEMA));
  ins.run("fontes_sha256", hashConteudo(raiz, arquivos));
  ins.run("fontes_lista_sha256", hashLista(arquivos));
  db.close();
  NodeFS.utimesSync(caminho, mtime / 1000, mtime / 1000);
}

describe("estadoDoBanco", () => {
  const antes = instante("2026-01-01T00:00:00Z");
  const depois = instante("2026-02-01T00:00:00Z");
  const caminho = NodePath.join(raiz, "tmp", "kb.sqlite");
  escrever("base-conhecimento/manifest.json", "[]", antes);
  escrever("dados/institucional/cursos/a/b.json", "{}", antes);
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });

  test("ausente", () => {
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "ausente" });
  });

  test("fresco pelo mtime", () => {
    banco(caminho, depois);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "mtime" });
  });

  test("fonte tocada sem mudar o conteúdo: fresco pelo hash, e o mtime do banco avança", () => {
    banco(caminho, depois);
    const tocada = instante("2026-03-01T00:00:00Z");
    escrever("dados/institucional/cursos/a/b.json", "{}", tocada);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "conteudo-igual" });
    // o banco avança só até o mtime das fontes lidas antes do hash: uma edição durante o hash fica
    // mais nova que ele e não passa por fresca
    expect(NodeFS.statSync(caminho).mtimeMs).toBe(tocada);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "mtime" });
  });

  test("conteúdo mudou", () => {
    banco(caminho, depois);
    escrever("dados/institucional/cursos/a/b.json", '{"x": 1}', instante("2026-04-01T00:00:00Z"));
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "conteudo" });
  });

  test("arquivo novo muda a lista de fontes", () => {
    banco(caminho, instante("2026-05-01T00:00:00Z"));
    escrever("dados/institucional/cursos/a/c.json", "{}", antes);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "lista-de-fontes" });
  });

  test("outra versão de esquema", () => {
    banco(caminho, instante("2026-06-01T00:00:00Z"));
    const db = new NodeSqlite.DatabaseSync(caminho);
    db.exec("UPDATE meta SET valor = '0' WHERE chave = 'versao_esquema'");
    db.close();
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "esquema" });
  });
});

describe("Compilador.compilar com erro", () => {
  it.effect("falha com FalhaNaCompilacao, remove o temporário e não deixa o banco no destino", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const compilador = yield* Compilador.Compilador;
      // raiz sem a base: a carga das normas falha no meio da compilação, com o temporário já criado
      const vazia = yield* fs.makeTempDirectoryScoped({ prefix: "kb-erro-" });
      const destino = path.join(vazia, "tmp", "kb.sqlite");
      const erro = yield* Effect.flip(compilador.compilar({ raiz: vazia, destino }));
      expect(Compilador.ehFalhaNaCompilacao(erro)).toBe(true);
      expect(erro).toMatchObject({ _tag: "FalhaNaCompilacao", etapa: "gravacao", destino });
      expect(yield* fs.readDirectory(path.dirname(destino))).toEqual([]);
    }).pipe(Effect.provide(Compilador.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );
});
