import { describe, expect, test } from "vite-plus/test";
import type { PendenciaRevisao, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import { agruparPorTema, descreverCurso } from "./agrupar.ts";

const pendencia = (
  ficha: string,
  ordemTema: number,
  tema: string,
  estado: PendenciaRevisao["estado"],
): PendenciaRevisao => ({
  ficha,
  tituloFicha: ficha,
  tema,
  ordemTema,
  estado,
  mensagem: `mensagem ${ficha}`,
  oQueFazer: "fazer",
  trecho: null,
  secao: null,
  fontes: [],
  tambemEm: [],
  noDocumento: "no-inicio",
  origem: "codigo",
});

const resultado: ResultadoRevisaoPpc = {
  arquivoOriginal: "/a/PPC.docx",
  arquivoComentado: "/a/PPC - revisão prévia (Simplifica IF).docx",
  curso: {
    cnct: { slug: "tecnico-em-agropecuaria", denominacao: "Técnico em Agropecuária" },
    forma: "integrado",
    origem: "documento",
  },
  pendencias: [
    pendencia("CT-SUP-12", 5, "Fundamentos legais e normativos", "a_conferir"),
    pendencia("CT-SUP-09", 5, "Fundamentos legais e normativos", "nao_atende"),
    pendencia("CT-IDENT-01", 1, "Identificação e oferta", "nao_atende"),
  ],
  criterios: [
    {
      ficha: "CT-IDENT-13",
      titulo: "Eixo",
      tema: "Identificação e oferta",
      ordemTema: 1,
      estado: "atende",
      mensagem: "",
      origem: "codigo",
    },
    {
      ficha: "CT-CURR-18",
      titulo: "FGB",
      tema: "Matriz e estrutura curricular",
      ordemTema: 2,
      estado: "nao_se_aplica",
      mensagem: "",
      origem: "codigo",
    },
    {
      ficha: "CT-SUP-09",
      titulo: "Ref.",
      tema: "Fundamentos legais e normativos",
      ordemTema: 5,
      estado: "nao_atende",
      mensagem: "",
      origem: "codigo",
    },
  ],
  conferidos: 12,
  conferidosIa: 0,
  paraConferirIa: 0,
  foraDaRevisao: [],
  totalCriterios: 80,
  dataBase: "2026-11-13",
};

describe("agruparPorTema", () => {
  test("temas na ordem do parecer; no tema, o que precisa de ajuste antes do que é para conferir", () => {
    const grupos = agruparPorTema(resultado);
    expect(grupos.map((g) => g.tema)).toEqual([
      "Identificação e oferta",
      "Matriz e estrutura curricular",
      "Fundamentos legais e normativos",
    ]);
    expect(grupos[2]!.pendencias.map((p) => p.ficha)).toEqual(["CT-SUP-09", "CT-SUP-12"]);
    expect(grupos[0]!.semPendencia.map((c) => c.ficha)).toEqual(["CT-IDENT-13"]);
    expect(grupos[1]!.pendencias).toEqual([]);
    expect(grupos[2]!.semPendencia).toEqual([]);
  });

  test("o curso, em palavras", () => {
    expect(descreverCurso(resultado.curso)).toBe(
      "Técnico em Agropecuária, integrado ao ensino médio (identificado no documento).",
    );
    expect(descreverCurso({ cnct: null, forma: null, origem: "documento" })).toMatch(/^Não identificamos o curso/);
  });
});
