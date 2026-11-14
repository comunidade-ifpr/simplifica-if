/** Frescor do banco (`estadoDoBanco`) sobre uma raiz sintética, sem compilar a base. */
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { estadoDoBanco } from "./banco.ts";
import { compilarBanco } from "./compilar.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, hashConteudo, hashLista } from "./fontes.ts";

const raiz = mkdtempSync(path.join(tmpdir(), "kb-frescor-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

function escrever(relativo: string, conteudo: string, mtime: Date): void {
  const arquivo = path.join(raiz, relativo);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, conteudo);
  utimesSync(arquivo, mtime, mtime);
}

function banco(caminho: string, mtime: Date): void {
  rmSync(caminho, { force: true });
  const arquivos = arquivosFonte(raiz);
  const db = new DatabaseSync(caminho);
  db.exec("CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO meta VALUES (?, ?)");
  ins.run("versao_esquema", String(VERSAO_ESQUEMA));
  ins.run("fontes_sha256", hashConteudo(raiz, arquivos));
  ins.run("fontes_lista_sha256", hashLista(arquivos));
  db.close();
  utimesSync(caminho, mtime, mtime);
}

describe("estadoDoBanco", () => {
  const antes = new Date("2026-01-01T00:00:00Z");
  const depois = new Date("2026-02-01T00:00:00Z");
  const caminho = path.join(raiz, "tmp", "kb.sqlite");
  escrever("base-conhecimento/manifest.json", "[]", antes);
  escrever("dados/institucional/cursos/a/b.json", "{}", antes);
  mkdirSync(path.dirname(caminho), { recursive: true });

  test("ausente", () => {
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "ausente" });
  });

  test("fresco pelo mtime", () => {
    banco(caminho, depois);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "mtime" });
  });

  test("fonte tocada sem mudar o conteúdo: fresco pelo hash, e o mtime do banco avança", () => {
    banco(caminho, depois);
    const tocada = new Date("2026-03-01T00:00:00Z");
    escrever("dados/institucional/cursos/a/b.json", "{}", tocada);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "conteudo-igual" });
    // o banco avança só até o mtime das fontes lidas antes do hash: uma edição durante o hash fica
    // mais nova que ele e não passa por fresca
    expect(statSync(caminho).mtimeMs).toBe(tocada.getTime());
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "fresco", motivo: "mtime" });
  });

  test("conteúdo mudou", () => {
    banco(caminho, depois);
    escrever("dados/institucional/cursos/a/b.json", '{"x": 1}', new Date("2026-04-01T00:00:00Z"));
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "conteudo" });
  });

  test("arquivo novo muda a lista de fontes", () => {
    banco(caminho, new Date("2026-05-01T00:00:00Z"));
    escrever("dados/institucional/cursos/a/c.json", "{}", antes);
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "lista-de-fontes" });
  });

  test("outra versão de esquema", () => {
    banco(caminho, new Date("2026-06-01T00:00:00Z"));
    const db = new DatabaseSync(caminho);
    db.exec("UPDATE meta SET valor = '0' WHERE chave = 'versao_esquema'");
    db.close();
    expect(estadoDoBanco(raiz, caminho)).toEqual({ estado: "velho", motivo: "esquema" });
  });
});

describe("compilarBanco com erro", () => {
  test("remove o temporário e não deixa o banco no destino", () => {
    // raiz sem a base: a carga das normas falha no meio da compilação, com o temporário já criado
    const vazia = mkdtempSync(path.join(tmpdir(), "kb-erro-"));
    try {
      const destino = path.join(vazia, "tmp", "kb.sqlite");
      expect(() => compilarBanco({ raiz: vazia, destino })).toThrow();
      expect(readdirSync(path.dirname(destino))).toEqual([]);
    } finally {
      rmSync(vazia, { recursive: true, force: true });
    }
  });
});
