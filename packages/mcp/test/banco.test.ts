import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { abrirBanco, ErroBanco, MENSAGEM_INCOMPATIVEL } from "../src/banco.ts";
import { CONTAGENS, criarBancoFixture, diretorioTemporario, FONTES_SHA256, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

describe("abrirBanco", () => {
  test("lê a meta de um banco de hoje, sem versao, commit nem canal", () => {
    const { db, meta } = abrirBanco(criarBancoFixture());
    try {
      expect(meta).toEqual({
        versao_esquema: VERSAO_ESQUEMA,
        data_referencia: "2026-11-13",
        fontes_sha256: FONTES_SHA256,
        contagens: CONTAGENS,
        versao: null,
        commit: null,
        canal: null,
      });
    } finally {
      db.close();
    }
  });

  test("lê versao, commit e canal quando o banco os tem (passo T0)", () => {
    const caminho = criarBancoFixture({ meta: { versao: "2026.11.13", commit: "dc6b4470abc", canal: "beta" } });
    const { db, meta } = abrirBanco(caminho);
    db.close();
    expect(meta).toMatchObject({ versao: "2026.11.13", commit: "dc6b4470abc", canal: "beta" });
  });

  test("recusa versao_esquema diferente com a mensagem da especificação", () => {
    const caminho = criarBancoFixture({ meta: { versao_esquema: String(VERSAO_ESQUEMA + 1) } });
    expect(() => abrirBanco(caminho)).toThrow(ErroBanco);
    expect(() => abrirBanco(caminho)).toThrow(MENSAGEM_INCOMPATIVEL);
    expect(() => abrirBanco(caminho)).toThrow(`esquema da base: ${VERSAO_ESQUEMA + 1}; esperado: ${VERSAO_ESQUEMA}`);
  });

  test("recusa banco sem versao_esquema", () => {
    expect(() => abrirBanco(criarBancoFixture({ meta: { versao_esquema: null } }))).toThrow(MENSAGEM_INCOMPATIVEL);
  });

  test("recusa meta incompleta ou inválida", () => {
    expect(() => abrirBanco(criarBancoFixture({ meta: { data_referencia: null } }))).toThrow(MENSAGEM_INCOMPATIVEL);
    expect(() => abrirBanco(criarBancoFixture({ meta: { contagens_json: "{" } }))).toThrow("contagens_json");
    expect(() => abrirBanco(criarBancoFixture({ meta: { canal: "nightly" } }))).toThrow(MENSAGEM_INCOMPATIVEL);
  });

  test("recusa arquivo que não é um kb.sqlite", () => {
    const caminho = path.join(diretorioTemporario(), "kb.sqlite");
    writeFileSync(caminho, "não sou um banco\n".repeat(200));
    expect(() => abrirBanco(caminho)).toThrow(MENSAGEM_INCOMPATIVEL);
  });

  test("banco ausente: erro claro, e nenhum arquivo é criado", () => {
    const caminho = path.join(diretorioTemporario(), "nao-existe.sqlite");
    expect(() => abrirBanco(caminho)).toThrow(`kb.sqlite não encontrado: ${caminho}`);
    expect(existsSync(caminho)).toBe(false);
  });

  test("abre só para leitura: escrever falha", () => {
    const { db } = abrirBanco(criarBancoFixture());
    try {
      expect(() => db.exec("INSERT INTO meta (chave, valor) VALUES ('x', 'y')")).toThrow(/readonly/);
      expect(() => db.exec("DELETE FROM campi")).toThrow(/readonly/);
      expect(() => db.exec("CREATE TABLE t (x)")).toThrow(/readonly/);
    } finally {
      db.close();
    }
  });
});
