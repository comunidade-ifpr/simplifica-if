/**
 * Ferramentas de PPCs e cursos (T3) sobre a fixture ampliada: contrato (entradas válidas e inválidas,
 * saída no outputSchema), conteúdo, avisos, determinismo, orçamento do texto e paginação completa e
 * sem repetição. A paridade com a CLI sobre a base real fica em `smoke-base-real.test.ts`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";
import * as moduloRegistro from "@simplifica-if/kb/normas/registro";
import * as moduloResolver from "@simplifica-if/kb/normas/resolver";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ErroEntrada, type Resposta } from "../src/envelope.ts";
import { adequacaoArt71, TETO_ADEQUACAO } from "../src/ferramentas/adequacao-art71.ts";
import { buscarSecoes, MAX_INTEGRAL, TETO_BUSCAR_SECOES } from "../src/ferramentas/buscar-secoes.ts";
import { citacoesDaNorma, TETO_CITACOES } from "../src/ferramentas/citacoes-da-norma.ts";
import { fatosPpc, TETO_FATOS } from "../src/ferramentas/fatos-ppc.ts";
import type { Contexto, Ferramenta } from "../src/ferramentas/ferramenta.ts";
import { fichaCurso, TETO_FICHA_CURSO } from "../src/ferramentas/ficha-curso.ts";
import { impactoDaNorma, TETO_IMPACTO } from "../src/ferramentas/impacto-da-norma.ts";
import { lerSecao, TETO_LER_SECAO } from "../src/ferramentas/ler-secao.ts";
import { listarCursos, TETO_LISTAR_CURSOS } from "../src/ferramentas/listar-cursos.ts";
import { criarContexto, criarServidor } from "../src/servidor.ts";
import { diretorioTemporario, limparTemporarios } from "./fixture.ts";
import {
  criarBancoFixturePpcs,
  LINHAS_SECAO_LONGA,
  PPC_ENFERMAGEM,
  PPC_FISICA,
  PPC_INFORMATICA,
  SECAO_LONGA,
} from "./fixture-ppcs.ts";

afterEach(limparTemporarios);

function contexto(): Contexto {
  return criarContexto({ banco: criarBancoFixturePpcs(), pastaTrabalho: diretorioTemporario(), canal: "dev" });
}

/** Chama, confere o outputSchema e o teto do texto, e devolve a resposta e o texto. */
function chamar<T>(
  ferramenta: Ferramenta,
  args: unknown,
  ctx: Contexto,
  teto: number,
): { resposta: Resposta<T>; texto: string } {
  const r = ferramenta.responder(args, ctx);
  const valida = ferramenta.saida.safeParse(r.resposta);
  if (!valida.success) throw new Error(`${ferramenta.nome}: saída fora do outputSchema: ${valida.error.message}`);
  expect(r.texto.length).toBeLessThanOrEqual(teto);
  expect(r.texto.split("\n").at(-1)).toBe("Base de 13/11/2026 (versão dev).");
  return r as { resposta: Resposta<T>; texto: string };
}

/** Percorre todas as páginas com o cursor; devolve os itens de cada página. */
function todasAsPaginas<I>(
  ferramenta: Ferramenta,
  args: Record<string, unknown>,
  ctx: Contexto,
  teto: number,
  itens: (dados: unknown) => I[],
): I[][] {
  const paginas: I[][] = [];
  let cursor: string | undefined;
  do {
    const { resposta } = chamar(ferramenta, { ...args, ...(cursor ? { cursor } : {}) }, ctx, teto);
    paginas.push(itens(resposta.dados));
    expect(resposta.pagina?.devolvidos).toBe(paginas.at(-1)!.length);
    cursor = resposta.pagina?.cursor;
  } while (cursor && paginas.length < 100);
  return paginas;
}

type Dados<F extends Ferramenta> = ReturnType<F["responder"]>["resposta"]["dados"];

/** Casos válidos de cada ferramenta, para determinismo e protocolo. */
const CASOS: [Ferramenta, unknown, number][] = [
  [citacoesDaNorma, { id: "br/cne-cp/res/2021/1" }, TETO_CITACOES],
  [citacoesDaNorma, { id: "br/cne-cp/res/2021/1#art20", ppc: PPC_ENFERMAGEM }, TETO_CITACOES],
  [impactoDaNorma, { id: "br/cne-cp/res/2021/1" }, TETO_IMPACTO],
  [adequacaoArt71, {}, TETO_ADEQUACAO],
  [adequacaoArt71, { campus: "curitiba" }, TETO_ADEQUACAO],
  [buscarSecoes, { consulta: "estágio obrigatório" }, TETO_BUSCAR_SECOES],
  [lerSecao, { id: `${PPC_INFORMATICA}#estagio_praticas-1` }, TETO_LER_SECAO],
  [lerSecao, { id: SECAO_LONGA }, TETO_LER_SECAO],
  [listarCursos, { campus: "curitiba" }, TETO_LISTAR_CURSOS],
  [fichaCurso, { curso: PPC_ENFERMAGEM }, TETO_FICHA_CURSO],
  [fatosPpc, {}, TETO_FATOS],
  [fatosPpc, { divergencias: true }, TETO_FATOS],
];

