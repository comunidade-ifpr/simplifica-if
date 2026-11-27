/**
 * O que as telas recebem do app: a `Api` (a conexão com o servidor), as conversas (`GerenteConversas`, um
 * controle por conversa), o que está rodando ou espera a pessoa (`ControleAtividades`), o painel do app
 * (`ControlePainel`), a continuidade (`ControleContinuidade`), o modo compacto da janela (`ControleJanelaCompacta`), o estado de longa duração de cada módulo (a
 * revisão de PPC corrente, `ControleRevisao`, lida pelo `useRevisao` do módulo), o que um módulo diz de um
 * link que não é da base (`pedidoDoLink`: o `ifpr://revisao-ppc/…` vira a ficha do PPC em revisão) e o que ele
 * faz com a conversa ao lado que abriu (`origens`: a revisão prepara cada mensagem). Arquivo de
 * composição: só ele e o `inicializar.ts` citam o controle do módulo.
 */
import { createContext, type ReactNode, use, useCallback, useEffect, useSyncExternalStore } from "react";
import type { ControleAtividades, EstadoAtividades } from "./atividades/ControleAtividades.ts";
import type { ControleContinuidade, EstadoContinuidade } from "./continuidade/ControleContinuidade.ts";
import type { Api } from "./conexao/api.ts";
import type { EstadoConexao } from "./conexao/Conexao.ts";
import type { ControleConversa } from "./conversa/ControleConversa.ts";
import type { EstadoConversa } from "./conversa/estado.ts";
import type { GerenteConversas } from "./conversa/GerenteConversas.ts";
import type { ControleJanelaCompacta, EstadoJanelaCompacta } from "./janela-compacta.ts";
import type { ControlePainel, EstadoPainel, OrigensConversa, PedidoConversa } from "./painel/ControlePainel.ts";
import type { ControleRevisao } from "./modulos/revisao-ppc/ControleRevisao.ts";

export interface ContextoApp {
  readonly api: Api;
  readonly conversas: GerenteConversas;
  readonly atividades: ControleAtividades;
  readonly painel: ControlePainel;
  /** Voltar onde se estava ao reabrir o app. */
  readonly continuidade: ControleContinuidade;
  /** O modo compacto da janela (só no desktop). */
  readonly janela: ControleJanelaCompacta;
  /** O pedido de conversa de um link que um módulo conhece (o PPC em revisão), ou nada (o da base). */
  readonly pedidoDoLink: (link: string) => PedidoConversa | undefined;
  /** A preparação das mensagens da conversa ao lado que um módulo abriu, e o aviso da caixa. */
  readonly origens: OrigensConversa;
  /** O módulo `revisao-ppc`. */
  readonly revisao: ControleRevisao;
}

const Contexto = createContext<ContextoApp | null>(null);

export function ProvedorApp({ valor, children }: { readonly valor: ContextoApp; readonly children: ReactNode }) {
  return <Contexto value={valor}>{children}</Contexto>;
}

export function useApp(): ContextoApp {
  const valor = use(Contexto);
  if (valor === null) throw new Error("useApp fora do ProvedorApp");
  return valor;
}

/** O contexto do app, ou nada fora do provedor (uma peça testada sozinha, como o leitor). */
export function useAppOpcional(): ContextoApp | null {
  return use(Contexto);
}

export function useApi(): Api {
  return useApp().api;
}

export function useEstadoConexao(): EstadoConexao {
  const { estado } = useApi();
  return useSyncExternalStore(estado.observar, estado.obter);
}

/**
 * O controle da conversa `id`, pego no `GerenteConversas` enquanto a tela a mostra (e solto ao sair);
 * `undefined` sem id e, se ninguém mais a mostra, até pegá-la. A referência é a assinatura do
 * `useSyncExternalStore`: o controle que o painel e a tela dividem vem já no primeiro quadro.
 */
export function useControleConversa(id: string | undefined): ControleConversa | undefined {
  const { conversas } = useApp();
  const assinar = useCallback(
    (aviso: () => void) => {
      if (id === undefined) return () => {};
      const { soltar } = conversas.pegar(id);
      aviso();
      return soltar;
    },
    [conversas, id],
  );
  return useSyncExternalStore(assinar, () => (id === undefined ? undefined : conversas.controleDe(id)));
}

/** O estado de uma conversa, que redesenha a tela a cada mudança. */
export function useEstadoConversa(controle: ControleConversa): EstadoConversa {
  return useSyncExternalStore(controle.observar, controle.obter);
}

/** As atividades (a bandeja do cabeçalho), que redesenham a cada mudança. */
export function useAtividades(): EstadoAtividades {
  const { atividades } = useApp();
  return useSyncExternalStore(atividades.observar, atividades.obter);
}

/** O modo compacto da janela, que redesenha ao ligar, desligar e mexer no alfinete. */
export function useJanelaCompacta(): readonly [EstadoJanelaCompacta, ControleJanelaCompacta] {
  const { janela } = useApp();
  return [useSyncExternalStore(janela.observar, janela.obter), janela] as const;
}

/** A continuidade (se ainda decide para onde voltar, e os avisos do que não voltou). */
export function useContinuidade(): EstadoContinuidade {
  const { continuidade } = useApp();
  return useSyncExternalStore(continuidade.observar, continuidade.obter);
}

export function usePainel(): readonly [EstadoPainel, ControlePainel] {
  const { painel } = useApp();
  return [useSyncExternalStore(painel.observar, painel.obter), painel] as const;
}

/**
 * A tela que chama é de trabalho enquanto está montada: nela, os links e a paleta abrem no painel
 * (`painel/abrirLink.ts`).
 */
export function useTelaDeTrabalho(): void {
  const { painel } = useApp();
  useEffect(() => painel.entrarEmTelaDeTrabalho(), [painel]);
}
