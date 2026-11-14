// @effect-diagnostics nodeBuiltinImport:off -- teste: roda a CLI kb como processo filho e lê o kb.sqlite real
/**
 * Casos de paridade (suíte transversal do T6): para cada ferramenta, a comparação com o comando da CLI
 * `kb` em JSON, no mesmo banco (`tmp/kb.sqlite`), com os mesmos IDs, textos e totais; ou o motivo de
 * não haver comando correspondente. Reúne os smokes do T2 (`banco-real.test.ts`) e do T3
 * (`smoke-base-real.test.ts`), agora indexados pelo nome da ferramenta: uma ferramenta nova sem caso
 * aqui quebra o `typecheck` e o `paridade.test.ts`.
 *
 * Alguns comandos da CLI leem os arquivos do repositório (`resolver`, `vigencia`, `relacoes`,
 * `citacoes`, `impacto`, `adequacao-art71`); os demais, o banco. A CLI compila o banco se ele faltar ou
 * estiver velho; `paridade.test.ts` a chama antes de abrir o banco.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { adequacaoArt71 } from "../../src/ferramentas/adequacao-art71.ts";
import { buscarNorma } from "../../src/ferramentas/buscar-norma.ts";
import { buscarSecoes } from "../../src/ferramentas/buscar-secoes.ts";
import { citacoesDaNorma } from "../../src/ferramentas/citacoes-da-norma.ts";
import { correspondencia } from "../../src/ferramentas/correspondencia.ts";
import { fatosPpc } from "../../src/ferramentas/fatos-ppc.ts";
import { fichaCurso } from "../../src/ferramentas/ficha-curso.ts";
import { fichaNorma } from "../../src/ferramentas/ficha-norma.ts";
import { impactoDaNorma } from "../../src/ferramentas/impacto-da-norma.ts";
import { lerDispositivos } from "../../src/ferramentas/ler-dispositivos.ts";
import { lerSecao } from "../../src/ferramentas/ler-secao.ts";
import { listarCursos } from "../../src/ferramentas/listar-cursos.ts";
import { resolverCitacoes } from "../../src/ferramentas/resolver-citacoes.ts";
import { sobreABase } from "../../src/ferramentas/sobre-a-base.ts";
import type * as Layer from "effect/Layer";
import { type camadaFerramentas, type FerramentaTestada, responder, saidaValida } from "../apoio.ts";
import type { NomeFerramenta } from "./amostras.ts";
import { BANCO_REAL, RAIZ } from "./apoio.ts";

const CLI_KB = NodePath.join(RAIZ, "packages/kb/src/cli.ts");
const PPC = "curitiba/tecnico-em-enfermagem";
const NORMA = "br/cne-cp/res/2021/1";

/** JSON da CLI, conferido campo a campo nos casos. */
type Json = any;

/** O que um caso de paridade pede do ambiente: as ferramentas sobre o banco real. */
type Ambiente = Layer.Success<ReturnType<typeof camadaFerramentas>>;

/** Um caso: a descrição e a conferência (as ferramentas sobre o banco real × a CLI). */
export interface CasoParidade {
  readonly descricao: string;
  readonly conferir: () => Effect.Effect<void, Error, Ambiente>;
}

/** Os casos de uma ferramenta, ou o motivo de não haver comando da CLI que lhe corresponda. */
export type Paridade = { readonly casos: ReadonlyArray<CasoParidade> } | { readonly semCli: string };

/* ================================================================== apoio */

const cache = new Map<string, Promise<Json>>();

/** `node packages/kb/src/cli.ts <args> --json`, na raiz do repositório (cada invocação roda uma vez). */
export function kb(...args: string[]): Promise<Json> {
  const chave = JSON.stringify(args);
  let pendente = cache.get(chave);
  if (!pendente) {
    pendente = new Promise((resolve, reject) => {
      const processo = NodeChildProcess.spawn(process.execPath, [CLI_KB, ...args, "--json"], {
        cwd: RAIZ,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      processo.stdout.setEncoding("utf-8").on("data", (parte: string) => (stdout += parte));
      processo.stderr.setEncoding("utf-8").on("data", (parte: string) => (stderr += parte));
      processo.once("error", reject);
      processo.once("close", () => {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`kb ${args.join(" ")}: saída não é JSON\n${stdout.slice(0, 500)}\n${stderr}`));
        }
      });
    });
    cache.set(chave, pendente);
  }
  return pendente;
}

