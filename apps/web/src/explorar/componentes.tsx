/**
 * Peças das telas de coleção do Explorar: os filtros (lista de escolha e texto, com rótulo visível), a
 * contagem anunciada ao leitor de tela, a linha de um item (que se clica inteira e abre a página dele) e
 * a espera do índice. Lista é linha com divisória, nunca um cartão por item.
 * Os filtros ficam na URL da rota: voltar a uma coleção traz os mesmos filtros.
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, ListFilterIcon, XIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "../components/ui/button.tsx";
import { ComCarga } from "../leitor/pecas.tsx";
import { cn } from "../lib/utils.ts";
import { useIndiceExplorar } from "./indice.ts";

const classeCampo =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const classeRotulo = "font-medium text-muted-foreground text-micro";

/** Uma lista de escolha com rótulo; "Todos" (ou `todos`) tira o filtro. O filtro ligado fica marcado. */
export function CampoFiltro({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  todos = "Todos",
  nome = (v) => v,
}: {
  readonly rotulo: string;
  readonly valor: string | undefined;
  readonly opcoes: ReadonlyArray<string>;
  readonly aoMudar: (valor: string | undefined) => void;
  readonly todos?: string;
  readonly nome?: (valor: string) => string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={classeRotulo}>
        {rotulo}
      </label>
      <div className="relative">
        <select
          id={id}
          className={cn(
            classeCampo,
            "appearance-none truncate pr-8",
            valor === undefined
              ? "text-muted-foreground"
              : "border-primary bg-accent font-medium text-accent-foreground",
          )}
          value={valor ?? ""}
          onChange={(evento) => aoMudar(evento.currentTarget.value === "" ? undefined : evento.currentTarget.value)}
        >
          <option value="">{todos}</option>
          {opcoes.map((o) => (
            <option key={o} value={o}>
              {nome(o)}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}

/** O filtro de texto livre da coleção ("Filtrar pelo nome"). */
export function CampoTexto({
  rotulo,
  valor,
  aoMudar,
}: {
  readonly rotulo: string;
  readonly valor: string | undefined;
  readonly aoMudar: (valor: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={classeRotulo}>
        {rotulo}
      </label>
      <div className="relative">
        <ListFilterIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={id}
          type="search"
          className={cn(classeCampo, "pl-8")}
          value={valor ?? ""}
          onChange={(evento) => aoMudar(evento.currentTarget.value === "" ? undefined : evento.currentTarget.value)}
        />
      </div>
    </div>
  );
}

/** A faixa dos filtros, com a contagem e "Limpar os filtros". */
export function Filtros({
  children,
  total,
  achados,
  nomes,
  aoLimpar,
}: {
  readonly children: ReactNode;
  readonly total: number;
  readonly achados: number;
  /** O nome dos itens no singular e no plural ("curso", "cursos"). */
  readonly nomes: readonly [string, string];
  readonly aoLimpar: (() => void) | null;
}) {
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Filtros"
        className="grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-6"
      >
        {children}
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
        <p role="status" className="font-medium tabular-nums">
          {`${achados === total ? "" : `${achados} de `}${total} ${total === 1 ? nomes[0] : nomes[1]}`}
        </p>
        {aoLimpar === null ? null : (
          <Button size="sm" variant="ghost" onClick={aoLimpar}>
            <XIcon /> Limpar os filtros
          </Button>
        )}
      </div>
    </div>
  );
}

/** A classe do atalho de teclado escrito num botão ("⌘K", "⌘F"). */
export const classeAtalho = "rounded border border-border px-1.5 font-sans text-micro text-muted-foreground";

/** A classe de uma linha de lista que se clica inteira (o link do título se estica sobre ela). */
export const classeLinha =
  "group relative flex items-start gap-x-4 px-3 py-3 hover:bg-muted has-[a:focus-visible]:bg-muted";

/** A classe do link do título: o `::after` cobre a linha, e o foco contorna a linha inteira. */
export const classeLinkLinha =
  "font-semibold outline-none after:absolute after:inset-0 decoration-link-risco underline-offset-3 group-hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring";

/**
 * Um item da coleção: a linha inteira abre a página dele no Explorar. O link é só o título (é o que o
 * leitor de tela anuncia), esticado sobre a linha; o que vem à direita (`selos`) fica alinhado em coluna.
 */
export function LinhaItem({
  link,
  titulo,
  detalhe,
  selos,
  marca,
  serifado = false,
}: {
  readonly link: string;
  readonly titulo: string;
  readonly detalhe?: ReactNode;
  readonly selos?: ReactNode;
  /** O sinal à esquerda do título (a vigência da norma). */
  readonly marca?: ReactNode;
  /** O detalhe é texto do documento (a ementa da norma): vai na serifada. */
  readonly serifado?: boolean;
}) {
  return (
    <li className={classeLinha}>
      {marca ? <span className="flex h-6 items-center">{marca}</span> : null}
      <div className="min-w-0 flex-1">
        <Link to="/explorar/ver" search={{ link }} className={classeLinkLinha}>
          {titulo}
        </Link>
        {detalhe ? (
          <p
            className={cn(
              "line-clamp-2 max-w-[76ch] text-muted-foreground",
              serifado ? "font-serif text-[0.9375rem] leading-6" : "text-small",
            )}
          >
            {detalhe}
          </p>
        ) : null}
      </div>
      {selos ? (
        <p className="flex max-w-[45%] shrink-0 flex-wrap items-start justify-end gap-x-4 gap-y-1 pt-0.5">{selos}</p>
      ) : null}
      <ChevronRightIcon
        aria-hidden
        className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100"
      />
    </li>
  );
}

/** As linhas da coleção, com a divisória de 1 px entre elas. */
export function ListaItens({ children, vazia }: { readonly children: ReactNode; readonly vazia: boolean }) {
  if (vazia) return <p className="py-6 text-muted-foreground text-sm">Nada com esses filtros.</p>;
  return <ul className="divide-y divide-border border-border border-y">{children}</ul>;
}

/** Um dado discreto à direita da linha (o órgão, o campus). */
export function Dado({ children }: { readonly children: ReactNode }) {
  return <span className="text-muted-foreground text-small">{children}</span>;
}

/** O índice do Explorar carregado: a tela de coleção recebe as coleções. */
export function ComIndice({ children }: { readonly children: (indice: DadosIndice) => ReactNode }) {
  const indice = useIndiceExplorar();
  return (
    <ComCarga carga={indice} titulo="Não foi possível ler a base">
      {children}
    </ComCarga>
  );
}

/** A busca da rota de coleção: só os campos de texto não vazios. */
export function buscaDeTextos<K extends string>(campos: ReadonlyArray<K>) {
  return (busca: Record<string, unknown>): Partial<Record<K, string>> => {
    const saida: Partial<Record<K, string>> = {};
    for (const campo of campos) {
      const valor = busca[campo];
      if (typeof valor === "string" && valor !== "") saida[campo] = valor;
      else if (typeof valor === "number") saida[campo] = String(valor);
    }
    return saida;
  };
}
