import { describe, expect, it, test } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ehEntradaInvalida, Resposta } from "../src/contratos.ts";
import { codificarCursor, lerCursor, type MetaEnvelope, montarBase, paginar, responder } from "../src/envelope.ts";
import { OPCOES_ENTRADA } from "../src/validacao.ts";
import { FONTES_SHA256 } from "./fixture.ts";

const META: MetaEnvelope = {
  data_referencia: "2026-11-13",
  fontes_sha256: FONTES_SHA256,
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

describe("Resposta", () => {
  const esquema = Resposta(Schema.Struct({ n: Schema.Finite }));
  const valida = (valor: unknown) => Exit.isSuccess(Schema.decodeUnknownExit(esquema)(valor, OPCOES_ENTRADA));
  const base = montarBase(META, "dev");

  test("aceita a resposta montada por responder, com e sem página", () => {
    expect(valida(responder(base, { n: 1 }))).toBe(true);
    const comPagina = responder(base, { n: 1 }, { pagina: { total: 3, devolvidos: 1, cursor: "x" } });
    expect(valida(comPagina)).toBe(true);
    expect(responder(base, { n: 1 })).not.toHaveProperty("pagina");
  });

  test("recusa aviso de tipo desconhecido e chave a mais", () => {
    const aviso = { tipo: "outro", mensagem: "m" };
    expect(valida({ ...responder(base, { n: 1 }), avisos: [aviso] })).toBe(false);
    expect(valida({ ...responder(base, { n: 1 }), extra: 1 })).toBe(false);
  });
});

describe("paginação", () => {
  const itens = Array.from({ length: 7 }, (_, i) => i);
  const consulta = { campus: "curitiba", base: "dev-ab12cd34" };

  it.effect("percorre tudo, sem repetir nem pular", () =>
    Effect.gen(function* () {
      const vistos: number[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const r = yield* paginar(itens, { limite: 3, cursor, consulta });
        vistos.push(...r.itens);
        expect(r.pagina.total).toBe(7);
        expect(r.pagina.devolvidos).toBe(r.itens.length);
        cursor = r.pagina.cursor;
        paginas += 1;
      } while (cursor);
      expect(vistos).toEqual(itens);
      expect(paginas).toBe(3);
    }),
  );

  it.effect("a última página não traz cursor", () =>
    Effect.gen(function* () {
      expect((yield* paginar(itens, { limite: 10, consulta })).pagina).toEqual({ total: 7, devolvidos: 7 });
      expect((yield* paginar([], { limite: 10, consulta })).pagina).toEqual({ total: 0, devolvidos: 0 });
    }),
  );

  it.effect("o cursor não depende da ordem das chaves da consulta", () =>
    Effect.gen(function* () {
      const cursor = codificarCursor(3, { a: 1, b: 2 });
      expect(yield* lerCursor(cursor, { b: 2, a: 1 })).toBe(3);
    }),
  );

  it.effect("cursor de outra consulta ou adulterado dá erro de entrada legível", () =>
    Effect.gen(function* () {
      const { pagina } = yield* paginar(itens, { limite: 3, consulta });
      const outra = yield* Effect.flip(
        paginar(itens, { limite: 3, cursor: pagina.cursor, consulta: { ...consulta, campus: "irati" } }),
      );
      expect(ehEntradaInvalida(outra)).toBe(true);
      expect(outra.message).toBe("o cursor é de outra consulta: repita a chamada com os mesmos filtros, ou sem cursor");
      expect((yield* Effect.flip(paginar(itens, { limite: 3, cursor: "lixo", consulta }))).message).toContain(
        "cursor inválido",
      );
      expect(
        (yield* Effect.flip(paginar(itens, { limite: 3, cursor: codificarCursor(99, consulta), consulta }))).message,
      ).toContain("cursor além do fim");
    }),
  );
});