describe("todas as ferramentas do T3", () => {
  test("saída no outputSchema, texto no teto e mesma saída byte a byte na segunda chamada", () => {
    const ctx = contexto();
    for (const [f, args, teto] of CASOS) {
      const a = chamar(f, args, ctx, teto);
      const b = chamar(f, args, ctx, teto);
      expect(JSON.stringify(b.resposta)).toBe(JSON.stringify(a.resposta));
      expect(b.texto).toBe(a.texto);
    }
  });

  test("determinismo entre aberturas do mesmo banco", () => {
    const banco = criarBancoFixturePpcs();
    const um = criarContexto({ banco, pastaTrabalho: diretorioTemporario(), canal: "dev" });
    const outro = criarContexto({ banco, pastaTrabalho: diretorioTemporario(), canal: "dev" });
    for (const [f, args] of CASOS) {
      expect(JSON.stringify(f.responder(args, outro))).toBe(JSON.stringify(f.responder(args, um)));
    }
  });

  test("entrada inválida: ErroEntrada com o campo", () => {
    const ctx = contexto();
    const invalidos: [Ferramenta, unknown, string][] = [
      [citacoesDaNorma, {}, "id"],
      [citacoesDaNorma, { id: "Res. CNE/CP 1/2021" }, "resolver_citacoes"],
      [citacoesDaNorma, { id: "br/cne-cp/res/2021/1", limite: 51 }, "limite"],
      [citacoesDaNorma, { id: "br/cne-cp/res/2021/1", confianca_min: 2 }, "confianca_min"],
      [impactoDaNorma, { id: "" }, "id"],
      [adequacaoArt71, { indicador: "cita-qualquer" }, "indicador"],
      [buscarSecoes, { consulta: "" }, "consulta"],
      [buscarSecoes, { consulta: "x", limite: 21 }, "limite"],
      [lerSecao, { id: "curitiba" }, "id"],
      [listarCursos, { limite: 0 }, "limite"],
      [listarCursos, { campos: "curitiba" }, "campos"],
      [fichaCurso, {}, "curso"],
      [fatosPpc, { divergencias: "sim" }, "divergencias"],
    ];
    for (const [f, args, campo] of invalidos) {
      expect(() => f.responder(args, ctx)).toThrow(ErroEntrada);
      expect(() => f.responder(args, ctx)).toThrow(campo);
    }
  });

  test("cursor de outra consulta ou adulterado: ErroEntrada", () => {
    const ctx = contexto();
    const { resposta } = listarCursos.responder({ limite: 1 }, ctx);
    const cursor = resposta.pagina!.cursor!;
    expect(() => listarCursos.responder({ limite: 1, campus: "curitiba", cursor }, ctx)).toThrow(
      "o cursor é de outra consulta",
    );
    expect(() => citacoesDaNorma.responder({ id: "br/cne-cp/res/2021/1", cursor }, ctx)).toThrow(ErroEntrada);
    expect(() => listarCursos.responder({ cursor: "xyz" }, ctx)).toThrow("cursor inválido");
  });
});

