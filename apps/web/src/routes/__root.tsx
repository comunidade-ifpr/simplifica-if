/**
 * A moldura das telas: o cabeçalho com o nome do app, a navegação (Início, Explorar, Configurações), a
 * busca na base (Ctrl/Cmd+K, a paleta do Explorar), o estado da conexão e o tema; o aviso de conexão; e
 * a tela da rota. No desktop, o cabeçalho é a barra de título da janela (`barra-titulo.ts`).
 */
import { createRootRoute, type ErrorComponentProps, Link, Outlet } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { type BarraTitulo, useBarraTitulo } from "../barra-titulo.ts";
import { AvisoConexao } from "../components/AvisoConexao.tsx";
import { IndicadorConexao } from "../components/IndicadorConexao.tsx";
import { SeletorTema } from "../components/SeletorTema.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { DetalhesTecnicos } from "../components/AvisoErro.tsx";
import { explicarErro } from "../conexao/erros.ts";
import { atalhoPaleta, ProvedorPaleta, usePaleta } from "../explorar/Paleta.tsx";

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
  return <div aria-hidden className="drag-region h-12 shrink-0 bg-marca" />;
}

function ErroDaTela({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex h-dvh flex-col">
      <FaixaArrastavel />
      <div className="p-6">
        <Alert variant="error">
          <AlertTitle>Algo deu errado nesta tela</AlertTitle>
          <AlertDescription>
            <p>{explicarErro(error).texto}</p>
            <DetalhesTecnicos detalhe={explicarErro(error).detalhe} />
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

const classeAba =
  "rounded-md px-3 py-1.5 font-semibold text-sm text-white/85 hover:bg-white/10 hover:text-white data-[status=active]:bg-white/15 data-[status=active]:text-white";

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
      className="flex items-center gap-2 rounded-md bg-white/10 px-2.5 py-1 text-sm text-white/85 hover:bg-white/20 hover:text-white"
    >
      <SearchIcon aria-hidden className="size-3.5" />
      <span>Buscar</span>
      <kbd className="hidden rounded bg-black/20 px-1 font-sans text-white/75 text-xs lg:inline">{atalho}</kbd>
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
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        {...propsBarraTitulo(barra)}
        className={
          barra === undefined
            ? "flex flex-wrap items-center gap-x-6 gap-y-2 bg-marca px-4 py-2 text-white"
            : "drag-region barra-titulo flex h-12 shrink-0 select-none items-center gap-x-4 bg-marca px-4 text-white lg:gap-x-6"
        }
      >
        <Link to="/" className="shrink-0 whitespace-nowrap font-bold text-lg tracking-tight">
          Simplifica IF
        </Link>
        <nav aria-label="Telas" className="flex gap-1">
          <Link to="/" className={classeAba} activeOptions={{ exact: true }}>
            Início
          </Link>
          <Link to="/explorar" className={classeAba}>
            Explorar
          </Link>
          <Link to="/configuracoes" className={classeAba}>
            Configurações
          </Link>
        </nav>
        <BotaoBuscar />
        <IndicadorConexao />
        <SeletorTema />
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
