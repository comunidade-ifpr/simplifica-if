/**
 * O leitor `ifpr://` (M1.6) da aba Ler do painel do app (`painel/PainelDoApp.tsx`): abre as fontes
 * citadas, direto da base, pelo `GrupoLeitura` do servidor local, sem passar pela IA. O conteúdo de cada
 * tipo de link está em `leitor/Leitor.tsx`; aqui ficam a linha de cima (voltar, avançar, o nome, o
 * marcador, buscar, imprimir e "abrir em tela cheia"), a prateleira dos documentos marcados, a busca no
 * texto (Ctrl/⌘+F, `BuscaPainel.tsx`) e a área de rolagem. O painel é uma instância própria do leitor
 * (`leitor/instancia.ts`, com o prefixo `painel-` nos `id`): a mesma norma pode estar aberta na tela e
 * nele, e imprimir daqui imprime só o painel.
 *
 * A área de rolagem é a mesma enquanto o documento é o mesmo: ir de um dispositivo a outro da mesma
 * norma só rola até ele, sem montar o texto de novo. A rolagem de cada documento fica lembrada ao trocar
 * de documento e voltar (`lib/rolagem.ts`).
 */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  Maximize2Icon,
  PrinterIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Historico, linkAtual, podeAvancar, podeVoltar } from "../leitor/historico.ts";
import { ContextoInstancia, imprimirLeitor, InstanciaLeitor } from "../leitor/instancia.ts";
import { ConteudoLink } from "../leitor/Leitor.tsx";
import { useRolagemLembrada } from "../lib/rolagem.ts";
import { ATALHO_BUSCA, ATALHO_PALETA } from "../lib/teclado.ts";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";
import { documentoDoLink, MAXIMO_MARCADOS } from "../painel/ControlePainel.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import { useBuscaNoTexto } from "./BuscaPainel.tsx";
import { Button } from "./ui/button.tsx";

