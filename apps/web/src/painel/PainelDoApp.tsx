/**
 * O painel do app na moldura (`docs/plans/multitarefa.md`, "Painel do app"): a coluna de largura
 * ajustável à direita da tela, presa ao `ControlePainel` do contexto, montada uma vez ao lado do
 * `<Outlet />` (`routes/__root.tsx`), que segue aberta de uma tela a outra e de uma conversa a outra.
 *
 * - Abas: Ler (o leitor `ifpr://`, com a trilha e os documentos marcados), Conversar (a conversa ao lado,
 *   `AbaConversar.tsx`; o clique nela, ou a escolha pelas setas, que deixa o foco na aba, com o rascunho intocado, traz o contexto da tela) e Pasta (a pasta da conversa da aba Conversar; sem ela, a da conversa da tela).
 *   "Buscar na base" abre a paleta (⌘K), com os resultados indo para o Ler, em qualquer tela.
 * - Coluna ou sobreposição: quando a tela principal ficaria com menos de `MINIMO_TELA` px, o painel vem por
 *   cima, da borda direita, com sombra; "Prender ao lado" o fixa como coluna, e o app lembra.
 * - No modo compacto da janela (`janela-compacta.ts`), o painel cobre a coluna inteira, e fechá-lo é
 *   "Voltar" (←, à esquerda) à tela que estava embaixo (a lista da revisão); as abas vão sem ícone e a busca
 *   só com a lupa, para a barra caber em 320 px.
 * - Teclado: ao abrir, o foco vem ao painel; ao fechar, volta para onde estava. Por cima, Esc (depois de
 *   fechar a busca no texto) e um clique fora recolhem. Sem `aria-modal`: a tela continua usável, e o ⌘F
 *   dela também (`BuscaPainel.tsx` cede o atalho a um modal).
 */
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  FolderIcon,
  MessageSquareIcon,
  PanelRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CHAVE_LARGURA_LEITURA, ColunaLateral } from "../components/ColunaLateral.tsx";
import { PainelLeitura } from "../components/PainelLeitura.tsx";
import { PainelPasta } from "../components/PainelPasta.tsx";
import { Button } from "../components/ui/button.tsx";
import { useApp, useControleConversa, useEstadoConversa, useJanelaCompacta, usePainel } from "../contexto.tsx";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import { usePaleta } from "../explorar/Paleta.tsx";
import { ariaAtalho, ATALHO_PAINEL, ATALHO_PALETA } from "../lib/teclado.ts";
import { cn } from "../lib/utils.ts";
import { AbaConversar } from "./AbaConversar.tsx";
import { useAbrirLink } from "./abrirLink.ts";
import { mostrarConversar } from "./conversar.ts";
import type { AbaPainel, ControlePainel, EstadoPainel } from "./ControlePainel.ts";

/** A largura mínima da tela principal com o painel em coluna; abaixo dela, o painel vem por cima. */
export const MINIMO_TELA = 760;

const ABAS: ReadonlyArray<{ readonly aba: AbaPainel; readonly nome: string; readonly Icone: typeof BookOpenIcon }> = [
  { aba: "ler", nome: "Ler", Icone: BookOpenIcon },
  { aba: "conversar", nome: "Conversar", Icone: MessageSquareIcon },
  { aba: "pasta", nome: "Pasta", Icone: FolderIcon },
];

export function PainelDoApp() {
  const [estado, painel] = usePainel();
  if (!estado.aberto) return null;
  return <Painel estado={estado} painel={painel} />;
}

