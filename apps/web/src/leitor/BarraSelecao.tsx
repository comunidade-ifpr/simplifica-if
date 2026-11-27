/**
 * A barra da seleção no leitor (`docs/plans/multitarefa.md`, "De onde nasce"): ao selecionar texto no
 * documento (com o mouse ou pelo teclado), aparece acima da seleção (abaixo, na primeira linha), dentro da
 * borda do leitor, com "Perguntar sobre este trecho" (a conversa ao lado, com o documento e o trecho como
 * fichas) e "Copiar citação" (o trecho, o nome do documento e o link). O dispositivo é o do começo da
 * seleção: o último `id` do texto que vem antes dele (o artigo, o inciso, a seção do PPC), procurado só no
 * clique, não a cada mudança da seleção.
 *
 * Pelo teclado: com texto selecionado no documento, Tab leva à barra; Esc a fecha. A barra fica enquanto o
 * foco está nela, mesmo que a seleção se desfaça.
 */
import { ClipboardCopyIcon, MessageSquareIcon } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { useAppOpcional } from "../contexto.tsx";
import { fichaDoTrecho, juntarPedidos, pedidoDoLink } from "../painel/conversar.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";

/** Os `id` do texto que não são de dispositivo nem de seção: os do sumário e das notas de rodapé. */
const NAO_E_DISPOSITIVO = /(^|-)(sumario-|user-content-)/;

/**
 * O link do dispositivo onde começa a seleção: o documento com o `#id` do último elemento com `id` que
 * começa antes do começo dela (ou junto).
 */
function dispositivoDoComeco(conteiner: HTMLElement, faixa: Range, prefixo: string, documento: string): string {
  let achado: string | undefined;
  const marca = document.createRange();
  for (const elemento of conteiner.querySelectorAll("[id]")) {
    marca.setStartBefore(elemento);
    if (marca.compareBoundaryPoints(Range.START_TO_START, faixa) > 0) break;
    const id = elemento.id.startsWith(prefixo) ? elemento.id.slice(prefixo.length) : elemento.id;
    if (!NAO_E_DISPOSITIVO.test(id)) achado = id;
  }
  const base = documento.split("#")[0]!;
  return achado === undefined ? base : `${base}#${achado}`;
}

interface Selecao {
  readonly texto: string;
  /** A seleção, guardada: o dispositivo do começo sai dela no clique. */
  readonly faixa: Range;
  /** A posição da barra no leitor: o meio da seleção, acima dela (ou abaixo, sem espaço acima). */
  readonly x: number;
  readonly y: number;
  readonly abaixo: boolean;
}

/** O tamanho máximo do trecho que vai como ficha. */
const MAXIMO_TRECHO = 4000;

/** Abaixo disto (em px, do topo do leitor), a barra vai para baixo da seleção. */
const ESPACO_ACIMA = 48;

type Copia = "nada" | "copiada" | "falhou";

