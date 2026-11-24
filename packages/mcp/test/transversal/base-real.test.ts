// @effect-diagnostics nodeBuiltinImport:off -- teste: conta as linhas das tabelas do kb.sqlite real pelo node:sqlite
/**
 * As ferramentas umas contra as outras e contra o banco, na base real (`tmp/kb.sqlite`), com a raiz
 * do repositório como pasta de trabalho: o texto integral de `buscar_secoes` é o de `ler_secao`; o
 * `pacote_contexto` do PPC da base e o do mesmo PPC como arquivo `.md` trazem as mesmas fichas,
 * normas, marcos e transições; as contagens de `sobre_a_base` são as linhas das tabelas. Lento e
 * dependente do checkout: roda só com `SIMPLIFICA_SMOKE=1` (`pnpm mcp:smoke`). A camada é a da CLI
 * `kb`: o banco do checkout, recompilado se velho.
 */
import * as NodeSqlite from "node:sqlite";
import { describe, expect, layer } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layers from "@simplifica-if/kb/layers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schema from "effect/Schema";
import { buscarSecoes } from "../../src/ferramentas/buscar-secoes.ts";
import { lerSecao } from "../../src/ferramentas/ler-secao.ts";
import { listarCursos } from "../../src/ferramentas/listar-cursos.ts";
import { pacoteContexto, TETO_PACOTE_CONTEXTO } from "../../src/ferramentas/pacote-contexto.ts";
import { sobreABase } from "../../src/ferramentas/sobre-a-base.ts";
import { layerHandlers } from "../../src/ferramentas/toolkit.ts";
import * as Leitura from "../../src/leitura/Leitura.ts";
import * as PastaTrabalho from "../../src/leitura/PastaTrabalho.ts";
import { type FerramentaTestada, responder, saidaValida } from "../apoio.ts";
import { BANCO_REAL, RAIZ, SMOKE } from "./apoio.ts";

const PPC = "curitiba/tecnico-em-enfermagem/2023";
const ARQUIVO = `base-conhecimento/institucional/ifpr/ppcs/${PPC}.md`;

/** A resposta de uma chamada, conferida no `outputSchema`. */
const chamar = <D extends Schema.Top>(f: FerramentaTestada<D>, args: Record<string, unknown>) =>
  Effect.map(responder(f, args), ({ resposta, texto }) => {
    expect(saidaValida(f, resposta)).toBe(true);
    return { ...resposta, texto };
  });

/** Os handlers sobre o `Leitura` do checkout, como na CLI `kb` (`src/kb.ts`). */
const camadaDoCheckout = layerHandlers.pipe(
  Layer.provide(Leitura.layer({ canal: "dev" })),
  Layer.provide(PastaTrabalho.layer({ pasta: RAIZ })),
  Layer.provide(Layers.layerRepositorio({ raiz: RAIZ })),
  Layer.provide(NodeServices.layer),
);

describe.skipIf(!SMOKE)("as ferramentas na base real", () => {
  layer(camadaDoCheckout, { timeout: "300 seconds", excludeTestServices: true })((it) => {
    it.effect("ler_secao: o texto integral de buscar_secoes, seção a seção", () =>
      Effect.gen(function* () {
        const integral = yield* chamar(buscarSecoes, {
          consulta: "estágio obrigatório",
          ppc: PPC,
          limite: 3,
          integral: true,
        });
        expect(integral.dados.resultados.length).toBeGreaterThan(0);
        for (const r of integral.dados.resultados) {
          expect((yield* chamar(lerSecao, { id: r.id })).dados.secao.texto).toBe(r.texto);
        }
      }),
    );

    it.effect("pacote_contexto: dentro do teto, e o mesmo PPC pela base e pelo arquivo dá o mesmo contexto", () =>
      Effect.gen(function* () {
        for (const tarefa of ["CT-CURR-12", "estagio", "todas"]) {
          const { texto } = yield* chamar(pacoteContexto, { tarefa, ppc: PPC });
          expect(texto.length, tarefa).toBeLessThanOrEqual(TETO_PACOTE_CONTEXTO);
        }
        const daBase = (yield* chamar(pacoteContexto, { tarefa: "CT-CURR-12", ppc: PPC })).dados;
        const doArquivo = (yield* chamar(pacoteContexto, { tarefa: "CT-CURR-12", arquivo: ARQUIVO })).dados;
        for (const parte of ["fichas_ids", "fichas", "normas", "marcos", "vigencia_em", "transicoes"] as const) {
          expect(doArquivo[parte], parte).toEqual(daBase[parte]);
        }
        // cada seção do PPC da base está entre as do arquivo, com as mesmas linhas e o mesmo texto
        const chave = (s: (typeof daBase.secoes)[number]) =>
          [s.id.split("#")[1], s.tipo, s.linha_inicio, s.linha_fim, s.texto].join("\u0000");
        const doArquivoChaves = new Set(doArquivo.secoes.map(chave));
        for (const s of daBase.secoes) expect(doArquivoChaves.has(chave(s))).toBe(true);
      }),
    );

    it.effect("sobre_a_base: contagens = linhas de cada tabela; os campi dos cursos estão na lista", () =>
      Effect.gen(function* () {
        const d = (yield* chamar(sobreABase, {})).dados;
        const db = new NodeSqlite.DatabaseSync(BANCO_REAL, { readOnly: true });
        try {
          for (const [tabela, n] of Object.entries(d.contagens)) {
            const linhas = db.prepare(`SELECT count(*) AS n FROM "${tabela}"`).get() as { n: number };
            expect(n, tabela).toBe(linhas.n);
          }
        } finally {
          db.close();
        }
        expect(Object.keys(d.contagens).length).toBeGreaterThan(10);
        const campi = new Set<string>();
        let cursor: string | undefined;
        do {
          const pagina = yield* chamar(listarCursos, cursor ? { cursor } : {});
          for (const c of pagina.dados.cursos) campi.add(c.campus.id);
          cursor = pagina.pagina?.cursor;
        } while (cursor);
        expect(campi.size).toBeGreaterThan(10);
        for (const campus of campi) expect(d.campi.map((c) => c.id)).toContain(campus);
      }),
    );
  });
});