/** `kb(...)` dentro de um Effect. */
const kbE = (...args: string[]) => Effect.promise(() => kb(...args));

/** Várias invocações da CLI em paralelo. */
const kbTodos = (invocacoes: ReadonlyArray<ReadonlyArray<string>>) =>
  Effect.promise(() => Promise.all(invocacoes.map((args) => kb(...args))));

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

const ato = (id: string) => id.split("#")[0]!.replace(/~[a-z]+$/, "");
const sufixo = (id: string) => id.slice(id.indexOf("#"));

/* ================================================================== casos */

export const PARIDADE: { readonly [N in NomeFerramenta]: Paridade } = {
  buscar_norma: {
    casos: [
      {
        descricao: "= kb buscar-norma --limite 8",
        conferir: () =>
          Effect.gen(function* () {
            const consultas = [
              "Resolução CNE/CP nº 1/2021, art. 20",
              "Res. CNE/CP 2/2026, art. 28, inciso VII",
              "LDB, arts. 61 a 63",
              "br/lei/1996/9394#art36",
              "Res. CNE/CP 2/2026, art. 28, XCIX",
              "estágio supervisionado carga horária",
              "acompanhamento de egressos",
              "CNCT",
            ];
            const cli = yield* kbTodos(consultas.map((c) => ["buscar-norma", c, "--limite", "8"]));
            for (const [i, consulta] of consultas.entries()) {
              const esperado = cli[i];
              expect(esperado.total).toBeGreaterThan(0);
              const resposta = yield* chamar(buscarNorma, { consulta });
              expect(resposta.dados.resultados.length).toBe(esperado.total);
              expect(
                resposta.dados.resultados.map((r) => ({
                  norma: [r.norma.id, r.norma.titulo, r.norma.status_vigencia],
                  dispositivo: r.dispositivo
                    ? {
                        id: r.dispositivo.id,
                        caput: r.dispositivo.caput,
                        texto: r.dispositivo.texto,
                        subordinados: r.dispositivo.subordinados.map((s) => [s.id, s.texto]),
                        fonte: [
                          r.dispositivo.fonte.path,
                          r.dispositivo.fonte.linha_inicio,
                          r.dispositivo.fonte.linha_fim,
                        ],
                      }
                    : null,
                  metadados: r.metadados
                    ? [r.metadados.texto, r.metadados.fonte.path, r.metadados.fonte.linha_inicio]
                    : null,
                  pedido: r.citado_fora_do_texto ?? null,
                  origem: r.origem,
                  pontuacao: r.pontuacao,
                })),
              ).toEqual(
                esperado.resultados.map((r: Json) => ({
                  norma: [r.norma.id, r.norma.titulo, r.norma.status_vigencia],
                  dispositivo: r.dispositivo
                    ? {
                        id: r.dispositivo.id,
                        caput: r.dispositivo.caput,
                        texto: r.dispositivo.texto,
                        subordinados: r.dispositivo.subordinados.map((s: Json) => [s.id, s.texto]),
                        fonte: [r.dispositivo.path, r.dispositivo.linha_inicio, r.dispositivo.linha_fim],
                      }
                    : null,
                  metadados: r.metadados ? [r.metadados.texto, r.metadados.path, r.metadados.linha] : null,
                  pedido: r.pedido,
                  origem: r.origem,
                  pontuacao: r.pontuacao,
                })),
              );
            }
          }),
      },
    ],
  },

  ler_dispositivos: {
    casos: [
      {
        descricao: "= kb dispositivo --filhos",
        conferir: () =>
          Effect.gen(function* () {
            const ids = [
              "br/cne-cp/res/2026/2#art71-parunico",
              "br/cne-cp/res/2026/2#art28",
              "br/lei/1996/9394#art24-par1",
              "br/lei/1996/9394#art36",
              "br/lei/1996/9394~compilacao#art26",
              "br/cne-cp/res/2026/2#art999",
            ];
            const cli = yield* kbTodos(ids.map((id) => ["dispositivo", id, "--filhos"]));
            const resposta = yield* chamar(lerDispositivos, { ids, filhos: true });
            expect(resposta.dados.nao_encontrados).toEqual(ids.filter((_, i) => cli[i].encontrado === false));
            const achados = cli.filter((c) => c.encontrado !== false);
            expect(achados.length).toBe(ids.length - 1);
            expect(achados.some((c) => c.filhos.length > 5 && c.notas.length + c.filhos.length > 0)).toBe(true);
            expect(resposta.dados.dispositivos.length).toBe(achados.length);
            resposta.dados.dispositivos.forEach((d, i) => {
              const e = achados[i];
              expect({
                id: d.id,
                rotulo: d.rotulo,
                tipo: d.tipo,
                caput: d.caput,
                texto: d.texto,
                notas: d.notas,
                estrutura: d.estrutura,
                pai: d.pai,
                revogado: d.revogado,
                vetado: d.vetado,
                subordinados: d.subordinados.map((s) => [s.id, s.rotulo, s.texto]),
                fonte: [d.fonte.path, d.fonte.linha_inicio, d.fonte.linha_fim],
              }).toEqual({
                id: `${e.ato}${e.dispositivo}`,
                rotulo: e.rotulo,
                tipo: e.tipo,
                caput: e.caput,
                texto: e.texto,
                notas: e.notas.map((n: Json) => n.texto),
                estrutura: e.estrutura,
                pai: e.pai === null ? null : `${e.ato}${sufixo(e.pai)}`,
                revogado: e.revogado,
                vetado: e.vetado,
                subordinados: e.filhos.map((f: Json) => [`${f.ato}${f.dispositivo}`, f.rotulo, f.texto]),
                fonte: [
                  `base-conhecimento/${e.path}`,
                  e.linha_inicio,
                  Math.max(e.linha_fim, ...e.filhos.map((f: Json) => f.linha_fim)),
                ],
              });
            });
          }),
      },
    ],
  },

  ficha_norma: {
    casos: [
      {
        descricao: "= kb vigencia + kb relacoes + sucessoras de kb impacto, em três datas",
        conferir: () =>
          Effect.gen(function* () {
            const normas = [
              "br/cne-cp/res/2021/1",
              "br/cne-cp/res/2026/2",
              "br/lei/1996/9394",
              "ifpr/consup/res/2025/259",
            ];
            for (const em of [undefined, "2026-11-01", "2030-01-01"]) {
              const data = em ? ["--em", em] : [];
              const vigencias = yield* kbTodos(normas.map((id) => ["vigencia", id, ...data]));
              const relacoes = yield* kbTodos(normas.map((id) => ["relacoes", id]));
              const impactos = yield* kbTodos(normas.map((id) => ["impacto", id, "--sem-ppcs"]));
              for (const [i, id] of normas.entries()) {
                const resposta = yield* chamar(fichaNorma, { id, ...(em ? { em } : {}) });
                const v = vigencias[i];
                const { vigencia, transicoes } = resposta.dados;
                expect([vigencia.data, vigencia.status, vigencia.certo, vigencia.inicio, vigencia.pendencias]).toEqual([
                  v.data,
                  v.status,
                  v.certo,
                  v.inicio,
                  v.pendencias,
                ]);
                expect(
                  vigencia.eventos.map((e) => [e.tipo, e.origem, e.operador, e.efeito_de, e.efeito_minimo, e.ocorreu]),
                ).toEqual(
                  v.eventos.map((e: Json) => [
                    e.tipo,
                    e.origem,
                    e.operador,
                    e.efeito_de,
                    e.efeito_minimo,
                    e.ocorreu === true ? "sim" : e.ocorreu === false ? "não" : "a confirmar",
                  ]),
                );
                expect(
                  transicoes.map((t) => [t.id, t.dispositivo, t.situacao_na_data, t.inicio_em, t.fim_em, t.regra]),
                ).toEqual(
                  v.transicoes.map((t: Json) => [
                    t.id,
                    `${t.norma}${t.dispositivo}`,
                    t.situacao,
                    t.inicio_em,
                    t.fim_em,
                    t.regra,
                  ]),
                );
                if (id === "br/cne-cp/res/2021/1") {
                  expect(v.eventos.length).toBeGreaterThan(0);
                  expect(v.transicoes.length).toBeGreaterThan(0);
                  expect(impactos[i].sucessoras.length).toBeGreaterThan(0);
                }
                if (id === "br/lei/1996/9394") expect(relacoes[i].entrada.length).toBeGreaterThan(5);
                const linha = (r: Json) =>
                  `${r.origem}${r.operador ?? ""} ${r.tipo} ${r.alvo}${r.alvo_dispositivo ?? ""} | ${r.alcance ?? ""} | ${r.evidencia.trecho}`;
                expect(resposta.dados.relacoes.saida.map(linha)).toEqual(relacoes[i].saida.map(linha));
                expect(resposta.dados.relacoes.entrada.map(linha)).toEqual(relacoes[i].entrada.map(linha));
                expect(resposta.dados.sucessoras).toEqual(impactos[i].sucessoras);
                expect(resposta.avisos.filter((a) => a.tipo === "vigencia-a-confirmar").length).toBe(
                  v.pendencias.length,
                );
              }
            }
          }),
      },
    ],
  },

  correspondencia: {
    casos: [
      {
        descricao: "= kb correspondencia (dispositivo e norma inteira, todas as páginas)",
        conferir: () =>
          Effect.gen(function* () {
            const ids = ["br/cne-cp/res/2021/1#art20", "br/cne-cp/res/2021/1#art20-iii", "br/cne-cp/res/2021/1#art6"];
            const projetar = (itens: Json[]) =>
              itens.map((r) => ({
                origem: [r.id, r.texto_origem],
                tipo: r.item.tipo,
                destino: r.textos_destino.map((d: Json) => [d.id, d.texto]),
                herdado: r.herdado_de === null ? null : `${ato(r.id)}${r.herdado_de}`,
                nota: r.item.nota ?? null,
                detalhes: r.detalhes.map((d: Json) => `${ato(r.id)}${d.origem}`),
              }));
            const projetarFerramenta = (itens: readonly Json[]) =>
              itens.map((i) => ({
                origem: [i.origem.id, i.origem.texto],
                tipo: i.tipo,
                destino: i.destino.map((d: Json) => [d.id, d.texto]),
                herdado: i.herdado_de,
                nota: i.nota,
                detalhes: i.detalhes.map((d: Json) => d.origem),
              }));
            const cli = yield* kbTodos([...ids, NORMA].map((id) => ["correspondencia", id]));
            for (const [i, id] of ids.entries()) {
              const resposta = yield* chamar(correspondencia, { id });
              expect(cli[i].length).toBeGreaterThan(0);
              expect(projetarFerramenta(resposta.dados.itens)).toEqual(projetar(cli[i]));
              expect(resposta.dados.tabela?.status).toBe(cli[i][0].status);
            }
            const todos = yield* paginas(correspondencia, { id: NORMA }, (d) => d.itens);
            expect(todos.length).toBeGreaterThan(20);
            expect(projetarFerramenta(todos)).toEqual(projetar(cli[ids.length]));
          }),
      },
    ],
  },

  resolver_citacoes: {
    casos: [
      {
        descricao: "= kb resolver, citação a citação",
        conferir: () =>
          Effect.gen(function* () {
            const citacoes = [
              "Resolução CNE/CP nº 1/2021, art. 20",
              "Res. CNE/CP 2/2026, art. 28, inciso VII",
              "LDB, arts. 61 a 63",
              "Lei 11.788/2008",
              "Resolução CNE/CEB nº 1, de 5 de janeiro de 2021",
              "Resolução CNE/CP nº 1, de 5 de janeiro de 2020",
              "Resolução CONSUP/IFPR nº 55/2011",
              "ABNT NBR 6023",
              "CNCT",
              "texto sem citação",
            ];
            const cli = yield* kbTodos(citacoes.map((c) => ["resolver", c]));
            const resposta = yield* chamar(resolverCitacoes, { citacoes });
            expect(
              resposta.dados.itens.map((i) => [
                i.texto,
                i.id,
                i.dispositivos,
                i.regra,
                i.confianca,
                i.situacao,
                i.titulo,
              ]),
            ).toEqual(
              cli.map((r: Json) => [
                r.texto,
                r.id,
                r.id
                  ? (r.dispositivos ?? (r.dispositivoId ? [r.dispositivoId] : [])).map((d: string) => `${r.id}${d}`)
                  : [],
                r.regra,
                r.confianca,
                r.situacao,
                r.titulo ?? null,
              ]),
            );
          }),
      },
    ],
  },

  citacoes_da_norma: {
    casos: [
      {
        descricao: "= kb citacoes (totais, PPCs na ordem, ocorrências de um PPC, dispositivo)",
        conferir: () =>
          Effect.gen(function* () {
            const [citacoes, citacoesArt20] = yield* kbTodos([
              ["citacoes", NORMA],
              ["citacoes", `${NORMA}#art20`],
            ]);
            const todas = yield* paginas(citacoesDaNorma, { id: NORMA, limite: 50 }, (d) => d.ppcs);
            const resposta = yield* chamar(citacoesDaNorma, { id: NORMA });
            expect([resposta.dados.total_ppcs, resposta.dados.total_ocorrencias]).toEqual([
              citacoes.total_ppcs,
              citacoes.total_ocorrencias,
            ]);
            expect(resposta.dados.norma.titulo).toBe(citacoes.titulo);
            expect(todas.map((p: Json) => [p.ppc, p.ocorrencias])).toEqual(
              citacoes.ppcs.map((p: Json) => [p.ppc, p.ocorrencias.length]),
            );
            const doPpc = (yield* chamar(citacoesDaNorma, { id: NORMA, ppc: PPC })).dados.ppcs[0]!;
            const esperado = citacoes.ppcs.find((p: Json) => p.ppc === PPC);
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
            expect(art20.map((p: Json) => p.ppc)).toEqual(citacoesArt20.ppcs.map((p: Json) => p.ppc));
          }),
      },
    ],
  },

  impacto_da_norma: {
    casos: [
      {
        descricao: "= kb impacto (sem os textos das skills que não são fichas)",
        conferir: () =>
          Effect.gen(function* () {
            const i = yield* kbE("impacto", NORMA);
            const d = (yield* chamar(impactoDaNorma, { id: NORMA })).dados;
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
      },
    ],
  },

  adequacao_art71: {
    casos: [
      {
        descricao: "= kb adequacao-art71 (totais; lista de um campus)",
        conferir: () =>
          Effect.gen(function* () {
            const adequacao = yield* kbE("adequacao-art71");
            const d = (yield* chamar(adequacaoArt71, {})).dados;
            expect(d.totais).toEqual(adequacao.totais);
            expect(d.criterio).toBe(adequacao.criterio);
            const curitiba = yield* paginas(adequacaoArt71, { campus: "curitiba", limite: 100 }, (x) => x.cursos);
            expect(curitiba.map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas])).toEqual(
              adequacao.cursos
                .filter((c: Json) => c.curso.startsWith("curso:curitiba/"))
                .map((c: Json) => [c.curso, c.indicador, c.ppc_ano, c.dcn_citadas]),
            );
          }),
      },
    ],
  },

  buscar_secoes: {
    casos: [
      {
        descricao: "= kb buscar-secoes (trechos com pontuação e linhas; texto integral)",
        conferir: () =>
          Effect.gen(function* () {
            const [secoes, integral] = yield* kbTodos([
              ["buscar-secoes", "acompanhamento de egressos", "--cnct", "tecnico-em-informatica", "--limite", "8"],
              ["buscar-secoes", "estágio obrigatório", "--ppc", PPC, "--limite", "3", "--integral"],
            ]);
            const d = (yield* chamar(buscarSecoes, {
              consulta: "acompanhamento de egressos",
              cnct: "tecnico-em-informatica",
              limite: 8,
            })).dados;
            expect(
              d.resultados.map((r) => [r.id, r.pontuacao, r.trecho, r.fonte.linha_inicio, r.fonte.linha_fim]),
            ).toEqual(secoes.resultados.map((r: Json) => [r.id, r.pontuacao, r.trecho, r.linha_inicio, r.linha_fim]));
            const di = (yield* chamar(buscarSecoes, {
              consulta: "estágio obrigatório",
              ppc: PPC,
              limite: 3,
              integral: true,
            })).dados;
            expect(di.resultados.map((r) => [r.id, r.texto])).toEqual(
              integral.resultados.map((r: Json) => [r.id, r.texto]),
            );
          }),
      },
    ],
  },

  ler_secao: {
    casos: [
      {
        descricao: "= texto integral de kb buscar-secoes --integral, seção a seção",
        conferir: () =>
          Effect.gen(function* () {
            const integral = yield* kbE(
              "buscar-secoes",
              "estágio obrigatório",
              "--ppc",
              PPC,
              "--limite",
              "3",
              "--integral",
            );
            expect(integral.resultados.length).toBeGreaterThan(0);
            for (const r of integral.resultados) {
              expect((yield* chamar(lerSecao, { id: r.id })).dados.secao.texto).toBe(r.texto);
            }
          }),
      },
    ],
  },

  listar_cursos: {
    casos: [
      {
        descricao: "= kb cursos --campus curitiba (todas as páginas)",
        conferir: () =>
          Effect.gen(function* () {
            const cli = yield* kbE("cursos", "--campus", "curitiba");
            const cursos = yield* paginas(listarCursos, { campus: "curitiba", limite: 100 }, (d) => d.cursos);
            expect(cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null])).toEqual(
              cli.cursos.map((c: Json) => [c.id, c.nome, c.cnct?.id ?? null, c.ppc?.id ?? null]),
            );
            expect(cursos).toHaveLength(cli.total);
          }),
      },
    ],
  },

  ficha_curso: {
    casos: [
      {
        descricao: "as partes conferem com kb citacoes, kb ppc-fatos, kb adequacao-art71 e kb cursos",
        conferir: () =>
          Effect.gen(function* () {
            const [fatos, adequacao, citacoes, cursos] = yield* kbTodos([
              ["ppc-fatos", PPC],
              ["adequacao-art71"],
              ["citacoes", NORMA],
              ["cursos", "--campus", "curitiba"],
            ]);
            const d = (yield* chamar(fichaCurso, { curso: PPC })).dados;
            expect(d.fatos?.cruzamento).toEqual(fatos.ppcs[0].cruzamento);
            const doCurso = adequacao.cursos.find((c: Json) => c.curso === `curso:${PPC}`);
            expect(d.adequacao_art71).toEqual({ indicador: doCurso.indicador });
            const daNorma = d.normas_citadas.find((n) => n.id === NORMA)!;
            expect(daNorma.ocorrencias).toBe(citacoes.ppcs.find((p: Json) => p.ppc === PPC).ocorrencias.length);
            // a soma das normas citadas é o total de citações resolvidas do PPC
            const total = d.normas_citadas.reduce((s, n) => s + n.ocorrencias, 0);
            const db = new NodeSqlite.DatabaseSync(BANCO_REAL, { readOnly: true });
            const resolvidas = db
              .prepare("SELECT count(*) AS n FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL")
              .get(`ppc:${PPC}`) as { n: number };
            db.close();
            expect(total).toBe(resolvidas.n);
            const curso = cursos.cursos.find((c: Json) => c.id === `curso:${PPC}`);
            expect(d.ofertas.map((o) => o.turno)).toEqual(curso.ofertas.map((o: Json) => o.turno));
            expect(d.cnct?.id).toBe(curso.cnct.id);
          }),
      },
    ],
  },

  fatos_ppc: {
    casos: [
      {
        descricao: "= kb ppc-fatos (um PPC; divergências do nível médio, todas as páginas)",
        conferir: () =>
          Effect.gen(function* () {
            const [fatos, divergencias] = yield* kbTodos([
              ["ppc-fatos", PPC],
              ["ppc-fatos", "--divergencias", "--nivel", "médio"],
            ]);
            const um = (yield* chamar(fatosPpc, { ppc: PPC })).dados.ppcs[0]!;
            const esperado = fatos.ppcs[0];
            expect(
              um.fatos.map((f) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.fonte.linha_inicio]),
            ).toEqual(esperado.fatos.map((f: Json) => [f.fato, f.valor, f.status_curadoria, f.trecho_fonte, f.linha]));
            expect(um.cruzamento).toEqual(esperado.cruzamento);
            expect(um.suap?.matrizes.map((m) => m.trecho)).toEqual(esperado.suap.matrizes.map((m: Json) => m.trecho));
            const div = (yield* chamar(fatosPpc, { divergencias: true, nivel: "médio" })).dados;
            expect(div.totais).toEqual(divergencias.totais);
            const todos = yield* paginas(fatosPpc, { divergencias: true, nivel: "médio", limite: 50 }, (x) => x.ppcs);
            expect(todos.map((p: Json) => [p.ppc, p.cruzamento])).toEqual(
              divergencias.ppcs.map((p: Json) => [p.ppc, p.cruzamento]),
            );
          }),
      },
    ],
  },

  sobre_a_base: {
    casos: [
      {
        // a CLI não tem um comando de resumo; as contagens são as que `kb compilar` grava e imprime
        descricao: "contagens = linhas de cada tabela do banco; campi = kb cursos",
        conferir: () =>
          Effect.gen(function* () {
            const cursos = yield* kbE("cursos");
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
            const campiDosCursos = new Set(cursos.cursos.map((c: Json) => c.campus_id ?? c.id.split(/[:/]/)[1]));
            for (const campus of campiDosCursos) expect(d.campi.map((c) => c.id)).toContain(campus);
          }),
      },
    ],
  },

  etapa: { semCli: "não lê a base: só confirma ao app a etapa da tarefa, e fora do app responde que não registrou" },
};
