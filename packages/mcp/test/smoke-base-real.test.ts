// @effect-diagnostics nodeBuiltinImport:off -- teste: confere o kb.sqlite real no disco
/**
 * Smoke contra a base real: as ferramentas do T3 sobre o `tmp/kb.sqlite` comparadas com a saída JSON
 * da CLI `kb` (que lê os arquivos em `citacoes`, `impacto` e `adequacao-art71`): mesmos IDs, textos e
 * totais. Lento e dependente do checkout; roda só com `SIMPLIFICA_SMOKE=1`, como o smoke das normas
 * (`banco-real.test.ts`): `pnpm mcp:smoke` roda os dois. A CLI roda antes de o banco ser aberto
 * aqui, e compila o `tmp/kb.sqlite` se ele faltar ou estiver velho.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { beforeAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { adequacaoArt71 } from "../src/ferramentas/adequacao-art71.ts";
import { buscarSecoes } from "../src/ferramentas/buscar-secoes.ts";
import { citacoesDaNorma } from "../src/ferramentas/citacoes-da-norma.ts";
import { fatosPpc } from "../src/ferramentas/fatos-ppc.ts";
import { fichaCurso } from "../src/ferramentas/ficha-curso.ts";
import { impactoDaNorma } from "../src/ferramentas/impacto-da-norma.ts";
import { lerSecao } from "../src/ferramentas/ler-secao.ts";
import { listarCursos } from "../src/ferramentas/listar-cursos.ts";
import { camadaFerramentas, type FerramentaTestada, responder, saidaValida } from "./apoio.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const BANCO = NodePath.join(RAIZ, "tmp/kb.sqlite");
const ATIVO = process.env.SIMPLIFICA_SMOKE === "1";
const PPC = "curitiba/tecnico-em-enfermagem";
const NORMA = "br/cne-cp/res/2021/1";

/** JSON da CLI, conferido campo a campo nos testes. */
type Json = any;

