/**
 * O leitor `ifpr://` (M1.6) da aba Ler do painel do app (`painel/PainelDoApp.tsx`): abre as fontes
 * citadas, direto da base, pelo `GrupoLeitura` do servidor local, sem passar pela IA. O conteúdo de cada
 * tipo de link está em `leitor/Leitor.tsx`; aqui ficam a barra de abas e ações (voltar, avançar, as abas
 * roláveis com os fixados no início, fixar, buscar e "abrir em tela cheia"), a busca no texto (Ctrl/⌘+F,
 * `BuscaPainel.tsx`) e a área de rolagem. O painel é uma instância própria do leitor (`leitor/instancia.ts`,
 * com o prefixo `painel-` nos `id`): a mesma norma pode estar aberta na tela e nele.
 *
 * A área de rolagem é a mesma enquanto o documento é o mesmo: ir de um dispositivo a outro da mesma
 * norma só rola até ele, sem montar o texto de novo. A rolagem de cada documento fica lembrada ao trocar
 * de documento e voltar (`lib/rolagem.ts`).
 */
import { ArrowLeftIcon, ArrowRightIcon, Maximize2Icon, PinIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Historico, linkAtual, podeAvancar, podeVoltar } from "../leitor/historico.ts";
import { ContextoInstancia, InstanciaLeitor } from "../leitor/instancia.ts";
import { ConteudoLink } from "../leitor/Leitor.tsx";
import { useRolagemLembrada } from "../lib/rolagem.ts";
import { ATALHO_BUSCA, ATALHO_PALETA } from "../lib/teclado.ts";
import { cn } from "../lib/utils.ts";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";
import { documentoDoLink, MAXIMO_MARCADOS } from "../painel/ControlePainel.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import { useBuscaNoTexto } from "./BuscaPainel.tsx";
import { Button } from "./ui/button.tsx";

export function PainelLeitura({
  historico,
  abertos,
  marcados,
  aoAbrirLink,
  aoVoltar,
  aoAvancar,
  aoMarcar,
  aoDesmarcar,
  aoFecharDocumento,
  aoTelaCheia,
  semFoco,
}: {
  readonly historico: Historico;
  readonly abertos: ReadonlyArray<string>;
  readonly marcados: ReadonlyArray<string>;
  readonly aoAbrirLink: AoAbrirLink;
  readonly aoVoltar: () => void;
  readonly aoAvancar: () => void;
  readonly aoMarcar: (link: string) => void;
  readonly aoDesmarcar: (link: string) => void;
  readonly aoFecharDocumento: (link: string) => void;
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

  // Abas na ordem: fixadas primeiro, depois as demais abertas.
  const docsFixados = new Set(marcados.map(documentoDoLink));
  const abas: ReadonlyArray<{ readonly link: string; readonly fixado: boolean }> = [
    ...marcados.map((m) => ({ link: m, fixado: true })),
    ...abertos.filter((a) => !docsFixados.has(documentoDoLink(a))).map((a) => ({ link: a, fixado: false })),
  ];

  const abaAtiva = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (documento === undefined) return;
    abaAtiva.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [documento]);

  return (
    <div ref={raiz} tabIndex={-1} data-leitor="" className="painel-leitura flex min-h-0 flex-1 flex-col outline-none">
      <div className="flex items-end gap-1 bg-muted/40 px-1.5 pt-1.5 shadow-[inset_0_-1px_0_0_var(--border)]">
        <div className="flex shrink-0 items-center gap-0.5 pb-1">
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
        </div>
        {abas.length === 0 ? (
          <div className="min-w-0 flex-1" />
        ) : (
          <nav aria-label="Documentos abertos" className="min-w-0 flex-1">
            <ul className="flex items-end gap-0.5 overflow-x-auto [scrollbar-width:thin]">
              {abas.map(({ link: item, fixado }) => {
                const doc = documentoDoLink(item);
                const nome = nomeCurtoLink(doc);
                const atual = doc === documento;
                return (
                  <li
                    key={doc}
                    ref={atual ? abaAtiva : undefined}
                    className={cn(
                      "group flex max-w-52 shrink-0 items-center rounded-t-md border border-b-0 text-small transition-colors",
                      atual
                        ? "border-border bg-card font-medium text-foreground"
                        : "mb-px border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                    aria-current={atual ? "true" : undefined}
                  >
                    {fixado ? (
                      <button
                        type="button"
                        aria-label={`Desafixar ${nome}`}
                        title="Desafixar"
                        className="ml-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => aoDesmarcar(item)}
                      >
                        <PinIcon aria-hidden className="size-3 fill-current" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 truncate py-1.5 hover:text-foreground",
                        fixado ? "pr-2.5 pl-1" : "pr-1 pl-2.5",
                      )}
                      title={nomeCurtoLink(item)}
                      onClick={(evento) => aoAbrirLink(item, ondeDoClique(evento))}
                    >
                      {nome}
                    </button>
                    {fixado ? null : (
                      <button
                        type="button"
                        aria-label={`Fechar ${nome}`}
                        title="Fechar"
                        className={cn(
                          "mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                          !atual && "opacity-60 group-hover:opacity-100",
                        )}
                        onClick={() => {
                          aoFecharDocumento(item);
                          raiz.current?.focus({ preventScroll: true });
                        }}
                      >
                        <XIcon aria-hidden className="size-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        {link === undefined ? null : (
          <div className="flex shrink-0 items-center gap-0.5 pb-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Fixar este documento"
              aria-pressed={marcado}
              title={
                marcado
                  ? "Fixado no início das abas (clique para desafixar)"
                  : cheia
                    ? `Já há ${MAXIMO_MARCADOS} documentos fixados: desafixe um antes`
                    : "Fixar este documento no início das abas"
              }
              disabled={cheia}
              onClick={() => (marcado ? aoDesmarcar(link) : aoMarcar(link))}
            >
              <PinIcon className={cn(marcado && "fill-current")} />
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
              aria-label="Abrir em tela cheia"
              title="Abrir em tela cheia, na página do Explorar"
              onClick={() => aoTelaCheia(link)}
            >
              <Maximize2Icon />
            </Button>
          </div>
        )}
      </div>
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
