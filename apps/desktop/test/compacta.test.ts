/**
 * O modo compacto da janela (`compacta.ts`), com `BrowserWindow` e `screen` falsos: a coluna encostada à
 * direita da área útil da tela da janela, o tamanho mínimo, o "sempre por cima" sem mexer nas mesas do
 * macOS (o Dock fica), o maximizar e a tela cheia impedidos, o alfinete, a reserva da saída da tela cheia
 * que falha, e a restauração das medidas (numa tela que ainda existe), do maximizado e da tela cheia.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  criarJanelaCompacta,
  ESPERA_TELA_CHEIA_MS,
  type JanelaCompactavel,
  LARGURA_COMPACTA,
  medidasNumaTela,
  MINIMO_COMPACTO,
  MINIMO_NORMAL,
  type Retangulo,
  retanguloCompacto,
} from "../src/compacta.ts";
import { porJanela } from "../src/janelas.ts";

/** Uma `BrowserWindow` falsa: guarda as medidas e o que lhe pediram, na ordem. */
class JanelaFalsa implements JanelaCompactavel {
  medidas: Retangulo;
  normais: Retangulo;
  maximizada = false;
  telaCheia = false;
  destruida = false;
  maximizavel = true;
  telaCheiavel = true;
  minimo: { largura: number; altura: number } = { largura: MINIMO_NORMAL.largura, altura: MINIMO_NORMAL.altura };
  sempre: { readonly ligado: boolean; readonly nivel?: string } = { ligado: false };
  readonly passos: Array<string> = [];
  /** Quem espera o fim da saída da tela cheia (a animação do macOS termina só quando o teste manda). */
  readonly ouvintes = new Set<() => void>();

  constructor(medidas: Retangulo) {
    this.medidas = medidas;
    this.normais = medidas;
  }
  isDestroyed() {
    return this.destruida;
  }
  isMaximized() {
    return this.maximizada;
  }
  isFullScreen() {
    return this.telaCheia;
  }
  isMaximizable() {
    return this.maximizavel;
  }
  isFullScreenable() {
    return this.telaCheiavel;
  }
  getBounds() {
    return this.medidas;
  }
  getNormalBounds() {
    return this.normais;
  }
  setBounds(medidas: Retangulo) {
    this.passos.push("setBounds");
    this.medidas = medidas;
    this.normais = medidas;
  }
  setMinimumSize(largura: number, altura: number) {
    this.passos.push("setMinimumSize");
    this.minimo = { largura, altura };
  }
  maximize() {
    this.passos.push("maximize");
    this.maximizada = true;
  }
  unmaximize() {
    this.passos.push("unmaximize");
    this.maximizada = false;
    this.medidas = this.normais;
  }
  setFullScreen(telaCheia: boolean) {
    this.passos.push(`setFullScreen(${telaCheia})`);
    if (telaCheia) this.telaCheia = true;
  }
  setMaximizable(maximizavel: boolean) {
    this.passos.push(`setMaximizable(${maximizavel})`);
    this.maximizavel = maximizavel;
  }
  setFullScreenable(telaCheiavel: boolean) {
    this.passos.push(`setFullScreenable(${telaCheiavel})`);
    this.telaCheiavel = telaCheiavel;
  }
  setAlwaysOnTop(ligado: boolean, nivel?: "floating") {
    this.passos.push(`setAlwaysOnTop(${ligado})`);
    this.sempre = nivel === undefined ? { ligado } : { ligado, nivel };
  }
  once(_evento: "leave-full-screen", ouvinte: () => void) {
    this.ouvintes.add(ouvinte);
    return this;
  }
  removeListener(_evento: "leave-full-screen", ouvinte: () => void) {
    // Como o Electron: método de janela destruída lança.
    if (this.destruida) throw new TypeError("Object has been destroyed");
    this.ouvintes.delete(ouvinte);
    return this;
  }
  /** A animação da saída da tela cheia termina. */
  saiuDaTelaCheia() {
    this.telaCheia = false;
    const ouvintes = [...this.ouvintes];
    this.ouvintes.clear();
    for (const ouvinte of ouvintes) ouvinte();
  }
}

