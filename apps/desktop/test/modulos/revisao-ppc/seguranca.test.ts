/**
 * As regras da ponte do desktop no módulo `revisao-ppc`: só sai do diálogo um `.docx` com caminho absoluto,
 * e só abre a cópia comentada de um `.docx` escolhido nesta execução ou, no Word, o próprio escolhido.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  caminhosDoServidor,
  copiaComentadaPermitida,
  docxEscolhido,
  documentoPermitido,
} from "../../../src/modulos/revisao-ppc/seguranca.ts";

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

  test("'Abrir no Word' abre também o próprio .docx escolhido (o acompanhado), e não outro", () => {
    const pasta = "/Users/ana/PPCs/";
    expect(documentoPermitido(`${pasta}PPC Agro.docx`, escolhidos)).toBe(`${pasta}PPC Agro.docx`);
    expect(
      documentoPermitido(`${pasta}PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx`, escolhidos),
    ).toBeDefined();
    for (const recusado of [
      `${pasta}Outro.docx`,
      `${pasta}../PPCs/PPC Agro.docx`,
      "/Users/ana/Outra pasta/PPC Agro.docx",
      "PPC Agro.docx",
      undefined,
    ])
      expect(documentoPermitido(recusado, escolhidos), String(recusado)).toBeUndefined();
  });

  test("acompanhados do servidor abrem no Word mas não viram raiz de cópia comentada", () => {
    const pasta = "/Users/ana/PPCs/";
    const acompanhado = `${pasta}PPC Agro editado.docx`;
    const acompanhados = new Set([acompanhado]);
    expect(documentoPermitido(acompanhado, escolhidos, acompanhados)).toBe(acompanhado);
    expect(
      copiaComentadaPermitida(
        `${pasta}PPC Agro editado - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx`,
        escolhidos,
      ),
    ).toBeUndefined();
  });

  test("caminhosDoServidor filtra entradas inválidas, relativas e fora de .docx, e normaliza", () => {
    expect(caminhosDoServidor(null)).toEqual({ originais: [], acompanhados: [] });
    expect(caminhosDoServidor("invalido")).toEqual({ originais: [], acompanhados: [] });
    expect(
      caminhosDoServidor({
        originais: [
          "/Users/ana/PPCs/../PPCs/PPC Agro.docx",
          "/Users/ana/PPCs/PPC Agro.docx",
          "/Users/ana/PPCs/anexo.pdf",
          "relativo.docx",
          42,
          "",
        ],
        acompanhados: [
          "/Users/ana/PPCs/PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx",
          "/Users/ana/PPCs/planilha.xlsx",
          null,
        ],
      }),
    ).toEqual({
      originais: ["/Users/ana/PPCs/PPC Agro.docx"],
      acompanhados: ["/Users/ana/PPCs/PPC Agro - revisão prévia (Simplifica IF) 2026-11-26 12h55.docx"],
    });
  });
});
