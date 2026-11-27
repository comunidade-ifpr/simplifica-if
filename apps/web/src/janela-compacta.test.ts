/**
 * O modo compacto do lado da interface (`janela-compacta.ts`), com a janela do desktop falsa: o pedido
 * recusado não liga a moldura, ⤢ no meio do pedido desiste dele, religar mantém o alfinete, e a navegação
 * para fora da vista compacta desliga o modo.
 */
import { describe, expect, it } from "vite-plus/test";
import { ControleJanelaCompacta, type EnderecoDaRota } from "./janela-compacta.ts";

/** A janela do desktop falsa: cada pedido de ligar espera a resposta do teste. */
function janelaFalsa() {
  const pedidos: Array<boolean> = [];
  const alfinete: Array<boolean> = [];
  const respostas: Array<(ligou: boolean) => void> = [];
  return {
    pedidos,
    alfinete,
    responder: (ligou: boolean) => respostas.shift()!(ligou),
    janela: {
      compacta: (ligar: boolean) => {
        pedidos.push(ligar);
        return ligar ? new Promise<boolean>((resolver) => respostas.push(resolver)) : Promise.resolve(false);
      },
      naFrente: async (sempre: boolean) => {
        alfinete.push(sempre);
      },
    },
  };
}

const naRevisao = ({ pathname, search }: EnderecoDaRota) => pathname === "/revisao-ppc" && search.compacto === 1;

describe("ControleJanelaCompacta", () => {
  it("o desktop que recusa (a tela cheia que não saiu a tempo) não liga a moldura", async () => {
    const falsa = janelaFalsa();
    const controle = new ControleJanelaCompacta(falsa.janela);
    const ligando = controle.ligar("Acompanhando o PPC", naRevisao);
    falsa.responder(false);
    expect(await ligando).toBe("recusada");
    expect(controle.obter().ligada).toBe(false);
  });

  it("⤢ (ou a navegação) no meio do pedido desiste dele e pede o desligar depois", async () => {
    const falsa = janelaFalsa();
    const controle = new ControleJanelaCompacta(falsa.janela);
    const ligando = controle.ligar("Acompanhando o PPC", naRevisao);
    controle.navegando({ pathname: "/", search: {} });
    falsa.responder(true);
    expect(await ligando).toBe("desistiu");
    expect(controle.obter().ligada).toBe(false);
    expect(falsa.pedidos).toEqual([true, false]);
  });

  it("religar com o modo ligado só troca o título: o alfinete solto continua solto", async () => {
    const falsa = janelaFalsa();
    const controle = new ControleJanelaCompacta(falsa.janela);
    const ligando = controle.ligar("Acompanhando o PPC", naRevisao);
    falsa.responder(true);
    expect(await ligando).toBe("ligada");
    await controle.fixarNaFrente(false);
    expect(await controle.ligar("Outro título", naRevisao)).toBe("ligada");
    expect(controle.obter()).toEqual({ ligada: true, naFrente: false, titulo: "Outro título" });
    expect(falsa.pedidos).toEqual([true]);
  });

  it("navegar dentro da vista compacta não desliga; para fora dela, desliga antes", async () => {
    const falsa = janelaFalsa();
    const controle = new ControleJanelaCompacta(falsa.janela);
    const ligando = controle.ligar("Acompanhando o PPC", naRevisao);
    falsa.responder(true);
    await ligando;
    controle.navegando({ pathname: "/revisao-ppc", search: { id: "outra", compacto: 1 } });
    expect(controle.obter().ligada).toBe(true);
    // Voltar no histórico, à revisão sem `compacto`: também sai.
    controle.navegando({ pathname: "/revisao-ppc", search: { id: "outra" } });
    expect(controle.obter().ligada).toBe(false);
    expect(falsa.pedidos).toEqual([true, false]);
  });

  it("o alfinete que responde depois de desligar e religar não muda o modo novo", async () => {
    const falsa = janelaFalsa();
    let soltar: () => void = () => {};
    const controle = new ControleJanelaCompacta({
      ...falsa.janela,
      naFrente: () =>
        new Promise<void>((resolver) => {
          soltar = resolver;
        }),
    });
    const ligando = controle.ligar("Acompanhando o PPC", naRevisao);
    falsa.responder(true);
    await ligando;
    const alfinete = controle.fixarNaFrente(false);
    await controle.desligar();
    const religando = controle.ligar("Acompanhando o PPC", naRevisao);
    falsa.responder(true);
    await religando;
    soltar();
    await alfinete;
    expect(controle.obter().naFrente).toBe(true);
  });
});
