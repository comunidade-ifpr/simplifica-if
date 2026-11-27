/**
 * A continuidade (`ControleContinuidade.ts`) com servidor, conexão e roteador falsos: a falha ao abrir não
 * apaga o guardado (e o "Prender ao lado" volta); uma gravação por vez, marcada só depois de gravar; sem
 * conexão não grava nem espera; fechar antes de conectar solta a espera; a pessoa que saiu do Início e voltou
 * fica onde está; e a rota longa demais grava o Início.
 */
import type { Continuidade, PainelGuardado, Preferencias } from "@simplifica-if/contratos-app";
import { defaultParseSearch } from "@tanstack/react-router";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { Api } from "../conexao/api.ts";
import type { EstadoConexao } from "../conexao/Conexao.ts";
import { ControlePainel } from "../painel/ControlePainel.ts";
import type { Roteador } from "../router.ts";
import { ControleContinuidade } from "./ControleContinuidade.ts";

// O `pagehide` da janela, que aqui não há.
beforeAll(() => {
  vi.stubGlobal("window", new EventTarget());
});

const PAINEL: PainelGuardado = {
  aberto: false,
  aba: "ler",
  trilha: { links: [], posicao: -1 },
  marcados: [],
  preso: true,
};

const preferencias = (continuidade?: Continuidade): Preferencias => ({
  avisoAceitoEm: "2026-11-01T00:00:00.000Z",
  boasVindasEm: "2026-11-01T00:00:00.000Z",
  iasDesligadas: [],
  avisosDoSistema: true,
  ...(continuidade === undefined ? {} : { continuidade }),
});

/** Uma promessa que o teste resolve ou rejeita quando quer. */
function adiada<A>() {
  let resolver: (valor: A) => void = () => {};
  let rejeitar: (motivo: unknown) => void = () => {};
  const promessa = new Promise<A>((sim, nao) => {
    resolver = sim;
    rejeitar = nao;
  });
  return { promessa, resolver, rejeitar };
}

type Respostas = Partial<Record<string, (argumentos: unknown) => Promise<unknown>>>;

/** A API falsa: cada método responde pelo que o teste deu; `gravadas` são as continuidades pedidas. */
function apiFalsa(respostas: Respostas, fase: EstadoConexao["fase"] = "conectada") {
  let estado = { fase } as EstadoConexao;
  const observadores = new Set<() => void>();
  const gravadas: Array<Continuidade> = [];
  const cliente = new Proxy(
    {},
    { get: (_alvo, metodo) => (argumentos: unknown) => ({ metodo: String(metodo), argumentos }) },
  );
  const api = {
    chamar: (chamada: (cliente: never) => unknown) => {
      const { metodo, argumentos } = chamada(cliente as never) as { metodo: string; argumentos: unknown };
      if (metodo === "preferencias.guardarContinuidade") {
        gravadas.push((argumentos as { continuidade: Continuidade }).continuidade);
      }
      const resposta = respostas[metodo];
      return resposta === undefined ? Promise.reject(new Error(`sem ${metodo}`)) : resposta(argumentos);
    },
    estado: {
      obter: () => estado,
      observar: (aviso: () => void) => {
        observadores.add(aviso);
        return () => void observadores.delete(aviso);
      },
    },
  } as unknown as Api;
  const mudarFase = (nova: EstadoConexao["fase"]) => {
    estado = { fase: nova } as EstadoConexao;
    for (const aviso of observadores) aviso();
  };
  return { api, gravadas, mudarFase, observadores };
}