describe("sem o repositório", () => {
  test("todas as ferramentas do T3 com o banco num diretório vazio, sem ler arquivo fora dele", () => {
    const banco = criarBancoFixturePpcs();
    const dir = fs.realpathSync(path.dirname(banco));
    const esperado = (ctx: Contexto) => JSON.stringify(CASOS.map(([f, args]) => f.responder(args, ctx)));
    const comRepositorio = esperado(criarContexto({ banco, pastaTrabalho: diretorioTemporario(), canal: "dev" }));
    const ctx = criarContexto({ banco: path.join(dir, "kb.sqlite"), pastaTrabalho: dir, canal: "dev" });
    const tentativas: string[] = [];
    const dentro = (alvo: unknown) => typeof alvo === "string" && path.resolve(alvo).startsWith(`${dir}${path.sep}`);
    const espioes = [
      ...(
        ["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync", "openSync", "realpathSync"] as const
      ).map((nome) => {
        const original = fs[nome] as (...args: unknown[]) => unknown;
        return spyOn(fs, nome).mockImplementation(((...args: unknown[]) => {
          if (dentro(args[0])) return original(...args);
          tentativas.push(`${nome} ${String(args[0])}`);
          throw new Error(`ferramenta leu arquivo: ${nome} ${String(args[0])}`);
        }) as never);
      }),
      spyOn(moduloRegistro, "raizRepositorio").mockImplementation(() => {
        tentativas.push("raizRepositorio");
        throw new Error("ferramenta procurou a raiz do repositório");
      }),
      spyOn(moduloResolver, "registroPadrao").mockImplementation(() => {
        tentativas.push("registroPadrao");
        throw new Error("ferramenta usou o registro do checkout");
      }),
    ];
    try {
      expect(esperado(ctx)).toBe(comRepositorio);
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
    expect(tentativas).toEqual([]);
  });
});

describe("citacoes_da_norma", () => {
  test("sem ppc: resumo por PPC, com totais e o aviso de baixa confiança", () => {
    const { resposta, texto } = chamar<Dados<typeof citacoesDaNorma>>(
      citacoesDaNorma,
      { id: "br/cne-cp/res/2021/1" },
      contexto(),
      TETO_CITACOES,
    );
    const d = resposta.dados;
    expect(d.norma).toMatchObject({
      id: "br/cne-cp/res/2021/1",
      situacao: "base",
      status_vigencia: "revogada",
      vigencia_a_confirmar: true,
      link: "ifpr://norma/br/cne-cp/res/2021/1",
    });
    expect([d.total_ppcs, d.total_ocorrencias]).toEqual([2, 3]);
    expect(d.ppcs.map((p) => [p.ppc, p.ocorrencias])).toEqual([
      [PPC_ENFERMAGEM, 2],
      [PPC_INFORMATICA, 1],
    ]);
    expect(d.ppcs[0]).toMatchObject({ campus: "Curitiba", nivel: "médio", forma: "subsequente" });
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(["citacao-baixa-confianca"]);
    expect(texto).toContain("orgao-no-documento");
    expect(resposta.pagina).toEqual({ total: 2, devolvidos: 2 });
  });

  test("com ppc: as ocorrências, com trecho, regra, dispositivo, link e fonte", () => {
    const { resposta, texto } = chamar<Dados<typeof citacoesDaNorma>>(
      citacoesDaNorma,
      { id: "br/cne-cp/res/2021/1", ppc: `ppc:${PPC_ENFERMAGEM}` },
      contexto(),
      TETO_CITACOES,
    );
    expect(resposta.dados.ppcs).toHaveLength(1);
    expect(resposta.dados.ppcs[0]!.ocorrencias).toEqual([
      {
        linha: 213,
        trecho: "Resolução nº 1/2021, art. 20",
        regra: "orgao-no-documento",
        confianca: 0.85,
        dispositivo: "br/cne-cp/res/2021/1#art20",
        link: "ifpr://norma/br/cne-cp/res/2021/1#art20",
        fonte: {
          path: `base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md`,
          linha_inicio: 213,
          linha_fim: 213,
        },
      },
      {
        linha: 661,
        trecho: "Resolução CNE/CP nº 1/2021",
        regra: "estrutural",
        confianca: 0.98,
        dispositivo: null,
        link: "ifpr://norma/br/cne-cp/res/2021/1",
        fonte: {
          path: `base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md`,
          linha_inicio: 661,
          linha_fim: 661,
        },
      },
    ]);
    expect(texto).toContain("> Resolução nº 1/2021, art. 20");
    expect(texto).toContain(`fonte: \`base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md:661-661\``);
  });

  test("dispositivo, confiança mínima e filtros", () => {
    const ctx = contexto();
    const art20 = citacoesDaNorma.responder({ id: "br/cne-cp/res/2021/1#art20" }, ctx).resposta;
    expect(art20.dados.id).toBe("br/cne-cp/res/2021/1#art20");
    expect(art20.dados.ppcs.map((p) => p.ppc)).toEqual([PPC_ENFERMAGEM]);
    const confiaveis = citacoesDaNorma.responder({ id: "br/cne-cp/res/2021/1", confianca_min: 0.9 }, ctx).resposta;
    expect(confiaveis.dados.total_ocorrencias).toBe(2);
    expect(confiaveis.avisos).toEqual([]);
    const foz = citacoesDaNorma.responder({ id: "br/lei/1996/9394", campus: "foz-do-iguacu" }, ctx).resposta;
    expect(foz.dados.ppcs.map((p) => p.ppc)).toEqual([PPC_FISICA]);
    const nenhum = citacoesDaNorma.responder({ id: "br/lei/1996/9394", nivel: "pós-graduação" }, ctx).resposta;
    expect(nenhum.dados.ppcs).toEqual([]);
    expect(nenhum.avisos.map((a) => a.tipo)).toEqual(["nao-encontrado"]);
  });

  test("norma fora da base: erro com a dica", () => {
    expect(() => citacoesDaNorma.responder({ id: "br/lei/2099/1" }, contexto())).toThrow("buscar_norma");
  });

  test("paginação de um em um: todos os PPCs, sem repetição", () => {
    const paginas = todasAsPaginas(
      citacoesDaNorma,
      { id: "br/cne-cp/res/2021/1", limite: 1 },
      contexto(),
      TETO_CITACOES,
      (d) => (d as Dados<typeof citacoesDaNorma>).ppcs.map((p) => p.ppc),
    );
    expect(paginas).toEqual([[PPC_ENFERMAGEM], [PPC_INFORMATICA]]);
  });
});

describe("impacto_da_norma", () => {
  test("sucessoras, transições, relações, normas que citam, PPCs, fichas e aviso de vigência", () => {
    const { resposta, texto } = chamar<Dados<typeof impactoDaNorma>>(
      impactoDaNorma,
      { id: "br/cne-cp/res/2021/1" },
      contexto(),
      TETO_IMPACTO,
    );
    const d = resposta.dados;
    expect(d.status).toBe("revogada (a confirmar)");
    expect(d.sucessoras).toEqual(["br/cne-cp/res/2026/2"]);
    expect(d.transicoes).toEqual([
      {
        id: "dcnept-2026-art71",
        regra:
          "Período de transição de até dois anos, a partir da vigência da Res. CNE/CP nº 2/2026, para a adequação dos cursos.",
        situacao_na_data: "a confirmar",
        link: "ifpr://norma/br/cne-cp/res/2026/2#art71",
      },
    ]);
    expect(d.relacoes).toEqual([
      {
        tipo: "revoga",
        origem: "br/cne-cp/res/2026/2",
        operador: "#art74-ii",
        alvo: "br/cne-cp/res/2021/1",
        alvo_dispositivo: null,
        alcance: null,
        evidencia: { em: "br/cne-cp/res/2026/2#art74-ii", trecho: "a Resolução CNE/CP nº 1, de 5 de janeiro de 2021" },
        confirmado_em: "2026-11-13",
        nota: null,
      },
    ]);
    expect(d.normas_que_citam).toEqual([
      {
        id: "br/cne-cp/res/2026/2",
        titulo: "Resolução CNE/CP nº 2/2026",
        dispositivos: ["#art71-parunico"],
        link: "ifpr://norma/br/cne-cp/res/2026/2",
      },
    ]);
    expect(d.ppcs.total).toBe(2);
    expect(d.ppcs.amostra.map((p) => p.ppc)).toEqual([PPC_ENFERMAGEM, PPC_INFORMATICA]);
    expect(d.fichas).toEqual([
      {
        id: "CT-CURR-12",
        titulo: "Progressão formativa explicitada na organização curricular",
        papel: "referencia",
        dispositivos: ["br/cne-cp/res/2021/1#art20"],
        link: "ifpr://ficha/CT-CURR-12",
      },
    ]);
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(["vigencia-a-confirmar"]);
    expect(texto).toContain("norma revogada não é inaplicável");
  });

  test("norma vigente sem citantes nem pendências", () => {
    const { resposta } = chamar<Dados<typeof impactoDaNorma>>(
      impactoDaNorma,
      { id: "br/lei/1996/9394" },
      contexto(),
      TETO_IMPACTO,
    );
    expect(resposta.dados.status).toBe("vigente");
    expect(resposta.dados.ppcs.total).toBe(2);
    expect(resposta.avisos).toEqual([]);
  });
});

describe("adequacao_art71", () => {
  test("sem filtros: só os totais", () => {
    const { resposta, texto } = chamar<Dados<typeof adequacaoArt71>>(adequacaoArt71, {}, contexto(), TETO_ADEQUACAO);
    expect(resposta.dados.cursos).toEqual([]);
    expect(resposta.dados.totais).toEqual({
      "cita-cne-cp-2-2026": 0,
      "cita-cne-cp-1-2021": 2,
      "cita-cne-ceb-6-2012": 0,
      "cita-cne-ceb-4-1999": 0,
      "nao-cita-dcn": 0,
      "sem-ppc-convertido": 1,
    });
    expect(resposta.pagina).toBeUndefined();
    expect(texto).toContain("filtre por `campus`, `curso` ou `indicador`");
  });

  test("filtros por campus, curso (ID ou slug) e indicador", () => {
    const ctx = contexto();
    const curitiba = adequacaoArt71.responder({ campus: "curitiba" }, ctx).resposta.dados;
    expect(curitiba.cursos.map((c) => c.curso)).toEqual([`curso:${PPC_ENFERMAGEM}`, `curso:${PPC_INFORMATICA}`]);
    expect(curitiba.cursos[0]).toEqual({
      curso: `curso:${PPC_ENFERMAGEM}`,
      nome: "Técnico em Enfermagem",
      campus: "curitiba",
      forma_oferta: "subsequente",
      ppc_ano: 2023,
      indicador: "cita-cne-cp-1-2021",
      dcn_citadas: [{ id: "br/cne-cp/res/2021/1", linhas: [213, 661], regras: ["estrutural", "orgao-no-documento"] }],
      link: `ifpr://curso/${PPC_ENFERMAGEM}`,
    });
    expect(curitiba.totais["cita-cne-cp-1-2021"]).toBe(2);
    for (const curso of [PPC_INFORMATICA, `curso:${PPC_INFORMATICA}`, "tecnico-em-informatica"]) {
      expect(adequacaoArt71.responder({ curso }, ctx).resposta.dados.cursos.map((c) => c.curso)).toEqual([
        `curso:${PPC_INFORMATICA}`,
      ]);
    }
    const semPpc = adequacaoArt71.responder({ indicador: "sem-ppc-convertido" }, ctx).resposta.dados;
    expect(semPpc.cursos.map((c) => c.curso)).toEqual(["curso:foz-do-iguacu/tecnico-em-aquicultura"]);
    const nada = adequacaoArt71.responder({ campus: "irati" }, ctx).resposta;
    expect(nada.avisos.map((a) => a.tipo)).toEqual(["nao-encontrado"]);
  });

  test("paginação completa", () => {
    const paginas = todasAsPaginas(
      adequacaoArt71,
      { indicador: "cita-cne-cp-1-2021", limite: 1 },
      contexto(),
      TETO_ADEQUACAO,
      (d) => (d as Dados<typeof adequacaoArt71>).cursos.map((c) => c.curso),
    );
    expect(paginas.flat()).toEqual([`curso:${PPC_ENFERMAGEM}`, `curso:${PPC_INFORMATICA}`]);
  });
});

describe("buscar_secoes", () => {
  test("trechos literais com linha, fonte, link e ID para ler_secao", () => {
    const { resposta, texto } = chamar<Dados<typeof buscarSecoes>>(
      buscarSecoes,
      { consulta: "estágio obrigatório", campus: "curitiba", nivel: "médio" },
      contexto(),
      TETO_BUSCAR_SECOES,
    );
    const r = resposta.dados.resultados.find((x) => x.id === `${PPC_INFORMATICA}#estagio_praticas-1`)!;
    expect(r).toMatchObject({
      ppc: `ppc:${PPC_INFORMATICA}`,
      curso: "Técnico em Informática",
      campus: "Curitiba",
      tipo: "estagio_praticas",
      cnct_id: "cnct:tecnico-em-informatica",
      trecho: [{ linha: 152, texto: "O estágio obrigatório tem 120 horas." }],
      fonte: {
        path: `base-conhecimento/institucional/ifpr/ppcs/${PPC_INFORMATICA}.md`,
        linha_inicio: 150,
        linha_fim: 152,
      },
      link: `ifpr://ppc/${PPC_INFORMATICA}#estagio_praticas-1`,
    });
    expect(r.texto).toBeUndefined();
    expect(texto).toContain("> O estágio obrigatório tem 120 horas.");
    expect(texto).toContain("não norma");
  });

  test("filtros de tipo, cnct e ppc; tipo desconhecido é erro", () => {
    const ctx = contexto();
    const porTipo = buscarSecoes.responder({ consulta: "avaliação", tipo: ["avaliacao"] }, ctx).resposta.dados;
    expect(porTipo.resultados.every((r) => r.tipo === "avaliacao")).toBe(true);
    expect(porTipo.resultados.map((r) => r.ppc)).toContain(`ppc:${PPC_FISICA}`);
    const porCnct = buscarSecoes.responder({ consulta: "estágio", cnct: "cnct:tecnico-em-informatica" }, ctx).resposta;
    expect(porCnct.dados.resultados.map((r) => r.ppc)).toEqual([`ppc:${PPC_INFORMATICA}`]);
    const porPpc = buscarSecoes.responder({ consulta: "estágio", ppc: `ifpr://ppc/${PPC_ENFERMAGEM}` }, ctx).resposta;
    expect(porPpc.dados.resultados.every((r) => r.ppc === `ppc:${PPC_ENFERMAGEM}`)).toBe(true);
    expect(() => buscarSecoes.responder({ consulta: "estágio", tipo: ["estagio"] }, ctx)).toThrow(
      "tipo de seção desconhecido: estagio",
    );
    const nada = buscarSecoes.responder({ consulta: "astronomia" }, ctx).resposta;
    expect(nada.avisos.map((a) => a.tipo)).toEqual(["nao-encontrado"]);
  });

  test("integral: texto inteiro, no máximo 5 seções, texto para a IA cortado no teto", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar<Dados<typeof buscarSecoes>>(
      buscarSecoes,
      { consulta: "estágio", integral: true, limite: 10 },
      ctx,
      30000,
    );
    expect(resposta.dados.resultados.length).toBeLessThanOrEqual(MAX_INTEGRAL);
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(["resultado-resumido"]);
    const longa = resposta.dados.resultados.find((r) => r.id === SECAO_LONGA)!;
    expect(longa.texto!.split("\n")).toHaveLength(LINHAS_SECAO_LONGA);
    expect(texto).toContain("leia o resto com ler_secao");
  });
});

