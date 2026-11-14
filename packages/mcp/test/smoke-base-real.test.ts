/**
 * Smoke contra a base real: as ferramentas do T3 sobre o `tmp/kb.sqlite` comparadas com a saída JSON
 * da CLI `kb` (que lê os arquivos em `citacoes`, `impacto` e `adequacao-art71`): mesmos IDs, textos e
 * totais. Lento e dependente do checkout; roda só com `SIMPLIFICA_SMOKE=1` e o banco compilado:
 *
 *   bun run kb:compilar && SIMPLIFICA_SMOKE=1 bun test --cwd packages/mcp test/smoke-base-real.test.ts
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { adequacaoArt71 } from "../src/ferramentas/adequacao-art71.ts";
import { buscarSecoes } from "../src/ferramentas/buscar-secoes.ts";
import { citacoesDaNorma } from "../src/ferramentas/citacoes-da-norma.ts";
import { fatosPpc } from "../src/ferramentas/fatos-ppc.ts";
import type { Contexto, Ferramenta } from "../src/ferramentas/ferramenta.ts";
import { fichaCurso } from "../src/ferramentas/ficha-curso.ts";
import { impactoDaNorma } from "../src/ferramentas/impacto-da-norma.ts";
import { lerSecao } from "../src/ferramentas/ler-secao.ts";
import { listarCursos } from "../src/ferramentas/listar-cursos.ts";
import { criarContexto } from "../src/servidor.ts";

const RAIZ = path.resolve(import.meta.dir, "../../..");
const BANCO = path.join(RAIZ, "tmp/kb.sqlite");
const ATIVO = process.env.SIMPLIFICA_SMOKE === "1" && existsSync(BANCO);
const PPC = "curitiba/tecnico-em-enfermagem";
const NORMA = "br/cne-cp/res/2021/1";

/** JSON da CLI, conferido campo a campo nos testes. */
type Json = any;

