/**
 * Identificação do curso (`src/identificacao.ts`): o curso do CNCT e a forma de oferta em trechos
 * mínimos e anonimizados, que reproduzem os formatos observados nos PPCs da base. A medição sobre os
 * PPCs técnicos da base está em `identificacao-medicao.test.ts`.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  casarComCnct,
  formaOfertaNoValor,
  identificarCurso,
  limparDenominacaoCurso,
  nucleoDaDenominacao,
} from "../src/identificacao.ts";
import type { CursoCnct } from "../src/verificadores/comum.ts";

const curso = (slug: string, denominacao: string): CursoCnct => ({
  slug,
  denominacao,
  eixo_tecnologico: "",
  carga_horaria_minima_horas: null,
});

const CNCTS = [
  curso("tecnico-em-enfermagem", "Técnico em Enfermagem"),
  curso("tecnico-em-comercio", "Técnico em Comércio"),
  curso("tecnico-em-secretariado", "Técnico em Secretariado"),
  curso("tecnico-em-automacao-industrial", "Técnico em Automação Industrial"),
  curso("tecnico-em-eletrotecnica", "Técnico em Eletrotécnica"),
  curso("tecnico-em-mecatronica", "Técnico em Mecatrônica"),
  curso("tecnico-em-informatica", "Técnico em Informática"),
  curso("tecnico-em-informatica-para-internet", "Técnico em Informática para Internet"),
  curso("tecnico-em-manutencao-e-suporte-em-informatica", "Técnico em Manutenção e Suporte em Informática"),
  curso("tecnico-em-administracao", "Técnico em Administração"),
];

const identificar = (texto: string) => {
  const achado = identificarCurso(texto, CNCTS);
  return { cnct: achado.cnct?.slug ?? null, forma: achado.forma, denominacao: achado.denominacao };
};

/** Capa e folha de rosto como no PPC de Técnico em Enfermagem, com a base legal numa tabela adiante. */
const PPC_TITULOS_NUMERADOS = `## **MINISTÉRIO DA EDUCAÇÃO INSTITUTO FEDERAL DO PARANÁ PRÓ-REITORIA DE ENSINO**

**PROJETO PEDAGÓGICO DE CURSO CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA: SUBSEQUENTE**

**Curitiba 2023**

## **Diretor Geral do Campus**

Fulano de Tal

## 1.1 IDENTIFICAÇÃO

## 1.1.2 Informações do Campus

Campus: Instituto Federal do Paraná Campus Curitiba. Endereço: R. Exemplo, 100 – Curitiba – PR. Telefone: (41) 0000-0000

## 1.1.3 Denominação do Curso

Curso Técnico em Enfermagem

## 1.1.4 Eixo Tecnológico

Ambiente e Saúde

## 1.1.5 Modalidade

Presencial

## 1.1.6 Forma de Oferta

Subsequente ao Ensino Médio

## 2 ORGANIZAÇÃO CURRICULAR

|Componente|CH|
|---|---|
||Base legal específica do curso: Resolução CNE/CP nº 1/2021||||
`;

