import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { PonteDesktop } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, it } from "vite-plus/test";
import type { Api } from "../../conexao/api.ts";
import type { GerenteConversas } from "../../conversa/GerenteConversas.ts";
import { MemoriaLeitor } from "../../leitor/carga.ts";
import { ControlePainel } from "../../painel/ControlePainel.ts";
import { depoisDeApagarRevisao, depoisDeTrocarCurso } from "./apagarRevisao.ts";

const PASTA = "/Documentos/Simplifica IF/PPC Enfermagem – conversa";

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
  it("com a pasta na Lixeira, saem as conversas da pasta: a da revisão e a que a continuou com outra IA", async () => {
    const { api, apagadas } = apiFalsa([
      { id: "c1", pastaTrabalho: PASTA },
      { id: "c2", pastaTrabalho: PASTA },
      { id: "outra", pastaTrabalho: "/Documentos/Simplifica IF/Outra" },
    ]);
    const saidas: string[] = [];
    const conversas = { apagada: (id: string) => void saidas.push(id) } as unknown as GerenteConversas;
    const lixeira: string[] = [];
    const ponte = { pastaParaLixeira: async (pasta: string) => void lixeira.push(pasta) } as unknown as PonteDesktop;
    const lista = { id: "l", conversaAoLado: { conversa: "c1", pasta: PASTA } } as unknown as ListaPendencias;
    const ficou = await depoisDeApagarRevisao(
      { api, conversas, painel: new ControlePainel() },
      new MemoriaLeitor(),
      lista,
      {
        ponte,
        pasta: true,
      },
    );
    expect(ficou).toBeUndefined();
    expect(apagadas).toEqual(["c1", "c2"]);
    expect(saidas).toEqual(["c1", "c2"]);
    expect(lixeira).toEqual([PASTA]);
  });

  it("'Qual é o curso?': o painel segue a lista nova, e a memória do PPC antigo sai", () => {
    const painel = new ControlePainel();
    painel.abrirLink("ifpr://revisao-ppc/A/ppc#p-1");
    painel.conversar({ conversa: "c", origem: { chave: "revisao-ppc:A" } });
    const memoria = new MemoriaLeitor();
    memoria.obter("revisao-ppc:A/ppc", async () => "texto");
    depoisDeTrocarCurso({ painel }, memoria, "A", "B");
    expect(painel.obter().conversa.origem?.chave).toBe("revisao-ppc:B");
    expect(painel.obter().historico.links).toEqual(["ifpr://revisao-ppc/B/ppc#p-1"]);
    let recarregou = false;
    memoria.obter("revisao-ppc:A/ppc", async () => {
      recarregou = true;
      return "texto";
    });
    expect(recarregou).toBe(true);
  });
});
