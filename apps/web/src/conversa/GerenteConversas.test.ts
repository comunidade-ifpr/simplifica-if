import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Api } from "../conexao/api.ts";
import { GerenteConversas } from "./GerenteConversas.ts";

/** A `Api` falsa: cada chamada espera a resposta do teste; cada acompanhamento conta e se cancela. */
function apiFalsa() {
  const pendentes: Array<{ readonly resolver: (valor: unknown) => void }> = [];
  const conta = { acompanhamentos: 0, cancelados: 0 };
  const api = {
    chamar: () =>
      new Promise((resolver) => {
        pendentes.push({ resolver });
      }),
    acompanhar: () => {
      conta.acompanhamentos += 1;
      return {
        fim: new Promise<never>(() => {}),
        cancelar: () => {
          conta.cancelados += 1;
        },
      };
    },
    estado: { obter: () => ({ fase: "conectada" }), observar: () => () => {} },
    reconectarAgora: () => {},
  } as unknown as Api;
  return { api, pendentes, conta };
}

const GRAVADA = {
  conversa: { id: "a", provider: "claude", estado: "liberada", titulo: "", pastaTrabalho: "/p", ultimaOrdem: 0 },
  itens: [],
  avaliacoes: [],
};

describe("GerenteConversas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("soltar com a carga em curso: a carga que chega depois não volta a acompanhar", async () => {
    const { api, pendentes, conta } = apiFalsa();
    const gerente = new GerenteConversas(api);
    const { soltar } = gerente.pegar("a");
    soltar();
    await vi.runAllTimersAsync();
    expect(gerente.controleDe("a")).toBeUndefined();
    pendentes[0]!.resolver(GRAVADA);
    await vi.runAllTimersAsync();
    expect(conta.acompanhamentos).toBe(0);
  });

  it("a mesma conversa pega de novo na mesma hora é o mesmo controle; a apagada sem ninguém sai", async () => {
    const { api } = apiFalsa();
    const apagadas: Array<string> = [];
    const gerente = new GerenteConversas(api, { aoApagar: (id) => apagadas.push(id) });
    const primeira = gerente.pegar("a");
    primeira.soltar();
    const segunda = gerente.pegar("a");
    await vi.runAllTimersAsync();
    expect(segunda.controle).toBe(primeira.controle);
    segunda.soltar();
    gerente.pegar("b");
    gerente.apagada("b");
    gerente.apagada("a");
    expect(gerente.controleDe("b")).toBeDefined();
    expect(gerente.controleDe("a")).toBeUndefined();
    expect(apagadas).toEqual(["b", "a"]);
    expect(gerente.foiApagada("a")).toBe(true);
  });

  it("o controle de `novo` sem conversa aberta se solta; encerrar para os acompanhados e as solturas agendadas", async () => {
    const { api, conta } = apiFalsa();
    const gerente = new GerenteConversas(api);
    const novo = gerente.novo("codex");
    novo.soltar();
    expect(gerente.ultimaIa()).toBe("claude");
    const pego = gerente.pegar("a");
    pego.soltar();
    gerente.encerrar();
    expect(gerente.controleDe("a")).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(conta.acompanhamentos).toBe(0);
  });
  it("a conversa apagada em outra janela: o fim do acompanhamento a marca apagada, e a vista diz que não existe", async () => {
    const { api: base, pendentes } = apiFalsa();
    const fins: Array<(fim: "concluido" | "cancelado") => void> = [];
    const api: Api = {
      ...base,
      acompanhar: () => ({
        fim: new Promise<"concluido" | "cancelado">((resolver) => fins.push(resolver)),
        cancelar: () => {},
      }),
    };
    const apagadas: Array<string> = [];
    const gerente = new GerenteConversas(api, { aoApagar: (id) => apagadas.push(id) });
    const { controle } = gerente.pegar("a");
    pendentes[0]!.resolver(GRAVADA);
    await vi.runAllTimersAsync();
    expect(fins).toHaveLength(1);
    fins[0]!("concluido");
    await vi.runAllTimersAsync();
    expect(apagadas).toEqual(["a"]);
    expect(gerente.foiApagada("a")).toBe(true);
    expect(controle.obter().erroInicio?.texto).toBe("Esta conversa não existe mais no app.");
  });
});
