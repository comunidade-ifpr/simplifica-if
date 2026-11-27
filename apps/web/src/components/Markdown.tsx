/**
 * O texto das respostas e do painel de leitura, em Markdown com GFM. Os links `ifpr://`, na sintaxe de
 * link ou soltos no texto (`linksIfpr.ts`), viram botões que abrem o painel de leitura; os outros abrem
 * fora do app (no desktop, no navegador do sistema).
 */
import { BookOpenIcon, ExternalLinkIcon } from "lucide-react";
import { type ComponentProps, createContext, type MouseEvent, use } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { type InstanciaLeitor, useInstanciaLeitor } from "../leitor/instancia.ts";
import { abrirExterno } from "../ponte-desktop.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import { remarkLinksIfpr } from "./linksIfpr.ts";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";

export const ESQUEMA_IFPR = "ifpr://";

export const ehLinkIfpr = (url: string): boolean => url.toLowerCase().startsWith(ESQUEMA_IFPR);

/** Mantém os links `ifpr://`; os outros passam pelo filtro padrão do react-markdown (sem `javascript:`). */
export function transformarUrl(url: string): string {
  return ehLinkIfpr(url) ? url : defaultUrlTransform(url);
}

/** Só `http` e `https` saem do app (o desktop recusa o resto). */
export const ehLinkWeb = (url: string): boolean => /^https?:\/\//i.test(url);

/** Abre no navegador do sistema; uma recusa (do desktop ou do navegador) não vira promessa rejeitada solta. */
export function abrirFora(url: string): void {
  abrirExterno(url).catch(() => undefined);
}

/**
 * Um link `#âncora` do próprio documento: rola até o elemento, se ele existe, dentro do leitor em que o
 * link está (com o prefixo de `id` dele) ou, fora de um leitor, na tela.
 */
function irParaAncora(evento: MouseEvent<HTMLAnchorElement>, href: string, instancia: InstanciaLeitor) {
  evento.preventDefault();
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // âncora malformada: procura como veio
  }
  const origem = evento.currentTarget;
  const alvo = instancia.elemento(origem, id) ?? instancia.elemento(origem, `user-content-${id}`);
  alvo?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** Quem abre os links `ifpr://` do texto (o painel de leitura). */
export const AbrirLink = createContext<AoAbrirLink>(() => {});

/**
 * O `a` do Markdown: chip para `ifpr://`; `http(s)` no navegador do sistema; `#âncora` rola no próprio
 * texto; o resto (`mailto:`, caminho relativo) fica como texto. Também o do leitor (`leitor/Documento.tsx`).
 */
export function LinkMarkdown({ href, children }: ComponentProps<"a">) {
  const aoAbrirLink = use(AbrirLink);
  const instancia = useInstanciaLeitor();
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
        onClick={(evento) => aoAbrirLink(href, ondeDoClique(evento))}
      >
        <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
        <span>{nome ?? children}</span>
      </button>
    );
  }
  if (href !== undefined && href.startsWith("#") && href.length > 1) {
    return (
      <a href={href} onClick={(evento) => irParaAncora(evento, href, instancia)}>
        {children}
      </a>
    );
  }
  // `mailto:`, caminho relativo e o resto não abrem no app nem no navegador (o desktop só abre http e
  // https): ficam como texto.
  if (href === undefined || !ehLinkWeb(href)) return <span>{children}</span>;
  let dominio: string | undefined;
  try {
    dominio = new URL(href).hostname;
  } catch {
    dominio = undefined;
  }
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      data-fonte-externa
      title={dominio === undefined ? "Abrir no navegador" : `Abrir no navegador: ${dominio}`}
      onClick={(evento) => {
        evento.preventDefault();
        abrirFora(href);
      }}
    >
      {children}
      <ExternalLinkIcon aria-hidden className="ml-0.5 inline size-3.5 shrink-0 align-[-0.15em]" />
    </a>
  );
}

const COMPONENTES: Components = { a: LinkMarkdown };

const PLUGINS = [remarkGfm, remarkLinksIfpr];

export function Markdown({ texto, aoAbrirLink }: { readonly texto: string; readonly aoAbrirLink: AoAbrirLink }) {
  return (
    <AbrirLink value={aoAbrirLink}>
      <div className="markdown" data-conteudo>
        <ReactMarkdown remarkPlugins={PLUGINS} urlTransform={transformarUrl} components={COMPONENTES}>
          {texto}
        </ReactMarkdown>
      </div>
    </AbrirLink>
  );
}
