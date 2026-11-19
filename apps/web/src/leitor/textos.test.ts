import { describe, expect, it } from "@effect/vitest";
import {
  citacaoDoDispositivo,
  datasDoCabecalho,
  trechoLimitado,
  citacaoDoPpc,
  type DispositivoLido,
  type FichaNorma,
  nomeDaRelacao,
  referenciaDaNorma,
  selosDaNorma,
} from "./textos.ts";

const NORMA: FichaNorma["norma"] = {
  id: "br/cne-cp/res/2026/2",
  titulo: "Resolução CNE/CP nº 2/2026",
  situacao: "base",
  status_vigencia: "vigente",
  vigencia_a_confirmar: false,
  data_publicacao: "2026-11-11",
  ementa: "Define as Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica.",
  link: "ifpr://norma/br/cne-cp/res/2026/2",
  orgao: "CNE/CP",
  tipo_documento: "Resolução",
  numero: "2",
  ano: 2026,
  fonte_url: "https://www.in.gov.br/dcnept-2026" as FichaNorma["norma"]["fonte_url"],
  fonte_referencia: null,
};

const DISPOSITIVO: DispositivoLido = {
  id: "br/cne-cp/res/2026/2#art28-xviii",
  rotulo: "XVIII",
  tipo: "inciso",
  caput: ["Art. 28. A estrutura do PPC deve conter, no mínimo:"],
  texto: "XVIII – o acompanhamento de egressos;",
  subordinados: [],
  revogado: false,
  vetado: false,
  fonte: { path: "x.md", linha_inicio: 10, linha_fim: 10 },
  link: "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii",
  norma: "Resolução CNE/CP nº 2/2026",
  notas: [],
  pai: "br/cne-cp/res/2026/2#art28",
  estrutura: [],
};

const ficha = (mudar: {
  status: string;
  certo?: boolean;
  aConfirmar?: boolean;
  pendencias?: string[];
}): FichaNorma => ({
  norma: { ...NORMA, vigencia_a_confirmar: mudar.aConfirmar ?? false },
  vigencia: {
    data: "2026-11-13",
    status: mudar.status,
    certo: mudar.certo ?? true,
    inicio: { data: "2026-11-12", minimo: null, certo: true },
    eventos: [],
    pendencias: mudar.pendencias ?? [],
  },
  relacoes: { entrada: [], saida: [] },
  sucessoras: [],
  transicoes: [],
});

describe("selosDaNorma", () => {
  it("o estado é o da data da base, e a data do evento vem à parte", () => {
    const revogada = ficha({ status: "revogada" });
    const comEvento: FichaNorma = {
      ...revogada,
      vigencia: {
        ...revogada.vigencia,
        eventos: [
          {
            tipo: "revoga",
            origem: "br/cne-cp/res/2026/2",
            operador: "#art74-ii",
            alvo_dispositivo: null,
            alcance: null,
            efeito_de: null,
            efeito_minimo: "2026-11-11",
            ocorreu: "a confirmar",
          },
        ],
      },
    };
    expect(selosDaNorma(comEvento)[0]!.detalhe).toBe(
      "Na data da base (13/11/2026): revogada. Revogação com efeito em a confirmar, não antes de 11/11/2026. Norma revogada ainda pode valer em situações de transição: veja as regras abaixo.",
    );
    expect(selosDaNorma(ficha({ status: "vigente" }))[0]!.detalhe).toBe(
      "Na data da base (13/11/2026): em vigor. Início da vigência: 12/11/2026.",
    );
  });

  it("vigente, revogada e a confirmar", () => {
    expect(selosDaNorma(ficha({ status: "vigente" })).map((s) => s.rotulo)).toEqual(["Em vigor"]);
    const revogada = selosDaNorma(ficha({ status: "revogada" }));
    expect(revogada.map((s) => [s.rotulo, s.variante])).toEqual([["Revogada", "error"]]);
    expect(revogada[0]!.detalhe).toContain("regras abaixo");
    const aConfirmar = selosDaNorma(
      ficha({ status: "vigente", certo: false, aConfirmar: true, pendencias: ["publicação não registrada"] }),
    );
    expect(aConfirmar.map((s) => s.rotulo)).toEqual(["Em vigor", "Vigência a confirmar"]);
    expect(aConfirmar[1]!.detalhe).toContain("publicação não registrada");
  });

  it("status desconhecido vira só 'a confirmar'", () => {
    expect(selosDaNorma(ficha({ status: "a confirmar", certo: false })).map((s) => s.rotulo)).toEqual([
      "Vigência a confirmar",
    ]);
  });
});

