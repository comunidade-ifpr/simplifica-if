import type { FichaCriterio, PendenciaRevisao } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, test } from "vite-plus/test";
import { textoDaPendencia } from "./conversa.ts";
import { nomeCurtoLink } from "../../tarefas/textos.ts";
import { comoConfere, nomeCriticidade, nomeDaReferencia, nomeEstadoCriterio, textoDoCriterio } from "./criterio.ts";

const ficha: FichaCriterio = {
  id: "CT-SUP-17",
  titulo: "Formação pedagógica e desenvolvimento docente previstos",
  criticidade: "obrigatorio",
  pergunta: "O PPC mostra a formação pedagógica?",
  normas: [],
  atendido: "Política de formação pedagógica.",
  naoAtendido: "Nenhuma menção.",
  aConferir: "Remissão genérica demais.",
  modo: "tematico",
  justificativa: null,
  secoes: ["Corpo docente", "Gestão do curso"],
  nestePpc: { estado: "a_conferir", mensagem: "", pendencia: null },
};

describe("a ficha do critério em linguagem de quem revisa", () => {
  test("como o app confere, pelo modo", () => {
    expect(comoConfere({ modo: "hibrido", secoes: [] })).toBe(
      "Híbrido — O app confere primeiro em código; se não conseguir concluir, a IA analisa o trecho.",
    );
    expect(comoConfere({ modo: "focal", secoes: ["X"] })).toBe(
      "Focal — O app localiza os trechos relevantes no PPC e a IA confirma o que eles dizem.",
    );
    expect(comoConfere(ficha)).toBe(
      "Temático — A IA julga as seções de Corpo docente e Gestão do curso; o app confere o trecho e as normas citadas.",
    );
    expect(comoConfere({ modo: "tematico", secoes: [] })).toMatch(/^Temático — A IA julga as seções inteiras/);
    expect(comoConfere({ modo: "transversal", secoes: [] })).toMatch(/^Transversal — A IA cruza os resumos/);
  });

  test("a criticidade e o estado por extenso", () => {
    expect(nomeCriticidade("bloqueante")).toBe("Bloqueia a submissão");
    expect(nomeCriticidade("XYZ")).toBe("XYZ");
    expect(nomeEstadoCriterio("atende")).toBe("em ordem");
    expect(nomeEstadoCriterio("nao_lido")).toBe("ainda não lido");
  });

  test("o texto do critério, e a pendência que o leva no lugar do título", () => {
    const texto = textoDoCriterio(ficha);
    expect(texto.split("\n")).toEqual([
      "Critério da revisão: CT-SUP-17 — Formação pedagógica e desenvolvimento docente previstos (Obrigatório)",
      "O que confere: O PPC mostra a formação pedagógica?",
      "Conta como atendido: Política de formação pedagógica.",
      "Não atendido: Nenhuma menção.",
      "Fica “a conferir” quando: Remissão genérica demais.",
    ]);
    const p = {
      titulo: "Sem formação pedagógica",
      explicacao: null,
      faltas: [],
      oQueFazer: "",
      secao: null,
      trecho: null,
      tituloFicha: ficha.titulo,
    } as unknown as PendenciaRevisao;
    expect(textoDaPendencia(p)).toBe(`Sem formação pedagógica\nCritério da revisão: ${ficha.titulo}`);
    expect(textoDaPendencia(p, texto)).toBe(`Sem formação pedagógica\n\n${texto}`);
  });

  test('o nome das referências: a norma pelo nome curto; o CNCT e a externa pelo título, não "Norma"', () => {
    const nome = (norma: string, tipo: "norma" | "cnct" | "externo", titulo: string | null) =>
      nomeDaReferencia({ norma, tipo, titulo }, nomeCurtoLink);
    expect(nome("br/cne-cp/res/2026/2", "norma", "Resolução CNE/CP nº 2/2026")).toBe("Res. CNE/CP 2/2026");
    expect(nome("cnct:catalogo", "cnct", "CNCT · Técnico em Agropecuária")).toBe("CNCT · Técnico em Agropecuária");
    expect(nome("externo:ifpr/pdi", "externo", "Plano de Desenvolvimento Institucional do IFPR")).toBe(
      "Plano de Desenvolvimento Institucional do IFPR",
    );
    expect(nome("externo:cft/res/2019/89", "externo", null)).toBe("cft/res/2019/89");
    expect(nome("xx/estranha", "norma", "Norma estranha")).toBe("Norma estranha");
  });
});
