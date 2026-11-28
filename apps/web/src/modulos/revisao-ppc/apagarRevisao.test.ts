import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { PonteDesktop } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, it } from "vite-plus/test";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { MemoriaLeitor } from "../../leitor/carga.ts";
import { ControlePainel } from "../../painel/ControlePainel.ts";
import { depoisDeApagarRevisao, depoisDeTrocarCurso } from "./apagarRevisao.ts";

const PASTA = "/Documentos/Simplifica IF/PPC Enfermagem – conversa";
const PASTA_ESTAGIO = "/Documentos/Simplifica IF/PPC Enfermagem – Estágio";

/** A `Api` falsa: as conversas da lista, e as que saíram. */
function apiFalsa(conversas: ReadonlyArray<{ readonly id: string; readonly pastaTrabalho: string }>) {
  const apagadas: string[] = [];
  const api = {
    chamar: (chamada: (cliente: unknown) => Promise<unknown>) =>
      chamada({
        "conversa.listar": async () => conversas,
        "conversa.apagar": async ({ sessao }: { readonly sessao: string }) => void apagadas.push(sessao),
      }),
  } as unknown as Api;
  return { api, apagadas };
}

describe("depois de apagar ou refazer a revisão", () => {
  it("com as pastas na Lixeira, saem as conversas de cada pasta: as da revisão e a que continuou uma delas com outra IA", async () => {
    const { api, apagadas } = apiFalsa([
      { id: "c1", pastaTrabalho: PASTA },
      { id: "c2", pastaTrabalho: PASTA },
      { id: "e1", pastaTrabalho: PASTA_ESTAGIO },
      { id: "outra", pastaTrabalho: "/Documentos/Simplifica IF/Outra" },
    ]);
    const saidas: string[] = [];
    const conversas = { apagada: (id: string) => void saidas.push(id) } as unknown as GerenteConversas;
    const lixeira: string[] = [];
    const ponte = { pastaParaLixeira: async (pasta: string) => void lixeira.push(pasta) } as unknown as PonteDesktop;
    const lista = {
      id: "l",
      conversas: [
        { conversa: "c1", pasta: PASTA, pendencia: null, titulo: "" },
        { conversa: "e1", pasta: PASTA_ESTAGIO, pendencia: "k", titulo: "" },
      ],
    } as unknown as ListaPendencias;
    const painel = new ControlePainel();
    painel.conversar({ origem: { chave: "revisao-ppc:l#k" }, fichas: [] });
    const ficou = await depoisDeApagarRevisao({ api, conversas, painel }, new MemoriaLeitor(), lista, {
      ponte,
      pasta: true,
    });
    expect(ficou).toBeUndefined();
    expect(apagadas).toEqual(["c1", "c2", "e1"]);
    expect(saidas).toEqual(["c1", "c2", "e1"]);
    expect(lixeira).toEqual([PASTA, PASTA_ESTAGIO]);
    // O rascunho da conversa de uma pendência da revisão apagada sai do painel.
    expect(painel.obter().conversa.origem).toBeUndefined();
  });

  it("'Qual é o curso?': o painel segue a lista nova, e a memória do PPC antigo sai", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://revisao-ppc/A/ppc#p-1");
    painel.conversar({ conversa: "c", origem: { chave: "revisao-ppc:A#k1" } });
    const memoria = new MemoriaLeitor();
    memoria.obter("revisao-ppc:A/ppc", async () => "texto");
    depoisDeTrocarCurso({ painel }, memoria, "A", "B");
    expect(painel.obter().conversa.origem?.chave).toBe("revisao-ppc:B#k1");
    expect(painel.obter().historico.links).toEqual(["ifpr://revisao-ppc/B/ppc#p-1"]);
    let recarregou = false;
    memoria.obter("revisao-ppc:A/ppc", async () => {
      recarregou = true;
      return "texto";
    });
    expect(recarregou).toBe(true);
  });
});
