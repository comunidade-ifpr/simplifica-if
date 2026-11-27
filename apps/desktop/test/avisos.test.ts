/**
 * O aviso do sistema pela ponte (`avisos.ts`), com `Notification` e janela falsas: só com a janela sem
 * foco, o texto sem nada da conversa, o clique que traz a janela e manda a rota, o pedido inválido
 * recusado e, com várias janelas, o primeiro pedido valendo e os repetidos descartados.
 */
import { CANAIS } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, test } from "vite-plus/test";
import {
  contagemValida,
  criarAvisos,
  REPETIDO_MS,
  TEXTOS_AVISO,
  textoDoSelo,
  type NotificacaoSistema,
} from "../src/avisos.ts";

/** Uma `Notification` falsa: guarda o que mostrou e deixa o teste clicar. */
class NotificacaoFalsa implements NotificacaoSistema {
  readonly ouvintes = new Map<string, () => void>();
  mostrada = false;
  readonly opcoes: { readonly title: string; readonly body: string };
  constructor(opcoes: { readonly title: string; readonly body: string }) {
    this.opcoes = opcoes;
  }
  on(evento: "click" | "close" | "failed", ouvinte: () => void) {
    this.ouvintes.set(evento, ouvinte);
    return this;
  }
  show() {
    this.mostrada = true;
  }
  clicar() {
    this.ouvintes.get("click")?.();
  }
  emitir(evento: "close" | "failed") {
    this.ouvintes.get(evento)?.();
  }
}

/** Uma janela falsa: o foco que o teste dá e o que a janela recebeu. */
function janelaFalsa(focada: boolean, url = "http://localhost:5733/") {
  const enviados: Array<readonly [string, ...Array<unknown>]> = [];
  const passos: Array<string> = [];
  return {
    focada,
    url,
    minimizada: true,
    visivel: true,
    enviados,
    passos,
    isDestroyed: () => false,
    isFocused() {
      return this.focada;
    },
    isMinimized() {
      return this.minimizada;
    },
    isVisible() {
      return this.visivel;
    },
    restore() {
      passos.push("restore");
    },
    show() {
      passos.push("show");
    },
    focus() {
      passos.push("focus");
    },
    get webContents() {
      return {
        send: (canal: string, ...argumentos: Array<unknown>) => void enviados.push([canal, ...argumentos]),
        getURL: () => this.url,
      };
    },
  };
}

function montar(focada: boolean, suportado = true, sempreAVista = false) {
  const criadas: Array<NotificacaoFalsa> = [];
  const janela = janelaFalsa(focada);
  let relogio = 0;
  const avisos = criarAvisos({
    criar: (opcoes) => {
      const nova = new NotificacaoFalsa(opcoes);
      criadas.push(nova);
      return nova;
    },
    suportado: () => suportado,
    janelas: () => [janela],
    ultimaUsada: () => janela,
    sempreAVista: () => sempreAVista,
    urlJanela: "http://localhost:5733/",
    nome: "Simplifica IF",
    // Cada pedido destes testes chega depois do prazo dos repetidos.
    agora: () => (relogio += REPETIDO_MS),
  });
  const avisar = (pedido: unknown) => avisos.avisar(pedido);
  return { avisos, avisar, criadas, janela };
}

