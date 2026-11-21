import { describe, expect, test } from "vite-plus/test";
import type {
  CriterioRevisao,
  ListaPendencias,
  PendenciaRevisao,
  PendenciaViva,
  ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app";
import {
  buscarCnct,
  contagens,
  descreverCurso,
  doBloqueio,
  fraseResultado,
  gruposDaRegua,
  localizacao,
  ordenar,
  principais,
  resumoGrupo,
  resumoRegua,
  temasDaNavegacao,
  textoArquivoNovo,
  textoFeitas,
} from "./lista.ts";

const pendencia = (
  ficha: string,
  ordemTema: number,
  estado: PendenciaRevisao["estado"],
  extra: Partial<PendenciaRevisao> = {},
): PendenciaRevisao => ({
  ficha,
  tituloFicha: `Título de ${ficha}`,
  tema: `Tema ${ordemTema}`,
  ordemTema,
  estado,
  mensagem: `mensagem ${ficha}`,
  oQueFazer: "fazer",
  trecho: null,
  secao: null,
  fontes: [],
  tambemEm: [],
  noDocumento: "no-trecho",
  origem: "codigo",
  dependeDoCurso: false,
  ...extra,
});

const viva = (p: PendenciaRevisao, situacao: PendenciaViva["situacao"] = "aberta"): PendenciaViva => ({
  chave: `${p.ficha}|${p.mensagem}`,
  pendencia: p,
  situacao,
  resolvidaPor: situacao === "resolvida" ? "pessoa" : null,
  historico: [],
  sugestao: null,
  aceitaIa: true,
});

const criterio = (ficha: string, ordemTema: number, estado: CriterioRevisao["estado"]): CriterioRevisao => ({
  ficha,
  titulo: ficha,
  tema: `Tema ${ordemTema}`,
  ordemTema,
  estado,
  mensagem: "",
  origem: "codigo",
});

const resultado = (extra: Partial<ResultadoRevisaoPpc> = {}): ResultadoRevisaoPpc => ({
  arquivoOriginal: "/a/PPC.docx",
  arquivoComentado: "/a/PPC - revisão prévia (Simplifica IF).docx",
  curso: { cnct: null, forma: "subsequente", origem: "documento" },
  pendencias: [],
  criterios: [
    criterio("A1", 1, "nao_atende"),
    criterio("A2", 1, "atende"),
    criterio("B1", 2, "a_conferir"),
    criterio("B2", 2, "nao_lido"),
    criterio("C1", 3, "nao_lido"),
    criterio("C2", 3, "nao_lido"),
  ],
  conferidos: 3,
  conferidosIa: 0,
  paraConferirIa: 0,
  foraDaRevisao: [],
  totalCriterios: 6,
  dataBase: "2026-11-12",
  ...extra,
});

const lista = (
  pendencias: ReadonlyArray<PendenciaViva>,
  extra: Partial<ResultadoRevisaoPpc> = {},
): ListaPendencias => ({
  id: "lista-1",
  arquivoOriginal: "/a/PPC.docx",
  revisao: null,
  provider: null,
  resultado: resultado(extra),
  pendencias,
  uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 },
  criadaEm: "2026-11-21T10:00:00Z",
  atualizadaEm: "2026-11-21T10:00:00Z",
});

const corrigir1 = viva(pendencia("A1", 1, "nao_atende"));
const conferir2 = viva(pendencia("B1", 2, "a_conferir"));
const feita = viva(pendencia("A9", 1, "nao_atende"), "resolvida");
const retirada = viva(pendencia("B9", 2, "nao_atende", { origem: "ia" }), "contestada_aceita");
const mantida = viva(pendencia("A8", 1, "a_conferir"), "contestada_mantida");
const doCurso = viva(pendencia("I1", 0, "a_conferir", { dependeDoCurso: true }));

describe("as contagens e a frase-resultado", () => {
  const l = lista([corrigir1, conferir2, feita, retirada, mantida, doCurso]);

  test("o bloqueio do curso sai da lista principal", () => {
    expect(principais(l)).not.toContain(doCurso);
    expect(doBloqueio(l)).toEqual([doCurso]);
    // Com o curso identificado, não há bloqueio.
    const comCurso = lista([doCurso], {
      curso: { cnct: { slug: "x", denominacao: "Técnico em X" }, forma: null, origem: "pessoa" },
    });
    expect(doBloqueio(comCurso)).toEqual([]);
  });

  test("corrigir e conferir contam as que pedem trabalho; feitas, as resolvidas; retiradas não contam", () => {
    expect(contagens(l)).toEqual({ corrigir: 1, conferir: 2, feitas: 1, total: 4 });
    expect(textoFeitas(contagens(l))).toBe("1 de 4 feitas");
  });

  test("sem a IA, a frase diz quantos critérios o app confere sozinho", () => {
    expect(fraseResultado(l)).toBe("1 para corrigir e 2 para conferir, nos 3 critérios que o app confere sozinho.");
  });

  test("depois da IA, a frase fala da régua inteira (ou do que foi lido)", () => {
    const todos = lista([corrigir1], {
      conferidosIa: 3,
      criterios: resultado().criterios.map((c) => ({ ...c, estado: c.estado === "nao_lido" ? "atende" : c.estado })),
    });
    expect(fraseResultado(todos)).toBe("1 para corrigir, em 6 critérios.");
    expect(fraseResultado(lista([conferir2], { conferidosIa: 1 }))).toBe(
      "Nada para corrigir e 1 para conferir, em 3 de 6 critérios.",
    );
  });

  test("sem pendências, nada apareceu (sem afirmar aprovação); com tudo feito, nada mais", () => {
    expect(fraseResultado(lista([]))).toBe(
      "Nada apareceu para corrigir nem para conferir nos 3 critérios que o app confere sozinho.",
    );
    expect(fraseResultado(lista([feita]))).toBe(
      "Nada mais para corrigir nem para conferir nos 3 critérios que o app confere sozinho.",
    );
    expect(fraseResultado(lista([], { conferidos: 1 }))).toMatch(/no critério que o app confere sozinho\.$/);
  });
});