/** O roteador falso: a localização, a navegação e os eventos que a continuidade ouve. */
function roteadorFalso(inicio = "/") {
  const ouvintes = new Map<string, Set<(evento: never) => void>>();
  const emitir = (tipo: string, evento: unknown) => {
    for (const ouvinte of ouvintes.get(tipo) ?? []) ouvinte(evento as never);
  };
  const localizacao = (href: string) => {
    const i = href.indexOf("?");
    return {
      href,
      pathname: i < 0 ? href : href.slice(0, i),
      search: i < 0 ? {} : defaultParseSearch(href.slice(i)),
    };
  };
  const roteador = {
    state: { location: localizacao(inicio) },
    subscribe: (tipo: string, ouvinte: (evento: never) => void) => {
      const doTipo = ouvintes.get(tipo) ?? new Set();
      ouvintes.set(tipo, doTipo.add(ouvinte));
      return () => void doTipo.delete(ouvinte);
    },
    navigate: async ({ href }: { href: string }) => {
      emitir("onBeforeNavigate", { toLocation: localizacao(href) });
      roteador.state.location = localizacao(href);
      emitir("onResolved", { toLocation: localizacao(href) });
    },
  };
  return roteador as typeof roteador & Roteador;
}

/** Espera a continuidade decidir para onde voltar. */
function decidida(controle: ControleContinuidade): Promise<void> {
  return new Promise((resolver) => {
    const conferir = () => {
      if (controle.obter().restaurando) return;
      parar();
      resolver();
    };
    const parar = controle.observar(conferir);
    conferir();
  });
}

