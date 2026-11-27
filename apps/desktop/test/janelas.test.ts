/**
 * As várias janelas (`janelas.ts`), com `BrowserWindow` falsas: o conjunto na ordem de uso, a principal, a
 * última usada (a do `second-instance` e dos atalhos), o teto de janelas, a continuidade de cada janela nova,
 * as medidas dela dentro da tela, o remetente do IPC conferido por janela (também a janela fechando), e a
 * rota de uma janela nova recusada quando não é do app.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  argumentosDaContinuidade,
  continuidadeDaJanelaNova,
  continuidadeDoArgv,
  criarConjuntoJanelas,
  MAXIMO_JANELAS,
  MAXIMO_ROTA_JANELA,
  medidasDaJanelaNova,
  remetenteConfiavel,
  remetenteDoEvento,
  rotaDaPagina,
  rotaValida,
  TAMANHO_JANELA,
  urlDaRota,
} from "../src/janelas.ts";
import { isSameOriginRendererNavigation } from "../src/seguranca.ts";

/** Uma `BrowserWindow` falsa: o `webContents` com o quadro principal. */
function janelaFalsa(nome: string) {
  const quadroPrincipal = { nome: `${nome}:quadro` };
  return {
    nome,
    destruida: false,
    isDestroyed() {
      return this.destruida;
    },
    webContents: { nome: `${nome}:conteudo`, mainFrame: quadroPrincipal },
  };
}

type JanelaFalsa = ReturnType<typeof janelaFalsa>;

const URL_APP = "http://localhost:5733/";
const mesmaOrigem = (url: string) => isSameOriginRendererNavigation({ applicationUrl: URL_APP, navigationUrl: url });

/** O pedido do IPC vindo do quadro principal de `janela`, na URL dada. */
const pedidoDe = (janela: JanelaFalsa, url = `${URL_APP}conversa?id=a`) => ({
  janela,
  conteudo: janela.webContents,
  conteudoDaJanela: janela.webContents,
  quadro: janela.webContents.mainFrame,
  quadroPrincipal: janela.webContents.mainFrame,
  urlQuadro: url,
});

describe("conjunto das janelas", () => {
  test("a primeira é a principal; a última usada segue o foco e, fechada, passa à anterior", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const a = janelaFalsa("a");
    const b = janelaFalsa("b");
    const c = janelaFalsa("c");
    expect(janelas.ultimaUsada()).toBeUndefined();
    janelas.adicionar(a);
    janelas.adicionar(b);
    janelas.adicionar(c);
    expect(janelas.principal()).toBe(a);
    // Sem foco nenhum ainda, a mais nova.
    expect(janelas.ultimaUsada()).toBe(c);
    janelas.usada(a);
    expect(janelas.ultimaUsada()).toBe(a);
    expect(janelas.todas()).toEqual([b, c, a]);
    janelas.remover(a);
    expect(janelas.principal()).toBeUndefined();
    expect(janelas.ultimaUsada()).toBe(c);
    // A destruída (fechando) já não conta.
    c.destruida = true;
    expect(janelas.ultimaUsada()).toBe(b);
    expect(janelas.tem(c)).toBe(false);
    // O foco de uma janela que não é do conjunto não muda nada.
    janelas.usada(janelaFalsa("x"));
    expect(janelas.todas()).toEqual([b]);
  });

  test("fechadas todas, a próxima janela volta a ser a principal", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const a = janelaFalsa("a");
    janelas.adicionar(a);
    janelas.remover(a);
    const b = janelaFalsa("b");
    janelas.adicionar(b);
    expect(janelas.principal()).toBe(b);
  });
});

