import type { Atividade, EventoAtividades } from "@simplifica-if/contratos-app";
import type { AvisoSistema } from "@simplifica-if/contratos-app/ponte";
import { describe, expect, it } from "vite-plus/test";
import type { Api } from "../conexao/api.ts";
import { ControleAtividades } from "./ControleAtividades.ts";

/** A `Api` falsa: cada acompanhamento fica com o teste, que manda os eventos e o termina. */
function apiFalsa() {
  const acompanhamentos: Array<{
    readonly aoItem: (evento: EventoAtividades) => void;
    readonly terminar: (erro?: unknown) => void;
  }> = [];
  let fase: "conectada" | "reconectando" = "conectada";
  const observadores = new Set<() => void>();
  const api = {
    chamar: () => new Promise(() => {}),
    acompanhar: (_fluxo: unknown, aoItem: (evento: EventoAtividades) => void) => {
      let terminar: (erro?: unknown) => void = () => {};
      const fim = new Promise<"concluido">((resolver, rejeitar) => {
        terminar = (erro) => (erro === undefined ? resolver("concluido") : rejeitar(erro));
      });
      acompanhamentos.push({ aoItem, terminar });
      return { fim, cancelar: () => {} };
    },
    estado: {
      obter: () => ({ fase }),
      observar: (aviso: () => void) => {
        observadores.add(aviso);
        return () => observadores.delete(aviso);
      },
    },
    reconectarAgora: () => {},
  } as unknown as Api;
  const mudarFase = (nova: typeof fase) => {
    fase = nova;
    for (const aviso of observadores) aviso();
  };
  return { api, acompanhamentos, mudarFase };
}

const atividade = (situacao: Atividade["situacao"], aprovacao?: string): Atividade => ({
  id: "conversa:a",
  titulo: "Conversa “Oi”",
  rota: "/conversa?id=a",
  situacao,
  desde: "2026-11-27T10:00:00Z",
  ...(aprovacao === undefined
    ? {}
    : {
        aprovacao: { conversa: "a", id: aprovacao, ferramenta: "escrever", tipo: "escrita", descricao: "escrever" },
      }),
});

/** Deixa rodar as microtarefas do fim do acompanhamento e da reinscrição. */
async function rodar() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ControleAtividades", () => {
  it("o primeiro retrato manda a contagem do selo, mesmo 0 (o selo de antes de recarregar a janela)", () => {
    const { api, acompanhamentos } = apiFalsa();
    const contagens: Array<number> = [];
    const controle = new ControleAtividades(api, { aoContar: (contagem) => contagens.push(contagem) });
    acompanhamentos[0]!.aoItem({ _tag: "Retrato", atividades: [] });
    expect(contagens).toEqual([0]);
    acompanhamentos[0]!.aoItem({ _tag: "Retrato", atividades: [] });
    expect(contagens).toEqual([0]);
    controle.encerrar();
  });

  it("o segundo pedido de permissão da mesma conversa também é anunciado e avisado", () => {
    const { api, acompanhamentos } = apiFalsa();
    const avisos: Array<AvisoSistema> = [];
    const controle = new ControleAtividades(api, { aoAvisar: (aviso) => avisos.push(aviso) });
    const { aoItem } = acompanhamentos[0]!;
    aoItem({ _tag: "Retrato", atividades: [] });
    aoItem({ _tag: "Mudou", atividade: atividade("permissao", "p1") });
    aoItem({ _tag: "Mudou", atividade: atividade("permissao", "p2") });
    expect(avisos).toHaveLength(2);
    expect(controle.obter().anuncio?.numero).toBe(2);
    // O mesmo pedido republicado não se repete.
    aoItem({ _tag: "Mudou", atividade: atividade("permissao", "p2") });
    expect(avisos).toHaveLength(2);
  });

  it("o acompanhamento que termina recomeça uma vez; terminando de novo sem mudança, espera a próxima conexão", async () => {
    const { api, acompanhamentos, mudarFase } = apiFalsa();
    const controle = new ControleAtividades(api);
    acompanhamentos[0]!.terminar();
    await rodar();
    expect(acompanhamentos).toHaveLength(2);
    acompanhamentos[1]!.aoItem({ _tag: "Retrato", atividades: [] });
    acompanhamentos[1]!.terminar({ _tag: "RpcClientError" });
    await rodar();
    // Sem laço: nenhum acompanhamento novo enquanto a conexão não muda.
    expect(acompanhamentos).toHaveLength(2);
    mudarFase("reconectando");
    mudarFase("conectada");
    expect(acompanhamentos).toHaveLength(3);
    // Uma mudança recebida mostra que o acompanhamento estava são: o fim seguinte recomeça na hora.
    acompanhamentos[2]!.aoItem({ _tag: "Retrato", atividades: [] });
    acompanhamentos[2]!.aoItem({ _tag: "Mudou", atividade: atividade("andamento") });
    acompanhamentos[2]!.terminar();
    await rodar();
    expect(acompanhamentos).toHaveLength(4);
    controle.encerrar();
  });
});
