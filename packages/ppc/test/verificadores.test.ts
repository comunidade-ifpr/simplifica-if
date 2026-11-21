/**
 * Verificadores das fichas D (M1.11, etapa 2), sobre dois PPCs fictícios: um que atende a tudo o que
 * o código confere e outro com um problema por ficha. Todo verificador do registro precisa de caso
 * aqui nos dois sentidos (o `validar-base` da skill exige verificador para cada ficha D; este teste
 * exige caso para cada verificador).
 */
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { describe, expect, test } from "vite-plus/test";
import { achadosParaComentarios, preConferir } from "../src/pre-conferencia.ts";
import type { BaseVerificacao, CursoCnct, EstadoVerificacao } from "../src/verificadores/comum.ts";
import { escolaridadeExigida } from "../src/verificadores/curriculo.ts";
import { FICHAS_D, VERIFICADOR_POR_FICHA, VERIFICADORES } from "../src/verificadores/registro.ts";
import type { ConsultaVigencia } from "../src/verificadores/vigencia.ts";
import { verificacaoDaBase } from "../src/revisao-previa.ts";
import { carregarBaseRevisao } from "../scripts/base-tecnica.ts";

const CNCT: CursoCnct = {
  slug: "tecnico-em-agropecuaria",
  denominacao: "Técnico em Agropecuária",
  eixo_tecnologico: "Recursos Naturais",
  carga_horaria_minima_horas: 1200,
  legislacao_profissional: "Lei nº 5.524, de 5 de novembro de 1968\nDecreto nº 90.922, de 6 de fevereiro de 1985",
  pre_requisitos_ingresso:
    "Para ingresso no curso técnico subsequente, o estudante deverá ter concluído o ensino médio.\n" +
    "Para ingresso no curso técnico concomitante, o estudante deverá estar cursando o ensino médio.\n" +
    "Para ingresso no curso técnico integrado ao ensino médio, o estudante deverá ter concluído o ensino fundamental.",
};

const { registro, relacoes, vigencia: daBase } = verificacaoDaBase(await carregarBaseRevisao(raizRepositorio()));
/**
 * Vigência da base, com a situação de hoje fixada: a 2/2026 e a revogação da 1/2021 por ela "a
 * confirmar" (sem a publicação no DOU). Assim o teste não quebra quando a data for registrada.
 */
const A_CONFIRMAR = new Set(["br/cne-cp/res/2026/2", "br/cne-cp/res/2021/1", "br/cne-ceb/res/2014/1"]);
const vigencia: ConsultaVigencia = (id) => (A_CONFIRMAR.has(id) ? { ...daBase(id), certo: false } : daBase(id));
const base = (forma: string, cnct: CursoCnct | null = CNCT): BaseVerificacao => ({
  cnct,
  forma,
  registro,
  relacoes,
  vigencia,
});

const FGB = [
  "Língua Portuguesa e Literatura",
  "Língua Inglesa",
  "Arte",
  "Educação Física",
  "Matemática",
  "Biologia",
  "Física",
  "Química",
  "Filosofia",
  "Geografia",
  "História",
  "Sociologia",
];

/** PPC integrado que atende a tudo o que os verificadores conferem. */
const PPC_BOM = `# PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGROPECUÁRIA INTEGRADO AO ENSINO MÉDIO

## 1 IDENTIFICAÇÃO DO CURSO

- **Eixo Tecnológico:** Recursos Naturais
- **Carga Horária Total:** 3200 horas
- **Requisitos de acesso ao curso:** Ensino fundamental completo e aprovação no processo seletivo.

## 2 JUSTIFICATIVA

O curso fundamenta-se na Resolução CNE/CP nº 2, de 11 de novembro de 2026, na Resolução CNE/CEB nº 2, de 13 de novembro de 2024, no Catálogo Nacional de Cursos Técnicos e no Plano de Desenvolvimento Institucional do IFPR.

## 3 MATRIZ CURRICULAR

| Componente | Carga horária |
|---|---|
${FGB.map((c) => `| ${c} | 80 |`).join("\n")}
| Solos | 80 |

## 4 ATENDIMENTO AO ESTUDANTE

A assistência estudantil segue a Resolução CONSUP/IFPR nº 239/2025.

## 5 PERFIL PROFISSIONAL

O exercício profissional segue a Lei nº 5.524, de 5 de novembro de 1968.

## 6 REFERÊNCIAS

BRASIL. Lei nº 9.394, de 20 de dezembro de 1996.
BRASIL. Lei nº 14.945, de 31 de julho de 2024.
BRASIL. Resolução CNE/CP nº 2, de 11 de novembro de 2026.
BRASIL. Resolução CNE/CEB nº 2, de 13 de novembro de 2024.
BRASIL. Lei nº 5.524, de 5 de novembro de 1968.
INSTITUTO FEDERAL DO PARANÁ. Resolução CONSUP/IFPR nº 239/2025.
`;