describe("datas do ato no cabeçalho", () => {
  it("o ato pela assinatura; a publicação só quando registrada, como está", () => {
    expect(datasDoCabecalho(NORMA, { assinada_em: "2026-11-11", publicada_em: "a confirmar" })).toEqual([
      "Ato de 11/11/2026",
      "Publicação no DOU: a confirmar",
    ]);
    expect(datasDoCabecalho(NORMA, { assinada_em: "2026-11-11", publicada_em: "2026-11-12" })).toEqual([
      "Ato de 11/11/2026",
      "Publicação no DOU: 12/11/2026",
    ]);
    expect(
      datasDoCabecalho(
        { id: "ifpr/consup/res/2017/50", data_publicacao: "2017-07-14" },
        { assinada_em: null, publicada_em: null },
      ),
    ).toEqual(["Ato de 14/07/2017"]);
    // sem o documento ainda (stub ou carregando): só o ato
    expect(datasDoCabecalho(NORMA, null)).toEqual(["Ato de 11/11/2026"]);
  });
});

describe("citação", () => {
  it("[…] em cada salto do caput ao dispositivo", () => {
    const texto = citacaoDoDispositivo({
      dispositivo: {
        ...DISPOSITIVO,
        caput: ["Art. 5º Caput do artigo:", "§ 1º Texto do parágrafo:"],
        texto: "IV – o inciso citado.",
      },
      norma: NORMA,
      nomeCurto: "Res. CNE/CP 2/2026, art. 5º, § 1º, IV",
    });
    expect(texto.split("\n").slice(0, 3)).toEqual([
      "“Art. 5º Caput do artigo: […]",
      "§ 1º Texto do parágrafo: […]",
      "IV – o inciso citado.”",
    ]);
  });

  it("o trecho longo corta no espaço, sem partir palavra", () => {
    const longo = `${"palavra ".repeat(300)}`;
    const cortado = trechoLimitado(longo);
    expect(cortado.endsWith("palavra […]")).toBe(true);
    expect(cortado.length).toBeLessThanOrEqual(2_000 + " […]".length);
    expect(trechoLimitado("curto")).toBe("curto");
  });

  it("referência formal da norma", () => {
    expect(referenciaDaNorma(NORMA)).toBe(
      "BRASIL. Resolução CNE/CP nº 2/2026, de 11 de novembro de 2026. Define as Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica. Disponível em: https://www.in.gov.br/dcnept-2026.",
    );
  });

  it('referência formal sem URL: a referência da fonte, sem "Disponível em"', () => {
    expect(referenciaDaNorma({ ...NORMA, fonte_url: null, fonte_referencia: "SEI/IFPR nº 3881287" })).toBe(
      "BRASIL. Resolução CNE/CP nº 2/2026, de 11 de novembro de 2026. Define as Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica. SEI/IFPR nº 3881287.",
    );
    expect(referenciaDaNorma({ ...NORMA, fonte_url: null })).not.toContain("Disponível em");
  });

  it("dispositivo: caput herdado, [...] e subordinados, com o nome curto e a referência", () => {
    const dispositivo: DispositivoLido = {
      id: "br/cne-cp/res/2026/2#art28-xviii",
      rotulo: "XVIII",
      tipo: "inciso",
      caput: ["Art. 28. A estrutura do PPC deve conter, no mínimo:"],
      texto: "XVIII – o acompanhamento de egressos;",
      subordinados: [],
      revogado: false,
      vetado: false,
      fonte: { path: "x.md", linha_inicio: 10, linha_fim: 10 },
      link: "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii",
      norma: "Resolução CNE/CP nº 2/2026",
      notas: [],
      pai: "br/cne-cp/res/2026/2#art28",
      estrutura: [],
    };
    const texto = citacaoDoDispositivo({ dispositivo, norma: NORMA, nomeCurto: "Res. CNE/CP 2/2026, art. 28, XVIII" });
    expect(texto.split("\n")).toEqual([
      "“Art. 28. A estrutura do PPC deve conter, no mínimo: […]",
      "XVIII – o acompanhamento de egressos;”",
      "(Res. CNE/CP 2/2026, art. 28, XVIII)",
      "",
      referenciaDaNorma(NORMA),
    ]);
  });

  it("seção de PPC", () => {
    expect(
      citacaoDoPpc({
        curso: "Técnico em Enfermagem",
        campus: "Curitiba",
        secao: { titulo: "1.1.10 Carga horária", texto: "1.600 horas" },
      }),
    ).toBe(
      "“1.600 horas”\n(PPC do curso Técnico em Enfermagem, Campus Curitiba, seção “1.1.10 Carga horária”)\n\nINSTITUTO FEDERAL DO PARANÁ. Campus Curitiba. Projeto Pedagógico do Curso Técnico em Enfermagem.",
    );
  });

  it("nomes das relações nos dois sentidos", () => {
    expect(nomeDaRelacao("revoga", "saida")).toBe("Revoga");
    expect(nomeDaRelacao("revoga", "entrada")).toBe("Revogada por");
    expect(nomeDaRelacao("altera", "entrada")).toBe("Alterada por");
  });
});