/** Duas telas lado a lado; a da direita com a barra de tarefas embaixo (área útil menor que a tela). */
const TELA_ESQUERDA: Retangulo = { x: 0, y: 25, width: 1366, height: 743 };
const TELA_DIREITA: Retangulo = { x: 1366, y: 0, width: 1920, height: 1040 };

function montar(janela: JanelaFalsa) {
  const consultas: Array<Retangulo> = [];
  const telas = [TELA_ESQUERDA, TELA_DIREITA];
  const adiados: Array<{ readonly acao: () => void; readonly ms: number; cancelada: boolean }> = [];
  const compacta = criarJanelaCompacta({
    janela: () => janela,
    tela: {
      getDisplayMatching: (retangulo) => {
        consultas.push(retangulo);
        return {
          workArea: retangulo.x >= TELA_DIREITA.x && telas.includes(TELA_DIREITA) ? TELA_DIREITA : TELA_ESQUERDA,
        };
      },
      getAllDisplays: () => telas.map((workArea) => ({ workArea })),
    },
    adiar: (acao, ms) => {
      const adiado = { acao, ms, cancelada: false };
      adiados.push(adiado);
      return () => {
        adiado.cancelada = true;
      };
    },
  });
  return { compacta, consultas, adiados, telas };
}

describe("retanguloCompacto", () => {
  test("a coluna na borda direita da área útil, com a altura toda", () => {
    expect(retanguloCompacto(TELA_ESQUERDA)).toEqual({ x: 1366 - LARGURA_COMPACTA, y: 25, width: 380, height: 743 });
    expect(retanguloCompacto(TELA_DIREITA)).toEqual({ x: 1366 + 1920 - 380, y: 0, width: 380, height: 1040 });
    // Numa tela mais estreita que a coluna, a coluna é a tela.
    expect(retanguloCompacto({ x: 0, y: 0, width: 300, height: 500 })).toEqual({ x: 0, y: 0, width: 300, height: 500 });
  });
});

describe("medidasNumaTela", () => {
  test("ficam as medidas que caem numa tela; as de uma tela que saiu vão ao centro da tela da coluna", () => {
    const naDireita = { x: 1500, y: 80, width: 1280, height: 820 };
    expect(medidasNumaTela(naDireita, [TELA_ESQUERDA, TELA_DIREITA], TELA_ESQUERDA)).toEqual(naDireita);
    // Só uma beirada de 20 px na tela não deixa alcançar a barra de título.
    expect(medidasNumaTela({ x: 1346, y: 80, width: 800, height: 600 }, [TELA_ESQUERDA], TELA_ESQUERDA)).toEqual({
      x: 283,
      y: 97,
      width: 800,
      height: 600,
    });
    // Maior que a tela que fica: cabe nela.
    expect(medidasNumaTela(naDireita, [TELA_ESQUERDA], TELA_ESQUERDA)).toEqual({
      x: 43,
      y: 25,
      width: 1280,
      height: 743,
    });
  });
});