describe("ler_secao", () => {
  test("seção pelo ID ou pelo link, com as vizinhas", () => {
    const ctx = contexto();
    const pelo = (id: string) => chamar<Dados<typeof lerSecao>>(lerSecao, { id }, ctx, TETO_LER_SECAO);
    const a = pelo(`${PPC_ENFERMAGEM}#avaliacao-1`);
    expect(a.resposta.dados).toEqual({
      secao: {
        id: `${PPC_ENFERMAGEM}#avaliacao-1`,
        ppc: `ppc:${PPC_ENFERMAGEM}`,
        curso: "Técnico em Enfermagem",
        tipo: "avaliacao",
        titulo: "avaliacao-1",
        texto: "Texto da seção avaliacao-1.",
        fonte: {
          path: `base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md`,
          linha_inicio: 120,
          linha_fim: 130,
        },
        link: `ifpr://ppc/${PPC_ENFERMAGEM}#avaliacao-1`,
      },
      anterior: null,
      proxima: `${PPC_ENFERMAGEM}#estagio-1`,
    });
    expect(a.resposta.pagina).toBeUndefined();
    expect(a.texto).toContain("> Texto da seção avaliacao-1.");
    expect(pelo(`ifpr://ppc/${PPC_ENFERMAGEM}#avaliacao-1`).resposta).toEqual(a.resposta);
    expect(pelo(`ppc:${PPC_ENFERMAGEM}#avaliacao-1`).resposta).toEqual(a.resposta);
    expect(pelo(`${PPC_ENFERMAGEM}#estagio-2`).resposta.dados).toMatchObject({
      anterior: `${PPC_ENFERMAGEM}#estagio-1`,
      proxima: SECAO_LONGA,
    });
  });

  test("seção inexistente ou link de outro tipo: erro", () => {
    const ctx = contexto();
    expect(() => lerSecao.responder({ id: `${PPC_ENFERMAGEM}#nao-existe` }, ctx)).toThrow("seção não encontrada");
    expect(() => lerSecao.responder({ id: "ifpr://curso/curitiba/tecnico-em-enfermagem" }, ctx)).toThrow(
      "esperava um link ifpr://ppc/",
    );
  });

  test("seção longa: páginas de linhas inteiras, contínuas, que remontam o texto", () => {
    const ctx = contexto();
    const paginas: { texto: string; linha_inicio: number; linha_fim: number }[] = [];
    let cursor: string | undefined;
    do {
      const { resposta } = chamar<Dados<typeof lerSecao>>(
        lerSecao,
        { id: SECAO_LONGA, ...(cursor ? { cursor } : {}) },
        ctx,
        TETO_LER_SECAO,
      );
      const s = resposta.dados.secao;
      paginas.push({ texto: s.texto, linha_inicio: s.fonte.linha_inicio, linha_fim: s.fonte.linha_fim });
      expect(resposta.pagina!.total).toBe(LINHAS_SECAO_LONGA);
      cursor = resposta.pagina!.cursor;
    } while (cursor);
    expect(paginas.length).toBeGreaterThan(1);
    const completo = chamar<Dados<typeof buscarSecoes>>(
      buscarSecoes,
      { consulta: "anexo plano", integral: true, ppc: PPC_ENFERMAGEM, limite: 1 },
      ctx,
      30000,
    ).resposta.dados.resultados[0]!.texto!;
    expect(paginas.map((p) => p.texto).join("\n")).toBe(completo);
    expect(paginas[0]!.linha_inicio).toBe(1002);
    for (let i = 1; i < paginas.length; i += 1) expect(paginas[i]!.linha_inicio).toBe(paginas[i - 1]!.linha_fim + 1);
    expect(paginas.at(-1)!.linha_fim).toBe(1001 + LINHAS_SECAO_LONGA);
  });
});

