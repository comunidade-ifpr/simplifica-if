import { describe, expect, test } from "vite-plus/test";
import type {
  CriterioRevisao,
  ListaPendencias,
  PendenciaRevisao,
  PendenciaViva,
  ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import {
  comoFoiConferida,
  buscarCnct,
  chavesNovas,
  contagens,
  descreverCurso,
  doBloqueio,
  fraseResultado,
  criterioDoCaminho,
  gruposDaRegua,
  linkDoCriterio,
  linkDoPpc,
  localizacao,
  naoLidos,
  ordenar,
  passouPelaIa,
  versaoDoPpc,
  principais,
  resumoGrupo,
  resumoRegua,
  temasDaNavegacao,
  textoArquivoNovo,
  textoConferencia,
  textoFeitas,
  linhasConferencia,
  doFiltro,
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
  titulo: `título ${ficha}`,
  explicacao: null,
  faltas: [],
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
  chave: `${p.ficha}|${p.titulo}`,
  pendencia: p,
  situacao,
  resolvidaPor: situacao === "resolvida" ? "pessoa" : null,
  historico: [],
  sugestao: null,
  aceitaIa: true,
  julgadaPor: null,
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
  leituraIa: "nenhuma",
  dataBase: "2026-11-12",
  ...extra,
});

const lista = (
  pendencias: ReadonlyArray<PendenciaViva>,
  extra: Partial<ResultadoRevisaoPpc> = {},
): ListaPendencias => ({
  id: "lista-1",
  arquivoOriginal: "/a/PPC.docx",
  sha256: "hash-1",
  revisao: null,
  arquivoAcompanhado: null,
  conversas: [],
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
      leituraIa: "completa",
      criterios: resultado().criterios.map((c) => ({ ...c, estado: c.estado === "nao_lido" ? "atende" : c.estado })),
    });
    expect(fraseResultado(todos)).toBe("1 para corrigir, em 6 critérios.");
    expect(fraseResultado(lista([conferir2], { conferidosIa: 1, leituraIa: "parcial" }))).toBe(
      "Nada para corrigir e 1 para conferir, em 3 de 6 critérios.",
    );
  });

  test("a leitura com IA parcial conta como passada pela IA; os não lidos são o que a faixa oferece ler", () => {
    expect(passouPelaIa(resultado())).toBe(false);
    expect(passouPelaIa(resultado({ leituraIa: "parcial" }))).toBe(true);
    // Mesmo sem decisão da IA (a leitura deixou tudo para conferir), a leitura conta.
    expect(passouPelaIa(resultado({ leituraIa: "completa", conferidosIa: 0 }))).toBe(true);
    expect(naoLidos(resultado())).toBe(3);
  });

  test("as pendências novas são só as chaves que a lista anterior não tinha", () => {
    const antes = lista([corrigir1, conferir2]);
    const depois = lista([corrigir1, conferir2, retirada, mantida]);
    expect(chavesNovas(antes, depois)).toEqual([retirada.chave, mantida.chave]);
    expect(chavesNovas(depois, depois)).toEqual([]);
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
  expect(comoFoiConferida("completa", "Claude")).toBe("conferida com o Claude");
  expect(comoFoiConferida("parcial", "ChatGPT")).toBe("conferida em parte com o ChatGPT");
  expect(comoFoiConferida("completa", null)).toBe("conferida com IA");
  expect(comoFoiConferida("nenhuma", null)).toBe("só a conferência automática");
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

describe("linkDoPpc e versaoDoPpc", () => {
  const pendencia = (chave: string) => ({ chave }) as PendenciaViva;
  test("o PPC revisado, com a versão no caminho", () => {
    expect(linkDoPpc("abc", "v1")).toBe("ifpr://revisao-ppc/abc/v1");
  });

  test("o critério da revisão: o link e o caminho de volta; o PPC não é critério", () => {
    expect(linkDoCriterio("abc", "CT-SUP-17")).toBe("ifpr://revisao-ppc/abc/criterio/CT-SUP-17");
    expect(criterioDoCaminho("abc/criterio/CT-SUP-17")).toEqual({ lista: "abc", id: "CT-SUP-17" });
    expect(criterioDoCaminho("abc/v1")).toBeUndefined();
    expect(criterioDoCaminho("abc/criterio")).toBeUndefined();
  });

  test("a versão muda com o arquivo e com o conjunto das pendências, não com a ordem", () => {
    const base = { sha256: "f".repeat(64), pendencias: [pendencia("A:1"), pendencia("B:2")] };
    const versao = versaoDoPpc(base);
    expect(versao).toMatch(/^f{12}-[0-9a-f]{8}$/);
    expect(versaoDoPpc({ ...base, pendencias: [pendencia("B:2"), pendencia("A:1")] })).toBe(versao);
    expect(versaoDoPpc({ ...base, pendencias: [pendencia("A:1")] })).not.toBe(versao);
    expect(versaoDoPpc({ ...base, sha256: "e".repeat(64) })).not.toBe(versao);
  });
});

describe("a conferência ao salvar", () => {
  test("a linha do que mudou, só com o que houve, e a que falhou espera o próximo salvamento", () => {
    const em = "2026-11-27T14:32:00Z";
    expect(textoConferencia({ tipo: "conferido", em, resolvidas: 2, novas: 1 }, "14:32")).toBe(
      "Salvo às 14:32 · 2 pontos resolvidos, 1 novo",
    );
    expect(textoConferencia({ tipo: "conferido", em, resolvidas: 1, novas: 0 }, "14:32")).toBe(
      "Salvo às 14:32 · 1 ponto resolvido",
    );
    expect(textoConferencia({ tipo: "conferido", em, resolvidas: 0, novas: 0 }, "14:32")).toBe(
      "Salvo às 14:32 · nada mudou na lista",
    );
    expect(textoConferencia({ tipo: "falhou", em, motivo: "O arquivo não pode ser lido" }, "14:32")).toBe(
      "Salvo às 14:32 · não deu para conferir: O arquivo não pode ser lido. O app confere de novo no próximo salvamento.",
    );
    expect(
      textoConferencia(
        {
          tipo: "falhou",
          em,
          motivo: "Este arquivo não parece o mesmo PPC. O app confere de novo no próximo salvamento.",
        },
        "14:32",
      ),
    ).toBe(
      "Salvo às 14:32 · não deu para conferir: Este arquivo não parece o mesmo PPC. O app confere de novo no próximo salvamento.",
    );
  });

  test("na janela compacta, em duas linhas: conferido sem IA, e o que mudou", () => {
    const em = "2026-11-27T14:32:00Z";
    expect(linhasConferencia({ tipo: "conferido", em, resolvidas: 1, novas: 1 }, "14:32")).toEqual({
      linha: "Salvo às 14:32 · conferido sem IA",
      detalhe: "1 ponto resolvido, 1 novo; as da IA ficam como estão.",
    });
    expect(linhasConferencia({ tipo: "conferido", em, resolvidas: 0, novas: 0 }, "14:32").detalhe).toBe(
      "Nada mudou na lista; as da IA ficam como estão.",
    );
    expect(linhasConferencia({ tipo: "falhou", em, motivo: "O arquivo não pode ser lido" }, "14:32")).toEqual({
      linha: "Salvo às 14:32 · não deu para conferir",
      detalhe: "O arquivo não pode ser lido. O app confere de novo no próximo salvamento.",
    });
  });
});

describe("o filtro por gravidade", () => {
  test("tudo, só o que corrigir ou só o que conferir", () => {
    const a = viva(pendencia("A:1", 1, "nao_atende"));
    const b = viva(pendencia("B:1", 1, "a_conferir"));
    expect(doFiltro([a, b], "tudo")).toEqual([a, b]);
    expect(doFiltro([a, b], "corrigir")).toEqual([a]);
    expect(doFiltro([a, b], "conferir")).toEqual([b]);
  });
});