describe("modo compacto", () => {
  test("macOS: encosta à direita da tela da janela, troca o mínimo, fica por cima sem mexer no Dock e restaura", async () => {
    const janela = new JanelaFalsa({ x: 1500, y: 80, width: 1280, height: 820 });
    const { compacta, consultas } = montar(janela);

    expect(await compacta.compactar(true)).toBe(true);
    expect(compacta.ligada()).toBe(true);
    expect(compacta.porCima()).toBe(true);
    expect(consultas).toEqual([{ x: 1500, y: 80, width: 1280, height: 820 }]);
    expect(janela.medidas).toEqual({ x: 1366 + 1920 - 380, y: 0, width: 380, height: 1040 });
    expect(janela.minimo).toEqual({ largura: MINIMO_COMPACTO.largura, altura: MINIMO_COMPACTO.altura });
    // A coluna não se maximiza nem vai à tela cheia; o mínimo cai antes de encolher (com o de 800 px, a coluna
    // não caberia).
    expect(janela.passos).toEqual([
      "setMaximizable(false)",
      "setFullScreenable(false)",
      "setMinimumSize",
      "setBounds",
      "setAlwaysOnTop(true)",
    ]);
    expect(janela.sempre).toEqual({ ligado: true, nivel: "floating" });

    // Ligar de novo não guarda a coluna como as medidas de antes.
    expect(await compacta.compactar(true)).toBe(true);

    // O alfinete solta e prende só o "sempre por cima".
    janela.passos.length = 0;
    await compacta.naFrente(false);
    expect(janela.sempre).toEqual({ ligado: false });
    expect(compacta.porCima()).toBe(false);
    await compacta.naFrente(true);
    expect(janela.sempre).toEqual({ ligado: true, nivel: "floating" });
    expect(compacta.porCima()).toBe(true);
    expect(janela.passos).toEqual(["setAlwaysOnTop(false)", "setAlwaysOnTop(true)"]);

    expect(await compacta.compactar(false)).toBe(false);
    expect(compacta.ligada()).toBe(false);
    expect(compacta.porCima()).toBe(false);
    expect(janela.medidas).toEqual({ x: 1500, y: 80, width: 1280, height: 820 });
    expect(janela.minimo).toEqual({ largura: MINIMO_NORMAL.largura, altura: MINIMO_NORMAL.altura });
    expect(janela.sempre).toEqual({ ligado: false });
    expect(janela.maximizavel).toBe(true);
    expect(janela.telaCheiavel).toBe(true);
    expect(janela.maximizada).toBe(false);

    // Fora do modo, o alfinete não mexe na janela.
    await compacta.naFrente(true);
    expect(janela.sempre).toEqual({ ligado: false });
  });

  test("Windows: maximizada, sai do maximizado, fica por cima e volta maximizada", async () => {
    const janela = new JanelaFalsa({ x: 0, y: 0, width: 1366, height: 728 });
    janela.normais = { x: 100, y: 60, width: 1000, height: 640 };
    janela.maximizada = true;
    const { compacta } = montar(janela);

    await compacta.compactar(true);
    expect(janela.maximizada).toBe(false);
    expect(janela.passos.slice(0, 2)).toEqual(["unmaximize", "setMaximizable(false)"]);
    expect(janela.medidas).toEqual({ x: 1366 - 380, y: 25, width: 380, height: 743 });
    expect(janela.sempre).toEqual({ ligado: true, nivel: "floating" });

    janela.passos.length = 0;
    await compacta.compactar(false);
    // As medidas de antes de maximizar, e o maximizado de volta.
    expect(janela.passos).toEqual([
      "setAlwaysOnTop(false)",
      "setMaximizable(true)",
      "setFullScreenable(true)",
      "setBounds",
      "setMinimumSize",
      "maximize",
    ]);
    expect(janela.normais).toEqual({ x: 100, y: 60, width: 1000, height: 640 });
    expect(janela.maximizada).toBe(true);
    expect(janela.sempre).toEqual({ ligado: false });
  });

  test("em tela cheia: espera sair dela antes de encolher, cancela a reserva, e volta à tela cheia ao desligar", async () => {
    const janela = new JanelaFalsa({ x: 0, y: 0, width: 1366, height: 768 });
    janela.normais = { x: 40, y: 40, width: 1200, height: 700 };
    janela.telaCheia = true;
    const { compacta, adiados } = montar(janela);

    const ligando = compacta.compactar(true);
    // Os pedidos vão numa fila: o primeiro começa no próximo microtask.
    await Promise.resolve();
    // Ainda na animação: nada encolheu, e o alfinete pedido agora espera a vez.
    expect(janela.passos).toEqual(["setFullScreen(false)"]);
    expect(compacta.ligada()).toBe(false);
    const alfinete = compacta.naFrente(false);
    janela.saiuDaTelaCheia();
    expect(await ligando).toBe(true);
    await alfinete;
    expect(janela.medidas).toEqual({ x: 1366 - 380, y: 25, width: 380, height: 743 });
    expect(janela.sempre).toEqual({ ligado: false });
    // A espera de reserva foi cancelada: não fica um relógio à toa.
    expect(adiados.map((a) => [a.ms, a.cancelada])).toEqual([[ESPERA_TELA_CHEIA_MS, true]]);

    await compacta.compactar(false);
    expect(janela.medidas).toEqual({ x: 40, y: 40, width: 1200, height: 700 });
    expect(janela.passos.at(-1)).toBe("setFullScreen(true)");
  });

  test("a reserva da tela cheia que vence com a janela ainda nela: o modo não liga, e o ouvinte sai", async () => {
    const janela = new JanelaFalsa({ x: 0, y: 0, width: 1366, height: 768 });
    janela.telaCheia = true;
    const { compacta, adiados } = montar(janela);
    const ligando = compacta.compactar(true);
    await Promise.resolve();
    adiados[0]!.acao();
    expect(await ligando).toBe(false);
    expect(compacta.ligada()).toBe(false);
    expect(janela.ouvintes.size).toBe(0);
    expect(janela.passos).toEqual(["setFullScreen(false)"]);
    expect(janela.sempre).toEqual({ ligado: false });
    // O fim da animação, mais tarde, não encolhe nada; ⤢ não tem o que desfazer.
    janela.saiuDaTelaCheia();
    expect(await compacta.compactar(false)).toBe(false);
    expect(janela.passos).toEqual(["setFullScreen(false)"]);
  });

  test("a reserva que vence com a janela já fora da tela cheia (o aviso não chegou) encolhe", async () => {
    const janela = new JanelaFalsa({ x: 0, y: 0, width: 1366, height: 768 });
    janela.telaCheia = true;
    const { compacta, adiados } = montar(janela);
    const ligando = compacta.compactar(true);
    await Promise.resolve();
    janela.telaCheia = false;
    adiados[0]!.acao();
    expect(await ligando).toBe(true);
    expect(janela.medidas.width).toBe(380);
  });

  test("a coluna maximizada ou em tela cheia mesmo assim sai dela antes de restaurar", async () => {
    const janela = new JanelaFalsa({ x: 100, y: 100, width: 1000, height: 600 });
    const { compacta } = montar(janela);
    await compacta.compactar(true);
    janela.maximizada = true;
    janela.passos.length = 0;
    await compacta.compactar(false);
    expect(janela.passos.slice(3)).toEqual(["unmaximize", "setBounds", "setMinimumSize"]);
    expect(janela.medidas).toEqual({ x: 100, y: 100, width: 1000, height: 600 });
    expect(janela.maximizada).toBe(false);

    await compacta.compactar(true);
    janela.telaCheia = true;
    janela.passos.length = 0;
    const desligando = compacta.compactar(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(janela.passos.at(-1)).toBe("setFullScreen(false)");
    janela.saiuDaTelaCheia();
    await desligando;
    expect(janela.passos.slice(-2)).toEqual(["setBounds", "setMinimumSize"]);
    expect(janela.medidas).toEqual({ x: 100, y: 100, width: 1000, height: 600 });
    expect(janela.telaCheia).toBe(false);
  });

  test("a tela em que a janela estava saiu: as medidas voltam ao centro da tela da coluna", async () => {
    const janela = new JanelaFalsa({ x: 1500, y: 80, width: 1280, height: 820 });
    const { compacta, telas } = montar(janela);
    await compacta.compactar(true);
    // O monitor da direita é desligado, e o sistema leva a coluna para a tela que ficou.
    telas.pop();
    janela.medidas = retanguloCompacto(TELA_ESQUERDA);
    await compacta.compactar(false);
    expect(janela.medidas).toEqual({ x: 43, y: 25, width: 1280, height: 743 });
  });

  test("ligar e desligar logo depois (a página recarregada): termina desligado", async () => {
    const janela = new JanelaFalsa({ x: 100, y: 100, width: 1000, height: 600 });
    const { compacta } = montar(janela);
    const ligando = compacta.compactar(true);
    const desligando = compacta.compactar(false);
    expect(await ligando).toBe(true);
    expect(await desligando).toBe(false);
    expect(compacta.ligada()).toBe(false);
    expect(janela.medidas).toEqual({ x: 100, y: 100, width: 1000, height: 600 });
  });

  test("a janela fechada esquece o modo; a destruída não recebe pedido", async () => {
    const janela = new JanelaFalsa({ x: 0, y: 0, width: 1280, height: 820 });
    const { compacta } = montar(janela);
    await compacta.compactar(true);
    compacta.esquecer();
    expect(compacta.ligada()).toBe(false);
    expect(compacta.porCima()).toBe(false);
    janela.destruida = true;
    janela.passos.length = 0;
    expect(await compacta.compactar(true)).toBe(false);
    await compacta.compactar(false);
    expect(janela.passos).toEqual([]);
    expect(compacta.ligada()).toBe(false);
  });

  test("a janela que fecha no meio da saída da tela cheia: a espera acaba já, sem relógio nem erro", async () => {
    const janela = new JanelaFalsa({ x: 100, y: 100, width: 1000, height: 600 });
    janela.telaCheia = true;
    const { compacta, adiados } = montar(janela);
    const compactas = porJanela(
      (_janela: JanelaFalsa) => compacta,
      (valor) => valor.esquecer(),
    );
    const ligando = compactas.de(janela).compactar(true);
    await Promise.resolve();
    expect(adiados).toHaveLength(1);
    janela.destruida = true;
    compactas.esquecer(janela);
    expect(await ligando).toBe(false);
    expect(adiados[0]?.cancelada).toBe(true);
    // O relógio que vencesse mesmo assim não mexe na janela destruída.
    expect(() => adiados[0]?.acao()).not.toThrow();
  });

  test("a reserva que vence com a janela já destruída não lança", async () => {
    const janela = new JanelaFalsa({ x: 100, y: 100, width: 1000, height: 600 });
    janela.telaCheia = true;
    const { compacta, adiados } = montar(janela);
    const ligando = compacta.compactar(true);
    await Promise.resolve();
    janela.destruida = true;
    expect(() => adiados[0]?.acao()).not.toThrow();
    expect(await ligando).toBe(false);
  });

  test("várias janelas: cada uma tem o seu modo compacto, e a fechada esquece só o dela", async () => {
    const primeira = new JanelaFalsa({ x: 100, y: 100, width: 1000, height: 600 });
    const segunda = new JanelaFalsa({ x: 200, y: 150, width: 1000, height: 600 });
    const compactas = porJanela((janela: JanelaFalsa) => montar(janela).compacta);
    expect(await compactas.de(segunda).compactar(true)).toBe(true);
    expect(compactas.de(segunda).porCima()).toBe(true);
    expect(segunda.medidas.width).toBe(LARGURA_COMPACTA);
    // A primeira continua inteira, sem nenhum pedido.
    expect(compactas.existente(primeira)).toBeUndefined();
    expect(primeira.passos).toEqual([]);
    expect(compactas.de(primeira).ligada()).toBe(false);
    compactas.esquecer(primeira);
    expect(compactas.existente(primeira)).toBeUndefined();
    expect(compactas.de(segunda).ligada()).toBe(true);
    expect(await compactas.de(segunda).compactar(false)).toBe(false);
    expect(segunda.medidas).toEqual({ x: 200, y: 150, width: 1000, height: 600 });
  });
});