describe("listar_cursos", () => {
  test("linha compacta por curso, com CNCT, PPC e turnos", () => {
    const { resposta, texto } = chamar<Dados<typeof listarCursos>>(
      listarCursos,
      { campus: "curitiba" },
      contexto(),
      TETO_LISTAR_CURSOS,
    );
    expect(resposta.dados.cursos).toEqual([
      {
        id: `curso:${PPC_ENFERMAGEM}`,
        nome: "Técnico em Enfermagem",
        campus: "curitiba",
        nivel: "médio",
        forma_oferta: "subsequente",
        modalidade: "presencial",
        situacao: "ativo",
        cnct: { id: "cnct:tecnico-em-enfermagem", nome: "Técnico em Enfermagem", eixo: "Ambiente e Saúde" },
        ppc: { id: `ppc:${PPC_ENFERMAGEM}`, ano: 2023 },
        turnos: ["matutino"],
        link: `ifpr://curso/${PPC_ENFERMAGEM}`,
      },
      {
        id: `curso:${PPC_INFORMATICA}`,
        nome: "Técnico em Informática",
        campus: "curitiba",
        nivel: "médio",
        forma_oferta: "integrado",
        modalidade: "presencial",
        situacao: "ativo",
        cnct: { id: "cnct:tecnico-em-informatica", nome: "Técnico em Informática", eixo: "Informação e Comunicação" },
        ppc: { id: `ppc:${PPC_INFORMATICA}`, ano: 2022 },
        turnos: ["noturno"],
        link: `ifpr://curso/${PPC_INFORMATICA}`,
      },
    ]);
    expect(texto).toContain("ficha_curso");
  });

  test("filtros de eixo, turno, processo e nível", () => {
    const ctx = contexto();
    const ids = (args: Record<string, unknown>) =>
      listarCursos.responder(args, ctx).resposta.dados.cursos.map((c) => c.id);
    expect(ids({ eixo: "Informação e Comunicação" })).toEqual([`curso:${PPC_INFORMATICA}`]);
    expect(ids({ turno: "matutino" })).toEqual([`curso:${PPC_ENFERMAGEM}`]);
    expect(ids({ processo: "processo-seletivo-2025" })).toEqual([`curso:${PPC_ENFERMAGEM}`]);
    expect(ids({ nivel: "superior" })).toEqual([`curso:${PPC_FISICA}`]);
    expect(ids({ cnct: "tecnico-em-enfermagem" })).toEqual([`curso:${PPC_ENFERMAGEM}`]);
    expect(listarCursos.responder({ campus: "irati" }, ctx).resposta.avisos.map((a) => a.tipo)).toEqual([
      "nao-encontrado",
    ]);
  });

  test("paginação de um em um: todos os cursos, sem repetição", () => {
    const paginas = todasAsPaginas(listarCursos, { limite: 1 }, contexto(), TETO_LISTAR_CURSOS, (d) =>
      (d as Dados<typeof listarCursos>).cursos.map((c) => c.id),
    );
    const ids = paginas.flat();
    expect(paginas.every((p) => p.length === 1)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      `curso:${PPC_ENFERMAGEM}`,
      `curso:${PPC_INFORMATICA}`,
      "curso:foz-do-iguacu/licenciatura-em-fisica",
      "curso:foz-do-iguacu/tecnico-em-aquicultura",
    ]);
  });
});

