/**
 * Uma página do Explorar: o conteúdo de um link `ifpr://` pelo leitor do M1.6 (norma com selos e
 * relações, PPC nas seções) e pelas telas próprias de curso, campus, CNCT e ficha. Os links de dentro
 * abrem aqui mesmo, com voltar pelo histórico; com Alt (⌥-clique), no painel ao lado. "Abrir ao lado"
 * leva a página ao painel. "Perguntar à IA sobre isto" leva a página à conversa ao lado, como ficha (e ⌘J
 * também, enquanto a página está à vista). "Buscar no texto" (ou
 * ⌘F/Ctrl+F) busca no texto da página, com a barra presa ao topo enquanto a página rola. A página nova
 * começa do topo, e a rolagem de cada documento fica lembrada ao sair e voltar (`lib/rolagem.ts`).
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, PanelRightOpenIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBuscaNoTexto } from "../../components/BuscaPainel.tsx";
import { ATALHO_BUSCA } from "../../lib/teclado.ts";
import { Button } from "../../components/ui/button.tsx";
import { classeAtalho } from "../../explorar/componentes.tsx";
import { useIndiceExplorar } from "../../explorar/indice.ts";
import { nomeDaPagina } from "../../explorar/nomes.ts";
import { PerguntarIa } from "../../explorar/PerguntarIa.tsx";
import { ContextoInstancia, InstanciaLeitor } from "../../leitor/instancia.ts";
import { ConteudoLink } from "../../leitor/Leitor.tsx";
import { useApp } from "../../contexto.tsx";
import { useRolagemLembrada } from "../../lib/rolagem.ts";
import { useAbrirLink } from "../../painel/abrirLink.ts";
import { fichaDoLink } from "../../painel/conversar.ts";

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
  const abrirLink = useAbrirLink();
  const roteador = useRouter();
  const indice = useIndiceExplorar();
  const nome = nomeDaPagina(link, indice.fase === "lido" ? indice.valor : undefined);
  const app = useApp();
  // A página na conversa ao lado: a do módulo que conhece o link, ou a ficha do documento da base.
  const pedido = () => app.pedidoDoLink(link) ?? { fichas: [fichaDoLink(link, nome)] };
  useEffect(
    () => app.painel.declararContexto(() => app.pedidoDoLink(link) ?? { fichas: [fichaDoLink(link, nome)] }),
    [app, link, nome],
  );
  // Estável entre páginas: a busca observa o texto aqui e o refaz quando ele muda.
  const area = useRef<HTMLDivElement>(null);
  // A página é um leitor sem prefixo nos `id`; o painel do app, ao lado, tem o dele.
  const [instancia] = useState(() => new InstanciaLeitor(""));
  const {
    lupa,
    abrir: abrirBusca,
    barra: barraBusca,
  } = useBuscaNoTexto(area, instancia, "busca-presa sticky top-0 z-10 -mx-3 rounded-b-md bg-background");
  // A rolagem é a do Explorar, a mesma para todas as páginas dele.
  useRolagemLembrada(
    link.startsWith("ifpr://") ? `tela:${link.split("#")[0]}` : undefined,
    () => area.current?.closest<HTMLElement>("[data-rolagem-explorar]"),
    { link, topo: true },
  );
  if (!link.startsWith("ifpr://")) {
    return <p className="text-muted-foreground text-sm">Página não encontrada na base.</p>;
  }
  return (
    <div className="space-y-6" data-leitor="">
      <div className="nao-imprimir -mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => roteador.history.back()}>
          <ArrowLeftIcon /> Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            title="Esta página no painel ao lado, para ler junto com outra"
            onClick={() => abrirLink(link, "painel")}
          >
            <PanelRightOpenIcon /> Abrir ao lado
          </Button>
          <Button ref={lupa} variant="outline" size="sm" onClick={abrirBusca}>
            <SearchIcon /> Buscar no texto
            <kbd className={classeAtalho}>{ATALHO_BUSCA}</kbd>
          </Button>
          <PerguntarIa pedido={pedido} />
        </div>
      </div>
      {barraBusca}
      <div ref={area}>
        <ContextoInstancia value={instancia}>
          <ConteudoLink
            key={link.split("#")[0]}
            link={link}
            aoAbrirLink={(destino, onde) => {
              if (onde === "outro" || onde === "painel" || onde === "janela") {
                abrirLink(destino, onde === "janela" ? "janela" : "painel");
                return;
              }
              // A página nova começa do topo, ou onde estava (`useRolagemLembrada`); outro dispositivo da
              // mesma norma rola até ele no leitor.
              abrirLink(destino, "tela");
            }}
          />
        </ContextoInstancia>
      </div>
    </div>
  );
}
