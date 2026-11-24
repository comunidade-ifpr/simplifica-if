// @effect-diagnostics nodeBuiltinImport:off -- monta um kb.sqlite mínimo em memória com node:sqlite
/**
 * Versões de PPC no banco: a referência sem versão (`campus/curso`) vale pelo PPC vigente, a com
 * versão pela versão exata, e as consultas sem PPC olham só os vigentes, salvo `incluirSubstituidos`.
 */
import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ppcsQueCitam, normasCitadasDoPpc } from "./citacoes.ts";
import { Inseridor } from "./compilar.ts";
import * as Conexao from "./conexao.ts";
import { fatosDosPpcs } from "./consultas-fatos.ts";
import { documentoDoPpc, indiceSecoesDoPpc, listarPpcs } from "./consultas-secoes.ts";
import { DDL } from "./esquema.ts";

const CURSO = "campus-a/tecnico-x";

function banco(): NodeSqlite.DatabaseSync {
  const db = new NodeSqlite.DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = new Inseridor(db);
  for (const [versao, vigente] of [
    ["2019", false],
    ["2026", true],
  ] as const) {
    const id = `ppc:${CURSO}/${versao}`;
    const path = `base-conhecimento/institucional/ifpr/ppcs/${CURSO}/${versao}.md`;
    ins.inserir("ppcs", {
      id,
      chave: `${CURSO}/${versao}`,
      chave_curso: CURSO,
      versao,
      vigente: vigente ? 1 : 0,
      substituido_por: vigente ? null : `ppc:${CURSO}/2026`,
      campus_id: "campus-a",
      campus_nome: "Campus A",
      curso_slug: "tecnico-x",
      curso_nome: "Técnico X",
      curso_id: null,
      nivel: "médio",
      taxonomia: "tecnico",
      tipo_oferta: "integrado",
      ano_documento: Number(versao),
      curso_url: null,
      fonte_pdf: null,
      path,
      linhas: 3,
      caracteres: 10,
      proveniencia_json: "null",
    });
    ins.inserir("documentos", { path, texto: `PPC ${versao}\n` });
    ins.inserir("secoes", {
      id: `${CURSO}/${versao}#estagio-1`,
      ppc_id: id,
      tipo: "estagio",
      origem_tipo: null,
      titulo: `Estágio ${versao}`,
      numeracao: null,
      path,
      linha_inicio: 1,
      linha_fim: 2,
      linha_texto: 2,
      texto: "texto",
    });
    ins.inserir("citacoes", {
      ppc_id: id,
      ordem: 0,
      linha: 2,
      trecho: "Lei nº 9.394/1996",
      norma_id: "br/lei/1996/9394",
      dispositivos_json: "[]",
      regra: "teste",
      confianca: 1,
      situacao: "na-base",
      secao_id: null,
      secao_tipo: null,
      papel: "fundamento",
      path,
    });
  }
  return db;
}

describe("versões de PPC no kb.sqlite", () => {
  it.effect("a chave do curso resolve para o vigente; a com versão, para a versão", () =>
    Effect.gen(function* () {
      const indice = (ppc: string) => indiceSecoesDoPpc(ppc).pipe(Effect.map((l) => l.map((s) => s.id)));
      expect(yield* indice(CURSO)).toEqual([`${CURSO}/2026#estagio-1`]);
      expect(yield* indice(`ppc:${CURSO}`)).toEqual([`${CURSO}/2026#estagio-1`]);
      expect(yield* indice(`${CURSO}/2019`)).toEqual([`${CURSO}/2019#estagio-1`]);
      expect(yield* indice(`ppc:${CURSO}/2019`)).toEqual([`${CURSO}/2019#estagio-1`]);
      expect(yield* indice(`${CURSO}/2020`)).toEqual([]);
      expect((yield* documentoDoPpc(CURSO))?.chave).toBe(`${CURSO}/2026`);
      expect((yield* documentoDoPpc(`${CURSO}/2019`))?.chave).toBe(`${CURSO}/2019`);
      expect(yield* normasCitadasDoPpc(`${CURSO}/2019`)).not.toBeNull();
      expect(yield* normasCitadasDoPpc("campus-a/outro")).toBeNull();
    }).pipe(Effect.provide(Conexao.layerDeConexao(banco()))),
  );

  it.effect("sem PPC, só os vigentes; incluirSubstituidos traz os anteriores", () =>
    Effect.gen(function* () {
      const citantes = (incluirSubstituidos: boolean) =>
        ppcsQueCitam("br/lei/1996/9394", { incluirSubstituidos }).pipe(Effect.map((l) => l.map((p) => p.ppc)));
      expect(yield* citantes(false)).toEqual([`${CURSO}/2026`]);
      expect(yield* citantes(true)).toEqual([`${CURSO}/2019`, `${CURSO}/2026`]);

      const fatos = (incluirSubstituidos: boolean) =>
        fatosDosPpcs({ incluirSubstituidos }).pipe(Effect.map((l) => l.map((f) => f.ppc)));
      expect(yield* fatos(false)).toEqual([`ppc:${CURSO}/2026`]);
      expect(yield* fatos(true)).toEqual([`ppc:${CURSO}/2019`, `ppc:${CURSO}/2026`]);

      const listados = yield* listarPpcs();
      expect(listados.map((p) => [p.chave, p.vigente, p.substituido_por])).toEqual([
        [`${CURSO}/2019`, false, `${CURSO}/2026`],
        [`${CURSO}/2026`, true, null],
      ]);
    }).pipe(Effect.provide(Conexao.layerDeConexao(banco()))),
  );
});