describe("a continuidade", () => {
  it("a falha ao conferir não apaga o guardado; o “Prender ao lado” volta, e grava depois de a pessoa mexer", async () => {
    const guardada: Continuidade = { rota: "/conversa?id=c1", painel: PAINEL };
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => preferencias(guardada),
      "conversa.listar": async () => {
        throw new Error("a conexão caiu");
      },
      "preferencias.guardarContinuidade": async () => preferencias(),
    });
    const painel = new ControlePainel();
    const controle = new ControleContinuidade(api, painel, []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);
    expect(painel.obter().preso).toBe(true);
    expect(roteador.state.location.href).toBe("/");

    await controle.gravarAgora();
    expect(gravadas).toEqual([]);

    // A pessoa navega: o que ela faz agora é o que fica.
    await roteador.navigate({ href: "/explorar" });
    await controle.gravarAgora();
    expect(gravadas.map((c) => [c.rota, c.painel.preso])).toEqual([["/explorar", true]]);
    await controle.encerrar();
  });

  it("sem ler as preferências, nada se grava nesta abertura", async () => {
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => {
        throw new Error("a loja falhou");
      },
      "preferencias.guardarContinuidade": async () => preferencias(),
    });
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);
    await roteador.navigate({ href: "/explorar" });
    await controle.encerrar();
    expect(gravadas).toEqual([]);
  });

  it("uma gravação por vez, a mais nova por último; ao fechar, espera a em curso; a que falha tenta de novo", async () => {
    const pedidos: Array<ReturnType<typeof adiada<Preferencias>>> = [];
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => preferencias(),
      "preferencias.guardarContinuidade": () => {
        const pedido = adiada<Preferencias>();
        pedidos.push(pedido);
        return pedido.promessa;
      },
    });
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);

    await roteador.navigate({ href: "/explorar" });
    const primeira = controle.gravarAgora();
    await Promise.resolve();
    expect(gravadas.map((c) => c.rota)).toEqual(["/explorar"]);
    await roteador.navigate({ href: "/explorar/normas" });
    const fechando = controle.encerrar();
    await Promise.resolve();
    // A segunda espera a primeira.
    expect(gravadas).toHaveLength(1);

    // A primeira falha: a próxima grava o estado de agora.
    pedidos[0]!.rejeitar(new Error("caiu"));
    await primeira;
    await Promise.resolve();
    expect(gravadas.map((c) => c.rota)).toEqual(["/explorar", "/explorar/normas"]);
    let fechou = false;
    void fechando.then(() => (fechou = true));
    await Promise.resolve();
    expect(fechou).toBe(false);
    pedidos[1]!.resolver(preferencias());
    await fechando;
  });

  it("a gravação que falhou não conta como gravada: o mesmo estado grava de novo", async () => {
    let falhar = true;
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => preferencias(),
      "preferencias.guardarContinuidade": async () => {
        if (falhar) throw new Error("caiu");
        return preferencias();
      },
    });
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);
    await roteador.navigate({ href: "/explorar" });
    await controle.gravarAgora();
    falhar = false;
    await controle.gravarAgora();
    await controle.gravarAgora();
    expect(gravadas.map((c) => c.rota)).toEqual(["/explorar", "/explorar"]);
  });

  it("sem conexão, não grava nem espera", async () => {
    const { api, gravadas, mudarFase } = apiFalsa({
      "preferencias.ler": async () => preferencias(),
      "preferencias.guardarContinuidade": () => new Promise(() => {}),
    });
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);
    await roteador.navigate({ href: "/explorar" });
    mudarFase("reconectando");
    await controle.encerrar();
    expect(gravadas).toEqual([]);
  });

  it("fechar antes de conectar solta a espera pela conexão", async () => {
    const { api, observadores } = apiFalsa({}, "conectando");
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    controle.ligar(roteadorFalso());
    expect(observadores.size).toBe(1);
    await controle.encerrar();
    expect(observadores.size).toBe(0);
  });

  it("quem saiu do Início durante a espera (e voltou) fica onde está", async () => {
    const conversas = adiada<ReadonlyArray<{ id: string }>>();
    const { api } = apiFalsa({
      "preferencias.ler": async () => preferencias({ rota: "/conversa?id=c1", painel: PAINEL }),
      "conversa.listar": () => conversas.promessa,
      "preferencias.guardarContinuidade": async () => preferencias(),
    });
    const controle = new ControleContinuidade(api, new ControlePainel(), []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await roteador.navigate({ href: "/explorar" });
    await roteador.navigate({ href: "/" });
    conversas.resolver([{ id: "c1" }]);
    await decidida(controle);
    expect(roteador.state.location.href).toBe("/");
    await controle.encerrar();
  });

  it("sem voltar (a janela aberta na rota pedida que virou a principal): nada volta, e grava daí em diante", async () => {
    const lidas: Array<string> = [];
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => {
        lidas.push("ler");
        return preferencias({ rota: "/conversa?id=c1", painel: { ...PAINEL, aberto: true } });
      },
      "conversa.listar": async () => [{ id: "c1" }],
      "preferencias.guardarContinuidade": async () => preferencias(),
    });
    const painel = new ControlePainel();
    const controle = new ControleContinuidade(api, painel, [], { voltar: false });
    expect(controle.obter().restaurando).toBe(false);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await controle.gravarAgora();
    // No Início pedido, nem a rota nem o painel da principal que fechou voltam.
    expect(lidas).toEqual([]);
    expect(roteador.state.location.href).toBe("/");
    expect(painel.obter().preso).toBe(false);
    expect(gravadas.map((c) => [c.rota, c.painel.preso])).toEqual([["/", false]]);
    await roteador.navigate({ href: "/explorar" });
    await controle.encerrar();
    expect(gravadas.map((c) => c.rota)).toEqual(["/", "/explorar"]);
  });

  it("a rota longa demais grava o Início, sem impedir de gravar o painel", async () => {
    const { api, gravadas } = apiFalsa({
      "preferencias.ler": async () => preferencias(),
      "preferencias.guardarContinuidade": async () => preferencias(),
    });
    const painel = new ControlePainel();
    const controle = new ControleContinuidade(api, painel, []);
    const roteador = roteadorFalso();
    controle.ligar(roteador);
    await decidida(controle);
    painel.prender(true);
    await roteador.navigate({ href: `/explorar/buscar?q=${"á".repeat(2_000)}` });
    await controle.encerrar();
    expect(gravadas.map((c) => [c.rota, c.painel.preso])).toEqual([["/", true]]);
  });
});