test("a ordem: corrigir antes de conferir; feitas e retiradas no fim", () => {
  const ordem = ordenar([feita, conferir2, retirada, mantida, corrigir1]).map((v) => v.pendencia.ficha);
  expect(ordem).toEqual(["A1", "A8", "B1", "A9", "B9"]);
});

describe("a régua", () => {
  const criterios = resultado().criterios;

  test("um grupo por tema, na ordem do parecer", () => {
    const grupos = gruposDaRegua([...criterios].reverse());
    expect(grupos.map((g) => [g.ordem, g.criterios.length])).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
  });

  test("o título de cada tema e o rótulo da régua, com plural", () => {
    const [um, dois, tres] = gruposDaRegua(criterios);
    expect(resumoGrupo(um!)).toBe("Tema 1: 1 para corrigir, 1 em ordem");
    expect(resumoGrupo(dois!)).toBe("Tema 2: 1 para conferir, 1 não lido");
    expect(resumoGrupo(tres!)).toBe("Tema 3: 2 não lidos");
    expect(resumoRegua(criterios)).toBe("6 critérios: 1 para corrigir, 1 para conferir, 1 em ordem, 3 não lidos.");
  });
});

test("os temas da coluna: gravidade mais alta, contagem, ✓ e não lido", () => {
  const l = lista([corrigir1, conferir2, feita, doCurso]);
  expect(temasDaNavegacao(l)).toEqual([
    { ordem: 1, tema: "Tema 1", abertas: 1, gravidade: "corrigir", naoLido: false },
    { ordem: 2, tema: "Tema 2", abertas: 1, gravidade: "conferir", naoLido: false },
    { ordem: 3, tema: "Tema 3", abertas: 0, gravidade: null, naoLido: true },
  ]);
});

test("as frases curtas: localização, curso e arquivo novo", () => {
  expect(localizacao(pendencia("x", 1, "nao_atende", { secao: "4.1" }))).toBe("seção 4.1");
  expect(localizacao(pendencia("x", 1, "nao_atende", { noDocumento: "no-inicio" }))).toBe("falta no documento");
  expect(localizacao(pendencia("x", 1, "nao_atende", { noDocumento: "so-na-lista" }))).toBeNull();
  expect(
    descreverCurso({
      cnct: { slug: "a", denominacao: "Técnico em Agropecuária" },
      forma: "integrado",
      origem: "documento",
    }),
  ).toBe("Técnico em Agropecuária, integrado ao ensino médio");
  expect(descreverCurso({ cnct: null, forma: null, origem: "documento" })).toBeNull();
  expect(textoArquivoNovo({ resolvidas: 3, continuam: 5, novas: 1 })).toBe("3 resolvidas, 5 continuam, 1 nova.");
  expect(textoArquivoNovo({ resolvidas: 1, continuam: 1, novas: 2 })).toBe("1 resolvida, 1 continua, 2 novas.");
  expect(textoArquivoNovo({ resolvidas: 0, continuam: 0, novas: 0 })).toBe("Nada mudou na conferência automática.");
});

test("a busca no CNCT, sem acento e com todas as palavras", () => {
  const cnct = [
    { slug: "b", denominacao: "Técnico em Agronegócio", eixo: "", area: null, carga_horaria_minima: null, link: "" },
    { slug: "a", denominacao: "Técnico em Agropecuária", eixo: "", area: null, carga_horaria_minima: null, link: "" },
    { slug: "c", denominacao: "Técnico em Enfermagem", eixo: "", area: null, carga_horaria_minima: null, link: "" },
  ] as unknown as Parameters<typeof buscarCnct>[0];
  expect(buscarCnct(cnct, "agro").map((c) => c.slug)).toEqual(["b", "a"]);
  expect(buscarCnct(cnct, "tecnico agropecuaria").map((c) => c.slug)).toEqual(["a"]);
  expect(buscarCnct(cnct, "  ")).toEqual([]);
});
