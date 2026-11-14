import { describe, expect, test } from "vite-plus/test";
import type { Base, Resposta } from "../src/contratos.ts";
import { blocoItem, citacao, comLink, dataBr, montarTexto, rodape } from "../src/texto.ts";

const BASE_DEV: Base = { versao: "dev-ab12cd34", commit: null, data_referencia: "2026-11-13", canal: "dev" };
const BASE_PUBLICADA: Base = {
  versao: "2026.11.13",
  commit: "dc6b4470abcdef",
  data_referencia: "2026-11-13",
  canal: "beta",
};

function resposta(extras: Partial<Resposta<unknown>> = {}): Resposta<unknown> {
  return { base: BASE_DEV, dados: {}, avisos: [], ...extras };
}

describe("texto para a IA", () => {
  test("rodapé com commit (7 caracteres) e sem commit", () => {
    expect(rodape(BASE_PUBLICADA)).toBe("Base de 13/11/2026 (commit `dc6b447`).");
    expect(rodape(BASE_DEV)).toBe("Base de 13/11/2026 (versão dev).");
    expect(dataBr("2026-01-02")).toBe("02/01/2026");
  });

  test("item: título com link, texto literal em citação e linha de fonte", () => {
    const bloco = blocoItem({
      titulo: "Res. CNE/CP nº 2/2026, art. 28, XVIII",
      link: "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii",
      detalhe: "vigente",
      literal: "Art. 28. Os PPCs devem prever:\n\nXVIII - o acompanhamento de egressos.",
      fonte: { path: "base-conhecimento/normas/x.md", linha_inicio: 120, linha_fim: 123 },
    });
    expect(bloco).toBe(
      [
        "**[Res. CNE/CP nº 2/2026, art. 28, XVIII](ifpr://norma/br/cne-cp/res/2026/2#art28-xviii)** — vigente",
        "> Art. 28. Os PPCs devem prever:",
        ">",
        "> XVIII - o acompanhamento de egressos.",
        "fonte: `base-conhecimento/normas/x.md:120-123`",
      ].join("\n"),
    );
  });

  test("escapa colchetes no título do link", () => {
    expect(comLink("Lei [compilada]", "ifpr://norma/br/lei/1996/9394")).toBe(
      "[Lei \\[compilada\\]](ifpr://norma/br/lei/1996/9394)",
    );
    expect(citacao("uma linha")).toBe("> uma linha");
  });

  test("sem avisos: corpo e rodapé", () => {
    expect(montarTexto(resposta(), "Corpo.")).toBe("Corpo.\n\nBase de 13/11/2026 (versão dev).");
  });

  test("com avisos: linhas 'Atenção:' antes do corpo, rodapé por último", () => {
    const texto = montarTexto(
      resposta({
        base: BASE_PUBLICADA,
        avisos: [
          { tipo: "vigencia-a-confirmar", mensagem: "vigência a confirmar.", ref: "br/cne-cp/res/2026/2" },
          { tipo: "correspondencia-rascunho", mensagem: "a tabela é rascunho." },
        ],
      }),
      "Corpo.",
    );
    expect(texto).toBe(
      [
        "Atenção: vigência a confirmar. (`br/cne-cp/res/2026/2`)",
        "Atenção: a tabela é rascunho.",
        "",
        "Corpo.",
        "",
        "Base de 13/11/2026 (commit `dc6b447`).",
      ].join("\n"),
    );
  });

  test("com página seguinte: diz como continuar", () => {
    const texto = montarTexto(resposta({ pagina: { total: 40, devolvidos: 30, cursor: "abc" } }), "Corpo.");
    expect(texto).toContain(
      'Mostrando 30 de 40. Para continuar, chame de novo com os mesmos filtros e `cursor: "abc"`.',
    );
    expect(texto.endsWith("Base de 13/11/2026 (versão dev).")).toBe(true);
  });
});
