/**
 * Uma página do Explorar: o conteúdo de um link `ifpr://` pelo leitor do M1.6 (norma com selos e
 * relações, PPC nas seções) e pelas telas próprias de curso, campus, CNCT e ficha. Os links de dentro
 * abrem aqui mesmo, com voltar pelo histórico. "Perguntar à IA sobre isto" leva o link ao pedido.
 */
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { pedidoSobre } from "../../explorar/colecoes.ts";
import { useIndiceExplorar } from "../../explorar/indice.ts";
import { nomeDaPagina } from "../../explorar/nomes.ts";
import { PerguntarIa } from "../../explorar/PerguntarIa.tsx";
import { ConteudoLink } from "../../leitor/Leitor.tsx";

export interface BuscaVer {
  readonly link: string;
}

export const Route = createFileRoute("/explorar/ver")({
  component: Pagina,
  validateSearch: (busca: Record<string, unknown>): BuscaVer => ({
    link: typeof busca.link === "string" ? busca.link : "",
  }),
});

function Pagina() {
  const { link } = Route.useSearch();
  const navegar = useNavigate();
  const roteador = useRouter();
  const indice = useIndiceExplorar();
  const nome = nomeDaPagina(link, indice.fase === "lido" ? indice.valor : undefined);
  if (!link.startsWith("ifpr://")) {
    return <p className="text-muted-foreground text-sm">Página não encontrada na base.</p>;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => roteador.history.back()}>
          <ArrowLeftIcon /> Voltar
        </Button>
        <PerguntarIa pedido={pedidoSobre(nome, [link])} />
      </div>
      <div className="rounded-xl border border-border bg-card p-5 text-card-foreground">
        <ConteudoLink
          key={link.split("#")[0]}
          link={link}
          aoAbrirLink={(destino) => {
            // a página nova começa do topo (outro dispositivo da mesma norma rola até ele no leitor)
            if (destino.split("#")[0] !== link.split("#")[0]) {
              document.querySelector("[data-rolagem-explorar]")?.scrollTo({ top: 0 });
            }
            void navegar({ to: "/explorar/ver", search: { link: destino } });
          }}
        />
      </div>
    </div>
  );
}
