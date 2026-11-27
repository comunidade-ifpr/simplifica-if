/**
 * Monta o que o app precisa antes da primeira tela: a conexão com o servidor (pela origem da página), a
 * `Api`, as conversas, as atividades (com o aviso e o selo do sistema, no desktop), o painel do app, a
 * continuidade (voltar onde se estava ao reabrir, com o que cada módulo diz do que é dele), o modo
 * compacto da janela (no desktop) e o estado de longa duração de cada módulo (o `ControleRevisao` da
 * revisão de PPC, com o painel seguindo a lista refeita ou apagada fora; o pedido de conversa do link do PPC
 * em revisão e a preparação da conversa ao lado dela).
 * Arquivo de composição.
 */
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { ControleAtividades } from "./atividades/ControleAtividades.ts";
import { ControleContinuidade } from "./continuidade/ControleContinuidade.ts";
import { criarApi } from "./conexao/api.ts";
import * as Conexao from "./conexao/Conexao.ts";
import type { OrigemConexao } from "./conexao/origem.ts";
import type { ContextoApp } from "./contexto.tsx";
import { GerenteConversas } from "./conversa/GerenteConversas.ts";
import { layerTracer } from "./diagnostico.ts";
import { ControleJanelaCompacta } from "./janela-compacta.ts";
import { memoriaDa } from "./leitor/carga.ts";
import { ControlePainel } from "./painel/ControlePainel.ts";
import { ponteDesktop } from "./ponte-desktop.ts";
import { avisosDoSistemaLigados } from "./tarefas/perfil.ts";
// Composição: o módulo `revisao-ppc`.
import { depoisDeApagarRevisao, depoisDeTrocarCurso } from "./modulos/revisao-ppc/apagarRevisao.ts";
import { ControleRevisao } from "./modulos/revisao-ppc/ControleRevisao.ts";
import { continuidadeDaRevisao } from "./modulos/revisao-ppc/continuidade.ts";
import { origensDaRevisao, pedidoDoLinkDaRevisao } from "./modulos/revisao-ppc/conversa.ts";

export interface AppIniciado {
  readonly contexto: ContextoApp;
  /** Fecha a conexão (o socket e o laço de reconexão). */
  readonly encerrar: () => Promise<void>;
}

export interface OpcoesApp {
  /** A continuidade desligada (os testes de navegador que não são dela, para um não voltar onde o outro parou). */
  readonly continuidade?: boolean;
}

export async function inicializar(
  origem: OrigemConexao,
  opcoes?: Conexao.OpcoesConexao,
  opcoesApp: OpcoesApp = {},
): Promise<AppIniciado> {
  // O tracer registra no log do app as chamadas que falham de forma inesperada (`diagnostico.ts`).
  const runtime = ManagedRuntime.make(Layer.merge(Conexao.layerGlobal(origem, opcoes), layerTracer));
  const api = await criarApi(runtime);
  const painel = new ControlePainel();
  // A continuidade é só da janela principal do desktop: a aberta por "Abrir em nova janela" não grava nem
  // volta, ou, sem a principal, grava sem voltar (`JanelaDesktop.continuidade`).
  const modo = ponteDesktop()?.janela.continuidade ?? "completa";
  const continuidade = new ControleContinuidade(api, painel, [continuidadeDaRevisao(api)], {
    ligada: opcoesApp.continuidade !== false && modo !== "nenhuma",
    voltar: modo === "completa",
  });
  const conversas = new GerenteConversas(api, { aoApagar: painel.conversaApagada });
  // A lista refeita com outro curso leva o painel junto; a apagada em outra janela sai dele.
  const revisao = new ControleRevisao(api, {
    aoTrocarLista: (antiga, nova) => depoisDeTrocarCurso({ painel }, memoriaDa(api), antiga, nova),
    aoApagarFora: (lista) =>
      void depoisDeApagarRevisao({ api, conversas, painel }, memoriaDa(api), lista, {
        ponte: undefined,
        pasta: false,
      }),
  });
  // O aviso e o selo do sistema só existem no desktop; a falha deles (a janela fechando) não é da tela.
  const atividades = new ControleAtividades(api, {
    aoAvisar: (aviso) => {
      const ponte = ponteDesktop();
      if (ponte === undefined) return;
      void avisosDoSistemaLigados(api)
        .then((ligados) => (ligados ? ponte.janela.avisar(aviso) : undefined))
        .catch(() => undefined);
    },
    aoContar: (contagem) =>
      void ponteDesktop()
        ?.janela.selo(contagem)
        .catch(() => undefined),
    naTela: conversas.naTela,
  });
  return {
    contexto: {
      api,
      conversas,
      atividades,
      painel,
      continuidade,
      janela: new ControleJanelaCompacta(ponteDesktop()?.janela),
      pedidoDoLink: (link) => pedidoDoLinkDaRevisao({ api, revisao, conversas }, link),
      origens: origensDaRevisao({ api, revisao, conversas }),
      revisao,
    },
    encerrar: async () => {
      // Antes de fechar a conexão: onde a pessoa estava fica gravado.
      await continuidade.encerrar();
      revisao.encerrar();
      conversas.encerrar();
      atividades.encerrar();
      return runtime.dispose();
    },
  };
}
