/**
 * Peças das telas de coleção do Explorar: os filtros (lista de escolha e texto, com rótulo visível), a
 * contagem anunciada ao leitor de tela, a linha de um item (que abre a página dele) e a espera do índice.
 * Os filtros ficam na URL da rota: voltar a uma coleção traz os mesmos filtros.
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "../components/ui/button.tsx";
import { ComCarga } from "../leitor/pecas.tsx";
import { useIndiceExplorar } from "./indice.ts";

const classeCampo =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

/** Uma lista de escolha com rótulo; "Todos" (ou `todos`) tira o filtro. */
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
    <div className="flex min-w-36 flex-1 flex-col gap-1">
      <label htmlFor={id} className="font-medium text-muted-foreground text-micro">
        {rotulo}
      </label>
      <select
        id={id}
        className={classeCampo}
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
    <div className="flex min-w-48 flex-[2] flex-col gap-1">
      <label htmlFor={id} className="font-medium text-muted-foreground text-micro">
        {rotulo}
      </label>
      <input
        id={id}
        type="search"
        className={classeCampo}
        value={valor ?? ""}
        onChange={(evento) => aoMudar(evento.currentTarget.value === "" ? undefined : evento.currentTarget.value)}
      />
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
    <div className="space-y-2">
      <div role="group" aria-label="Filtros" className="flex flex-wrap items-end gap-3">
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
        <p role="status">{`${achados === total ? "" : `${achados} de `}${total} ${total === 1 ? nomes[0] : nomes[1]}`}</p>
        {aoLimpar === null ? null : (
          <Button size="sm" variant="ghost" onClick={aoLimpar}>
            <XIcon /> Limpar os filtros
          </Button>
        )}
      </div>
    </div>
  );
}

/** Um item da coleção: o título abre a página dele no Explorar; abaixo, o detalhe. */
export function LinhaItem({
  link,
  titulo,
  detalhe,
  selos,
}: {
  readonly link: string;
  readonly titulo: string;
  readonly detalhe?: ReactNode;
  readonly selos?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2 hover:border-ring/40">
      <Link to="/explorar/ver" search={{ link }} className="text-link text-small underline underline-offset-2">
        {titulo}
      </Link>
      {detalhe ? <p className="text-muted-foreground text-small">{detalhe}</p> : null}
      {selos ? <p className="mt-1 flex flex-wrap gap-1">{selos}</p> : null}
    </li>
  );
}

export function ListaItens({ children, vazia }: { readonly children: ReactNode; readonly vazia: boolean }) {
  if (vazia) return <p className="text-muted-foreground text-sm">Nada com esses filtros.</p>;
  return <ul className="grid gap-2 lg:grid-cols-2">{children}</ul>;
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
