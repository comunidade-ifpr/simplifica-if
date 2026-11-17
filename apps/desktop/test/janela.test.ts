/**
 * A janela sem a barra de título do sistema: semáforos dentro da barra no macOS, overlay da mesma altura
 * no Windows e no Linux, e o fundo inicial conforme o tema.
 */
import { describe, expect, test } from "vite-plus/test";
import { ALTURA_BARRA_TITULO, corFundoJanela, opcoesBarraTitulo } from "../src/janela.ts";

describe("opcoesBarraTitulo", () => {
  test("macOS: hiddenInset, semáforos à esquerda e centralizados na barra", () => {
    const opcoes = opcoesBarraTitulo("darwin");
    expect(opcoes.titleBarStyle).toBe("hiddenInset");
    expect(opcoes.titleBarOverlay).toBeUndefined();
    const posicao = opcoes.trafficLightPosition!;
    expect(posicao.x).toBe(16);
    // O centro do botão (raio 7) cai no meio da barra.
    expect(posicao.y + 7).toBe(ALTURA_BARRA_TITULO / 2);
  });

  test.each(["win32", "linux"] as const)("%s: hidden com overlay transparente da altura da barra", (plataforma) => {
    const opcoes = opcoesBarraTitulo(plataforma);
    expect(opcoes.titleBarStyle).toBe("hidden");
    expect(opcoes.trafficLightPosition).toBeUndefined();
    expect(opcoes.titleBarOverlay).toEqual({ color: "#01000000", symbolColor: "#ffffff", height: ALTURA_BARRA_TITULO });
  });

  test("a altura bate com a da barra na interface", async () => {
    const { ALTURA_BARRA_TITULO: daInterface } = await import("../../web/src/barra-titulo.ts");
    expect(daInterface).toBe(ALTURA_BARRA_TITULO);
  });
});

describe("corFundoJanela", () => {
  test("o fundo da interface no tema claro e no escuro, nunca branco puro no escuro", () => {
    expect(corFundoJanela(false)).toBe("#fafafa");
    expect(corFundoJanela(true)).toBe("#121412");
  });
});
