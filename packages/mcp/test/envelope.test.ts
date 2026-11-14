import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { MetaBase } from "../src/banco.ts";
import {
  codificarCursor,
  ErroEntrada,
  esquemaResposta,
  lerCursor,
  montarBase,
  paginar,
  responder,
} from "../src/envelope.ts";
import { FONTES_SHA256 } from "./fixture.ts";

const META: MetaBase = {
  versao_esquema: 2,
  data_referencia: "2026-11-13",
  fontes_sha256: FONTES_SHA256,
  contagens: {},
  versao: null,
  commit: null,
  canal: null,
};

describe("montarBase", () => {
  test("sem os campos do T0: versão dev, commit nulo, canal da CLI", () => {
    expect(montarBase(META, "beta")).toEqual({
      versao: "dev-ab12cd34",
      commit: null,
      data_referencia: "2026-11-13",
      canal: "beta",
    });
  });

  test("com os campos do T0, a meta prevalece", () => {
    const meta = { ...META, versao: "2026.11.13", commit: "dc6b447", canal: "estavel" as const };
    expect(montarBase(meta, "dev")).toEqual({
      versao: "2026.11.13",
      commit: "dc6b447",
      data_referencia: "2026-11-13",
      canal: "estavel",
    });
  });
});

describe("esquemaResposta", () => {
  const esquema = esquemaResposta(z.strictObject({ n: z.number() }));
  const base = montarBase(META, "dev");

  test("aceita a resposta montada por responder, com e sem página", () => {
    expect(esquema.safeParse(responder(base, { n: 1 })).success).toBe(true);
    const comPagina = responder(base, { n: 1 }, { pagina: { total: 3, devolvidos: 1, cursor: "x" } });
    expect(esquema.safeParse(comPagina).success).toBe(true);
    expect(responder(base, { n: 1 })).not.toHaveProperty("pagina");
  });

  test("recusa aviso de tipo desconhecido e chave a mais", () => {
    const aviso = { tipo: "outro", mensagem: "m" };
    expect(esquema.safeParse({ ...responder(base, { n: 1 }), avisos: [aviso] }).success).toBe(false);
    expect(esquema.safeParse({ ...responder(base, { n: 1 }), extra: 1 }).success).toBe(false);
  });
});

describe("paginação", () => {
  const itens = Array.from({ length: 7 }, (_, i) => i);
  const consulta = { campus: "curitiba", base: "dev-ab12cd34" };

  test("percorre tudo, sem repetir nem pular", () => {
    const vistos: number[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const r = paginar(itens, { limite: 3, cursor, consulta });
      vistos.push(...r.itens);
      expect(r.pagina.total).toBe(7);
      expect(r.pagina.devolvidos).toBe(r.itens.length);
      cursor = r.pagina.cursor;
      paginas += 1;
    } while (cursor);
    expect(vistos).toEqual(itens);
    expect(paginas).toBe(3);
  });

  test("a última página não traz cursor", () => {
    expect(paginar(itens, { limite: 10, consulta }).pagina).toEqual({ total: 7, devolvidos: 7 });
    expect(paginar([], { limite: 10, consulta }).pagina).toEqual({ total: 0, devolvidos: 0 });
  });

  test("o cursor não depende da ordem das chaves da consulta", () => {
    const cursor = codificarCursor(3, { a: 1, b: 2 });
    expect(lerCursor(cursor, { b: 2, a: 1 })).toBe(3);
  });

  test("cursor de outra consulta ou adulterado dá erro de entrada legível", () => {
    const { pagina } = paginar(itens, { limite: 3, consulta });
    expect(() =>
      paginar(itens, { limite: 3, cursor: pagina.cursor, consulta: { ...consulta, campus: "irati" } }),
    ).toThrow(new ErroEntrada("o cursor é de outra consulta: repita a chamada com os mesmos filtros, ou sem cursor"));
    expect(() => paginar(itens, { limite: 3, cursor: "lixo", consulta })).toThrow("cursor inválido");
    expect(() => paginar(itens, { limite: 3, cursor: codificarCursor(99, consulta), consulta })).toThrow(
      "cursor além do fim",
    );
  });
});
