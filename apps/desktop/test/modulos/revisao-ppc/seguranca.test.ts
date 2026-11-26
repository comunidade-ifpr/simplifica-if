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
    expect(copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF).docx`, escolhidos)).toBeDefined();
    expect(
      copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF) (2).docx`, escolhidos),
    ).toBeDefined();
    expect(
      copiaComentadaPermitida(`${pasta}PPC Agro - revisão prévia (Simplifica IF) (99).docx`, escolhidos),
    ).toBeDefined();
    for (const recusado of [
      `${pasta}PPC Agro.docx`, // o original
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) (1).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF) (100).docx`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF).docm`,
      `${pasta}PPC Agro - revisão prévia (Simplifica IF).docx.app`,
      `${pasta}Outro - revisão prévia (Simplifica IF).docx`, // de um arquivo não escolhido
      "/Users/ana/Outra pasta/PPC Agro - revisão prévia (Simplifica IF).docx",
      `${pasta}../PPCs/PPC Agro - revisão prévia (Simplifica IF).docx`,
      "PPC Agro - revisão prévia (Simplifica IF).docx",
      42,
    ])
      expect(copiaComentadaPermitida(recusado, escolhidos), String(recusado)).toBeUndefined();
  });
});
