/**
 * Uma página do Explorar: o conteúdo de um link `ifpr://` pelo leitor do M1.6 (norma com selos e
 * relações, PPC nas seções) e pelas telas próprias de curso, campus, CNCT e ficha. Os links de dentro
 * abrem aqui mesmo, com voltar pelo histórico. "Perguntar à IA sobre isto" leva o link ao pedido. "Buscar
 * no texto" (ou ⌘F/Ctrl+F) busca no texto da página, com a barra presa ao topo enquanto a página rola.
 */
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useRef } from "react";
import { ATALHO_BUSCA, useBuscaNoTexto } from "../../components/BuscaPainel.tsx";
import { Button } from "../../components/ui/button.tsx";
import { pedidoSobre } from "../../explorar/colecoes.ts";
import { classeAtalho } from "../../explorar/componentes.tsx";
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
  // Estável entre páginas: a busca observa o texto aqui e o refaz quando ele muda.
  const area = useRef<HTMLDivElement>(null);
  const {
    lupa,
    abrir: abrirBusca,
    barra: barraBusca,
  } = useBuscaNoTexto(area, "busca-presa sticky top-0 z-10 -mx-3 rounded-b-md bg-background");
  if (!link.startsWith("ifpr://")) {
    return <p className="text-muted-foreground text-sm">Página não encontrada na base.</p>;
  }
  return (
    <div className="space-y-6">
      <div className="nao-imprimir -mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => roteador.history.back()}>
          <ArrowLeftIcon /> Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Button ref={lupa} variant="outline" size="sm" onClick={abrirBusca}>
            <SearchIcon /> Buscar no texto
            <kbd className={classeAtalho}>{ATALHO_BUSCA}</kbd>
          </Button>
          <PerguntarIa pedido={pedidoSobre(nome, [link])} />
        </div>
      </div>
      {barraBusca}
      <div ref={area}>
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