describe("aviso do sistema", () => {
  test("com a janela sem foco, mostra o texto fixo, e o clique traz a janela e pede a rota", () => {
    const { avisar, criadas, janela } = montar(false);
    expect(avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(true);
    expect(criadas).toHaveLength(1);
    const notificacao = criadas[0]!;
    expect(notificacao.mostrada).toBe(true);
    expect(notificacao.opcoes).toEqual({ title: "Simplifica IF", body: "Uma resposta está pronta" });
    notificacao.clicar();
    expect(janela.passos).toEqual(["restore", "show", "focus"]);
    expect(janela.enviados).toEqual([[CANAIS.abrirRota, "/conversa?id=abc"]]);

    expect(avisar({ tipo: "permissao", rota: "/conversa?id=def" })).toBe(true);
    expect(criadas[1]!.opcoes.body).toBe(TEXTOS_AVISO.permissao);
  });

  test("com a janela em foco, ou sem suporte no sistema, não avisa", () => {
    const focada = montar(true);
    expect(focada.avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(false);
    expect(focada.criadas).toEqual([]);
    const semSuporte = montar(false, false);
    expect(semSuporte.avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(false);
    expect(semSuporte.criadas).toEqual([]);
  });

  test("no modo compacto com o alfinete preso, sempre à vista ao lado do Word: só com a janela oculta ou minimizada", () => {
    const { avisar, criadas, janela } = montar(false, true, true);
    // Sem foco, mas à vista (a pessoa está no Word): não avisa.
    janela.minimizada = false;
    expect(avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(false);
    expect(criadas).toEqual([]);
    janela.minimizada = true;
    expect(avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(true);
    janela.minimizada = false;
    janela.visivel = false;
    expect(avisar({ tipo: "permissao", rota: "/conversa?id=abc" })).toBe(true);
    expect(criadas).toHaveLength(2);
  });

  test("no modo compacto com o alfinete solto, o Word pode cobrir a janela: avisa sem foco, mesmo visível", () => {
    const { avisar, criadas, janela } = montar(false, true, false);
    janela.minimizada = false;
    expect(avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(true);
    janela.focada = true;
    expect(avisar({ tipo: "resposta", rota: "/conversa?id=abc" })).toBe(false);
    expect(criadas).toHaveLength(1);
  });

  test.each([
    { tipo: "resposta", rota: "https://exemplo.org/" },
    { tipo: "resposta", rota: "//exemplo.org/conversa" },
    { tipo: "resposta", rota: "/\\exemplo.org/conversa" },
    { tipo: "resposta", rota: "/conversa\r\nid=abc" },
    { tipo: "resposta", rota: "/conversa\u0000" },
    { tipo: "outro", rota: "/conversa" },
    { tipo: "resposta" },
    "resposta",
    null,
  ])("recusa o pedido inválido: %j", (pedido) => {
    const { avisar, criadas } = montar(false);
    expect(avisar(pedido)).toBe(false);
    expect(criadas).toEqual([]);
  });

  test("a notificação guardada sai ao fechar ou falhar, e as guardadas têm teto", () => {
    const { avisar, avisos, criadas } = montar(false);
    avisar({ tipo: "resposta", rota: "/conversa?id=a" });
    avisar({ tipo: "resposta", rota: "/conversa?id=b" });
    expect(avisos.guardadas()).toBe(2);
    criadas[0]!.emitir("failed");
    criadas[1]!.emitir("close");
    expect(avisos.guardadas()).toBe(0);
    // As que ficam na Central de Notificações do macOS não avisam: as mais antigas saem.
    for (let i = 0; i < 30; i++) avisar({ tipo: "resposta", rota: `/conversa?id=${i}` });
    expect(avisos.guardadas()).toBe(20);
  });

  test("várias janelas: vale o primeiro pedido, de qualquer janela, e os repetidos saem descartados", () => {
    const criadas: Array<NotificacaoFalsa> = [];
    const principal = janelaFalsa(false, "http://localhost:5733/revisao-ppc?id=r1&compacto=1");
    const outra = janelaFalsa(false, "http://localhost:5733/explorar");
    let agora = 0;
    const avisos = criarAvisos({
      criar: (opcoes) => {
        const nova = new NotificacaoFalsa(opcoes);
        criadas.push(nova);
        return nova;
      },
      suportado: () => true,
      janelas: () => [principal, outra],
      // A última usada (a recém-aberta, a que recarrega) não pede nada: o aviso sai pelas outras.
      ultimaUsada: () => outra,
      sempreAVista: () => false,
      urlJanela: "http://localhost:5733/",
      nome: "Simplifica IF",
      agora: () => agora,
    });
    const revisao = { tipo: "resposta", rota: "/revisao-ppc?id=r1" };
    expect(avisos.avisar(revisao)).toBe(true);
    agora += 500;
    // A outra janela pede o mesmo: descartado.
    expect(avisos.avisar(revisao)).toBe(false);
    expect(criadas).toHaveLength(1);
    // Um aviso diferente no mesmo instante vale.
    expect(avisos.avisar({ tipo: "permissao", rota: "/revisao-ppc?id=r1" })).toBe(true);
    // Passado o prazo, o mesmo aviso é outro (outra resposta da mesma conversa).
    agora += REPETIDO_MS;
    expect(avisos.avisar(revisao)).toBe(true);
    expect(criadas).toHaveLength(3);
    // Com uma janela em foco, a pessoa está no app: não avisa, e a cópia das outras janelas também não.
    agora += REPETIDO_MS;
    outra.focada = true;
    expect(avisos.avisar(revisao)).toBe(false);
    outra.focada = false;
    expect(avisos.avisar(revisao)).toBe(false);
    expect(criadas).toHaveLength(3);
  });

  test("o clique vai à janela que já mostra a rota (também no modo compacto) sem navegar; sem ela, à última usada", () => {
    const criadas: Array<NotificacaoFalsa> = [];
    const principal = janelaFalsa(false, "http://localhost:5733/revisao-ppc?id=r1&compacto=1");
    const outra = janelaFalsa(false, "http://localhost:5733/explorar");
    let agora = 0;
    const avisos = criarAvisos({
      criar: (opcoes) => {
        const nova = new NotificacaoFalsa(opcoes);
        criadas.push(nova);
        return nova;
      },
      suportado: () => true,
      janelas: () => [principal, outra],
      ultimaUsada: () => outra,
      sempreAVista: () => false,
      urlJanela: "http://localhost:5733/",
      nome: "Simplifica IF",
      agora: () => (agora += REPETIDO_MS),
    });
    expect(avisos.avisar({ tipo: "resposta", rota: "/revisao-ppc?id=r1" })).toBe(true);
    criadas[0]!.clicar();
    // A revisão na coluna compacta vem à frente como está: a rota sem o `compacto=1` desligaria o modo.
    expect(principal.passos).toEqual(["restore", "show", "focus"]);
    expect(principal.enviados).toEqual([]);
    expect(outra.passos).toEqual([]);
    // Sem janela da rota, vai à última usada, que navega até ela.
    expect(avisos.avisar({ tipo: "permissao", rota: "/conversa?id=c9" })).toBe(true);
    criadas[1]!.clicar();
    expect(outra.passos).toEqual(["restore", "show", "focus"]);
    expect(outra.enviados).toEqual([[CANAIS.abrirRota, "/conversa?id=c9"]]);
  });

  test("o selo: a contagem inteira, e 0 tira", () => {
    expect(contagemValida(3)).toBe(3);
    expect(contagemValida(-1)).toBeUndefined();
    expect(contagemValida(1.5)).toBeUndefined();
    expect(contagemValida("3")).toBeUndefined();
    expect(textoDoSelo(0)).toBe("");
    expect(textoDoSelo(2)).toBe("2");
  });
});
