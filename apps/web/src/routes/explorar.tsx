/**
 * Explorar: a base inteira para navegar, sem IA, offline e instantânea (antes M2.1, trazido ao Marco 1).
 * Na entrada, o topo é a busca (a paleta, Ctrl/Cmd+K), em destaque, com exemplos do que ela entende;
 * dentro de uma coleção ou de uma página, o topo se recolhe a uma linha, e o conteúdo fica com a tela.
 * As coleções (normas, cursos, PPCs, campi, CNCT e Consepe) vêm do índice (`explorarIndice`), lido uma
 * vez e filtrado na memória; cada item abre a página dele (`/explorar/ver?link=ifpr://…`), que usa o
 * leitor do M1.6.
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { classeColuna } from "../components/Pagina.tsx";
import { classeAtalho } from "../explorar/componentes.tsx";
import { ICONES_TIPO } from "../explorar/icones.ts";
import { useIndiceExplorar } from "../explorar/indice.ts";
import { atalhoPaleta, usePaleta } from "../explorar/Paleta.tsx";
import { inteiro } from "../lib/formato.ts";
import { cn } from "../lib/utils.ts";

export const Route = createFileRoute("/explorar")({ component: Explorar });

const COLECOES = [
  {
    to: "/explorar/normas",
    nome: "Normas",
    tipo: "norma",
    icone: ICONES_TIPO.norma,
    quantos: (d: DadosIndice) => d.normas.length,
  },
  {
    to: "/explorar/cursos",
    nome: "Cursos",
    tipo: "curso",
    icone: ICONES_TIPO.curso,
    quantos: (d: DadosIndice) => d.cursos.length,
  },
  {
    to: "/explorar/ppcs",
    nome: "PPCs",
    tipo: "ppc",
    icone: ICONES_TIPO.ppc,
    quantos: (d: DadosIndice) => d.ppcs.length,
  },
  {
    to: "/explorar/campi",
    nome: "Campi",
    tipo: "campus",
    icone: ICONES_TIPO.campus,
    quantos: (d: DadosIndice) => d.campi.length,
  },
  {
    to: "/explorar/cnct",
    nome: "CNCT",
    tipo: "cnct",
    icone: ICONES_TIPO.cnct,
    quantos: (d: DadosIndice) => d.cnct.length,
  },
  {
    to: "/explorar/consepe",
    nome: "Consepe",
    tipo: "reuniao",
    icone: ICONES_TIPO.consepe,
    quantos: (d: DadosIndice) => d.reunioes.length,
  },
] as const;

/** O que a busca entende, para abrir a paleta já com a consulta. */
const EXEMPLOS = ["LDB, art. 36", "Res. CNE/CP 2/2026, art. 71", "acompanhamento de egressos", "Técnico em Enfermagem"];

// A aba ativa pelo traço embaixo e pela cor do texto, sem fundo: é navegação, não botão.
const classeAba =
  "flex items-baseline gap-1.5 border-transparent border-b-2 px-2.5 pt-1 pb-2 font-medium text-muted-foreground text-small hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground";

/** O tipo da página aberta (`/explorar/ver?link=ifpr://norma/…`, a reunião do Consepe), para marcar a coleção dela. */
function tipoDaPagina(local: { readonly pathname: string; readonly search: Record<string, unknown> }): string | null {
  if (local.pathname.startsWith("/explorar/reuniao")) return "reuniao";
  const link = local.search["link"];
  return typeof link === "string" ? (/^ifpr:\/\/([a-z]+)\//.exec(link)?.[1] ?? null) : null;
}

function Abas() {
  const indice = useIndiceExplorar();
  const tipo = useLocation({ select: tipoDaPagina });
  return (
    <nav aria-label="Coleções" className="-mx-2.5 -mb-px flex flex-wrap gap-1">
      {COLECOES.map((c) => (
        <Link key={c.to} to={c.to} className={cn(classeAba, c.tipo === tipo ? "border-primary text-foreground" : "")}>
          <c.icone aria-hidden className="size-3.5 shrink-0 self-center" />
          {c.nome}{" "}
          {indice.fase === "lido" ? (
            <span className="font-normal text-micro tabular-nums opacity-80">{inteiro(c.quantos(indice.valor))}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Explorar() {
  const { abrir } = usePaleta();
  const naEntrada = useLocation({ select: (l) => l.pathname.replace(/\/$/, "") === "/explorar" });
  return (
    <div className="flex h-full flex-col">
      <div className={cn("border-border border-b", naEntrada ? "bg-muted" : "")}>
        {naEntrada ? (
          <div className={cn(classeColuna("larga"), "flex flex-col gap-6 pt-12")}>
            <div className="space-y-2">
              <h1 className="text-hero">Explorar o IFPR</h1>
              <p className="max-w-[60ch] text-body text-muted-foreground">
                As normas que regem o Instituto, das federais às internas, os cursos, os PPCs, os campi, o catálogo de
                cursos técnicos e o Consepe.
              </p>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => abrir()}
                className="flex h-14 w-full max-w-3xl items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-muted-foreground shadow-[0_1px_2px_rgb(0_0_0/5%),0_10px_28px_-14px_rgb(0_0_0/18%)] hover:border-ring/45 dark:shadow-[0_14px_32px_-18px_rgb(0_0_0/75%)]"
              >
                <SearchIcon aria-hidden className="size-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="sr-only">Buscar na base: </span>
                  Um curso, um campus, uma norma, um assunto dos PPCs ou uma citação
                </span>
                <kbd className={classeAtalho}>{atalhoPaleta()}</kbd>
              </button>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-small">
                <span className="text-muted-foreground">Por exemplo:</span>
                {EXEMPLOS.map((exemplo) => (
                  <button
                    key={exemplo}
                    type="button"
                    onClick={() => abrir(exemplo)}
                    className="rounded-full border border-border bg-card px-2.5 py-0.5 hover:border-input hover:bg-muted"
                  >
                    {exemplo}
                  </button>
                ))}
              </p>
            </div>
            <Abas />
          </div>
        ) : (
          <div className={cn(classeColuna("larga"), "flex flex-wrap items-end justify-between gap-x-6 pt-3")}>
            <div className="flex flex-wrap items-end gap-x-6">
              <h1 className="pb-2 font-extrabold text-heading tracking-tight">
                <Link to="/explorar" className="decoration-link-risco underline-offset-3 hover:underline">
                  Explorar o IFPR
                </Link>
              </h1>
              <Abas />
            </div>
            <button
              type="button"
              onClick={() => abrir()}
              className="mb-1.5 flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-muted-foreground text-small hover:border-ring/45 hover:text-foreground"
            >
              <SearchIcon aria-hidden className="size-4" /> Buscar na base
              <kbd className={classeAtalho}>{atalhoPaleta()}</kbd>
            </button>
          </div>
        )}
      </div>
      {/* `relative`: o que tem posição absoluta (o `sr-only` do trecho citado) rola com a página. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto" data-rolagem-explorar>
        <div className={cn(classeColuna("larga"), "py-8")}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
