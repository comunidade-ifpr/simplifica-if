/**
 * Antes de fechar, a janela grava onde a pessoa estava (`antesDeSair.ts`), com janela e relógio falsos: o
 * fechamento espera a resposta do mesmo pedido, vinda da janela que o recebeu, ou o prazo, e segue sem janela.
 */
import { CANAIS } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, test } from "vite-plus/test";
import { criarGravacaoAoSair, ESPERA_SAIR_MS, fecharDepoisDeGravar } from "../src/antesDeSair.ts";

function montar(comJanela = true) {
  const enviados: Array<readonly [string, ...Array<unknown>]> = [];
  const prazos: Array<{ readonly acao: () => void; readonly ms: number; cancelado: boolean }> = [];
  const janela = {
    destruida: false,
    isDestroyed() {
      return this.destruida;
    },
    webContents: { send: (canal: string, ...argumentos: Array<unknown>) => void enviados.push([canal, ...argumentos]) },
  };
  const gravacao = criarGravacaoAoSair({
    janela: () => (comJanela ? janela : undefined),
    adiar: (acao, ms) => {
      const prazo = { acao, ms, cancelado: false };
      prazos.push(prazo);
      return () => {
        prazo.cancelado = true;
      };
    },
  });
  return { gravacao, enviados, prazos, janela };
}

/** Se a promessa já terminou, sem esperar relógio. */
async function terminou(promessa: Promise<void>): Promise<boolean> {
  let feito = false;
  void promessa.then(() => (feito = true));
  await Promise.resolve();
  await Promise.resolve();
  return feito;
}

describe("gravar antes de sair", () => {
  test("pede à janela e espera a resposta do mesmo pedido, vinda dela", async () => {
    const { gravacao, enviados, prazos, janela } = montar();
    const espera = gravacao.pedir();
    expect(enviados).toEqual([[CANAIS.antesDeSair, 1]]);
    expect(prazos[0]?.ms).toBe(ESPERA_SAIR_MS);
    // outra resposta (ou uma que não é número) não solta o fechamento
    gravacao.pronto(janela, 2);
    gravacao.pronto(janela, "1");
    // nem o número certo vindo de outra janela
    gravacao.pronto({ isDestroyed: () => false, webContents: { send: () => {} } }, 1);
    expect(await terminou(espera)).toBe(false);
    gravacao.pronto(janela, 1);
    expect(await terminou(espera)).toBe(true);
    expect(prazos[0]?.cancelado).toBe(true);
  });

  test("sem resposta, o prazo solta o fechamento", async () => {
    const { gravacao, prazos, janela } = montar();
    const espera = gravacao.pedir();
    prazos[0]!.acao();
    expect(await terminou(espera)).toBe(true);
    // a resposta que chega tarde não faz nada
    gravacao.pronto(janela, 1);
  });

  test("sem janela (ou já destruída), segue na hora", async () => {
    expect(await terminou(montar(false).gravacao.pedir())).toBe(true);
    const { gravacao, janela, enviados } = montar();
    janela.destruida = true;
    expect(await terminou(gravacao.pedir())).toBe(true);
    expect(enviados).toEqual([]);
  });

  test("a página que já se foi (o envio falha) solta o fechamento", async () => {
    const { gravacao, janela, prazos } = montar();
    janela.webContents.send = () => {
      throw new Error("Object has been destroyed");
    };
    expect(await terminou(gravacao.pedir())).toBe(true);
    expect(prazos[0]?.cancelado).toBe(true);
  });
});

describe("fechar a janela depois de gravar", () => {
  function montarFechamento(saindo = false) {
    let soltar: () => void = () => {};
    const pedidos: Array<number> = [];
    let fechou = 0;
    const aoFechar = fecharDepoisDeGravar({
      pedir: () => {
        pedidos.push(pedidos.length + 1);
        return new Promise<void>((resolver) => (soltar = resolver));
      },
      fechar: () => void (fechou += 1),
      saindo: () => saindo,
    });
    const fechar = () => {
      let segurou = false;
      aoFechar({ preventDefault: () => void (segurou = true) });
      return segurou;
    };
    return { fechar, pedidos, fechou: () => fechou, soltar: () => soltar() };
  }

  test("o segundo fechar, durante a gravação, também espera, sem pedir de novo", async () => {
    const { fechar, pedidos, fechou, soltar } = montarFechamento();
    expect(fechar()).toBe(true);
    expect(fechar()).toBe(true);
    expect(pedidos).toEqual([1]);
    expect(fechou()).toBe(0);
    soltar();
    await Promise.resolve();
    await Promise.resolve();
    expect(fechou()).toBe(1);
    // o `close` que ela dispara passa
    expect(fechar()).toBe(false);
  });

  test("saindo do app, fecha sem pedir (o `before-quit` já pediu)", () => {
    const { fechar, pedidos } = montarFechamento(true);
    expect(fechar()).toBe(false);
    expect(pedidos).toEqual([]);
  });
});