function kb(...args: string[]): Json {
  const r = NodeChildProcess.spawnSync(process.execPath, ["packages/kb/src/cli.ts", ...args, "--json"], {
    cwd: RAIZ,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`kb ${args.join(" ")}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** A resposta de uma chamada, conferida no `outputSchema`. */
const chamar = <D extends Schema.Top>(f: FerramentaTestada<D>, args: Record<string, unknown>) =>
  Effect.map(responder(f, args), ({ resposta }) => {
    expect(saidaValida(f, resposta)).toBe(true);
    return resposta;
  });

/** Todas as páginas de uma ferramenta, concatenando a lista que `lista` tira dos dados. */
const paginas = <T>(f: FerramentaTestada, args: Record<string, unknown>, lista: (d: Json) => T[]) =>
  Effect.gen(function* () {
    const itens: T[] = [];
    let cursor: string | undefined;
    do {
      const resposta = yield* chamar(f, { ...args, ...(cursor ? { cursor } : {}) });
      itens.push(...lista(resposta.dados));
      cursor = resposta.pagina?.cursor;
    } while (cursor);
    return itens;
  });

/** As ferramentas sobre o banco real (aberto depois de a CLI o recompilar, no `beforeAll`). */
const naBase = <A, E, R>(efeito: Effect.Effect<A, E, R>) => Effect.provide(efeito, camadaFerramentas(BANCO));

describe.skipIf(!ATIVO)("smoke: ferramentas do T3 × CLI kb na base real", () => {
  const cli: Record<string, Json> = {};

  beforeAll(() => {
    // CLI primeiro: ela recompila o banco se estiver velho
    cli.citacoes = kb("citacoes", NORMA);
    cli.citacoesArt20 = kb("citacoes", `${NORMA}#art20`);
    cli.impacto = kb("impacto", NORMA);
    cli.adequacao = kb("adequacao-art71");
    cli.secoes = kb("buscar-secoes", "acompanhamento de egressos", "--cnct", "tecnico-em-informatica", "--limite", "8");
    cli.secoesIntegral = kb("buscar-secoes", "estágio obrigatório", "--ppc", PPC, "--limite", "3", "--integral");
    cli.cursos = kb("cursos", "--campus", "curitiba");
    cli.fatos = kb("ppc-fatos", PPC);
    cli.divergencias = kb("ppc-fatos", "--divergencias", "--nivel", "médio");
  }, 300_000);

  it.effect("citacoes_da_norma = kb citacoes (totais, PPCs na ordem, ocorrências de um PPC)", () =>
    naBase(
      Effect.gen(function* () {
        const todas = yield* paginas(citacoesDaNorma, { id: NORMA, limite: 50 }, (d) => d.ppcs);
        const resposta = yield* chamar(citacoesDaNorma, { id: NORMA });
        expect([resposta.dados.total_ppcs, resposta.dados.total_ocorrencias]).toEqual([
          cli.citacoes.total_ppcs,
          cli.citacoes.total_ocorrencias,
        ]);
        expect(resposta.dados.norma.titulo).toBe(cli.citacoes.titulo);
        expect(todas.map((p: Json) => [p.ppc, p.ocorrencias])).toEqual(
          cli.citacoes.ppcs.map((p: Json) => [p.ppc, p.ocorrencias.length]),
        );
        const doPpc = (yield* chamar(citacoesDaNorma, { id: NORMA, ppc: PPC })).dados.ppcs[0]!;
        const esperado = cli.citacoes.ppcs.find((p: Json) => p.ppc === PPC);
        expect(
          (doPpc.ocorrencias as Json[]).map((o) => [o.linha, o.trecho, o.regra, o.confianca, o.dispositivo]),
        ).toEqual(
          esperado.ocorrencias.map((o: Json) => [
            o.linha,
            o.trecho,
            o.regra,
            o.confianca,
            o.dispositivoId ? `${NORMA}${o.dispositivoId}` : null,
          ]),
        );
        const art20 = yield* paginas(citacoesDaNorma, { id: `${NORMA}#art20`, limite: 50 }, (d) => d.ppcs);
        expect(art20.map((p: Json) => p.ppc)).toEqual(cli.citacoesArt20.ppcs.map((p: Json) => p.ppc));
      }),
    ),
  );

  it.effect("impacto_da_norma = kb impacto (sem os textos das skills que não são fichas)", () =>
    naBase(
      Effect.gen(function* () {
        const d = (yield* chamar(impactoDaNorma, { id: NORMA })).dados;
        const i = cli.impacto;
        expect(d.status).toBe(i.status);
        expect(d.sucessoras).toEqual(i.sucessoras);
        expect(d.transicoes.map((t) => t.id)).toEqual(i.transicoes);
        expect(d.relacoes.map((r) => [r.tipo, r.origem, r.operador, r.alvo, r.alvo_dispositivo])).toEqual(
          i.relacoes.map((r: Json) => [r.tipo, r.origem, r.operador, r.alvo, r.alvo_dispositivo]),
        );
        expect(d.normas_que_citam.map((n) => [n.id, n.dispositivos])).toEqual(
          i.normas_que_citam.map((n: Json) => [n.id, n.dispositivos]),
        );
        expect(d.ppcs.total).toBe(i.ppcs.total);
        expect(d.ppcs.amostra.map((p) => p.ppc)).toEqual(i.ppcs.ids.slice(0, d.ppcs.amostra.length));
        const fichas = i.arquivos.filter((a: Json) => a.categoria === "ficha");
        expect(d.fichas.map((f) => [f.id, f.papel, f.dispositivos])).toEqual(
          fichas.map((a: Json) => [
            NodePath.basename(a.arquivo, ".json").toUpperCase(),
            a.motivos.join(", "),
            a.dispositivos,
          ]),
        );
        expect(d.topicos).toEqual(i.topicos_atingidos);
      }),
    ),
  );

  it.effect("adequacao_art71 = kb adequacao-art71 (totais; lista de um campus)", () =>
    naBase(
      Effect.gen(function* () {
        const d = (yield* chamar(adequacaoArt71, {})).dados;
        expect(d.totais).toEqual(cli.adequacao.totais);
        expect(d.criterio).toBe(cli.adequacao.criterio);
        const curitiba = yield* paginas(adequacaoArt71, { campus: "curitiba", limite: 100 }, (x) => x.cursos);
        expect(curitiba.map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas])).toEqual(
          cli.adequacao.cursos
            .filter((c: Json) => c.curso.startsWith("curso:curitiba/"))
            .map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas]),
        );
      }),
    ),
  );

  it.effect("buscar_secoes = kb buscar-secoes; ler_secao = texto integral", () =>
    naBase(
      Effect.gen(function* () {
        const d = (yield* chamar(buscarSecoes, {
          consulta: "acompanhamento de egressos",
          cnct: "tecnico-em-informatica",
          limite: 8,
        })).dados;
        expect(d.resultados.map((r) => [r.id, r.pontuacao, r.trecho, r.fonte.linha_inicio, r.fonte.linha_fim])).toEqual(
          cli.secoes.resultados.map((r: Json) => [r.id, r.pontuacao, r.trecho, r.linha_inicio, r.linha_fim]),
        );
        const integral = (yield* chamar(buscarSecoes, {
          consulta: "estágio obrigatório",
          ppc: PPC,
          limite: 3,
          integral: true,
        })).dados;
        expect(integral.resultados.map((r) => [r.id, r.texto])).toEqual(
          cli.secoesIntegral.resultados.map((r: Json) => [r.id, r.texto]),
        );
        for (const r of cli.secoesIntegral.resultados) {
          expect((yield* chamar(lerSecao, { id: r.id })).dados.secao.texto).toBe(r.texto);
        }
      }),
    ),
  );

  it.effect("listar_cursos = kb cursos --campus curitiba", () =>
    naBase(
      Effect.gen(function* () {
        const cursos = yield* paginas(listarCursos, { campus: "curitiba", limite: 100 }, (d) => d.cursos);
        expect(cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null])).toEqual(
          cli.cursos.cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null]),
        );
        expect(cursos).toHaveLength(cli.cursos.total);
      }),
    ),
  );

  it.effect("fatos_ppc = kb ppc-fatos (um PPC; divergências do nível médio)", () =>
    naBase(
      Effect.gen(function* () {
        const um = (yield* chamar(fatosPpc, { ppc: PPC })).dados.ppcs[0]!;
        const esperado = cli.fatos.ppcs[0];
        expect(
          um.fatos.map((f) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.fonte.linha_inicio]),
        ).toEqual(esperado.fatos.map((f: Json) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.linha]));
        expect(um.cruzamento).toEqual(esperado.cruzamento);
        expect(um.suap?.matrizes.map((m) => m.trecho)).toEqual(esperado.suap.matrizes.map((m: Json) => m.trecho));
        const div = (yield* chamar(fatosPpc, { divergencias: true, nivel: "médio" })).dados;
        expect(div.totais).toEqual(cli.divergencias.totais);
        const todos = yield* paginas(fatosPpc, { divergencias: true, nivel: "médio", limite: 50 }, (d) => d.ppcs);
        expect(todos.map((p: Json) => [p.ppc, p.cruzamento])).toEqual(
          cli.divergencias.ppcs.map((p: Json) => [p.ppc, p.cruzamento]),
        );
      }),
    ),
  );

  it.effect("ficha_curso: as partes conferem com kb citacoes, kb ppc-fatos e kb adequacao-art71", () =>
    naBase(
      Effect.gen(function* () {
        const d = (yield* chamar(fichaCurso, { curso: PPC })).dados;
        expect(d.fatos?.cruzamento).toEqual(cli.fatos.ppcs[0].cruzamento);
        const adequacao = cli.adequacao.cursos.find((c: Json) => c.curso === `curso:${PPC}`);
        expect(d.adequacao_art71).toEqual({ indicador: adequacao.indicador });
        const daNorma = d.normas_citadas.find((n) => n.id === NORMA)!;
        expect(daNorma.ocorrencias).toBe(cli.citacoes.ppcs.find((p: Json) => p.ppc === PPC).ocorrencias.length);
        // a soma das normas citadas é o total de citações resolvidas do PPC
        const total = d.normas_citadas.reduce((s, n) => s + n.ocorrencias, 0);
        const db = new NodeSqlite.DatabaseSync(BANCO, { readOnly: true });
        const resolvidas = db
          .prepare("SELECT count(*) AS n FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL")
          .get(`ppc:${PPC}`) as { n: number };
        db.close();
        expect(total).toBe(resolvidas.n);
        const curso = cli.cursos.cursos.find((c: Json) => c.id === `curso:${PPC}`);
        expect(d.ofertas.map((o) => o.turno)).toEqual(curso.ofertas.map((o: Json) => o.turno));
        expect(d.cnct?.id).toBe(curso.cnct.id);
      }),
    ),
  );
});
