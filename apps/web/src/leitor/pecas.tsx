/**
 * Peças comuns das telas do leitor `ifpr://` e das fichas do Explorar: a espera, a falha com "Tentar de
 * novo", a carga (`ComCarga`), o cabeçalho, o corpo com a coluna lateral, a seção com título e o link
 * `ifpr://` como botão.
 */
import { CheckIcon, CopyIcon, ExternalLinkIcon, LocateFixedIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { abrirFora } from "../components/Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import type { Carga } from "./carga.ts";
import { useInstanciaLeitor } from "./instancia.ts";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";

function Carregando() {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner size="sm" /> Lendo na base…
    </p>
  );
}

function Falha({
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
        <Button className="mt-2 self-start" size="sm" variant="outline" onClick={aoTentar}>
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
  readonly aoAbrirLink: AoAbrirLink;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="link-ifpr"
      data-link={link}
      onClick={(evento) => aoAbrirLink(link, ondeDoClique(evento))}
    >
      <span>{children ?? nomeCurtoLink(link)}</span>
    </button>
  );
}

export function Secao({ titulo, children }: { readonly titulo: string; readonly children: ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-1.5">
      <h3 className="font-semibold text-muted-foreground text-small">{titulo}</h3>
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
      className="inline-flex items-center gap-1 link-grifo text-small"
      onClick={(evento) => {
        evento.preventDefault();
        abrirFora(href);
      }}
    >
      {children} <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}

/** Código do curso no SUAP, copiável num clique. */
export function BotaoCodigoSuap({ codigo, prefixo = true }: { readonly codigo: string; readonly prefixo?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    navigator.clipboard.writeText(codigo).then(
      () => {
        setCopiado(true);
        window.setTimeout(() => setCopiado(false), 2000);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      onClick={copiar}
      title={`Copiar código SUAP ${codigo}`}
      aria-label={copiado ? `Código SUAP ${codigo} copiado` : `Copiar código SUAP ${codigo}`}
      className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-foreground text-micro hover:border-ring"
    >
      <span>{prefixo ? `SUAP ${codigo}` : codigo}</span>
      {copiado ? (
        <CheckIcon aria-hidden className="size-3 text-success-foreground" />
      ) : (
        <CopyIcon aria-hidden className="size-3 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * O cabeçalho de uma página do leitor, em ordem de importância: o tipo, o título, o resumo (a ementa da
 * norma, o campus do curso), as ações à direita (copiar a citação, a fonte oficial) e, abaixo, o que a
 * página tem de próprio (a situação de vigência, os fatos). É um contêiner: no painel estreito ao lado da
 * conversa o título é menor e as ações descem para baixo dele.
 */
export function Cabecalho({
  tipo,
  titulo,
  resumo,
  acoes,
  children,
}: {
  readonly tipo: string;
  readonly titulo: string;
  readonly resumo?: ReactNode;
  readonly acoes?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="@container space-y-5">
      <div className="flex flex-col gap-x-8 gap-y-3 @3xl:flex-row @3xl:items-start @3xl:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="font-semibold text-muted-foreground text-small">{tipo}</p>
          <h2 className="break-words text-title @3xl:text-display">{titulo}</h2>
          {resumo}
        </div>
        {acoes ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-small @3xl:pt-7">{acoes}</div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/** Os fatos curtos do cabeçalho (as datas do ato, o campus e o nível), numa linha com divisórias. */
export function Fatos({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex flex-wrap gap-y-1 text-small [&>*+*]:ml-3 [&>*+*]:border-border [&>*+*]:border-l [&>*+*]:pl-3">
      {children}
    </p>
  );
}

/**
 * O corpo de uma página do leitor: o conteúdo principal e, quando há, a coluna lateral (relações da
 * norma, seções do PPC). Com largura, a lateral fica à direita e acompanha a rolagem; no painel estreito,
 * vem antes do conteúdo, como uma seção a mais.
 */
export function Corpo({ lateral, children }: { readonly lateral?: ReactNode; readonly children: ReactNode }) {
  if (!lateral) return <div className="space-y-4">{children}</div>;
  return (
    <div className="@container">
      <div className="grid gap-x-12 gap-y-6 @4xl:grid-cols-[minmax(0,1fr)_19rem]">
        <aside className="space-y-6 @4xl:sticky @4xl:top-0 @4xl:col-start-2 @4xl:row-start-1 @4xl:max-h-[calc(100dvh-9rem)] @4xl:self-start @4xl:overflow-y-auto @4xl:border-border @4xl:border-l @4xl:pl-6">
          {lateral}
        </aside>
        <div className="min-w-0 space-y-4 @4xl:col-start-1 @4xl:row-start-1">{children}</div>
      </div>
    </div>
  );
}

/** A faixa do trecho citado: o que está destacado e "Ir ao trecho". */
export function FaixaTrecho({ rotulo, alvo }: { readonly rotulo: string; readonly alvo: string }) {
  const instancia = useInstanciaLeitor();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        Trecho citado: <strong>{rotulo}</strong>, destacado no texto.
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={(evento) =>
          instancia.elemento(evento.currentTarget, alvo)?.scrollIntoView({ block: "start", behavior: "smooth" })
        }
      >
        <LocateFixedIcon /> Ir ao trecho
      </Button>
    </div>
  );
}
