/**
 * O leitor `ifpr://` (M1.6): o painel ao lado da conversa que abre as fontes citadas, direto da base,
 * pelo `GrupoLeitura` do servidor local, sem passar pela IA. O conteúdo de cada tipo de link está em
 * `leitor/Leitor.tsx`; aqui ficam o cabeçalho (voltar, avançar, buscar, imprimir, fechar), a memória
 * das leituras do painel, a busca no texto (Ctrl/⌘+F, `BuscaPainel.tsx`) e a área de rolagem.
 *
 * A área de rolagem é a mesma enquanto o documento é o mesmo: ir de um dispositivo a outro da mesma
 * norma só rola até ele, sem montar o texto de novo.
 */
import { ArrowLeftIcon, ArrowRightIcon, PrinterIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Historico, linkAtual, podeAvancar, podeVoltar } from "../leitor/historico.ts";
import { ContextoMemoria, MemoriaLeitor } from "../leitor/carga.ts";
import { ConteudoLink } from "../leitor/Leitor.tsx";
import { nomeCurtoLink } from "../tarefas/textos.ts";
import { ATALHO_BUSCA, useBuscaNoTexto } from "./BuscaPainel.tsx";
import { Button } from "./ui/button.tsx";

export function PainelLeitura({
  historico,
  aoAbrirLink,
  aoVoltar,
  aoAvancar,
  aoFechar,
}: {
  readonly historico: Historico;
  readonly aoAbrirLink: (link: string) => void;
  readonly aoVoltar: () => void;
  readonly aoAvancar: () => void;
  readonly aoFechar: () => void;
}) {
  const [memoria] = useState(() => new MemoriaLeitor());
  const link = linkAtual(historico);
  // O foco vem para o painel quando ele abre ou quando um link de fora dele (um chip da conversa) troca o
  // que se lê; a navegação de dentro (voltar, uma relação) deixa o foco onde está.
  const painel = useRef<HTMLElement>(null);
  useEffect(() => {
    const elemento = painel.current;
    if (link === undefined || elemento === null || elemento.contains(document.activeElement)) return;
    elemento.focus({ preventScroll: true });
  }, [link]);

  // A busca: ⌘F (macOS) ou Ctrl+F, de qualquer lugar da tela, enquanto o painel está aberto.
  const area = useRef<HTMLDivElement>(null);
  const { lupa, abrir: abrirBusca, barra: barraBusca } = useBuscaNoTexto(area);
  if (link === undefined) return null;
  const documento = link.split("#")[0]!;
  return (
    <aside
      ref={painel}
      tabIndex={-1}
      aria-label="Painel de leitura"
      className="painel-leitura flex h-full outline-none w-full flex-col border-border border-l bg-card text-card-foreground"
    >
      <header className="nao-imprimir flex items-center gap-1 border-border border-b px-3 py-2">
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
        <p className="min-w-0 flex-1 truncate font-semibold text-sm" title={nomeCurtoLink(link)}>
          {nomeCurtoLink(link)}
        </p>
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
        <Button variant="ghost" size="icon-sm" aria-label="Imprimir" title="Imprimir" onClick={() => window.print()}>
          <PrinterIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Fechar o painel de leitura" onClick={aoFechar}>
          <XIcon />
        </Button>
      </header>
      {barraBusca}
      <ContextoMemoria value={memoria}>
        {/* Estável entre documentos: a busca observa o texto aqui e o refaz quando ele muda. */}
        <div ref={area} className="flex min-h-0 flex-1 flex-col">
          {/* `relative`: o `sr-only` do trecho citado (posição absoluta) fica dentro da rolagem do painel. */}
          <div key={documento} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <ConteudoLink link={link} aoAbrirLink={aoAbrirLink} />
          </div>
        </div>
      </ContextoMemoria>
    </aside>
  );
}
