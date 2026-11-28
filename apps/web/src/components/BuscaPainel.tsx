/**
 * A busca no texto de um documento (⌘F no macOS, Ctrl+F nos outros, ou a lupa), no painel de leitura e
 * na página do Explorar: busca no texto que a área mostra, sem acento nem caixa, pinta todas as
 * ocorrências e a atual, e Enter/Shift+Enter (ou as setas) passam de uma a outra, rolando até ela. Esc
 * fecha. A lógica está em `leitor/busca.ts`; o atalho, a lupa e a barra, em `useBuscaNoTexto`.
 *
 * O texto se indexa uma vez; quando o conteúdo da área muda (o documento terminou de carregar, outro
 * trecho foi destacado, outro documento abriu), o índice e as ocorrências se refazem com o mesmo termo.
 *
 * Com dois leitores na janela (a tela e o painel), o atalho vale para o leitor em foco: o que tem o foco
 * dentro da raiz dele (`data-leitor`) ou, sem foco em nenhum, o último em que a pessoa mexeu. Os realces
 * de cada um somam-se sob os mesmos nomes (`leitor/destaques.ts`).
 */
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import {
  type IndiceBusca,
  indexarBusca,
  NOME_BUSCA,
  NOME_BUSCA_ATUAL,
  ocorrencias,
  termoDaBusca,
  visivel,
} from "../leitor/busca.ts";
import { pintar } from "../leitor/destaques.ts";
import { ATRIBUTO_RAIZ, type InstanciaLeitor } from "../leitor/instancia.ts";
import { rolarAte, textosDe } from "../leitor/realce.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { eAtalhoBusca } from "../lib/teclado.ts";

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

/** Um leitor com a busca montada: a área do texto, quando a pessoa mexeu nele por último e como abrir. */
interface Dono {
  readonly area: RefObject<HTMLElement | null>;
  uso: number;
  readonly abrir: () => void;
}

const donos = new Set<Dono>();
let relogio = 0;

/** A raiz do leitor da área: onde o foco conta como "neste leitor". */
const raizDe = (area: HTMLElement): Element => area.closest(`[${ATRIBUTO_RAIZ}]`) ?? area;

/** O dono do atalho: o leitor com o foco dentro ou, sem foco em nenhum, o último em que se mexeu. */
function donoDoAtalho(): Dono | undefined {
  const vivos = [...donos].filter((d) => d.area.current?.isConnected);
  const foco = document.activeElement;
  return (
    vivos.find((d) => raizDe(d.area.current!).contains(foco)) ??
    vivos.reduce<Dono | undefined>((melhor, d) => (melhor === undefined || d.uso > melhor.uso ? d : melhor), undefined)
  );
}

const aoTeclar = (e: KeyboardEvent) => {
  if (!eAtalhoBusca(e)) return;
  const dono = donoDoAtalho();
  const raiz = dono?.area.current;
  if (dono === undefined || raiz == null) return;
  // Um diálogo por cima (a paleta do Explorar) fica com o teclado.
  const modal = document.querySelector('[aria-modal="true"]');
  if (modal !== null && !modal.contains(raiz)) return;
  e.preventDefault();
  dono.abrir();
};

/** O clique ou o foco num leitor o torna o último usado. */
const aoUsar = (e: Event) => {
  if (!(e.target instanceof Node)) return;
  for (const d of donos) {
    const area = d.area.current;
    if (area !== null && raizDe(area).contains(e.target)) d.uso = ++relogio;
  }
};

function registrar(dono: Dono): () => void {
  if (donos.size === 0) {
    window.addEventListener("keydown", aoTeclar);
    document.addEventListener("focusin", aoUsar, true);
    document.addEventListener("pointerdown", aoUsar, true);
  }
  donos.add(dono);
  return () => {
    donos.delete(dono);
    if (donos.size > 0) return;
    window.removeEventListener("keydown", aoTeclar);
    document.removeEventListener("focusin", aoUsar, true);
    document.removeEventListener("pointerdown", aoUsar, true);
  };
}

/**
 * O atalho, a lupa e a barra da busca sobre `area`, o texto do leitor `instancia`. O atalho vale de
 * qualquer lugar da tela, mas só enquanto `area` está nela, sem diálogo por cima e, com outro leitor na
 * janela, para o leitor em foco (`donoDoAtalho`).
 */
export function useBuscaNoTexto(
  area: RefObject<HTMLElement | null>,
  instancia: InstanciaLeitor,
  classeBarra?: string,
): BuscaNoTexto {
  const lupa = useRef<HTMLButtonElement>(null);
  const [pedido, setPedido] = useState(0);
  const abrir = () => {
    instancia.montarTudo();
    setPedido((n) => n + 1);
  };
  const fechar = () => {
    setPedido(0);
    // Sem rolar: no Explorar a lupa fica no topo da página, e a pessoa perderia o ponto achado.
    lupa.current?.focus({ preventScroll: true });
  };
  useEffect(
    () =>
      registrar({
        area,
        // o leitor que acabou de abrir é o último usado
        uso: ++relogio,
        abrir: () => {
          instancia.montarTudo();
          setPedido((n) => n + 1);
        },
      }),
    [area, instancia],
  );
  const barra =
    pedido === 0 ? null : (
      <BuscaPainel
        area={area}
        pedido={pedido}
        aoFechar={fechar}
        montarTudo={instancia.montarTudo}
        className={classeBarra}
      />
    );
  return { lupa, abrir, barra };
}

export function BuscaPainel({
  area,
  pedido,
  aoFechar,
  montarTudo,
  className,
}: {
  /** O contêiner do texto, estável entre documentos (o observador fica nele). */
  readonly area: RefObject<HTMLElement | null>;
  /** Sobe a cada atalho ou clique na lupa: o campo recebe o foco, com o termo selecionado. */
  readonly pedido: number;
  readonly aoFechar: () => void;
  /** Pede ao leitor todos os blocos do texto, para a busca ver o texto inteiro. */
  readonly montarTudo: () => void;
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
  useEffect(() => pintar(NOME_BUSCA, faixas), [faixas]);

  // A atual, por cima, e a rolagem até ela.
  useEffect(() => {
    const faixa = faixas[posicao];
    if (faixa === undefined) return;
    const apagar = pintar(NOME_BUSCA_ATUAL, [faixa], 1);
    rolarAte(faixa);
    return apagar;
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
    <search
      className={cn("flex items-center gap-1 border-border border-b px-3 py-2", className)}
      // Esc fecha a busca também com o foco nos botões dela, antes de chegar ao painel (que recolheria).
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing || e.defaultPrevented) return;
        e.preventDefault();
        aoFechar();
      }}
    >
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