/** A largura da linha da moldura e a do painel, medidas antes de pintar e a cada mudança. */
function useEstreito(caixa: RefObject<HTMLDivElement | null>): boolean {
  const [estreito, setEstreito] = useState(false);
  useLayoutEffect(() => {
    const elemento = caixa.current;
    const linha = elemento?.parentElement;
    if (elemento == null || linha == null) return;
    const medir = () => setEstreito(linha.clientWidth - elemento.offsetWidth < MINIMO_TELA);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(linha);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [caixa]);
  return estreito;
}

function Painel({ estado, painel }: { readonly estado: EstadoPainel; readonly painel: ControlePainel }) {
  const caixa = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLElement>(null);
  const estreito = useEstreito(caixa);
  const [{ ligada: compacta }] = useJanelaCompacta();
  const sobreposto = compacta || (estreito && !estado.preso);
  const { abrir: abrirPaleta } = usePaleta();
  const abrirLink = useAbrirLink();
  const app = useApp();
  const id = useId();

  // O foco vem ao painel ao abrir e volta, ao fechar, para onde estava (se ainda está na tela e o foco não
  // foi para outro lugar no meio tempo). A origem se lê antes dos efeitos de dentro, porque o leitor puxa
  // o foco para si ao abrir um link. O painel que a continuidade reabriu, sem gesto, deixa o foco na tela.
  const origem = useRef<Element | null>(null);
  useLayoutEffect(() => {
    origem.current = document.activeElement;
  }, []);
  useEffect(() => {
    const anterior = origem.current;
    const elemento = raiz.current;
    if (elemento !== null && !elemento.contains(document.activeElement) && !painel.abertoPelaContinuidade())
      elemento.focus({ preventScroll: true });
    return () => {
      const foco = document.activeElement;
      const perdido = foco === null || foco === document.body || (elemento?.contains(foco) ?? false);
      if (perdido && anterior instanceof HTMLElement && anterior.isConnected) anterior.focus({ preventScroll: true });
    };
  }, [painel]);

  // Por cima, um clique fora recolhe, salvo quando o próprio clique pediu o painel (um link que abre nele,
  // mesmo o que ele já mostra; o botão da pasta), começou dentro dele (a seleção arrastada para fora) ou
  // foi num diálogo ou menu por cima.
  // No modo compacto, o painel cobre a tela inteira: fora dele, só a moldura (o alfinete, ⤢).
  useEffect(() => {
    if (!sobreposto || compacta) return;
    let antes: { readonly estado: EstadoPainel; readonly pedidos: number } | undefined;
    const aoApertar = (evento: PointerEvent) => {
      const dentro = evento.target instanceof Node && (caixa.current?.contains(evento.target) ?? false);
      const modal = document.querySelector('[aria-modal="true"]') !== null;
      antes = dentro || modal ? undefined : { estado: painel.obter(), pedidos: painel.pedidosFeitos() };
    };
    // Depois dos handlers do React, que ficam na raiz do app, dentro do `document`.
    const aoClicar = (evento: MouseEvent) => {
      const alvo = evento.target;
      const mexeu = antes === undefined || painel.obter() !== antes.estado || painel.pedidosFeitos() !== antes.pedidos;
      antes = undefined;
      if (mexeu || !(alvo instanceof Element) || caixa.current?.contains(alvo)) return;
      if (alvo.closest('[role="menu"], [role="dialog"], [role="alertdialog"]') !== null) return;
      painel.fechar();
    };
    document.addEventListener("pointerdown", aoApertar, true);
    document.addEventListener("click", aoClicar);
    return () => {
      document.removeEventListener("pointerdown", aoApertar, true);
      document.removeEventListener("click", aoClicar);
    };
  }, [sobreposto, compacta, painel]);

  // Esc recolhe o painel por cima, depois de a busca no texto (que o consome) fechar.
  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (!sobreposto || evento.key !== "Escape" || evento.defaultPrevented) return;
    if (!(evento.target instanceof Node) || !evento.currentTarget.contains(evento.target)) return;
    evento.preventDefault();
    painel.fechar();
  };

  // As setas andam entre as abas, que se escolhem ao receber o foco, como no clique (Conversar traz o
  // contexto da tela), mas o foco fica na aba.
  const aoTeclarAbas = (evento: KeyboardEvent<HTMLDivElement>) => {
    const passo = { ArrowLeft: -1, ArrowRight: 1 }[evento.key];
    if (passo === undefined) return;
    evento.preventDefault();
    const i = ABAS.findIndex((a) => a.aba === estado.aba);
    const proxima = ABAS[(i + passo + ABAS.length) % ABAS.length]!.aba;
    if (proxima === "conversar") mostrarConversar(app, { focar: false });
    else painel.mostrar(proxima);
    document.getElementById(`${id}-aba-${proxima}`)?.focus();
  };

  return (
    <div
      ref={caixa}
      data-painel-app=""
      data-sobreposto={sobreposto ? "" : undefined}
      onKeyDown={aoTeclar}
      className={cn(
        "h-full",
        compacta ? "absolute inset-0 z-30" : sobreposto ? "absolute inset-y-0 right-0 z-30 shadow-2xl" : "shrink-0",
      )}
    >
      <Coluna compacta={compacta}>
        <aside
          ref={raiz}
          tabIndex={-1}
          aria-label="Painel ao lado"
          className="@container/painel flex h-full w-full flex-col border-border border-l bg-card text-card-foreground outline-none"
        >
          <header className="flex items-center gap-1 border-border border-b px-2 py-1.5">
            {compacta ? (
              // Na coluna de 320 a 380 px, só o ícone: o nome fica para o leitor de tela e na dica.
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Voltar"
                title={`Fechar o painel e voltar à tela (${ATALHO_PAINEL})`}
                onClick={painel.fechar}
              >
                <ArrowLeftIcon />
              </Button>
            ) : null}
            <div role="tablist" aria-label="Abas do painel" className="flex min-w-0 gap-0.5" onKeyDown={aoTeclarAbas}>
              {ABAS.map(({ aba, nome, Icone }) => (
                <button
                  key={aba}
                  type="button"
                  role="tab"
                  id={`${id}-aba-${aba}`}
                  aria-selected={estado.aba === aba}
                  aria-controls={`${id}-conteudo`}
                  tabIndex={estado.aba === aba ? 0 : -1}
                  // Conversar, com o rascunho intocado, traz o contexto da tela (`mostrarConversar`).
                  onClick={() => (aba === "conversar" ? mostrarConversar(app) : painel.mostrar(aba))}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  {compacta ? null : <Icone aria-hidden className="size-3.5" />}
                  {nome}
                </button>
              ))}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {compacta ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Buscar na base"
                  title={`Buscar na base (${ATALHO_PALETA})`}
                  aria-keyshortcuts={ariaAtalho("K")}
                  onClick={() => abrirPaleta("", { aoLado: true })}
                >
                  <SearchIcon />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  title={`Buscar na base (${ATALHO_PALETA})`}
                  aria-keyshortcuts={ariaAtalho("K")}
                  onClick={() => abrirPaleta("", { aoLado: true })}
                >
                  <SearchIcon />
                  {/* No painel estreito, só a lupa; o nome continua para o leitor de tela e na dica. */}
                  <span className="sr-only @min-[28rem]/painel:not-sr-only">Buscar na base</span>
                  <kbd className="hidden font-sans text-micro opacity-70 @min-[34rem]/painel:inline">
                    {ATALHO_PALETA}
                  </kbd>
                </Button>
              )}
              {estreito && !compacta ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Prender ao lado"
                  aria-pressed={estado.preso}
                  title={
                    estado.preso
                      ? "Preso ao lado, como coluna: clique para o painel voltar a vir por cima"
                      : "Prender ao lado, como coluna, em vez de por cima da tela"
                  }
                  onClick={() => painel.prender(!estado.preso)}
                >
                  <PanelRightIcon />
                </Button>
              ) : null}
              {compacta ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Fechar o painel"
                  title={`Fechar o painel (${ATALHO_PAINEL})`}
                  onClick={painel.fechar}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          </header>
          <div
            id={`${id}-conteudo`}
            role="tabpanel"
            aria-labelledby={`${id}-aba-${estado.aba}`}
            className="flex min-h-0 flex-1 flex-col"
          >
            {estado.aba === "ler" ? (
              <PainelLeitura
                historico={estado.historico}
                abertos={estado.abertos}
                marcados={estado.marcados}
                // O "outro" lugar do Ler é a tela; no modo compacto, só o painel cabe na coluna.
                aoAbrirLink={(link, onde) =>
                  onde === "tela" || onde === "janela" || (onde === "outro" && !compacta)
                    ? abrirLink(link, onde === "janela" ? "janela" : "tela")
                    : painel.abrirLink(link)
                }
                aoVoltar={painel.voltar}
                aoAvancar={painel.avancar}
                aoMarcar={painel.marcar}
                aoDesmarcar={painel.desmarcar}
                aoFecharDocumento={painel.fecharDocumento}
                aoTelaCheia={(link) => {
                  painel.fechar();
                  abrirLink(link, "tela");
                }}
                semFoco={painel.abertoPelaContinuidade}
              />
            ) : estado.aba === "conversar" ? (
              <AbaConversar />
            ) : (
              <AbaPasta conversaDoPainel={estado.conversa.id} pedida={estado.pastaDe} />
            )}
          </div>
        </aside>
      </Coluna>
    </div>
  );
}

