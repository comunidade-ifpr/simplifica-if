/**
 * As regras da ponte do desktop no módulo `revisao-ppc`: só sai do diálogo um `.docx` com caminho absoluto,
 * e só abre a cópia comentada de um `.docx` escolhido nesta execução.
 */
import { describe, expect, test } from "vite-plus/test";
import { copiaComentadaPermitida, docxEscolhido } from "../../../src/modulos/revisao-ppc/seguranca.ts";

describe("revisão prévia: o que a interface pode abrir", () => {
  const escolhidos = new Set(["/Users/ana/PPCs/PPC Agro.docx"]);

  test("só .docx com caminho absoluto sai do diálogo", () => {
    expect(docxEscolhido("/Users/ana/PPCs/PPC Agro.DOCX")).toBe("/Users/ana/PPCs/PPC Agro.DOCX");
    expect(docxEscolhido("/Users/ana/PPCs/PPC Agro.pdf")).toBeUndefined();
    expect(docxEscolhido("PPC Agro.docx")).toBeUndefined();
    expect(docxEscolhido(undefined)).toBeUndefined();
    // O `File` solto sem caminho (criado por script): `webUtils.getPathForFile` dá "".
    expect(docxEscolhido("")).toBeUndefined();
  });

  test("abre a cópia comentada de um arquivo escolhido, e nada mais", () => {
    const pasta = "/Users/ana/PPCs/";
    // Cada revisão com a sua cópia, com a data e a hora no nome; ` (2)` a ` (99)` se o nome estava ocupado.
    expect(
      copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx`, escolhidos),
    ).toBeDefined();
    expect(
      copiaComentadaPermitida(
        `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55 (2).docx`,
        escolhidos,
      ),
    ).toBeDefined();
    expect(
      copiaComentadaPermitida(
        `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55 (99).docx`,
        escolhidos,
      ),
    ).toBeDefined();
    for (const recusado of [
      `${pasta}PPC Agro.docx`, // o original
      `${pasta}PPC Agro - revisão prévia (Simplifica IF).docx`, // sem a data e a hora
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) (2).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55 (1).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55 (100).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26.docx`, // sem a hora
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55 ../x.docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) qualquer coisa.docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docm`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx.app`,
      `${pasta}Outro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx`, // de um arquivo não escolhido
      "/Users/ana/Outra pasta/PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx",
      `${pasta}../PPCs/PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx`,
      "PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx",
      42,
    ])
      expect(copiaComentadaPermitida(recusado, escolhidos), String(recusado)).toBeUndefined();
  });
});
