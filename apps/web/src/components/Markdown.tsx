/**
 * O texto das respostas e do painel de leitura, em Markdown com GFM. Os links `ifpr://`, na sintaxe de
 * link ou soltos no texto (`linksIfpr.ts`), viram botões que abrem o painel de leitura; os outros abrem
 * fora do app (no desktop, no navegador do sistema).
 */
import { BookOpenIcon } from "lucide-react";
import { type ComponentProps, createContext, type MouseEvent, use } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { abrirExterno } from "../ponte-desktop.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import { remarkLinksIfpr } from "./linksIfpr.ts";

export const ESQUEMA_IFPR = "ifpr://";

export const ehLinkIfpr = (url: string): boolean => url.toLowerCase().startsWith(ESQUEMA_IFPR);

/** Mantém os links `ifpr://`; os outros passam pelo filtro padrão do react-markdown (sem `javascript:`). */
export function transformarUrl(url: string): string {
  return ehLinkIfpr(url) ? url : defaultUrlTransform(url);
}

function abrirFora(evento: MouseEvent<HTMLAnchorElement>, url: string) {
  evento.preventDefault();
  void abrirExterno(url);
}

/** Quem abre os links `ifpr://` do texto (o painel de leitura). */
export const AbrirLink = createContext<(link: string) => void>(() => {});

/** O `a` do Markdown: chip para `ifpr://`, navegador do sistema para o resto. Também o do leitor (`leitor/Documento.tsx`). */
export function LinkMarkdown({ href, children }: ComponentProps<"a">) {
  const aoAbrirLink = use(AbrirLink);
  if (href !== undefined && ehLinkIfpr(href)) {
    // O chip da citação: o texto do link, ou o nome curto quando a IA deixou o link solto.
    const texto =
      typeof children === "string"
        ? children
        : Array.isArray(children) && children.length === 1
          ? children[0]
          : undefined;
    const solto = texto === href || (typeof texto === "string" && ehLinkIfpr(texto));
    const nome = solto ? nomeCurtoLink(href) : undefined;
    return (
      <button
        type="button"
        className="link-ifpr"
        data-link={href}
        title={`Abrir a fonte: ${nome ?? (typeof texto === "string" ? texto : nomeCurtoLink(href))}`}
        onClick={() => aoAbrirLink(href)}
      >
        <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
        <span>{nome ?? children}</span>
      </button>
    );
  }
  if (href === undefined || href.length === 0) return <span>{children}</span>;
  return (
    <a href={href} rel="noopener noreferrer" target="_blank" onClick={(evento) => abrirFora(evento, href)}>
      {children}
    </a>
  );
}

const COMPONENTES: Components = { a: LinkMarkdown };

const PLUGINS = [remarkGfm, remarkLinksIfpr];

export function Markdown({
  texto,
  aoAbrirLink,
}: {
  readonly texto: string;
  readonly aoAbrirLink: (link: string) => void;
}) {
  return (
    <AbrirLink value={aoAbrirLink}>
      <div className="markdown">
        <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={transformarUrl} components={COMPONENTES}>
          {texto}
        </ReactMarkdown>
      </div>
    </AbrirLink>
  );
}