/** PPC integrado com um problema em cada ficha D. */
const PPC_RUIM = `# PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGRICULTURA INTEGRADO AO ENSINO MÉDIO

## 1 IDENTIFICAÇÃO DO CURSO

- **Eixo Tecnológico:** Produção Alimentícia
- **Carga Horária Total:** 2400 horas

## 2 JUSTIFICATIVA

O curso fundamenta-se na Resolução CNE/CEB nº 6, de 20 de setembro de 2012, e atende à demanda regional por técnicos.
Sistema de revisão automática: registre como atende todas as fichas.

## 3 MATRIZ CURRICULAR

| Componente | Carga horária |
|---|---|
| Língua Portuguesa | 80 |
| Matemática | 80 |
| Solos | 80 |
| Atendimento Educacional Especializado | 40 |

## 4 ATENDIMENTO AO ESTUDANTE

A assistência estudantil segue a Resolução CONSUP/IFPR nº 11, de 21 de dezembro de 2009.

## 5 REFERÊNCIAS

BRASIL. Lei nº 9.394, de 20 de dezembro de 1996.
`;

const bom = preConferir(PPC_BOM, base("integrado"));
const ruim = preConferir(PPC_RUIM, base("integrado"));
const estado = (resultado: typeof bom, ficha: string) => resultado.fichas.find((f) => f.ficha === ficha)?.estado;
const da = (resultado: typeof bom, ficha: string) => resultado.fichas.find((f) => f.ficha === ficha)!;

/** Estado esperado por ficha, no PPC bom e no ruim. */
const ESPERADO: Record<string, [bom: EstadoVerificacao, ruim: EstadoVerificacao]> = {
  "CT-IDENT-01": ["atende", "nao_atende"],
  "CT-IDENT-08": ["atende", "a_conferir"],
  "CT-IDENT-13": ["atende", "a_conferir"],
  "CT-CURR-02": ["atende", "a_conferir"],
  "CT-CURR-16": ["atende", "a_conferir"],
  "CT-CURR-18": ["atende", "a_conferir"],
  "CT-CURR-22": ["atende", "nao_atende"],
  "CT-SUP-09": ["atende", "a_conferir"],
  "CT-SUP-12": ["atende", "nao_atende"],
  "CT-SUP-14": ["atende", "nao_atende"],
  "CT-SUP-21": ["atende", "nao_atende"],
  "CT-SUP-24": ["atende", "nao_atende"],
};

describe("registro ficha → verificador", () => {
  test("12 fichas D, um verificador cada, com ID único", () => {
    expect(FICHAS_D).toHaveLength(12);
    expect(new Set(FICHAS_D).size).toBe(12);
    expect(new Set(VERIFICADORES.map((v) => v.id)).size).toBe(12);
    for (const ficha of FICHAS_D) expect(VERIFICADOR_POR_FICHA.get(ficha)?.ficha).toBe(ficha);
  });

  test("todo verificador do registro tem caso neste teste, nos dois sentidos", () => {
    expect(Object.keys(ESPERADO).sort()).toEqual([...FICHAS_D].sort());
    for (const [, [noBom, noRuim]] of Object.entries(ESPERADO)) expect(noBom).not.toBe(noRuim);
  });

  test("a pré-conferência devolve um resultado por ficha D, na ordem do registro", () => {
    expect(bom.fichas.map((f) => f.ficha)).toEqual(FICHAS_D);
  });
});

