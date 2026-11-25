/**
 * A busca no texto de um documento (⌘F no macOS, Ctrl+F nos outros, ou a lupa), no painel de leitura e
 * na página do Explorar: busca no texto que a área mostra, sem acento nem caixa, pinta todas as
 * ocorrências e a atual, e Enter/Shift+Enter (ou as setas) passam de uma a outra, rolando até ela. Esc
 * fecha. A lógica está em `leitor/busca.ts`; o atalho, a lupa e a barra, em `useBuscaNoTexto`.
 *
 * O texto se indexa uma vez; quando o conteúdo da área muda (o documento terminou de carregar, outro
 * trecho foi destacado, outro documento abriu), o índice e as ocorrências se refazem com o mesmo termo.
 */
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import {
  type IndiceBusca,
  indexarBusca,
  MONTAR_TUDO,
  NOME_BUSCA,
  NOME_BUSCA_ATUAL,
  ocorrencias,
  termoDaBusca,
  visivel,
} from "../leitor/busca.ts";
import { rolarAte, textosDe } from "../leitor/realce.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

/** Pede ao `Documento` todos os blocos (só de um tratador de evento: o `Documento` usa `flushSync`). */
export const montarTudo = () => window.dispatchEvent(new Event(MONTAR_TUDO));

/** macOS usa ⌘F; os outros, Ctrl+F (no macOS, Ctrl+F num campo de texto avança o cursor). */
export const NO_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
export const ATALHO_BUSCA = NO_MAC ? "⌘F" : "Ctrl+F";
export const eAtalhoBusca = (e: KeyboardEvent) =>
  (NO_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  e.key.toLowerCase() === "f";

/** O índice do texto à vista na área, refeito só depois que o DOM mudou (`cache` volta a `null`). */
function indiceDe(raiz: HTMLElement | null, cache: { current: IndiceBusca | null }): IndiceBusca | null {
  if (raiz === null) return null;
  cache.current ??= indexarBusca(textosDe([raiz]).filter(visivel));
  return cache.current;
}

export interface BuscaNoTexto {
  /** Vai na lupa: o foco volta a ela quando a barra fecha. */
  readonly lupa: RefObject<HTMLButtonElement | null>;
  /** Abre a barra (ou devolve o foco a ela), como o atalho. */
  readonly abrir: () => void;
  /** A barra, enquanto aberta. */
  readonly barra: ReactNode;
}

/**
 * O atalho, a lupa e a barra da busca sobre `area`. O atalho vale de qualquer lugar da tela, mas só
 * enquanto `area` está nela e sem diálogo por cima: quem tem a área montada é o dono da busca.
 */
export function useBuscaNoTexto(area: RefObject<HTMLElement | null>, classeBarra?: string): BuscaNoTexto {
  const lupa = useRef<HTMLButtonElement>(null);
  const [pedido, setPedido] = useState(0);
  const abrir = () => {
    montarTudo();
    setPedido((n) => n + 1);
  };
  const fechar = () => {
    setPedido(0);
    // Sem rolar: no Explorar a lupa fica no topo da página, e a pessoa perderia o ponto achado.
    lupa.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const raiz = area.current;
      if (!eAtalhoBusca(e) || !raiz?.isConnected) return;
      // Um diálogo por cima (a paleta do Explorar) fica com o teclado.
      const modal = document.querySelector('[aria-modal="true"]');
      if (modal !== null && !modal.contains(raiz)) return;
      e.preventDefault();
      montarTudo();
      setPedido((n) => n + 1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [area]);
  const barra =
    pedido === 0 ? null : <BuscaPainel area={area} pedido={pedido} aoFechar={fechar} className={classeBarra} />;
  return { lupa, abrir, barra };
}

export function BuscaPainel({
  area,
  pedido,
  aoFechar,
  className,
}: {
  /** O contêiner do texto, estável entre documentos (o observador fica nele). */
  readonly area: RefObject<HTMLElement | null>;
  /** Sobe a cada atalho ou clique na lupa: o campo recebe o foco, com o termo selecionado. */
  readonly pedido: number;
  readonly aoFechar: () => void;
  readonly className?: string | undefined;
}) {
  const [termo, setTermo] = useState("");
  const [faixas, setFaixas] = useState<ReadonlyArray<Range>>([]);
  const [atual, setAtual] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const indice = useRef<IndiceBusca | null>(null);
  const termoAtual = useRef("");
  const observador = useRef<MutationObserver | null>(null);

  useEffect(() => {
    if (pedido === 0) return;
    campo.current?.focus();
    campo.current?.select();
  }, [pedido]);

  // O conteúdo mudou: o índice e as ocorrências se refazem com o mesmo termo, uma vez por quadro.
  useEffect(() => {
    const raiz = area.current;
    if (raiz === null) return;
    let quadro = 0;
    const obs = new MutationObserver(() => {
      indice.current = null;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const i = indiceDe(area.current, indice);
        setFaixas(i === null ? [] : ocorrencias(i, termoAtual.current));
      });
    });
    obs.observe(raiz, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    observador.current = obs;
    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      observador.current = null;
    };
  }, [area]);

  // A atual fora do intervalo (o texto mudou e há menos ocorrências): volta à primeira.
  const posicao = atual < faixas.length ? atual : 0;

  // Todas as ocorrências.
  useEffect(() => {
    if (!("highlights" in CSS) || faixas.length === 0) return;
    CSS.highlights.set(NOME_BUSCA, new Highlight(...faixas));
    return () => {
      CSS.highlights.delete(NOME_BUSCA);
    };
  }, [faixas]);

  // A atual, por cima, e a rolagem até ela.
  useEffect(() => {
    const faixa = faixas[posicao];
    if (!("highlights" in CSS) || faixa === undefined) return;
    const destaque = new Highlight(faixa);
    destaque.priority = 1;
    CSS.highlights.set(NOME_BUSCA_ATUAL, destaque);
    rolarAte(faixa);
    return () => {
      CSS.highlights.delete(NOME_BUSCA_ATUAL);
    };
  }, [faixas, posicao]);

  const buscar = (novo: string) => {
    setTermo(novo);
    termoAtual.current = novo;
    montarTudo();
    // O que `montarTudo` mudou já entra no índice abaixo: o observador não precisa refazê-lo.
    if (observador.current?.takeRecords().length) indice.current = null;
    const i = indiceDe(area.current, indice);
    setFaixas(i === null ? [] : ocorrencias(i, novo));
    setAtual(0);
  };

  const ir = (passo: 1 | -1) => {
    if (faixas.length === 0) return;
    setAtual((posicao + passo + faixas.length) % faixas.length);
  };

  const situacao =
    termoDaBusca(termo) === null ? "" : faixas.length === 0 ? "Nenhum resultado" : `${posicao + 1} de ${faixas.length}`;

  return (
    <search className={cn("nao-imprimir flex items-center gap-1 border-border border-b px-3 py-2", className)}>
      <Input
        ref={campo}
        type="search"
        size="sm"
        aria-label="Buscar no texto"
        placeholder="Buscar no texto"
        value={termo}
        onChange={(e) => buscar(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            ir(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            aoFechar();
          }
        }}
        className="min-w-0 flex-1"
      />
      <span aria-live="polite" className="min-w-[6.5rem] text-right text-muted-foreground text-small tabular-nums">
        {situacao}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Resultado anterior"
        title="Anterior (Shift+Enter)"
        disabled={faixas.length === 0}
        onClick={() => ir(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Próximo resultado"
        title="Próximo (Enter)"
        disabled={faixas.length === 0}
        onClick={() => ir(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Fechar a busca" title="Fechar (Esc)" onClick={aoFechar}>
        <XIcon />
      </Button>
    </search>
  );
}
