/**
 * Explorar: a base inteira para navegar, sem IA, offline e instantânea (antes M2.1, trazido ao Marco 1).
 * O topo tem a busca (a paleta, Ctrl/Cmd+K) e as coleções: normas, cursos, PPCs, campi, CNCT, Consepe e
 * as fichas de análise de PPC. As coleções vêm do índice (`explorarIndice`), lido uma vez e filtrado
 * na memória; cada item abre a página dele (`/explorar/ver?link=ifpr://…`), que usa o leitor do M1.6.
 */
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
import { classeColuna } from "../components/Pagina.tsx";
import { cn } from "../lib/utils.ts";
import { atalhoPaleta, usePaleta } from "../explorar/Paleta.tsx";

export const Route = createFileRoute("/explorar")({ component: Explorar });

const COLECOES = [
  { to: "/explorar/normas", nome: "Normas" },
  { to: "/explorar/cursos", nome: "Cursos" },
  { to: "/explorar/ppcs", nome: "PPCs" },
  { to: "/explorar/campi", nome: "Campi" },
  { to: "/explorar/cnct", nome: "CNCT" },
  { to: "/explorar/consepe", nome: "Consepe" },
  { to: "/explorar/fichas", nome: "Fichas de análise" },
] as const;

// A aba ativa pelo traço embaixo e pela cor do texto, sem fundo: é navegação, não botão.
const classeAba =
  "border-transparent border-b-2 px-2.5 pt-1 pb-2 font-medium text-muted-foreground text-small hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground";

function Explorar() {
  const { abrir } = usePaleta();
  return (
    <div className="flex h-full flex-col">
      <div className="border-border border-b">
        <div className={cn(classeColuna("larga"), "flex flex-col gap-4 pt-8")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-display">
                <Link to="/explorar">Explorar a base</Link>
              </h1>
              <p className="text-muted-foreground">
                Normas, cursos, PPCs, campi, catálogo e Consepe, direto da base do app. Sem IA e sem internet.
              </p>
            </div>
            <Button variant="outline" onClick={() => abrir()}>
              <SearchIcon /> Buscar na base
              <kbd className="ml-1 rounded border border-border px-1 font-sans text-micro text-muted-foreground">
                {atalhoPaleta()}
              </kbd>
            </Button>
          </div>
          <nav aria-label="Coleções" className="-mx-2.5 -mb-px flex flex-wrap gap-1">
            {COLECOES.map((c) => (
              <Link key={c.to} to={c.to} className={classeAba}>
                {c.nome}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {/* `relative`: o que tem posição absoluta (o `sr-only` do trecho citado) rola com a página. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto" data-rolagem-explorar>
        <div className={cn(classeColuna("larga"), "py-6")}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