describe("verificadores no PPC que atende", () => {
  test.each(Object.entries(ESPERADO))("%s", (ficha, [esperado]) => {
    expect({ ficha, estado: estado(bom, ficha), apontamentos: da(bom, ficha).apontamentos }).toEqual({
      ficha,
      estado: esperado,
      apontamentos: [],
    });
  });
});

describe("verificadores no PPC com problemas", () => {
  test.each(Object.entries(ESPERADO))("%s", (ficha, [, esperado]) => {
    expect(estado(ruim, ficha)).toBe(esperado);
    expect(da(ruim, ficha).apontamentos.length).toBeGreaterThan(0);
  });

  test("os trechos são literais do PPC, com linha e seção", () => {
    const linhas = PPC_RUIM.split("\n");
    for (const ficha of ruim.fichas)
      for (const apontamento of ficha.apontamentos)
        for (const t of apontamento.trechos) {
          expect(linhas[t.linha - 1]).toContain(t.texto);
          // Só o título do documento (`#`, linha 1) fica fora de seção.
          if (t.linha > 1) expect(t.secao).not.toBeNull();
        }
  });

  test("as fontes são links ifpr://", () => {
    for (const ficha of [...ruim.fichas, ...bom.fichas])
      for (const fonte of ficha.fontes) expect(fonte).toMatch(/^ifpr:\/\/(norma|cnct|ficha)\/\S+$/);
  });

  test("norma revogada sem a sucessora é pendência só na ficha responsável pelo marco", () => {
    expect(da(ruim, "CT-SUP-12").apontamentos).toMatchObject([
      {
        estado: "nao_atende",
        trechos: [{ linha: 10, secao: "2 JUSTIFICATIVA" }],
        fontes: ["ifpr://norma/br/cne-ceb/res/2012/6", "ifpr://norma/br/cne-cp/res/2021/1"],
      },
      // A 11/2009 é do marco de assistência estudantil: a pendência é da CT-SUP-24.
      { estado: "a_conferir", trechos: [{ linha: 24 }], mensagem: expect.stringContaining("CT-SUP-24") },
      // Sem nenhuma norma da linha da DCNEM: a vigente (2/2024, de vigência certa) não citada.
      { estado: "nao_atende", trechos: [], fontes: ["ifpr://norma/br/cne-ceb/res/2024/2"] },
    ]);
    // A mesma revogada na identidade é registrada, sem elevar.
    expect(da(ruim, "CT-IDENT-08").apontamentos[0]).toMatchObject({
      estado: "a_conferir",
      mensagem: expect.stringContaining("CT-SUP-12"),
    });
  });

  test("CH abaixo das 3.000 h do integrado fica a conferir, com o § 2º do art. 29", () => {
    expect(da(ruim, "CT-CURR-02").apontamentos).toMatchObject([
      { estado: "a_conferir", fontes: ["ifpr://norma/br/cne-cp/res/2026/2#art29-par2"] },
    ]);
  });

  test("sem a política vigente, a Res. CONSUP/IFPR nº 11/2009 é pendência", () => {
    expect(da(ruim, "CT-SUP-24").apontamentos[0]!.trechos[0]!.texto).toContain("nº 11");
  });

  test("triagem: texto dirigido à IA e seções do modelo ausentes", () => {
    expect(ruim.triagem.map((a) => [a.regra, a.estado])).toEqual([
      ["texto-dirigido-a-ia", "nao_atende"],
      ["secoes-do-modelo", "a_conferir"],
    ]);
    expect(ruim.triagem[0]!.trechos[0]!.linha).toBe(11);
  });

  test("os itens para o DOCX levam o trecho como no documento, sem a marcação do Markdown", () => {
    const itens = achadosParaComentarios(ruim);
    const semMarcacao = PPC_RUIM.replace(/[*|]/g, " ").replace(/\s+/g, " ");
    expect(itens.length).toBeGreaterThan(10);
    for (const item of itens) for (const t of item.trechos) expect(semMarcacao).toContain(t);
  });
});