function kb(...args: string[]): Json {
  const r = Bun.spawnSync(["bun", "run", "packages/kb/src/cli.ts", ...args, "--json"], { cwd: RAIZ });
  if (r.exitCode !== 0) throw new Error(`kb ${args.join(" ")}: ${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString());
}

/** Todas as páginas de uma ferramenta, concatenando a lista de `chave`. */
function paginas<T>(f: Ferramenta, args: Record<string, unknown>, ctx: Contexto, lista: (d: Json) => T[]): T[] {
  const itens: T[] = [];
  let cursor: string | undefined;
  do {
    const { resposta } = f.responder({ ...args, ...(cursor ? { cursor } : {}) }, ctx);
    expect(f.saida.safeParse(resposta).success).toBe(true);
    itens.push(...lista(resposta.dados));
    cursor = resposta.pagina?.cursor;
  } while (cursor);
  return itens;
}

describe.skipIf(!ATIVO)("smoke: ferramentas do T3 × CLI kb na base real", () => {
  const cli: Record<string, Json> = {};
  let ctx: Contexto;

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
    ctx = criarContexto({ banco: BANCO, pastaTrabalho: RAIZ, canal: "dev" });
  }, 300_000);

  test("citacoes_da_norma = kb citacoes (totais, PPCs na ordem, ocorrências de um PPC)", () => {
    const todas = paginas(citacoesDaNorma, { id: NORMA, limite: 50 }, ctx, (d) => d.ppcs);
    const { resposta } = citacoesDaNorma.responder({ id: NORMA }, ctx);
    expect([resposta.dados.total_ppcs, resposta.dados.total_ocorrencias]).toEqual([
      cli.citacoes.total_ppcs,
      cli.citacoes.total_ocorrencias,
    ]);
    expect(resposta.dados.norma.titulo).toBe(cli.citacoes.titulo);
    expect(todas.map((p: Json) => [p.ppc, p.ocorrencias])).toEqual(
      cli.citacoes.ppcs.map((p: Json) => [p.ppc, p.ocorrencias.length]),
    );
    const doPpc = citacoesDaNorma.responder({ id: NORMA, ppc: PPC }, ctx).resposta.dados.ppcs[0]!;
    const esperado = cli.citacoes.ppcs.find((p: Json) => p.ppc === PPC);
    expect((doPpc.ocorrencias as Json[]).map((o) => [o.linha, o.trecho, o.regra, o.confianca, o.dispositivo])).toEqual(
      esperado.ocorrencias.map((o: Json) => [
        o.linha,
        o.trecho,
        o.regra,
        o.confianca,
        o.dispositivoId ? `${NORMA}${o.dispositivoId}` : null,
      ]),
    );
    const art20 = paginas(citacoesDaNorma, { id: `${NORMA}#art20`, limite: 50 }, ctx, (d) => d.ppcs);
    expect(art20.map((p: Json) => p.ppc)).toEqual(cli.citacoesArt20.ppcs.map((p: Json) => p.ppc));
  });

  test("impacto_da_norma = kb impacto (sem os textos das skills que não são fichas)", () => {
    const d = impactoDaNorma.responder({ id: NORMA }, ctx).resposta.dados;
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
      fichas.map((a: Json) => [path.basename(a.arquivo, ".json").toUpperCase(), a.motivos.join(", "), a.dispositivos]),
    );
    expect(d.topicos).toEqual(i.topicos_atingidos);
  });

  test("adequacao_art71 = kb adequacao-art71 (totais; lista de um campus)", () => {
    const d = adequacaoArt71.responder({}, ctx).resposta.dados;
    expect(d.totais).toEqual(cli.adequacao.totais);
    expect(d.criterio).toBe(cli.adequacao.criterio);
    const curitiba = paginas(adequacaoArt71, { campus: "curitiba", limite: 100 }, ctx, (x) => x.cursos);
    expect(curitiba.map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas])).toEqual(
      cli.adequacao.cursos
        .filter((c: Json) => c.curso.startsWith("curso:curitiba/"))
        .map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas]),
    );
  });

  test("buscar_secoes = kb buscar-secoes; ler_secao = texto integral", () => {
    const d = buscarSecoes.responder(
      { consulta: "acompanhamento de egressos", cnct: "tecnico-em-informatica", limite: 8 },
      ctx,
    ).resposta.dados;
    expect(d.resultados.map((r) => [r.id, r.pontuacao, r.trecho, r.fonte.linha_inicio, r.fonte.linha_fim])).toEqual(
      cli.secoes.resultados.map((r: Json) => [r.id, r.pontuacao, r.trecho, r.linha_inicio, r.linha_fim]),
    );
    const integral = buscarSecoes.responder(
      { consulta: "estágio obrigatório", ppc: PPC, limite: 3, integral: true },
      ctx,
    ).resposta.dados;
    expect(integral.resultados.map((r) => [r.id, r.texto])).toEqual(
      cli.secoesIntegral.resultados.map((r: Json) => [r.id, r.texto]),
    );
    for (const r of cli.secoesIntegral.resultados) {
      expect(lerSecao.responder({ id: r.id }, ctx).resposta.dados.secao.texto).toBe(r.texto);
    }
  });

  test("listar_cursos = kb cursos --campus curitiba", () => {
    const cursos = paginas(listarCursos, { campus: "curitiba", limite: 100 }, ctx, (d) => d.cursos);
    expect(cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null])).toEqual(
      cli.cursos.cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null]),
    );
    expect(cursos).toHaveLength(cli.cursos.total);
  });

  test("fatos_ppc = kb ppc-fatos (um PPC; divergências do nível médio)", () => {
    const um = fatosPpc.responder({ ppc: PPC }, ctx).resposta.dados.ppcs[0]!;
    const esperado = cli.fatos.ppcs[0];
    expect(um.fatos.map((f) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.fonte.linha_inicio])).toEqual(
      esperado.fatos.map((f: Json) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.linha]),
    );
    expect(um.cruzamento).toEqual(esperado.cruzamento);
    expect(um.suap?.matrizes.map((m) => m.trecho)).toEqual(esperado.suap.matrizes.map((m: Json) => m.trecho));
    const div = fatosPpc.responder({ divergencias: true, nivel: "médio" }, ctx).resposta.dados;
    expect(div.totais).toEqual(cli.divergencias.totais);
    const todos = paginas(fatosPpc, { divergencias: true, nivel: "médio", limite: 50 }, ctx, (d) => d.ppcs);
    expect(todos.map((p: Json) => [p.ppc, p.cruzamento])).toEqual(
      cli.divergencias.ppcs.map((p: Json) => [p.ppc, p.cruzamento]),
    );
  });

  test("ficha_curso: as partes conferem com kb citacoes, kb ppc-fatos e kb adequacao-art71", () => {
    const d = fichaCurso.responder({ curso: PPC }, ctx).resposta.dados;
    expect(d.fatos?.cruzamento).toEqual(cli.fatos.ppcs[0].cruzamento);
    const adequacao = cli.adequacao.cursos.find((c: Json) => c.curso === `curso:${PPC}`);
    expect(d.adequacao_art71).toEqual({ indicador: adequacao.indicador });
    const daNorma = d.normas_citadas.find((n) => n.id === NORMA)!;
    expect(daNorma.ocorrencias).toBe(cli.citacoes.ppcs.find((p: Json) => p.ppc === PPC).ocorrencias.length);
    // a soma das normas citadas é o total de citações resolvidas do PPC
    const total = d.normas_citadas.reduce((s, n) => s + n.ocorrencias, 0);
    const resolvidas = ctx.db
      .query("SELECT count(*) AS n FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL")
      .get(`ppc:${PPC}`) as { n: number };
    expect(total).toBe(resolvidas.n);
    const curso = cli.cursos.cursos.find((c: Json) => c.id === `curso:${PPC}`);
    expect(d.ofertas.map((o) => o.turno)).toEqual(curso.ofertas.map((o: Json) => o.turno));
    expect(d.cnct?.id).toBe(curso.cnct.id);
  });
});