describe("janela nova", () => {
  test("a principal destruída, ainda no conjunto (antes do `closed`), cede o lugar à nova", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const a = janelaFalsa("a");
    janelas.adicionar(a);
    a.destruida = true;
    const b = janelaFalsa("b");
    janelas.adicionar(b);
    janelas.remover(a);
    expect(janelas.principal()).toBe(b);
  });

  test("no máximo `MAXIMO_JANELAS` abertas; a destruída não conta", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const abertas = Array.from({ length: MAXIMO_JANELAS }, (_, i) => janelaFalsa(String(i)));
    for (const janela of abertas.slice(0, -1)) janelas.adicionar(janela);
    expect(janelas.cabeMais()).toBe(true);
    janelas.adicionar(abertas.at(-1)!);
    expect(janelas.cabeMais()).toBe(false);
    abertas[0]!.destruida = true;
    expect(janelas.cabeMais()).toBe(true);
  });

  test("a continuidade: a do app grava e volta; sem principal, a pedida grava sem voltar; com ela, nenhuma", () => {
    expect(continuidadeDaJanelaNova(false, false)).toBe("completa");
    expect(continuidadeDaJanelaNova(false, true)).toBe("so-grava");
    expect(continuidadeDaJanelaNova(true, true)).toBe("nenhuma");
    for (const modo of ["completa", "so-grava", "nenhuma"] as const)
      expect(continuidadeDoArgv(["electron", "--type=renderer", ...argumentosDaContinuidade(modo)])).toBe(modo);
    expect(argumentosDaContinuidade("completa")).toEqual([]);
    expect(continuidadeDoArgv(["--simplifica-continuidade=outra"])).toBe("completa");
  });

  const AREA = { x: 0, y: 25, width: 1440, height: 875 };

  test("em cascata a partir da que pediu, voltando à borda da área útil quando não cabe", () => {
    const { largura, altura } = TAMANHO_JANELA;
    expect(medidasDaJanelaNova({ x: 50, y: 40, width: 1280, height: 820 }, AREA, false)).toEqual({
      x: 78,
      y: 68,
      width: largura,
      height: altura,
    });
    // Perto da borda direita e de baixo: a cascata recomeça no canto.
    expect(medidasDaJanelaNova({ x: 150, y: 60, width: 1280, height: 820 }, AREA, false)).toEqual({
      x: 0,
      y: 25,
      width: largura,
      height: altura,
    });
  });

  test("a partir da coluna compacta (ou da maximizada): o tamanho normal, no centro da tela dela", () => {
    const coluna = { x: AREA.width - 380, y: 25, width: 380, height: 875 };
    const medidas = medidasDaJanelaNova(coluna, AREA, true);
    expect(medidas).toEqual({ x: 80, y: 53, width: 1280, height: 820 });
    expect(medidas.x + medidas.width).toBeLessThanOrEqual(AREA.x + AREA.width);
  });

  test("na tela menor que o tamanho normal, cabe nela", () => {
    const pequena = { x: 1440, y: 0, width: 1024, height: 700 };
    for (const centro of [false, true])
      expect(medidasDaJanelaNova({ x: 1500, y: 10, width: 1000, height: 600 }, pequena, centro)).toEqual({
        x: 1440,
        y: 0,
        width: 1024,
        height: 700,
      });
  });
});