export function PainelLeitura({
  historico,
  marcados,
  aoAbrirLink,
  aoVoltar,
  aoAvancar,
  aoMarcar,
  aoDesmarcar,
  aoTelaCheia,
  semFoco,
}: {
  readonly historico: Historico;
  readonly marcados: ReadonlyArray<string>;
  readonly aoAbrirLink: AoAbrirLink;
  readonly aoVoltar: () => void;
  readonly aoAvancar: () => void;
  readonly aoMarcar: (link: string) => void;
  readonly aoDesmarcar: (link: string) => void;
  /** O documento aberto na página do Explorar. */
  readonly aoTelaCheia: (link: string) => void;
  /** O documento abriu sem gesto da pessoa (o painel que a continuidade reabriu): o foco fica na tela. */
  readonly semFoco?: () => boolean;
}) {
  const [instancia] = useState(() => new InstanciaLeitor("painel-"));
  const link = linkAtual(historico);
  // O foco vem para o leitor quando um link de fora do painel (um chip da conversa) troca o que se lê; a
  // navegação de dentro (voltar, uma relação, as setas nas abas) deixa o foco onde está.
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const elemento = raiz.current;
    const painel = elemento?.closest("[data-painel-app]") ?? elemento;
    if (link === undefined || elemento === null || painel?.contains(document.activeElement) || semFoco?.()) return;
    elemento.focus({ preventScroll: true });
    // Só a troca do link conta: `semFoco` se lê na hora e não é motivo para pôr o foco de novo.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [link]);

  // A busca: ⌘F (macOS) ou Ctrl+F, de qualquer lugar da tela, quando o painel é o leitor em foco ou o
  // último usado (`BuscaPainel.tsx`).
  const area = useRef<HTMLDivElement>(null);
  const { lupa, abrir: abrirBusca, barra: barraBusca } = useBuscaNoTexto(area, instancia);
  const documento = link === undefined ? undefined : documentoDoLink(link);
  const marcado = documento !== undefined && marcados.some((m) => documentoDoLink(m) === documento);
  const cheia = !marcado && marcados.length >= MAXIMO_MARCADOS;
  const rolante = useRef<HTMLDivElement>(null);
  useRolagemLembrada(documento === undefined ? undefined : `painel:${documento}`, () => rolante.current, { link });
  return (
    <div ref={raiz} tabIndex={-1} data-leitor="" className="painel-leitura flex min-h-0 flex-1 flex-col outline-none">
      <div className="nao-imprimir flex items-center gap-1 border-border border-b px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Voltar ao link anterior"
          title="Voltar"
          disabled={!podeVoltar(historico)}
          onClick={aoVoltar}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Avançar para o próximo link"
          title="Avançar"
          disabled={!podeAvancar(historico)}
          onClick={aoAvancar}
        >
          <ArrowRightIcon />
        </Button>
        <p className="min-w-0 flex-1 truncate font-semibold text-sm" title={link && nomeCurtoLink(link)}>
          {link === undefined ? null : nomeCurtoLink(link)}
        </p>
        {link === undefined ? null : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Marcar este documento"
              aria-pressed={marcado}
              title={
                marcado
                  ? "Marcado: volta com um clique (clique de novo para desmarcar)"
                  : cheia
                    ? `Já há ${MAXIMO_MARCADOS} documentos marcados: desmarque um antes`
                    : "Marcar este documento, para voltar a ele com um clique"
              }
              disabled={cheia}
              onClick={() => (marcado ? aoDesmarcar(link) : aoMarcar(link))}
            >
              {marcado ? <BookmarkCheckIcon /> : <BookmarkIcon />}
            </Button>
            <Button
              ref={lupa}
              variant="ghost"
              size="icon-sm"
              aria-label="Buscar no texto"
              title={`Buscar no texto (${ATALHO_BUSCA})`}
              onClick={abrirBusca}
            >
              <SearchIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Imprimir"
              title="Imprimir"
              onClick={() => imprimirLeitor(raiz.current)}
            >
              <PrinterIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Abrir em tela cheia"
              title="Abrir em tela cheia, na página do Explorar"
              onClick={() => aoTelaCheia(link)}
            >
              <Maximize2Icon />
            </Button>
          </>
        )}
      </div>
      {marcados.length === 0 ? null : (
        <nav aria-label="Documentos marcados" className="nao-imprimir border-border border-b px-3 py-1.5">
          <ul className="flex flex-wrap gap-1.5">
            {marcados.map((m) => {
              const nome = nomeCurtoLink(m);
              const atual = documentoDoLink(m) === documento;
              return (
                <li
                  key={m}
                  className="flex max-w-full items-center rounded-full border border-border text-small aria-[current]:border-input aria-[current]:bg-accent"
                  aria-current={atual ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="min-w-0 truncate rounded-full py-0.5 pr-1 pl-2.5 hover:text-foreground"
                    title={nome}
                    onClick={(evento) => aoAbrirLink(m, ondeDoClique(evento))}
                  >
                    {nome}
                  </button>
                  <button
                    type="button"
                    aria-label={`Desmarcar ${nome}`}
                    title="Desmarcar"
                    className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => aoDesmarcar(m)}
                  >
                    <XIcon aria-hidden className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {barraBusca}
      {link === undefined ? (
        <p className="px-4 py-6 text-muted-foreground text-sm">
          Nada aberto para ler. Busque na base ({ATALHO_PALETA}) ou clique numa citação para abrir a norma ou o PPC
          aqui, ao lado da tela.
        </p>
      ) : (
        <ContextoInstancia value={instancia}>
          {/* Estável entre documentos: a busca observa o texto aqui e o refaz quando ele muda. */}
          <div ref={area} className="flex min-h-0 flex-1 flex-col">
            {/* `relative`: o `sr-only` do trecho citado (posição absoluta) fica dentro da rolagem do painel. */}
            <div ref={rolante} key={documento} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <ConteudoLink link={link} aoAbrirLink={aoAbrirLink} />
            </div>
          </div>
        </ContextoInstancia>
      )}
    </div>
  );
}
