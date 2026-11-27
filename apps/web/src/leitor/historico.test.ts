import { describe, expect, it } from "@effect/vitest";
import { abrir, avancar, HISTORICO_VAZIO, linkAtual, podeAvancar, podeVoltar, semLinks, voltar } from "./historico.ts";

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
    h = abrir(h, "ifpr://ppc/c/d/2024");
    expect(h.links).toEqual(["ifpr://norma/a", "ifpr://ppc/c/d/2024"]);
    expect(podeAvancar(h)).toBe(false);
  });

  it("o mesmo link não duplica a entrada; voltar no começo não muda nada", () => {
    const h = abrir(HISTORICO_VAZIO, "ifpr://norma/a");
    expect(abrir(h, "ifpr://norma/a")).toBe(h);
    expect(voltar(h)).toBe(h);
    expect(linkAtual(HISTORICO_VAZIO)).toBeUndefined();
  });

  it("sem os links de um documento que saiu: o atual fica, ou o de antes toma o lugar", () => {
    const apagado = (link: string) => link.startsWith("ifpr://revisao-ppc/x/");
    const trilha = ["ifpr://norma/a", "ifpr://revisao-ppc/x/1", "ifpr://norma/a", "ifpr://norma/b"];
    // o atual fica: os iguais que ficaram lado a lado viram um
    expect(semLinks({ links: trilha, posicao: 3 }, apagado)).toEqual({
      links: ["ifpr://norma/a", "ifpr://norma/b"],
      posicao: 1,
    });
    // o atual sai: o de antes dele
    expect(semLinks({ links: trilha, posicao: 1 }, apagado)).toEqual({
      links: ["ifpr://norma/a", "ifpr://norma/b"],
      posicao: 0,
    });
    // sem nenhum antes, o primeiro que ficou; sem nenhum, vazio
    expect(linkAtual(semLinks({ links: ["ifpr://revisao-ppc/x/1#p-1", "ifpr://norma/b"], posicao: 0 }, apagado))).toBe(
      "ifpr://norma/b",
    );
    expect(semLinks({ links: ["ifpr://revisao-ppc/x/1"], posicao: 0 }, apagado)).toEqual(HISTORICO_VAZIO);
    // nada a tirar: a mesma trilha
    const h = abrir(HISTORICO_VAZIO, "ifpr://norma/a");
    expect(semLinks(h, apagado)).toBe(h);
  });
});