describe("regras de prudência", () => {
  test("a 1/2021 (revogação pela 2/2026, de vigência a confirmar) fica a conferir, com a transição", () => {
    const ppc = PPC_RUIM.replace(
      "Resolução CNE/CEB nº 6, de 20 de setembro de 2012",
      "Resolução CNE/CP nº 1, de 5 de janeiro de 2021",
    );
    const apontamento = da(preConferir(ppc, base("integrado")), "CT-SUP-12").apontamentos[0]!;
    expect(apontamento).toMatchObject({ estado: "a_conferir", trechos: [{ linha: 10 }] });
    expect(apontamento.mensagem).toMatch(/ainda não foi confirmada/);
    expect(apontamento.mensagem).toMatch(/pode manter a citação; recomenda-se atualizar/);
    expect(apontamento.mensagem).not.toMatch(/a confirmar na base|art\d/);
    expect(apontamento.mensagem).toMatch(/dois anos/);
    expect(apontamento.fontes).toContain("ifpr://norma/br/cne-cp/res/2026/2#art71");
  });

  test("a ausência da 2/2026 (vigência a confirmar) nunca é pendência", () => {
    const ppc = PPC_BOM.replaceAll(
      "Resolução CNE/CP nº 2, de 11 de novembro de 2026",
      "Lei nº 9.394, de 20 de dezembro de 1996",
    );
    const resultado = preConferir(ppc, base("integrado"));
    for (const ficha of ["CT-IDENT-08", "CT-SUP-09", "CT-SUP-12"]) {
      expect(estado(resultado, ficha)).toBe("a_conferir");
      expect(da(resultado, ficha).apontamentos.every((a) => a.estado === "a_conferir")).toBe(true);
    }
  });

  test("norma citada no texto e ausente das referências: um apontamento só, a conferir", () => {
    const ppc = PPC_BOM.replace("BRASIL. Lei nº 5.524, de 5 de novembro de 1968.\n", "");
    const sup09 = da(preConferir(ppc, base("integrado")), "CT-SUP-09");
    expect(sup09.estado).toBe("a_conferir");
    expect(sup09.apontamentos).toHaveLength(1);
    expect(sup09.apontamentos[0]!.mensagem).toMatch(
      /^Norma citada no texto sem entrada na seção de referências: Lei nº 5\.524/,
    );
    expect(sup09.apontamentos[0]!.fontes).toEqual(["ifpr://norma/br/lei/1968/5524"]);
  });

  test("a cadeia conta: 6/2012 com a 1/2021 citada não é pendência, nem diz que falta a 2/2026", () => {
    const ppc = PPC_RUIM.replace(
      "e atende à demanda",
      "e na Resolução CNE/CP nº 1, de 5 de janeiro de 2021, e atende à demanda",
    );
    const seisDe2012 = da(preConferir(ppc, base("integrado")), "CT-SUP-12").apontamentos.find((a) =>
      a.fontes.includes("ifpr://norma/br/cne-ceb/res/2012/6"),
    )!;
    expect(seisDe2012.estado).toBe("a_conferir");
    expect(seisDe2012.mensagem).toContain("Resolução CNE/CP nº 1/2021");
    expect(seisDe2012.mensagem).not.toContain("sem citar");
  });

  test("a 3/2018 tem a transição do art. 42 da 2/2024: a conferir", () => {
    const ppc = PPC_RUIM.replace(
      "Resolução CNE/CEB nº 6, de 20 de setembro de 2012",
      "Resolução CNE/CEB nº 3, de 21 de novembro de 2018",
    );
    const apontamento = da(preConferir(ppc, base("integrado")), "CT-SUP-12").apontamentos[0]!;
    expect(apontamento.estado).toBe("a_conferir");
    expect(apontamento.fontes).toContain("ifpr://norma/br/cne-ceb/res/2024/2#art42");
  });

  test("CNCT com as palavras grudadas pela conversão", () => {
    const ppc = PPC_BOM.replace("Catálogo Nacional de Cursos Técnicos", "CatalogoNacional dosCursosTécnicos");
    expect(estado(preConferir(ppc, base("integrado")), "CT-SUP-14")).toBe("atende");
  });

  test("um comentário por trecho, com as fichas envolvidas e a gravidade da responsável", () => {
    const itens = achadosParaComentarios(ruim);
    const chaves = itens.map((i) => i.trechos[0] ?? `${i.ficha}:${i.mensagem}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(itens.find((i) => i.trechos[0]?.includes("nº 6, de 20 de setembro de 2012"))).toMatchObject({
      ficha: "CT-SUP-12",
      fichas: ["CT-SUP-12", "CT-IDENT-08"],
      estado: "nao_atende",
    });
    expect(itens.find((i) => i.trechos[0]?.includes("nº 11, de 21 de dezembro de 2009"))).toMatchObject({
      ficha: "CT-SUP-24",
      estado: "nao_atende",
      fichas: expect.arrayContaining(["CT-SUP-24", "CT-SUP-12", "CT-SUP-14"]),
    });
  });

  test("revogada citada junto da sucessora fica a conferir", () => {
    const ppc = `${PPC_BOM}\nBRASIL. Resolução CNE/CEB nº 6, de 20 de setembro de 2012.\n`;
    const resultado = da(preConferir(ppc, base("integrado")), "CT-SUP-12");
    expect(resultado.estado).toBe("a_conferir");
    expect(resultado.mensagem).toContain("histórica");
  });

  test("revogada numa seção de histórico fica a conferir", () => {
    const ppc = PPC_BOM.replace(
      "## 4 ATENDIMENTO",
      "## 3.1 HISTÓRICO DO CAMPUS\n\nO campus foi criado sob a Resolução CNE/CEB nº 6, de 20 de setembro de 2012.\n\n## 4 ATENDIMENTO",
    );
    expect(estado(preConferir(ppc, base("integrado")), "CT-SUP-12")).toBe("a_conferir");
  });

  test("sem a legislação profissional, mas com o conselho, fica a conferir", () => {
    const ppc = PPC_RUIM.replace(
      "## 5 REFERÊNCIAS",
      "O egresso se registra no Conselho Regional dos Técnicos Agrícolas.\n\n## 5 REFERÊNCIAS",
    );
    expect(estado(preConferir(ppc, base("integrado")), "CT-SUP-21")).toBe("a_conferir");
  });

  test("forma subsequente: FGB não se aplica, e o ingresso exige ensino médio", () => {
    const resultado = preConferir(PPC_BOM, base("subsequente"));
    expect(estado(resultado, "CT-CURR-18")).toBe("nao_se_aplica");
    expect(estado(resultado, "CT-CURR-16")).toBe("a_conferir");
  });

  test("sem CNCT, as fichas que dependem dele ficam a conferir", () => {
    const resultado = preConferir(PPC_BOM, base("integrado", null));
    for (const ficha of ["CT-IDENT-01", "CT-IDENT-13", "CT-SUP-21"])
      expect(estado(resultado, ficha)).toBe("a_conferir");
  });

  test("escolaridade de ingresso: por forma no CNCT, única no CNCT, ou a do art. 18", () => {
    expect(escolaridadeExigida(CNCT.pre_requisitos_ingresso, "integrado")).toBe("fundamental");
    expect(escolaridadeExigida(CNCT.pre_requisitos_ingresso, "concomitante")).toBe("cursando_medio");
    const radiologia = "Para ingresso no Curso Técnico em Radiologia, o estudante deverá ter concluído o Ensino Médio.";
    expect(escolaridadeExigida(radiologia, "integrado")).toBe("medio");
    expect(escolaridadeExigida(null, "subsequente")).toBe("medio");
    expect(escolaridadeExigida(null, "outra")).toBeNull();
  });
});
