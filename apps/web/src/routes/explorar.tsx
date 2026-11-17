/**
 * Explorar: a base inteira para navegar, sem IA, offline e instantânea (antes M2.1, trazido ao Marco 1).
 * O topo tem a busca (a paleta, Ctrl/Cmd+K) e as coleções: normas, cursos, PPCs, campi, CNCT, Consepe e
 * as fichas de análise de PPC. As coleções vêm do índice (`explorarIndice`), lido uma vez e filtrado
 * na memória; cada item abre a página dele (`/explorar/ver?link=ifpr://…`), que usa o leitor do M1.6.
 */
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { Button } from "../components/ui/button.tsx";
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

const classeAba =
  "rounded-md px-2.5 py-1 font-medium text-muted-foreground text-sm hover:bg-accent hover:text-foreground data-[status=active]:bg-primary/10 data-[status=active]:text-primary";

function Explorar() {
  const { abrir } = usePaleta();
  return (
    <div className="flex h-full flex-col">
      <div className="border-border border-b bg-card/50">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 pt-4 pb-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-bold text-2xl tracking-tight">
                <Link to="/explorar">Explorar a base</Link>
              </h1>
              <p className="text-muted-foreground text-sm">
                Normas, cursos, PPCs, campi, catálogo e Consepe, direto da base do app. Sem IA e sem internet.
              </p>
            </div>
            <Button variant="outline" onClick={() => abrir()}>
              <SearchIcon /> Buscar na base
              <kbd className="ml-1 rounded border border-border px-1 font-sans text-muted-foreground text-xs">
                {atalhoPaleta()}
              </kbd>
            </Button>
          </div>
          <nav aria-label="Coleções" className="-mx-1 flex flex-wrap gap-1">
            {COLECOES.map((c) => (
              <Link key={c.to} to={c.to} className={classeAba}>
                {c.nome}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-rolagem-explorar>
        <div className="mx-auto max-w-5xl px-6 py-5">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