describe("fatos_ppc", () => {
  test("fatos com status, trecho e fonte; SUAP e cruzamento; aviso fato-extraido sempre", () => {
    const { resposta, texto } = chamar<Dados<typeof fatosPpc>>(
      fatosPpc,
      { ppc: PPC_ENFERMAGEM },
      contexto(),
      TETO_FATOS,
    );
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(["fato-extraido"]);
    const p = resposta.dados.ppcs[0]!;
    expect(p.fatos[0]).toEqual({
      fato: "carga_horaria_total_h",
      valor: "1600",
      valor_num: 1600,
      unidade: "h",
      status_curadoria: "extraido",
      regra: "rotulo-corpo",
      trecho_fonte: "Carga horária total em hora relógio: 1.600 horas",
      fonte: {
        path: `base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md`,
        linha_inicio: 122,
        linha_fim: 122,
      },
    });
    expect(p.suap?.matrizes.map((m) => m.matriz_id)).toEqual([538]);
    expect(p.cruzamento.map((c) => [c.aspecto, c.resultado])).toEqual([
      ["carga_horaria", "confere"],
      ["estagio", "diverge"],
    ]);
    expect(resposta.dados.totais).toBeUndefined();
    expect(texto).toContain("status `extraido`");
    expect(texto).toContain("> Carga horária total em hora relógio: 1.600 horas");
    expect(texto).toContain(`fonte: \`base-conhecimento/institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md:122-122\``);
  });

  test("divergências: só as linhas divergentes, com os totais; filtros de campus e nível", () => {
    const ctx = contexto();
    const div = fatosPpc.responder({ divergencias: true }, ctx).resposta.dados;
    expect(div.ppcs.map((p) => [p.ppc, p.cruzamento.map((c) => c.aspecto)])).toEqual([
      [`ppc:${PPC_ENFERMAGEM}`, ["estagio"]],
    ]);
    expect(div.totais).toEqual({
      carga_horaria: { confere: 1, "sem-fato-ppc": 1 },
      estagio: { diverge: 1 },
    });
    expect(fatosPpc.responder({ campus: "foz-do-iguacu" }, ctx).resposta.dados.ppcs.map((p) => p.ppc)).toEqual([
      `ppc:${PPC_FISICA}`,
    ]);
    expect(fatosPpc.responder({ nivel: "superior" }, ctx).resposta.dados.ppcs.map((p) => p.ppc)).toEqual([
      `ppc:${PPC_FISICA}`,
    ]);
    const nada = fatosPpc.responder({ ppc: "curitiba/nao-existe" }, ctx).resposta;
    expect(nada.avisos.map((a) => a.tipo)).toEqual(["fato-extraido", "nao-encontrado"]);
  });

  test("paginação completa", () => {
    const paginas = todasAsPaginas(fatosPpc, { limite: 1 }, contexto(), TETO_FATOS, (d) =>
      (d as Dados<typeof fatosPpc>).ppcs.map((p) => p.ppc),
    );
    expect(paginas.flat()).toEqual([`ppc:${PPC_ENFERMAGEM}`, `ppc:${PPC_INFORMATICA}`, `ppc:${PPC_FISICA}`].sort());
  });
});

