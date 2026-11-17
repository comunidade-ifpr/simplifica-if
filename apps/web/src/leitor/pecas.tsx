/**
 * Peças comuns das telas do leitor `ifpr://` e das fichas do Explorar: a espera, a falha com "Tentar de
 * novo", a carga (`ComCarga`), a seção com título e o link `ifpr://` como botão.
 */
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { abrirFora } from "../components/Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import type { Carga } from "./carga.ts";

export function Carregando({ texto = "Lendo na base…" }: { readonly texto?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner size="sm" /> {texto}
    </p>
  );
}

export function Falha({
  titulo,
  erro,
  aoTentar,
}: {
  readonly titulo: string;
  readonly erro: string;
  readonly aoTentar: () => void;
}) {
  return (
    <Alert variant="error">
      <AlertTitle>{titulo}</AlertTitle>
      <AlertDescription>
        <p>{erro}</p>
        <Button className="mt-2" size="sm" variant="outline" onClick={aoTentar}>
          Tentar de novo
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Mostra a carga: o conteúdo quando lida, a espera e o erro com "Tentar de novo". */
export function ComCarga<T>({
  carga,
  titulo,
  children,
}: {
  readonly carga: Carga<T> & { readonly tentarDeNovo: () => void };
  readonly titulo: string;
  readonly children: (valor: T) => ReactNode;
}) {
  switch (carga.fase) {
    case "parada":
      return null;
    case "carregando":
      return <Carregando />;
    case "falhou":
      return <Falha titulo={titulo} erro={carga.erro} aoTentar={carga.tentarDeNovo} />;
    case "lido":
      return children(carga.valor);
  }
}

/** Um link `ifpr://` como botão que abre no leitor (relações, sucessoras, seções). */
export function BotaoLink({
  link,
  aoAbrirLink,
  children,
}: {
  readonly link: string;
  readonly aoAbrirLink: (link: string) => void;
  readonly children?: ReactNode;
}) {
  return (
    <button type="button" className="link-ifpr" data-link={link} onClick={() => aoAbrirLink(link)}>
      <span>{children ?? nomeCurtoLink(link)}</span>
    </button>
  );
}

export function Secao({ titulo, children }: { readonly titulo: string; readonly children: ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-1.5">
      <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">{titulo}</h3>
      {children}
    </section>
  );
}

/** Um endereço fora da base (site do campus, publicação oficial), aberto no navegador do sistema. */
export function LinkExterno({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      className="nao-imprimir inline-flex items-center gap-1 font-semibold text-primary text-sm underline underline-offset-2"
      onClick={(evento) => {
        evento.preventDefault();
        abrirFora(href);
      }}
    >
      {children} <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}

/** O cabeçalho de uma página do leitor: o tipo, o título e o que vem abaixo dele. */
export function Cabecalho({
  tipo,
  titulo,
  children,
}: {
  readonly tipo: string;
  readonly titulo: string;
  readonly children?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">{tipo}</p>
      <h2 className="font-semibold text-lg leading-snug">{titulo}</h2>
      {children}
    </header>
  );
}
