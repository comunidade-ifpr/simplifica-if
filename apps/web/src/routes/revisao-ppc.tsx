/**
 * "Revisar um PPC": a entrada (soltar ou escolher o `.docx`, e as revisões recentes), a leitura com as
 * etapas (o stream de `revisaoPpc.revisar`) e o resultado (`revisao/Leitura.tsx`), com a lista viva de
 * pendências e a leitura com IA como continuação. O estado e os streams ficam em `ControleRevisao`
 * (no `ContextoApp`), para sobreviverem à navegação entre telas; a revisão aberta fica na URL
 * (`/revisao-ppc?id=…`).
 *
 * No navegador (sem o desktop), o caminho do arquivo é digitado: é o modo de desenvolvimento.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Spinner } from "../components/ui/spinner.tsx";
import { useRevisao } from "../contexto.tsx";
import { Entrada } from "../revisao/Entrada.tsx";
import { Leitura } from "../revisao/Leitura.tsx";
import { Lendo } from "../revisao/Lendo.tsx";

/** A busca da rota: o id da revisão aberta, quando há. */
export interface BuscaRevisaoPpc {
  readonly id?: string;
}

export const Route = createFileRoute("/revisao-ppc")({
  component: RevisaoPpc,
  validateSearch: (busca: Record<string, unknown>): BuscaRevisaoPpc =>
    typeof busca.id === "string" && busca.id !== "" ? { id: busca.id } : {},
});

function RevisaoPpc() {
  const [estado, revisao] = useRevisao();
  const { id } = Route.useSearch();
  const navegar = useNavigate({ from: "/revisao-ppc" });

  // A URL manda quando há `id`: abre a lista se ainda não é a corrente.
  useEffect(() => {
    if (id !== undefined && id !== revisao.obter().listaId) void revisao.abrir(id);
  }, [id, revisao]);

  // Quando a lista corrente muda de id (por exemplo, "Qual é o curso?"), acompanha na URL.
  useEffect(() => {
    if (id === undefined || estado.fase !== "resultado" || estado.lista === undefined) return;
    if (estado.lista.id !== id && revisao.obter().listaId === estado.lista.id) {
      void navegar({ search: { id: estado.lista.id }, replace: true });
    }
  }, [estado.fase, estado.lista, id, revisao, navegar]);

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
      return (
        <Leitura
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