export function BarraSelecao({
  conteiner,
  caixa,
  documento,
  prefixo,
}: {
  /** O texto do documento, onde a seleção conta. */
  readonly conteiner: RefObject<HTMLElement | null>;
  /** A caixa posicionada em que a barra se põe (a borda que ela não passa). */
  readonly caixa: RefObject<HTMLElement | null>;
  readonly documento: string;
  readonly prefixo: string;
}) {
  const app = useAppOpcional();
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [copia, setCopia] = useState<Copia>("nada");
  const barra = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let quadro: number | undefined;
    const medir = () => {
      quadro = undefined;
      // Com o foco na barra (Tab até ela), a seleção pode se desfazer: a barra fica.
      if (barra.current?.contains(document.activeElement) === true) return;
      const texto = conteiner.current;
      const borda = caixa.current;
      const atual = window.getSelection();
      if (texto === null || borda === null || atual === null || atual.isCollapsed || atual.rangeCount === 0) {
        setSelecao(null);
        return;
      }
      const faixa = atual.getRangeAt(0);
      if (!texto.contains(faixa.startContainer) || !texto.contains(faixa.endContainer)) {
        setSelecao(null);
        return;
      }
      const escrito = atual.toString().replace(/\s+/g, " ").trim();
      if (escrito === "") {
        setSelecao(null);
        return;
      }
      const retangulo = faixa.getBoundingClientRect();
      const fora = borda.getBoundingClientRect();
      const topo = retangulo.top - fora.top;
      const abaixo = topo < ESPACO_ACIMA;
      setCopia("nada");
      setSelecao({
        texto: escrito.slice(0, MAXIMO_TRECHO),
        faixa: faixa.cloneRange(),
        x: retangulo.left + retangulo.width / 2 - fora.left,
        y: abaixo ? retangulo.bottom - fora.top + 6 : topo - 6,
        abaixo,
      });
    };
    // Uma medida por quadro: arrastar o mouse dispara a mudança da seleção sem parar.
    const aoMudar = () => {
      if (quadro === undefined) quadro = requestAnimationFrame(medir);
    };
    document.addEventListener("selectionchange", aoMudar);
    return () => {
      document.removeEventListener("selectionchange", aoMudar);
      if (quadro !== undefined) cancelAnimationFrame(quadro);
    };
  }, [conteiner, caixa]);

  // Tab, com texto selecionado no documento, leva à barra.
  useEffect(() => {
    if (selecao === null) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Tab" || evento.shiftKey || evento.altKey || evento.ctrlKey || evento.metaKey) return;
      const atual = window.getSelection();
      const texto = conteiner.current;
      if (atual === null || atual.isCollapsed || texto === null || !texto.contains(atual.anchorNode)) return;
      if (barra.current === null || barra.current.contains(document.activeElement)) return;
      evento.preventDefault();
      barra.current.querySelector("button")?.focus();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [selecao, conteiner]);

  if (app === null || selecao === null) return null;
  const largura = caixa.current?.clientWidth ?? 0;
  // Dentro da borda do leitor: a barra (até ~22rem; quebra em duas linhas no painel estreito) não passa
  // das laterais.
  const meia = Math.min(176, largura / 2);
  const x = Math.min(Math.max(selecao.x, meia), Math.max(meia, largura - meia));
  const linkDoComeco = () =>
    conteiner.current === null
      ? documento.split("#")[0]!
      : dispositivoDoComeco(conteiner.current, selecao.faixa, prefixo, documento);
  const fechar = () => {
    setSelecao(null);
    window.getSelection()?.removeAllRanges();
  };
  return (
    <div
      ref={barra}
      role="toolbar"
      aria-label="Trecho selecionado"
      data-barra-selecao
      className={`nao-imprimir absolute z-20 flex max-w-full -translate-x-1/2 flex-wrap justify-center gap-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ${selecao.abaixo ? "" : "-translate-y-full"}`}
      style={{ left: x, top: Math.max(0, selecao.y) }}
      // A barra não tira a seleção ao ser clicada.
      onMouseDown={(evento) => evento.preventDefault()}
      onKeyDown={(evento) => {
        if (evento.key !== "Escape") return;
        evento.preventDefault();
        evento.stopPropagation();
        fechar();
      }}
      onBlur={(evento) => {
        // O foco saiu da barra sem seleção: ela some.
        if (barra.current?.contains(evento.relatedTarget as Node | null) !== true && window.getSelection()?.isCollapsed)
          setSelecao(null);
      }}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          app.painel.conversar(
            juntarPedidos(pedidoDoLink(app, documento), { fichas: [fichaDoTrecho(selecao.texto, linkDoComeco())] }),
          )
        }
      >
        <MessageSquareIcon /> Perguntar sobre este trecho
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const link = linkDoComeco();
          const citacao = `“${selecao.texto}” (${nomeCurtoLink(link)}, ${link})`;
          navigator.clipboard.writeText(citacao).then(
            () => setCopia("copiada"),
            () => setCopia("falhou"),
          );
        }}
      >
        <ClipboardCopyIcon />{" "}
        {copia === "copiada" ? "Citação copiada" : copia === "falhou" ? "Não foi possível copiar" : "Copiar citação"}
      </Button>
      <span role="status" className="sr-only">
        {copia === "copiada" ? "Citação copiada" : copia === "falhou" ? "Não foi possível copiar a citação" : ""}
      </span>
    </div>
  );
}
