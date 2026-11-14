/**
 * Consultas de todos os serviços do kb, com argumentos reais, numa saída só. `db/base.test.ts` as
 * roda sobre o banco compilado e sobre `layerSomenteLeitura` numa cópia dele num diretório vazio
 * ("sem o repositório"); o executável do mesmo teste (Node SEA) importa `consultasDoExecutavel`.
 */
import * as Effect from "effect/Effect";
import * as BaseKb from "../BaseKb.ts";
import * as Cursos from "../Cursos.ts";
import * as Impacto from "../Impacto.ts";
import * as Normas from "../Normas.ts";
import * as PacoteContexto from "../PacoteContexto.ts";
import * as Ppcs from "../Ppcs.ts";

export const NORMAS = [
  "br/cne-cp/res/2021/1",
  "br/cne-cp/res/2026/2",
  "br/lei/1996/9394",
  "br/cne-cp/res/2021/1#art20",
] as const;
export const CITACOES = [
  "Resolução CNE/CP nº 1/2021, art. 20",
  "Res. CNE/CP 2/2026, art. 28, inciso VII",
  "LDB, arts. 61 a 63",
  "CNCT",
  "texto sem citação",
] as const;
export const PPC = "curitiba/tecnico-em-enfermagem";

/** Cada método de cada serviço de consulta; `markdown` é o PPC lido por quem chama (o pacote fora da base). */
export const todasAsConsultas = Effect.fn("testes.todasAsConsultas")(function* (markdown: string) {
  const base = yield* BaseKb.BaseKb;
  const normas = yield* Normas.Normas;
  const ppcs = yield* Ppcs.Ppcs;
  const cursos = yield* Cursos.Cursos;
  const impacto = yield* Impacto.Impacto;
  const pacote = yield* PacoteContexto.PacoteContexto;
  const cada = <A, E, R>(ids: readonly string[], f: (id: string) => Effect.Effect<A, E, R>) =>
    Effect.forEach(ids, (id) => f(id));
  return {
    meta: base.meta,
    resolver: yield* cada(CITACOES, normas.resolver),
    buscarNorma: yield* cada(CITACOES, (c) => normas.buscar(c, { limite: 5 })),
    obter: yield* cada(NORMAS, normas.obter),
    dispositivo: (yield* normas.dispositivo("br/cne-cp/res/2026/2#art71-parunico"))?.disp ?? null,
    dispositivoOuAncestral: (yield* normas.dispositivoOuAncestral("br/cne-cp/res/2026/2#art28-vii-a"))?.disp ?? null,
    descendentes: (yield* normas.descendentes("br/cne-cp/res/2026/2#art28")).map((d) => d.disp.id),
    trecho: yield* normas.trecho("br/cne-cp/res/2026/2#art28", { subordinados: true }),
    correspondencia: yield* normas.correspondencia("br/cne-cp/res/2021/1#art20"),
    tabelasDeCorrespondencia: yield* normas.tabelasDeCorrespondencia("br/cne-cp/res/2021/1"),
    citacoes: yield* cada(NORMAS, (id) => ppcs.relatorioCitacoes(id)),
    citacoesDaNorma: yield* ppcs.citacoesDaNorma("br/cne-cp/res/2021/1", { confiancaMinima: 0.9 }),
    vigencia: yield* cada(NORMAS, (id) => normas.vigencia(id, { em: "2026-11-01" })),
    relacoes: yield* cada(NORMAS, normas.relacoes),
    normas: yield* cada(NORMAS, normas.ficha),
    sucessoras: yield* cada(NORMAS, normas.sucessoras),
    dataReferencia: yield* normas.dataReferencia,
    impacto: yield* cada(NORMAS, (id) => impacto.daNorma(id)),
    adequacao: yield* cursos.adequacaoArt71({ incluirTecnologia: true }),
    buscarSecoes: yield* ppcs.buscarSecoes("acompanhamento de egressos", { cnct: "tecnico-em-informatica" }),
    secoesDoPpc: yield* ppcs.secoesDoPpc(PPC, ["estagio", "matriz_curricular"]),
    cursos: yield* cursos.listar({ eixo: "Informação e Comunicação", processo: "processo-seletivo-2026" }),
    fatos: yield* ppcs.fatos({ ppc: PPC }),
    fatosCampus: yield* ppcs.fatos({ campus: "curitiba", nivel: "médio" }),
    normasCitadas: yield* ppcs.normasCitadas(PPC),
    secao: yield* ppcs.lerSecao(`${PPC}#carga_horaria-1`),
    indiceSecoes: yield* ppcs.indiceSecoesDoPpc(PPC),
    divergencias: yield* ppcs.divergencias({ nivel: "médio" }),
    pacote: yield* cada(["CT-CURR-12", "grupo-003"], (t) => pacote.montar(t, PPC)),
    pacoteMarkdown: yield* pacote.doMarkdown("estagio", "PPC.md", markdown),
    fichas: (yield* pacote.fichas(["CT-CURR-12", "CT-CURR-02"])).map((f) => f.id),
    nomesDeCampi: yield* pacote.nomesDeCampi,
  };
});

/** O recorte das consultas que o executável (Node SEA) roda só com o `kb.sqlite`. */
export const consultasDoExecutavel = Effect.gen(function* () {
  const normas = yield* Normas.Normas;
  const ppcs = yield* Ppcs.Ppcs;
  const cursos = yield* Cursos.Cursos;
  const impacto = yield* Impacto.Impacto;
  const pacote = yield* PacoteContexto.PacoteContexto;
  return {
    resolver: yield* normas.resolver("Res. CNE/CP 2/2026, art. 28, inciso VII"),
    citacoes: yield* Effect.forEach(NORMAS, (id) => ppcs.relatorioCitacoes(id)),
    vigencia: yield* Effect.forEach(NORMAS, (id) => normas.vigencia(id)),
    impacto: yield* Effect.forEach(NORMAS, (id) => impacto.daNorma(id, { incluirPpcs: false })),
    adequacao: yield* cursos.adequacaoArt71(),
    secoes: yield* ppcs.buscarSecoes("acompanhamento de egressos"),
    pacote: yield* pacote.montar("grupo-001", PPC),
  };
});