describe("identificação no Markdown", () => {
  test("título numerado seguido do valor; rótulo no meio da frase não vira nome do curso", () => {
    expect(identificar(PPC_TITULOS_NUMERADOS)).toEqual({
      cnct: "tecnico-em-enfermagem",
      forma: "subsequente",
      denominacao: "Técnico em Enfermagem",
    });
  });

  test("só a linha da base legal não identifica o curso", () => {
    expect(identificar("||Base legal específica do curso: Resolução CNE/CP nº 1/2021||||\n")).toEqual({
      cnct: null,
      forma: null,
      denominacao: "",
    });
  });

  test("vários rótulos em negrito na mesma linha", () => {
    expect(
      identificar(`## **CAMPUS EXEMPLO**

**NÚMERO DO PROCESSO:** 23411.000000/2018-00 **NOME DO CURSO:** Curso Técnico em Comércio **EIXO TECNOLÓGICO** : Gestão e Negócios **COORDENAÇÃO DO CURSO** Coordenador: Fulano

**LOCAL DE REALIZAÇÃO/CAMPUS: ASSIS CHATEAUBRIAND**

**Forma de oferta:** Articulada Integrada

**Modalidade de oferta: (** X ) Presencial   (   ) A distância

A secretaria e o secretariado do campus apoiam o curso.
`),
    ).toMatchObject({ cnct: "tecnico-em-comercio", forma: "integrado" });
  });

  test("tabela de identificação com rótulo e valor em células", () => {
    expect(
      identificar(`|Campo|Valor|
|---|---|
|Denominação do curso|TÉCNICO EM AUTOMAÇÃO INDUSTRIAL|
|Eixo Tecnológico|Controle e Processos Industriais|
|Campus|Telêmaco Borba|
|Forma de oferta|Integrada ao ensino médio|
|Modalidade|Presencial|
|Coordenador do curso|Fulano de Tal|
`),
    ).toMatchObject({ cnct: "tecnico-em-automacao-industrial", forma: "integrado" });
  });

  test("grade de opções: opções sem marca são ambíguas, e o X marca a opção anterior", () => {
    expect(
      identificar(`**NOME DO CURSO: TÉCNICO EM ELETROTÉCNICA**

**LOCAL DE REALIZAÇÃO/CAMPUS: ASSIS CHATEAUBRIAND**

|**MODALIDADE:**||||PROEJA|||||INTEGRADO|||||CONCOMITANTE|||
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|SUBSEQUENTE|||||X||||||||||||
|OFERTA:|||PRESENCIAL|||||||X||||A DISTÂNCIA|||
`),
    ).toMatchObject({ cnct: "tecnico-em-eletrotecnica", forma: "subsequente" });
  });

  test("capa em caixa alta quando não há rótulo", () => {
    expect(
      identificar(`# PROJETO PEDAGÓGICO DE CURSO CURSO TÉCNICO EM MECATRÔNICA FORMA DE OFERTA: Integrado

**CAMPUS AVANÇADO ARAPONGAS 2025**
`),
    ).toMatchObject({ cnct: "tecnico-em-mecatronica", forma: "integrado" });
  });

  test("PROEJA na modalidade faz do integrado o PROEJA", () => {
    expect(
      identificar(`**NOME DO CURSO:** Curso Técnico em Manutenção e Suporte em Informática

**Modalidade:** presencial/Educação de Jovens e Adultos/PROEJA

**Forma de Oferta:** Integrada
`),
    ).toMatchObject({ cnct: "tecnico-em-manutencao-e-suporte-em-informatica", forma: "proeja" });
  });

  test("PROEJA citado no texto institucional não muda a forma declarada", () => {
    expect(
      identificar(`**NOME DO CURSO:** Técnico em Administração

**Forma de oferta:** Integrado ao Ensino Médio

O campus oferta também cursos PROEJA e de Educação de Jovens e Adultos.
`),
    ).toMatchObject({ cnct: "tecnico-em-administracao", forma: "integrado" });
  });

  test("front matter YAML no topo é ignorado", () => {
    const texto = `---
titulo: "Curso: Técnico em Secretariado"
---
${PPC_TITULOS_NUMERADOS}`;
    expect(identificar(texto).cnct).toBe("tecnico-em-enfermagem");
  });
});

describe("validadores", () => {
  test("denominação do curso", () => {
    expect(limparDenominacaoCurso("Resolução CNE/CP nº 1/2021||||")).toEqual({ curso: "", forma: "" });
    expect(limparDenominacaoCurso("3300h.").curso).toBe("");
    expect(limparDenominacaoCurso("Curso Técnico em Mecânica Resolução de Criação: Nº 78/2011").curso).toBe(
      "Técnico em Mecânica",
    );
    expect(limparDenominacaoCurso("Técnico Integrado em Petróleo e Gás")).toEqual({
      curso: "Técnico em Petróleo e Gás",
      forma: "Integrado",
    });
    expect(limparDenominacaoCurso("Curso Técnico em Programação de Jogos Digitais, modalidade integrado").curso).toBe(
      "Técnico em Programação de Jogos Digitais",
    );
    expect(limparDenominacaoCurso("ENSINO MÉDIO INTEGRADO EM MECÂNICA").curso).toBe("Técnico em MECÂNICA");
    expect(limparDenominacaoCurso("Curso Técnico em Melhoria de Processos Oferta Experimental").curso).toBe(
      "Técnico em Melhoria de Processos",
    );
  });

  test("forma de oferta", () => {
    expect(formaOfertaNoValor("Subsequente ao Ensino Médio")).toBe("subsequente");
    expect(formaOfertaNoValor("Articulada Integrada")).toBe("integrado");
    expect(formaOfertaNoValor("PROEJA INTEGRADO CONCOMITANTE")).toBeNull();
    expect(formaOfertaNoValor("PROEJA INTEGRADO X CONCOMITANTE")).toBe("integrado");
    expect(formaOfertaNoValor("Integrada (PROEJA)")).toBe("proeja");
    expect(formaOfertaNoValor("Presencial")).toBeNull();
  });
});

describe("casamento com o CNCT", () => {
  test("pelo núcleo da denominação", () => {
    expect(nucleoDaDenominacao("Curso Técnico em Informática Integrado ao Ensino Médio")).toBe("informatica");
    expect(nucleoDaDenominacao("Técnico em Informática para Internet")).toBe("informatica para internet");
    expect(casarComCnct("Técnico em Informática", CNCTS)?.slug).toBe("tecnico-em-informatica");
    expect(casarComCnct("Técnico em Informática para Internet", CNCTS)?.slug).toBe(
      "tecnico-em-informatica-para-internet",
    );
  });

  test("grafia próxima casa; curso que não está no CNCT fica sem curso", () => {
    expect(casarComCnct("Técnico em Enfermagen", CNCTS)?.slug).toBe("tecnico-em-enfermagem");
    expect(casarComCnct("Técnico em Agroecologia", CNCTS)).toBeNull();
  });
});