describe("remetente do IPC", () => {
  test("o evento da janela fechando não é lido: nada de `webContents` nem de quadro", () => {
    const a = janelaFalsa("a");
    const destruido = () => {
      throw new TypeError("Object has been destroyed");
    };
    const conteudo = (destruidoJa: boolean) => ({
      isDestroyed: () => destruidoJa,
      get mainFrame() {
        return destruidoJa ? destruido() : a.webContents.mainFrame;
      },
    });
    expect(remetenteDoEvento({ sender: conteudo(true), senderFrame: null }, () => destruido())).toBeUndefined();
    a.destruida = true;
    expect(remetenteDoEvento({ sender: conteudo(false), senderFrame: { url: URL_APP } }, () => a)).toBeUndefined();
    expect(remetenteDoEvento({ sender: conteudo(false), senderFrame: { url: URL_APP } }, () => null)).toBeUndefined();
    // O quadro que já se foi (ler a URL lança).
    a.destruida = false;
    const quadroQueSeFoi = {
      get url(): string {
        return destruido();
      },
    };
    expect(remetenteDoEvento({ sender: conteudo(false), senderFrame: quadroQueSeFoi }, () => a)).toBeUndefined();
    expect(remetenteDoEvento({ sender: conteudo(false), senderFrame: { url: URL_APP } }, () => a)).toMatchObject({
      janela: a,
      conteudoDaJanela: a.webContents,
      quadroPrincipal: a.webContents.mainFrame,
      urlQuadro: URL_APP,
    });
  });

  test("atende qualquer janela do conjunto, no quadro principal e na origem da interface", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const a = janelaFalsa("a");
    const b = janelaFalsa("b");
    janelas.adicionar(a);
    janelas.adicionar(b);
    expect(remetenteConfiavel(pedidoDe(a), janelas, mesmaOrigem)).toBe(true);
    expect(remetenteConfiavel(pedidoDe(b), janelas, mesmaOrigem)).toBe(true);
  });

  test("recusa a janela de fora do conjunto, a fechada, outro quadro, outro conteúdo e outra origem", () => {
    const janelas = criarConjuntoJanelas<JanelaFalsa>();
    const a = janelaFalsa("a");
    const b = janelaFalsa("b");
    janelas.adicionar(a);
    janelas.adicionar(b);
    expect(remetenteConfiavel(pedidoDe(janelaFalsa("intrusa")), janelas, mesmaOrigem)).toBe(false);
    expect(remetenteConfiavel({ ...pedidoDe(a), janela: null }, janelas, mesmaOrigem)).toBe(false);
    expect(remetenteConfiavel({ ...pedidoDe(a), quadro: { nome: "iframe" } }, janelas, mesmaOrigem)).toBe(false);
    expect(remetenteConfiavel({ ...pedidoDe(a), quadro: null }, janelas, mesmaOrigem)).toBe(false);
    // O conteúdo de uma janela com a janela de outra.
    expect(remetenteConfiavel({ ...pedidoDe(a), conteudoDaJanela: b.webContents }, janelas, mesmaOrigem)).toBe(false);
    expect(remetenteConfiavel(pedidoDe(a, "https://exemplo.org/"), janelas, mesmaOrigem)).toBe(false);
    expect(remetenteConfiavel({ ...pedidoDe(a), urlQuadro: undefined }, janelas, mesmaOrigem)).toBe(false);
    b.destruida = true;
    expect(remetenteConfiavel(pedidoDe(b), janelas, mesmaOrigem)).toBe(false);
    janelas.remover(a);
    expect(remetenteConfiavel(pedidoDe(a), janelas, mesmaOrigem)).toBe(false);
  });
});

describe("rota da janela nova", () => {
  test("aceita a rota do app, como a continuidade a guarda", () => {
    for (const rota of [
      "/",
      "/conversa?id=abc",
      "/revisao-ppc?id=r1",
      "/explorar/ver?link=ifpr%3A%2F%2Fnorma%2Fbr%2Fcne-cp%2Fres%2F2021%2F1",
    ])
      expect(rotaValida(rota, MAXIMO_ROTA_JANELA)).toBe(rota);
    expect(urlDaRota(URL_APP, "/conversa?id=abc")).toBe("http://localhost:5733/conversa?id=abc");
    expect(urlDaRota("simplifica://app/", "/explorar")).toBe("simplifica://app/explorar");
  });

  test.each([
    "https://exemplo.org/",
    "//exemplo.org/conversa",
    "/\\exemplo.org/conversa",
    "javascript:alert(1)",
    "conversa?id=abc",
    "/conversa\r\nid=abc",
    "/conversa\u0000",
    "",
    `/${"a".repeat(MAXIMO_ROTA_JANELA)}`,
    42,
    null,
  ])("recusa a rota que não é do app: %j", (rota) => {
    expect(rotaValida(rota, MAXIMO_ROTA_JANELA)).toBeUndefined();
  });

  test("a rota que a página mostra, sem o compacto e só na origem da interface", () => {
    expect(rotaDaPagina(`${URL_APP}revisao-ppc?id=r1&compacto=1`, URL_APP)).toBe("/revisao-ppc?id=r1");
    expect(rotaDaPagina(`${URL_APP}`, URL_APP)).toBe("/");
    expect(rotaDaPagina("https://exemplo.org/conversa?id=a", URL_APP)).toBeUndefined();
    expect(rotaDaPagina("não é url", URL_APP)).toBeUndefined();
  });
});
