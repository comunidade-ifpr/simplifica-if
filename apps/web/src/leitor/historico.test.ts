import { describe, expect, it } from "@effect/vitest";
import { abrir, avancar, HISTORICO_VAZIO, linkAtual, podeAvancar, podeVoltar, voltar } from "./historico.ts";

describe("histórico do leitor", () => {
  it("abre, volta, avança e descarta o futuro ao abrir outro link", () => {
    let h = abrir(abrir(HISTORICO_VAZIO, "ifpr://norma/a"), "ifpr://norma/b");
    expect(linkAtual(h)).toBe("ifpr://norma/b");
    expect(podeVoltar(h)).toBe(true);
    expect(podeAvancar(h)).toBe(false);
    h = voltar(h);
    expect(linkAtual(h)).toBe("ifpr://norma/a");
    expect(podeAvancar(h)).toBe(true);
    expect(linkAtual(avancar(h))).toBe("ifpr://norma/b");
    h = abrir(h, "ifpr://ppc/c/d");
    expect(h.links).toEqual(["ifpr://norma/a", "ifpr://ppc/c/d"]);
    expect(podeAvancar(h)).toBe(false);
  });

  it("o mesmo link não duplica a entrada; voltar no começo não muda nada", () => {
    const h = abrir(HISTORICO_VAZIO, "ifpr://norma/a");
    expect(abrir(h, "ifpr://norma/a")).toBe(h);
    expect(voltar(h)).toBe(h);
    expect(linkAtual(HISTORICO_VAZIO)).toBeUndefined();
  });
});
