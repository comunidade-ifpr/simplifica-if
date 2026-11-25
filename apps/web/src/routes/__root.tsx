/**
 * A moldura das telas: o cabeçalho com o logo do app, a navegação (Início, Explorar), a busca na base
 * (Ctrl/Cmd+K, a paleta do Explorar), o estado da conexão e, em ícones, a Ajuda e as Configurações; o
 * aviso de conexão; e a tela da rota. No desktop, o cabeçalho é a barra de título da janela (`barra-titulo.ts`).
 */
import { createRootRoute, type ErrorComponentProps, Link, Outlet } from "@tanstack/react-router";
import { CircleHelpIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useEffect } from "react";
import { type BarraTitulo, useBarraTitulo } from "../barra-titulo.ts";
import { AvisoConexao } from "../components/AvisoConexao.tsx";
import { IndicadorConexao } from "../components/IndicadorConexao.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { DetalhesTecnicos } from "../components/AvisoErro.tsx";
import { explicarErro } from "../conexao/erros.ts";
import { registrarErro, textoDoErro } from "../diagnostico.ts";
import { atalhoPaleta, ProvedorPaleta, usePaleta } from "../explorar/Paleta.tsx";
import logoEscuro from "../marca/logo-escuro.svg";
import logo from "../marca/logo.svg";

export const Route = createRootRoute({
  component: Moldura,
  notFoundComponent: () => <p className="p-6">Página não encontrada.</p>,
  // O padrão do roteador é em inglês.
  errorComponent: ErroDaTela,
});

/** As props do cabeçalho que o tornam barra de título no desktop; no navegador, nenhuma. */
function propsBarraTitulo(barra: BarraTitulo | undefined) {
  if (barra === undefined) return {};
  return {
    "data-botoes": barra.botoes,
    "data-tela-cheia": barra.telaCheia ? "" : undefined,
  };
}

/** Sem o cabeçalho, uma faixa vazia da altura da barra, para arrastar a janela e não cobrir os semáforos. */
function FaixaArrastavel() {
  const barra = useBarraTitulo();
  if (barra === undefined) return null;
  return <div aria-hidden className="drag-region h-12 shrink-0 border-border border-b bg-background" />;
}

function ErroDaTela({ error, reset }: ErrorComponentProps) {
  const mensagem = explicarErro(error);
  useEffect(() => {
    registrarErro(`erro na tela ${window.location.pathname}: ${textoDoErro(error)}`);
  }, [error]);
  return (
    <div className="flex h-dvh flex-col">
      <FaixaArrastavel />
      <div className="p-6">
        <Alert variant="error">
          <AlertTitle>Algo deu errado nesta tela</AlertTitle>
          <AlertDescription>
            <p>{mensagem.texto}</p>
            <DetalhesTecnicos detalhe={mensagem.detalhe} codigo={mensagem.codigo} />
            <div>
              <Button size="sm" variant="outline" onClick={reset}>
                Tentar de novo
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

// A aba em que se está vem grifada: o marca-texto na metade de baixo da palavra.
const classeAba =
  "rounded-xs px-1 font-semibold text-muted-foreground text-sm hover:text-foreground data-[status=active]:bg-[linear-gradient(to_top,var(--grifo)_45%,transparent_45%)] data-[status=active]:text-foreground";

// As telas de apoio (Ajuda, Configurações) vão em ícone, à direita; a em que se está, com o grifo ao fundo.
const classeIcone =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground data-[status=active]:bg-grifo data-[status=active]:text-foreground [&_svg]:size-[1.125rem]";

/** O botão da busca no cabeçalho, com o atalho. */
function BotaoBuscar() {
  const { abrir } = usePaleta();
  const atalho = atalhoPaleta();
  return (
    <button
      type="button"
      onClick={() => abrir()}
      aria-keyshortcuts={atalho === "⌘K" ? "Meta+K" : "Control+K"}
      title={`Buscar na base (${atalho})`}
      className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1 text-muted-foreground text-sm hover:border-input hover:text-foreground"
    >
      <SearchIcon aria-hidden className="size-3.5" />
      {/* Em janela estreita, só a lupa; o nome continua para o leitor de tela e na dica. */}
      <span className="sr-only lg:not-sr-only">Buscar</span>
      <kbd className="hidden font-sans text-micro lg:inline">{atalho}</kbd>
    </button>
  );
}

function Moldura() {
  return (
    <ProvedorPaleta>
      <MolduraComPaleta />
    </ProvedorPaleta>
  );
}

function MolduraComPaleta() {
  const barra = useBarraTitulo();
  // A janela nunca rola: cada coluna rola sozinha. `relative` contém o que tem posição absoluta (o
  // `sr-only` do trecho citado no leitor), e `overflow-clip`, ao contrário de `overflow-hidden`, não se
  // deixa rolar por código (o `scrollIntoView` até o trecho levava a moldura junto, com o cabeçalho).
  return (
    <div className="relative flex h-dvh flex-col overflow-clip bg-background text-foreground">
      <header
        {...propsBarraTitulo(barra)}
        className={
          barra === undefined
            ? "flex flex-wrap items-center gap-x-6 gap-y-2 border-border border-b bg-background px-4 py-2"
            : "drag-region barra-titulo flex h-12 shrink-0 select-none items-center gap-x-4 border-border border-b bg-background px-4 lg:gap-x-6"
        }
      >
        <Link to="/" className="shrink-0 rounded-sm">
          {/* O logo de cada tema (`apps/desktop/scripts/gerar-marca.ts`). */}
          <img src={logo} alt="Simplifica IF" draggable={false} className="block h-6 w-auto dark:hidden" />
          <img src={logoEscuro} alt="Simplifica IF" draggable={false} className="hidden h-6 w-auto dark:block" />
        </Link>
        <nav aria-label="Telas" className="flex gap-4 lg:gap-5">
          <Link to="/" className={classeAba} activeOptions={{ exact: true }}>
            Início
          </Link>
          <Link to="/explorar" className={classeAba}>
            Explorar
          </Link>
        </nav>
        <BotaoBuscar />
        <IndicadorConexao />
        <div className="-mx-1 flex shrink-0 items-center gap-1">
          <Link to="/ajuda" className={classeIcone} aria-label="Ajuda" title="Ajuda">
            <CircleHelpIcon aria-hidden />
          </Link>
          <Link to="/configuracoes" className={classeIcone} aria-label="Configurações" title="Configurações">
            <SettingsIcon aria-hidden />
          </Link>
        </div>
      </header>
      <div className="px-4 pt-3 empty:hidden">
        <AvisoConexao />
      </div>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
