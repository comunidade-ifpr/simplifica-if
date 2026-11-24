/**
 * Amostras das suítes transversais (passo T6 do M0.1): para cada ferramenta de `FERRAMENTAS`, entradas
 * válidas na fixture e na base real, entradas inválidas com o trecho da mensagem esperada, o teto do
 * texto e, nas ferramentas que paginam, a lista a percorrer.
 *
 * O registro é indexado pelo nome da ferramenta: uma ferramenta nova em `FERRAMENTAS` sem amostras
 * aqui quebra o `typecheck` e o teste "toda ferramenta tem amostras" (`contrato.test.ts`). Para
 * acrescentar uma ferramenta, basta uma entrada nova neste arquivo; o comando da CLI `kb` sai dela
 * sozinho (`src/consulta.ts`).
 */
import { TETO_ADEQUACAO } from "../../src/ferramentas/adequacao-art71.ts";
import { TETO_BUSCAR_NORMA } from "../../src/ferramentas/buscar-norma.ts";
import { TETO_BUSCAR_SECOES, TETO_BUSCAR_SECOES_INTEGRAL } from "../../src/ferramentas/buscar-secoes.ts";
import { TETO_CITACOES } from "../../src/ferramentas/citacoes-da-norma.ts";
import { TETO_CORRESPONDENCIA } from "../../src/ferramentas/correspondencia.ts";
import { TETO_FATOS } from "../../src/ferramentas/fatos-ppc.ts";
import { TETO_FICHA_CURSO } from "../../src/ferramentas/ficha-curso.ts";
import { TETO_FICHA_NORMA } from "../../src/ferramentas/ficha-norma.ts";
import { TETO_IMPACTO } from "../../src/ferramentas/impacto-da-norma.ts";
import { TETO_LER_DISPOSITIVOS } from "../../src/ferramentas/ler-dispositivos.ts";
import { TETO_LER_SECAO } from "../../src/ferramentas/ler-secao.ts";
import { TETO_LISTAR_CURSOS } from "../../src/ferramentas/listar-cursos.ts";
import { TETO_PACOTE_CONTEXTO } from "../../src/ferramentas/pacote-contexto.ts";
import { TETO_RESOLVER_CITACOES } from "../../src/ferramentas/resolver-citacoes.ts";
import type { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { DCN_2021, DCN_2026, EXTERNO, STUB } from "../fixture-normas.ts";
import { CURSO_ENFERMAGEM, CURSO_FISICA, PPC_ENFERMAGEM, PPC_INFORMATICA, SECAO_LONGA } from "../fixture-ppcs.ts";

export type NomeFerramenta = (typeof FERRAMENTAS)[number]["nome"];

/** Argumentos de uma chamada. */
export type Args = Readonly<Record<string, unknown>>;

/** Dados de uma resposta, lidos sem o tipo da ferramenta. */
type Dados = any;

/** As fixtures de `fixture-normas.ts` (normas, dispositivos, correspondência) e `fixture-ppcs.ts` (PPCs, cursos, citações). */
export type Fixture = "normas" | "ppcs";

export interface Amostras {
  /** O banco de fixture em que as amostras válidas respondem. */
  readonly fixture: Fixture;
  /** Entradas válidas na fixture: respondem sem erro, com a saída no `outputSchema`. */
  readonly validas: ReadonlyArray<Args>;
  /** Entradas válidas na base real (`tmp/kb.sqlite`), para as suítes com `SIMPLIFICA_SMOKE=1`. */
  readonly reais: ReadonlyArray<Args>;
  /** Entradas recusadas pela validação (`EntradaInvalida`) e um trecho da mensagem esperada. */
  readonly invalidas: ReadonlyArray<readonly [args: unknown, trecho: string]>;
  /** Teto do texto para a IA, em caracteres, para a entrada dada. */
  readonly teto: (args: Args) => number;
  /**
   * Ferramentas com `cursor`: uma lista a percorrer página a página na fixture e na base real, e as
   * chaves dos itens de uma página (únicas na lista inteira; o total é `pagina.total`).
   */
  readonly paginacao: null | {
    readonly fixture: Args;
    readonly real: Args;
    readonly chaves: (dados: Dados) => ReadonlyArray<string>;
  };
}

const fixo = (teto: number) => () => teto;

/** Linhas de uma página de `ler_secao`, pelo intervalo da fonte. */
const linhasDaPagina = (d: Dados): string[] =>
  Array.from(
    { length: d.secao.fonte.linha_fim - d.secao.fonte.linha_inicio + 1 },
    (_, i) => `${d.secao.id}:${d.secao.fonte.linha_inicio + i}`,
  );

const NORMA_REAL = "br/cne-cp/res/2021/1";
const PPC_REAL = "curitiba/tecnico-em-enfermagem";

export const AMOSTRAS: { readonly [N in NomeFerramenta]: Amostras } = {
  buscar_norma: {
    fixture: "normas",
    validas: [
      { consulta: "Resolução CNE/CP nº 2/2026, art. 71, parágrafo único" },
      { consulta: `${DCN_2026}#art28`, limite: 20 },
      { consulta: "itinerário formativo egressos" },
      { consulta: "NBR 6023", situacao: "externo" },
      { consulta: "estágio", vigentes: true, em: "2030-01-01" },
    ],
    reais: [
      { consulta: "Resolução CNE/CP nº 2/2026, art. 28" },
      { consulta: "estágio supervisionado obrigatório", limite: 20 },
      { consulta: "itinerário formativo", vigentes: true },
      { consulta: "LDB, arts. 61 a 63" },
    ],
    invalidas: [
      [{}, "consulta: "],
      [{ consulta: "x".repeat(301) }, "consulta: "],
      [{ consulta: "x", limite: 21 }, "limite: "],
      [{ consulta: "x", situacao: "revogada" }, "situacao: "],
    ],
    teto: fixo(TETO_BUSCAR_NORMA),
    paginacao: null,
  },
  ler_dispositivos: {
    fixture: "normas",
    validas: [
      { ids: [`${DCN_2026}#art28`], filhos: true },
      { ids: [`${DCN_2026}#art36`, `${DCN_2021}#art20`, `${DCN_2021}#art999`] },
    ],
    reais: [
      { ids: ["br/cne-cp/res/2026/2#art28-xviii", "br/xx/res/1900/1#art1"] },
      { ids: ["br/cne-cp/res/2026/2#art28", "br/lei/1996/9394#art36"], filhos: true },
    ],
    invalidas: [
      [{ ids: [] }, "ids: "],
      [{ ids: Array.from({ length: 21 }, (_, i) => `${DCN_2026}#art${i + 1}`) }, "ids: "],
      [{ ids: [`${DCN_2026}#art28`], filhos: "sim" }, "filhos: "],
    ],
    teto: fixo(TETO_LER_DISPOSITIVOS),
    paginacao: null,
  },
  ficha_norma: {
    fixture: "normas",
    validas: [{ id: DCN_2021 }, { id: DCN_2026, em: "2030-01-01" }, { id: STUB }, { id: EXTERNO }],
    reais: [{ id: NORMA_REAL }, { id: "br/lei/1996/9394" }, { id: "br/cne-cp/res/2026/2", em: "2026-11-01" }],
    invalidas: [
      [{}, "id: "],
      [{ id: DCN_2021, em: "01/11/2026" }, "em: "],
    ],
    teto: fixo(TETO_FICHA_NORMA),
    paginacao: null,
  },
  correspondencia: {
    fixture: "normas",
    validas: [{ id: `${DCN_2021}#art20` }, { id: `${DCN_2021}#art20-ii` }, { id: DCN_2021 }],
    reais: [{ id: `${NORMA_REAL}#art20` }, { id: NORMA_REAL }],
    invalidas: [
      [{}, "id: "],
      [{ id: DCN_2021, cursor: 1 }, "cursor: "],
    ],
    teto: fixo(TETO_CORRESPONDENCIA),
    paginacao: {
      fixture: { id: DCN_2021 },
      real: { id: NORMA_REAL },
      chaves: (d) => d.itens.map((i: Dados) => JSON.stringify(i)),
    },
  },
  resolver_citacoes: {
    fixture: "normas",
    validas: [
      { citacoes: ["Resolução CNE/CP nº 1/2021, art. 20", "Res. CNE/CP 2/2026, art. 28, VII", "texto sem citação"] },
      { citacoes: Array.from({ length: 50 }, (_, i) => `Resolução CNE/CP nº 2/2026, art. ${i + 1}`) },
    ],
    reais: [
      { citacoes: ["Resolução CNE/CP nº 1/2021, art. 20", "Lei nº 9.394/1996", "ABNT NBR 6023", "CNCT"] },
      { citacoes: ["texto qualquer sem citação normativa"] },
    ],
    invalidas: [
      [{ citacoes: [] }, "citacoes: "],
      [{ citacoes: [""] }, "citacoes.0: "],
      [{ citacoes: Array.from({ length: 51 }, () => "LDB") }, "citacoes: "],
      [{ textos: ["chave errada"] }, "textos"],
    ],
    teto: fixo(TETO_RESOLVER_CITACOES),
    paginacao: null,
  },
  citacoes_da_norma: {
    fixture: "ppcs",
    validas: [
      { id: "br/cne-cp/res/2021/1" },
      { id: "br/cne-cp/res/2021/1#art20", ppc: PPC_ENFERMAGEM },
      { id: "br/lei/1996/9394", campus: "foz-do-iguacu" },
      { id: "br/cne-cp/res/2021/1", confianca_min: 0.9 },
    ],
    reais: [
      { id: NORMA_REAL, limite: 5 },
      { id: NORMA_REAL, ppc: PPC_REAL },
      { id: "br/lei/1996/9394", nivel: "superior" },
    ],
    invalidas: [
      [{}, "id: "],
      [{ id: "br/cne-cp/res/2021/1", limite: 51 }, "limite: "],
      [{ id: "br/cne-cp/res/2021/1", confianca_min: 2 }, "confianca_min: "],
    ],
    teto: fixo(TETO_CITACOES),
    paginacao: {
      fixture: { id: "br/cne-cp/res/2021/1", limite: 1 },
      real: { id: NORMA_REAL, limite: 50 },
      chaves: (d) => d.ppcs.map((p: Dados) => p.ppc),
    },
  },
  impacto_da_norma: {
    fixture: "ppcs",
    validas: [{ id: "br/cne-cp/res/2021/1" }, { id: "br/lei/1996/9394" }],
    reais: [{ id: NORMA_REAL }, { id: "br/lei/1996/9394" }],
    invalidas: [
      [{ id: "" }, "id: "],
      [{ id: "br/lei/1996/9394", ppcs: true }, "ppcs"],
    ],
    teto: fixo(TETO_IMPACTO),
    paginacao: null,
  },
  adequacao_art71: {
    fixture: "ppcs",
    validas: [{}, { campus: "curitiba" }, { indicador: "sem-ppc-convertido" }, { campus: "irati" }],
    reais: [{}, { campus: "curitiba", limite: 10 }, { indicador: "cita-cne-cp-1-2021" }],
    invalidas: [
      [{ indicador: "cita-qualquer" }, "indicador: "],
      [{ limite: 0 }, "limite: "],
    ],
    teto: fixo(TETO_ADEQUACAO),
    paginacao: {
      fixture: { campus: "curitiba", limite: 1 },
      real: { campus: "curitiba", limite: 7 },
      chaves: (d) => d.cursos.map((c: Dados) => c.curso),
    },
  },
  buscar_secoes: {
    fixture: "ppcs",
    validas: [
      { consulta: "estágio obrigatório" },
      { consulta: "avaliação", tipo: ["avaliacao"] },
      { consulta: "estágio", ppc: `ifpr://ppc/${PPC_ENFERMAGEM}`, integral: true, limite: 5 },
      { consulta: "astronomia" },
    ],
    reais: [
      { consulta: "acompanhamento de egressos", cnct: "tecnico-em-agropecuaria" },
      { consulta: "estágio obrigatório", limite: 20 },
      { consulta: "estágio obrigatório", ppc: PPC_REAL, limite: 5, integral: true },
      { consulta: "ementa", limite: 5, integral: true },
    ],
    invalidas: [
      [{ consulta: "" }, "consulta: "],
      [{ consulta: "x", limite: 21 }, "limite: "],
      [{ consulta: "x", tipo: [] }, "tipo: "],
    ],
    teto: (args) => (args.integral === true ? TETO_BUSCAR_SECOES_INTEGRAL : TETO_BUSCAR_SECOES),
    paginacao: null,
  },
  ler_secao: {
    fixture: "ppcs",
    validas: [
      { id: `${PPC_INFORMATICA}#estagio_praticas-1` },
      { id: SECAO_LONGA },
      { id: `ifpr://ppc/${SECAO_LONGA}` },
    ],
    reais: [{ id: `${PPC_REAL}#estagio_praticas-1` }, { id: "capanema/tecnico-em-agroecologia#ementas-2" }],
    invalidas: [
      [{ id: "curitiba" }, "id: "],
      [{}, "id: "],
    ],
    teto: fixo(TETO_LER_SECAO),
    paginacao: {
      fixture: { id: SECAO_LONGA },
      real: { id: "telemaco-borba/tecnologia-em-manutencao-industrial#anexos-3" },
      chaves: linhasDaPagina,
    },
  },
  listar_cursos: {
    fixture: "ppcs",
    validas: [{}, { campus: "curitiba" }, { nivel: "superior", limite: 1 }, { campus: "irati" }],
    reais: [{ limite: 5 }, { campus: "curitiba", nivel: "médio" }, { eixo: "Informação e Comunicação" }],
    invalidas: [
      [{ limite: 0 }, "limite: "],
      [{ campos: "curitiba" }, "campos"],
    ],
    teto: fixo(TETO_LISTAR_CURSOS),
    paginacao: {
      fixture: { limite: 1 },
      real: { limite: 100 },
      chaves: (d) => d.cursos.map((c: Dados) => c.id),
    },
  },
  ficha_curso: {
    fixture: "ppcs",
    validas: [{ curso: CURSO_ENFERMAGEM }, { curso: `curso:${CURSO_FISICA}` }],
    reais: [{ curso: PPC_REAL }, { curso: "curso:foz-do-iguacu/licenciatura-em-fisica" }],
    invalidas: [
      [{}, "curso: "],
      [{ curso: "" }, "curso: "],
    ],
    teto: fixo(TETO_FICHA_CURSO),
    paginacao: null,
  },
  fatos_ppc: {
    fixture: "ppcs",
    validas: [{}, { ppc: PPC_ENFERMAGEM }, { divergencias: true }, { nivel: "superior" }],
    reais: [{ ppc: PPC_REAL }, { divergencias: true, nivel: "médio", limite: 3 }, { campus: "curitiba" }],
    invalidas: [
      [{ divergencias: "sim" }, "divergencias: "],
      [{ limite: 51 }, "limite: "],
    ],
    teto: fixo(TETO_FATOS),
    paginacao: {
      fixture: { limite: 1 },
      real: { divergencias: true, limite: 50 },
      chaves: (d) => d.ppcs.map((p: Dados) => p.ppc),
    },
  },
  pacote_contexto: {
    fixture: "ppcs",
    // só com `ppc`: o `arquivo` depende da pasta de trabalho, e tem a suíte própria (`pasta-de-trabalho.test.ts`)
    validas: [
      { tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM },
      { tarefa: "todas", ppc: `ifpr://ppc/${PPC_ENFERMAGEM}` },
    ],
    reais: [
      { tarefa: "CT-CURR-12", ppc: PPC_REAL },
      { tarefa: "estagio", ppc: PPC_REAL },
      { tarefa: "todas", ppc: PPC_REAL },
    ],
    invalidas: [
      [{ tarefa: "", ppc: PPC_ENFERMAGEM }, "tarefa: "],
      [{ tarefa: "CT-CURR-12" }, "informe exatamente um destes: ppc"],
      [{ tarefa: "CT-CURR-12", ppc: PPC_ENFERMAGEM, arquivo: "PPC.md" }, "informe exatamente um destes: ppc"],
      [{ tarefa: "CT-XXXX-99", ppc: PPC_ENFERMAGEM }, "tarefa não reconhecida"],
    ],
    teto: fixo(TETO_PACOTE_CONTEXTO),
    paginacao: null,
  },
  sobre_a_base: {
    fixture: "ppcs",
    validas: [{}],
    reais: [{}],
    invalidas: [[{ versao: true }, "versao"]],
    // sem teto no código: o texto é uma lista curta de contagens e campi (cerca de 3 mil caracteres na base real)
    teto: fixo(6000),
    paginacao: null,
  },
  etapa: {
    fixture: "ppcs",
    validas: [{ id: "inicio" }, { id: "revisao", progresso: { feito: 1, total: 2 } }],
    reais: [{ id: "inicio" }],
    invalidas: [
      [{ id: "" }, "id: "],
      [{ id: "x", progresso: { feito: 3, total: 2 } }, "feito não pode passar de total"],
    ],
    // sem teto no código: o texto é uma frase fixa
    teto: fixo(200),
    paginacao: null,
  },
};
