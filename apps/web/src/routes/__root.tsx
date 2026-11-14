/**
 * A moldura das telas: o cabeçalho com o nome do app, a navegação, o estado da conexão e o tema; o
 * aviso de conexão; e a tela da rota.
 */
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { AvisoConexao } from "../components/AvisoConexao.tsx";
import { IndicadorConexao } from "../components/IndicadorConexao.tsx";
import { SeletorTema } from "../components/SeletorTema.tsx";

export const Route = createRootRoute({
  component: Moldura,
  notFoundComponent: () => <p className="p-6">Página não encontrada.</p>,
});

const classeAba =
  "rounded-md px-3 py-1.5 font-semibold text-sm text-white/85 hover:bg-white/10 hover:text-white data-[status=active]:bg-white/15 data-[status=active]:text-white";

function Moldura() {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-marca px-4 py-2 text-white">
        <Link to="/" className="flex items-baseline gap-2 font-bold text-lg tracking-tight">
          Simplifica IF
          <span className="font-normal text-white/75 text-xs">IFPR</span>
        </Link>
        <nav aria-label="Telas" className="flex gap-1">
          <Link to="/" className={classeAba} activeOptions={{ exact: true }}>
            Início
          </Link>
          <Link to="/conversa" className={classeAba}>
            Conversa
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 rounded-full bg-black/25 px-3 py-1 text-white">
          <IndicadorConexao />
        </div>
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