describe("ficha_curso", () => {
  test("composta: as mesmas respostas de listar_cursos, fatos_ppc, citacoes_da_norma e adequacao_art71", () => {
    const ctx = contexto();
    const { resposta, texto } = chamar<Dados<typeof fichaCurso>>(
      fichaCurso,
      { curso: `curso:${PPC_ENFERMAGEM}` },
      ctx,
      TETO_FICHA_CURSO,
    );
    const d = resposta.dados;
    expect(d.curso).toEqual({
      id: `curso:${PPC_ENFERMAGEM}`,
      nome: "Técnico em Enfermagem",
      nivel: "médio",
      forma_oferta: "subsequente",
      modalidade: "presencial",
      situacao: "ativo",
      link: `ifpr://curso/${PPC_ENFERMAGEM}`,
    });
    expect(d.campus).toEqual({ id: "curitiba", nome: "Curitiba", link: "ifpr://campus/curitiba" });
    expect(d.cnct).toEqual({
      id: "cnct:tecnico-em-enfermagem",
      nome: "Técnico em Enfermagem",
      eixo: "Ambiente e Saúde",
      carga_horaria_minima: 1200,
      link: "ifpr://cnct/tecnico-em-enfermagem",
    });
    expect(d.ppc?.secoes.map((s) => s.id)).toEqual([
      `${PPC_ENFERMAGEM}#avaliacao-1`,
      `${PPC_ENFERMAGEM}#estagio-1`,
      `${PPC_ENFERMAGEM}#estagio-2`,
      SECAO_LONGA,
    ]);
    expect(d.ofertas).toEqual([
      { processo: "processo-seletivo-2026", turno: "matutino", vagas: 30 },
      { processo: "processo-seletivo-2025", turno: "matutino", vagas: 30 },
    ]);
    // fatos: os de fatos_ppc
    expect(d.fatos).toEqual(fatosPpc.responder({ ppc: PPC_ENFERMAGEM }, ctx).resposta.dados.ppcs[0]!);
    // normas citadas: cada contagem é o total de citacoes_da_norma para o PPC
    expect(d.normas_citadas.map((n) => [n.id, n.ocorrencias])).toEqual([
      ["br/cne-cp/res/2021/1", 2],
      ["br/lei/1996/9394", 1],
    ]);
    for (const n of d.normas_citadas) {
      const c = citacoesDaNorma.responder({ id: n.id, ppc: PPC_ENFERMAGEM }, ctx).resposta.dados;
      expect(c.total_ocorrencias).toBe(n.ocorrencias);
      expect(n.status_vigencia).toBe(c.norma.status_vigencia);
    }
    // adequação: o indicador de adequacao_art71
    expect(d.adequacao_art71).toEqual({
      indicador: adequacaoArt71.responder({ curso: PPC_ENFERMAGEM }, ctx).resposta.dados.cursos[0]!.indicador,
    });
    expect(d.transicoes_aplicaveis.map((t) => t.id)).toEqual(["dcnept-2026-art71"]);
    expect(resposta.avisos.map((a) => a.tipo)).toEqual(["fato-extraido", "citacao-baixa-confianca"]);
    expect(texto).toContain("## [Técnico em Enfermagem](ifpr://curso/curitiba/tecnico-em-enfermagem)");
    expect(texto).toContain("`#estagio-1` estagio-1 [estagio_praticas]");
  });

  test("curso sem PPC convertido e curso superior (fora do art. 71)", () => {
    const ctx = contexto();
    const semPpc = fichaCurso.responder({ curso: "ifpr://curso/foz-do-iguacu/tecnico-em-aquicultura" }, ctx).resposta;
    expect(semPpc.dados).toMatchObject({
      ppc: null,
      fatos: null,
      normas_citadas: [],
      adequacao_art71: { indicador: "sem-ppc-convertido" },
    });
    expect(semPpc.avisos).toEqual([]);
    const fisica = fichaCurso.responder({ curso: PPC_FISICA }, ctx).resposta.dados;
    expect(fisica.adequacao_art71).toBeNull();
    expect(fisica.cnct).toBeNull();
    expect(fisica.fatos?.suap).toEqual({ situacao: null, carga_horaria_comum_h: null, matrizes: [] });
  });

  test("curso inexistente: erro com a dica", () => {
    expect(() => fichaCurso.responder({ curso: "curitiba/nao-existe" }, contexto())).toThrow("listar_cursos");
    expect(() => fichaCurso.responder({ curso: "curitiba" }, contexto())).toThrow('esperava "campus/curso"');
  });
});

describe("pelo protocolo MCP: o SDK valida a saída no outputSchema", () => {
  test("cada caso volta sem erro, com structuredContent igual à chamada direta", async () => {
    const ctx = contexto();
    const servidor = criarServidor(ctx);
    const [lado, outro] = InMemoryTransport.createLinkedPair();
    await servidor.connect(lado);
    const cliente = new Client({ name: "teste", version: "0" });
    await cliente.connect(outro);
    for (const [f, args] of CASOS) {
      const r = await cliente.callTool({ name: f.nome, arguments: args as Record<string, unknown> });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual(f.responder(args, ctx).resposta);
    }
    const erro = await cliente.callTool({ name: "ler_secao", arguments: { id: `${PPC_ENFERMAGEM}#nao-existe` } });
    expect(erro.isError).toBe(true);
    expect((erro.content as { text: string }[])[0]!.text).toContain("seção não encontrada");
    await cliente.close();
    await servidor.close();
  });
});