/** A coluna de largura ajustável; no modo compacto, a coluna da janela inteira. */
function Coluna({ compacta, children }: { readonly compacta: boolean; readonly children: ReactNode }) {
  if (compacta) return <div className="h-full w-full">{children}</div>;
  return (
    <ColunaLateral chave={CHAVE_LARGURA_LEITURA} classePadrao="w-[min(40rem,38vw)]" rotulo="Largura do painel ao lado">
      {children}
    </ColunaLateral>
  );
}

/**
 * A pasta da conversa pedida ("Pasta da tarefa" da tela cheia); sem pedido, a da aba Conversar; sem ela, a da
 * conversa da tela; sem nenhuma, o que fazer para ver uma. Com as duas conversas, diz de qual é e leva à outra.
 */
function AbaPasta({
  conversaDoPainel,
  pedida,
}: {
  readonly conversaDoPainel: string | undefined;
  readonly pedida: string | undefined;
}) {
  const { painel } = useApp();
  const daTela = useRouterState({
    select: (s) => {
      const id = (s.location.search as { readonly id?: unknown }).id;
      return s.location.pathname === "/conversa" && typeof id === "string" ? id : undefined;
    },
  });
  const escolhida = pedida !== undefined && (pedida === conversaDoPainel || pedida === daTela) ? pedida : undefined;
  const id = escolhida ?? conversaDoPainel ?? daTela;
  const controle = useControleConversa(id);
  if (controle === undefined || id === undefined) {
    return (
      <p className="px-4 py-6 text-muted-foreground text-sm">
        Abra uma conversa para ver aqui a pasta dela: o que você trouxe e o que a IA gravou.
      </p>
    );
  }
  const duas = conversaDoPainel !== undefined && daTela !== undefined && conversaDoPainel !== daTela;
  const outra = id === conversaDoPainel ? daTela : conversaDoPainel;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {duas && outra !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-border border-b px-3 py-1.5 text-small">
          <span className="text-muted-foreground">
            {id === conversaDoPainel ? "Pasta da conversa ao lado" : "Pasta da conversa da tela"}
          </span>
          <Button size="xs" variant="ghost" onClick={() => painel.mostrarPasta(outra)}>
            {id === conversaDoPainel ? "Ver a da conversa da tela" : "Ver a da conversa ao lado"}
          </Button>
        </div>
      ) : null}
      <PastaDaConversa controle={controle} />
    </div>
  );
}

function PastaDaConversa({ controle }: { readonly controle: ControleConversa }) {
  const estado = useEstadoConversa(controle);
  if (estado.sessao === undefined) return null;
  return (
    // Uma por conversa: a confirmação do "Desfazer", o aviso e a lista de uma não passam à outra.
    <PainelPasta
      key={estado.sessao}
      sessao={estado.sessao}
      atualizar={`${estado.fase}:${estado.itens.length}`}
      emTurno={estado.fase === "respondendo" || estado.fase === "interrompendo"}
    />
  );
}
