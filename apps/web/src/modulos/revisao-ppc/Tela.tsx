/**
 * "Revisar um PPC": a entrada (soltar ou escolher o `.docx`, e as revisões recentes), a leitura com as
 * etapas (o stream de `revisaoPpc.revisar`) e o resultado (`Leitura.tsx`), com a lista viva de
 * pendências e a leitura com IA como continuação. O estado e os streams ficam em `ControleRevisao`
 * (no `ContextoApp`), para sobreviverem à navegação entre telas; a revisão aberta fica na URL
 * (`/revisao-ppc?id=…`).
 *
 * Com `compacto=1` e a janela no modo compacto (só no desktop), a revisão vira a coluna ao lado do Word
 * (`VistaCompacta.tsx`). Sem a janela compacta (⤢, ou a página recarregada, que volta com a janela normal),
 * o `compacto=1` sai da URL e a tela volta à inteira: quem lembrar a rota (a continuidade) não o guarda.
 *
 * No navegador (sem o desktop), o caminho do arquivo é digitado: é o modo de desenvolvimento.
 */
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Spinner } from "../../components/ui/spinner.tsx";
import { useApp, useJanelaCompacta, useTelaDeTrabalho } from "../../contexto.tsx";
import type { EnderecoDaRota, ResultadoLigar } from "../../janela-compacta.ts";
import { useRevisao } from "./contexto.ts";
import { Entrada } from "./Entrada.tsx";
import { Leitura } from "./Leitura.tsx";
import { Lendo } from "./Lendo.tsx";
import { TITULO_COMPACTO, VistaCompacta } from "./VistaCompacta.tsx";

/** A busca da rota: o id da revisão aberta, quando há, e se ela está na janela compacta. */
export interface BuscaRevisaoPpc {
  readonly id?: string;
  readonly compacto?: 1;
}

/** A busca da URL, conferida: só um `id` não vazio, e `compacto` só com ele. */
export const validarBusca = (busca: Record<string, unknown>): BuscaRevisaoPpc => {
  if (typeof busca.id !== "string" || busca.id === "") return {};
  return busca.compacto === 1 || busca.compacto === "1" ? { id: busca.id, compacto: 1 } : { id: busca.id };
};

/** A rota da tela, declarada na casca `routes/revisao-ppc.tsx` (o roteamento por arquivo do TanStack). */
const rota = getRouteApi("/revisao-ppc");

/** A vista compacta: a revisão com `compacto=1` (a lista pode trocar de id, "Qual é o curso?"). */
const naVistaCompacta = ({ pathname, search }: EnderecoDaRota): boolean =>
  pathname === "/revisao-ppc" && validarBusca(search).compacto === 1;

export function TelaRevisaoPpc() {
  const [estado, revisao] = useRevisao();
  const { id, compacto } = rota.useSearch();
  const navegar = useNavigate({ from: "/revisao-ppc" });
  const [janelaCompacta, janela] = useJanelaCompacta();
  const { painel } = useApp();
  const roteador = useRouter();
  const naColuna = compacto === 1 && janelaCompacta.ligada;
  // Buscar na base (⌘K) no meio da revisão abre o resultado no painel, e a revisão fica.
  useTelaDeTrabalho();

  // A URL manda quando há `id`: abre a lista se ainda não é a corrente.
  useEffect(() => {
    if (id !== undefined && id !== revisao.obter().listaId) void revisao.abrir(id);
  }, [id, revisao]);

  // Quando a lista corrente muda de id (por exemplo, "Qual é o curso?"), acompanha na URL.
  useEffect(() => {
    if (id === undefined || estado.fase !== "resultado" || estado.lista === undefined) return;
    if (estado.lista.id !== id && revisao.obter().listaId === estado.lista.id) {
      void navegar({ search: { id: estado.lista.id, ...(compacto === undefined ? {} : { compacto }) }, replace: true });
    }
  }, [estado.fase, estado.lista, id, compacto, revisao, navegar]);

  // Sem a janela compacta (⤢, a página recarregada), o `compacto=1` sai, e a revisão volta à tela inteira.
  // Saindo da revisão (o modo desliga porque a pessoa foi a outra tela), a navegação dela vale.
  useEffect(() => {
    if (compacto !== 1 || janelaCompacta.ligada || roteador.state.location.pathname !== "/revisao-ppc") return;
    void navegar({ search: id === undefined ? {} : { id }, replace: true });
  }, [compacto, janelaCompacta.ligada, id, navegar, roteador]);

  if (estado.fase === "lendo" && estado.arquivoLendo !== undefined) {
    return <Lendo arquivo={estado.arquivoLendo} etapa={estado.etapaLendo} />;
  }
  if (id !== undefined) {
    if (estado.fase === "carregando") {
      return (
        <p className="flex h-full items-center justify-center gap-2 text-muted-foreground">
          <Spinner /> Abrindo a revisão…
        </p>
      );
    }
    if (estado.fase === "resultado" && estado.lista !== undefined) {
      if (naColuna) return <VistaCompacta />;
      return (
        <Leitura
          aoCompactar={
            janela.disponivel
              ? async (): Promise<ResultadoLigar> => {
                  // Saiu da revisão enquanto o Word abria: o modo não liga noutra tela.
                  const aqui = roteador.state.location;
                  if (aqui.pathname !== "/revisao-ppc" || validarBusca(aqui.search).id !== id) return "desistiu";
                  const resultado = await janela.ligar(TITULO_COMPACTO, naVistaCompacta);
                  if (resultado !== "ligada") return resultado;
                  // O painel aberto cobriria a lista; e o `compacto=1` não fica no histórico (Voltar sai da
                  // revisão, e o modo com ela).
                  painel.fechar();
                  void navegar({ search: { id, compacto: 1 }, replace: true });
                  return resultado;
                }
              : undefined
          }
          aoSair={() => {
            revisao.sair();
            void navegar({ search: {}, replace: true });
          }}
        />
      );
    }
  }
  return (
    <Entrada
      erro={estado.erroEntrada}
      aoEscolher={(arquivo) => {
        void revisao.revisar(arquivo).then((listaId) => {
          if (listaId !== undefined) void navegar({ search: { id: listaId } });
        });
      }}
      aoAbrirLista={(lista) => {
        revisao.abrirLista(lista);
        void navegar({ search: { id: lista.id } });
      }}
    />
  );
}
