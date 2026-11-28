/**
 * A moldura das telas: o cabeçalho com o logo do app, a navegação (Início, Tarefas, Explorar o IFPR), a busca na base
 * (Ctrl/Cmd+K, a paleta do Explorar), o que está em andamento (`atividades/EmAndamento.tsx`), o estado da
 * conexão e, em ícones, a Ajuda e as Configurações; o
 * aviso de conexão; a tela da rota e, à direita dela, o painel do app (`painel/PainelDoApp.tsx`), que
 * Ctrl/Cmd+\ mostra e esconde; Ctrl/Cmd+J abre a aba Conversar com o contexto da tela. No desktop, o
 * cabeçalho é a barra de título da janela (`barra-titulo.ts`), os três atalhos também vêm do menu Ver, o
 * clique num aviso do sistema leva à rota dele, e "Abrir em nova janela" (menu Arquivo, ⇧⌘N ou
 * Ctrl+Shift+N) abre a tela atual numa janela nova.
 *
 * A moldura liga a continuidade ao roteador (`continuidade/ControleContinuidade.ts`): ao reabrir, volta à
 * última rota e ao painel; ao navegar e ao fechar o app (no desktop, pela ponte), grava onde a pessoa está.
 *
 * No modo compacto da janela (`janela-compacta.ts`, só no desktop), a moldura reage ao estado, e não à rota:
 * o cabeçalho vira uma barra estreita com o título, o alfinete ("sempre por cima") e ⤢ (voltar ao app
 * inteiro), sem a navegação, e o painel cobre a coluna inteira (a tela embaixo fica inerte). Navegar para
 * fora da vista compacta desliga o modo antes.
 *
 * O erro de uma tela fica na área dela (a `CatchBoundary` em volta do `<Outlet />`), com o cabeçalho e o
 * painel de pé; o `errorComponent` da raiz só pega o que escapar disso.
 */
import {
  CatchBoundary,
  createRootRoute,
  type ErrorComponentProps,
  Link,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  CircleHelpIcon,
  Maximize2Icon,
  PanelRightIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { AnunciosAtividades, EmAndamento } from "../atividades/EmAndamento.tsx";
import { type BarraTitulo, useBarraTitulo } from "../barra-titulo.ts";
import { AvisoConexao } from "../components/AvisoConexao.tsx";
import { AvisoContinuidade } from "../continuidade/AvisoContinuidade.tsx";
import { IndicadorConexao } from "../components/IndicadorConexao.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { DetalhesTecnicos } from "../components/AvisoErro.tsx";
import { explicarErro } from "../conexao/erros.ts";
import { useApi, useApp, useJanelaCompacta, usePainel } from "../contexto.tsx";
import { registrarErro, textoDoErro } from "../diagnostico.ts";
import { ProvedorPaleta, usePaleta } from "../explorar/Paleta.tsx";
import { ContextoMemoria, memoriaDa } from "../leitor/carga.ts";
import logoEscuro from "../marca/logo-escuro.svg";
import logo from "../marca/logo.svg";
import { ariaAtalho, ATALHO_PAINEL, ATALHO_PALETA, eComando, eNovaJanela } from "../lib/teclado.ts";
import { rotaParaGuardar } from "../continuidade/conferir.ts";
import { abrirEmNovaJanela, useAbrirRota } from "../painel/abrirLink.ts";
import { contextoParaConversar } from "../painel/conversar.ts";
import { PainelDoApp } from "../painel/PainelDoApp.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";

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

/** O erro que escapou da tela (na própria moldura): a faixa da janela e o aviso. */
function ErroDaTela(props: ErrorComponentProps) {
  return (
    <div className="flex h-dvh flex-col">
      <FaixaArrastavel />
      <AvisoErroDaTela {...props} />
    </div>
  );
}

function AvisoErroDaTela({ error, reset }: ErrorComponentProps) {
  const mensagem = explicarErro(error);
  useEffect(() => {
    registrarErro(`erro na tela ${window.location.pathname}: ${textoDoErro(error)}`);
  }, [error]);
  return (
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
  );
}

// A aba em que se está vem grifada: o marca-texto na metade de baixo da palavra.
const classeAba =
  "whitespace-nowrap rounded-xs px-1 font-semibold text-muted-foreground text-sm hover:text-foreground data-[status=active]:bg-[linear-gradient(to_top,var(--grifo)_45%,transparent_45%)] data-[status=active]:text-foreground";

// As telas de apoio (Ajuda, Configurações) vão em ícone, à direita; a em que se está, com o grifo ao fundo.
const classeIcone =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground data-[status=active]:bg-grifo data-[status=active]:text-foreground [&_svg]:size-[1.125rem]";

/** O botão da busca no cabeçalho, com o atalho. */
function BotaoBuscar() {
  const { abrir } = usePaleta();
  return (
    <button
      type="button"
      onClick={() => abrir()}
      aria-keyshortcuts={ariaAtalho("K")}
      title={`Buscar na base (${ATALHO_PALETA})`}
      className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1 text-muted-foreground text-sm hover:border-input hover:text-foreground"
    >
      <SearchIcon aria-hidden className="size-3.5" />
      {/* Em janela estreita, só a lupa; o nome continua para o leitor de tela e na dica. */}
      <span className="sr-only lg:not-sr-only">Buscar</span>
      <kbd className="hidden font-sans text-micro lg:inline">{ATALHO_PALETA}</kbd>
    </button>
  );
}

function Moldura() {
  // Uma memória das leituras para todos os leitores (a tela e o painel), por conexão.
  const api = useApi();
  return (
    <ContextoMemoria value={memoriaDa(api)}>
      <ProvedorPaleta>
        <MolduraComPaleta />
      </ProvedorPaleta>
    </ContextoMemoria>
  );
}

/**
 * Ctrl/Cmd+\ mostra e esconde o painel; Ctrl/Cmd+J leva o contexto da tela à aba Conversar (com
 * `preventDefault`: no Chromium, Ctrl+J abre os downloads). No desktop, o menu Ver manda os três atalhos, e
 * ⇧⌘N (Ctrl+Shift+N, também do menu Arquivo) abre a tela atual numa janela nova, sem o modo compacto.
 */
function useAtalhosDaMoldura() {
  const app = useApp();
  const { painel } = app;
  const { abrir } = usePaleta();
  const roteador = useRouter();
  useEffect(() => {
    const novaJanela = () => {
      const { pathname, search } = roteador.state.location;
      return abrirEmNovaJanela(rotaParaGuardar(pathname, search as Record<string, unknown>));
    };
    // Com um diálogo por cima (a paleta, uma confirmação), o painel fica como está: abri-lo tiraria o foco
    // do diálogo.
    const semModal = () => document.querySelector('[aria-modal="true"]') === null;
    const alternar = () => {
      if (semModal()) painel.alternar();
    };
    const conversar = () => {
      if (semModal()) painel.conversar(contextoParaConversar(app));
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (eComando(evento, "\\")) {
        evento.preventDefault();
        alternar();
      } else if (eComando(evento, "j")) {
        evento.preventDefault();
        conversar();
      } else if (eNovaJanela(evento) && novaJanela()) {
        evento.preventDefault();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    const pararMenu = ponteDesktop()?.janela.aoAtalhoDoMenu((atalho) => {
      if (atalho === "painel") alternar();
      else if (atalho === "conversar") conversar();
      else if (atalho === "novaJanela") novaJanela();
      else abrir();
    });
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      pararMenu?.();
    };
  }, [app, painel, abrir, roteador]);
}

/**
 * No modo compacto, navegar para fora da vista compacta (um link na tela, a paleta, o aviso do sistema,
 * Voltar no histórico) desliga o modo antes: a página feita para a janela inteira não abre na coluna.
 */
function useSaidaDoCompacto() {
  const roteador = useRouter();
  const { janela } = useApp();
  useEffect(
    () =>
      roteador.subscribe("onBeforeNavigate", ({ toLocation }) =>
        janela.navegando({ pathname: toLocation.pathname, search: toLocation.search as Record<string, unknown> }),
      ),
    [roteador, janela],
  );
}

/** Voltar onde se estava ao reabrir, e gravar onde se está (também antes de o desktop fechar). */
function useContinuidadeDaMoldura() {
  const roteador = useRouter();
  const { continuidade } = useApp();
  useEffect(() => {
    const parar = continuidade.ligar(roteador);
    const pararSair = ponteDesktop()?.janela.antesDeSair(continuidade.gravarAgora);
    return () => {
      parar();
      pararSair?.();
    };
  }, [roteador, continuidade]);
}

/** O clique num aviso do sistema (no desktop) leva à rota da conversa ou da revisão (a do painel, a ele). */
function useRotaDoAviso() {
  const abrirRota = useAbrirRota();
  useEffect(() => ponteDesktop()?.janela.aoAbrirRota(abrirRota), [abrirRota]);
}

/** A tela da rota; o erro dela some ao ir para outra. À parte, a URL não redesenha a moldura nem o painel. */
function AreaDaTela() {
  const endereco = useRouterState({ select: (s) => s.location.href });
  return (
    <CatchBoundary getResetKey={() => endereco} errorComponent={AvisoErroDaTela}>
      <Outlet />
    </CatchBoundary>
  );
}

/** O cabeçalho do app: o logo, a navegação, a busca, o que está em andamento, a conexão, Ajuda, Configurações e o painel. */
function CabecalhoCompleto({ barra }: { readonly barra: BarraTitulo | undefined }) {
  const [painel, controlePainel] = usePainel();
  return (
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
        <Link to="/tarefas" className={classeAba}>
          Tarefas
        </Link>
        <Link to="/explorar" className={classeAba}>
          Explorar o IFPR
        </Link>
      </nav>
      <BotaoBuscar />
      <EmAndamento />
      <IndicadorConexao />
      <div className="-mx-1 flex shrink-0 items-center gap-1">
        <Link to="/ajuda" className={classeIcone} aria-label="Ajuda" title="Ajuda">
          <CircleHelpIcon aria-hidden />
        </Link>
        <Link to="/configuracoes" className={classeIcone} aria-label="Configurações" title="Configurações">
          <SettingsIcon aria-hidden />
        </Link>
        <button
          type="button"
          onClick={controlePainel.alternar}
          data-status={painel.aberto ? "active" : undefined}
          aria-pressed={painel.aberto}
          aria-label="Painel ao lado"
          aria-keyshortcuts={ariaAtalho(ATALHO_PAINEL)}
          title={`Painel ao lado (${ATALHO_PAINEL})`}
          className={classeIcone}
        >
          <PanelRightIcon aria-hidden />
        </button>
      </div>
    </header>
  );
}

/**
 * A barra da janela compacta: o título, "Em andamento" (o pedido de permissão e a resposta pronta não ficam
 * sem sinal na coluna, que com o alfinete preso não dá aviso do sistema), o alfinete e ⤢, entre os botões
 * do sistema (`data-botoes`).
 */
function CabecalhoCompacto({ barra }: { readonly barra: BarraTitulo | undefined }) {
  const [compacta, janela] = useJanelaCompacta();
  return (
    <header
      {...propsBarraTitulo(barra)}
      className="drag-region barra-titulo flex h-12 shrink-0 select-none items-center gap-1 border-border border-b bg-background px-3"
    >
      <p className="min-w-0 flex-1 truncate font-semibold text-sm">{compacta.titulo}</p>
      <EmAndamento />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Sempre por cima"
        aria-pressed={compacta.naFrente}
        title={
          compacta.naFrente
            ? "Sempre por cima das outras janelas: clique para soltar"
            : "Clique para ficar sempre por cima das outras janelas"
        }
        onClick={() => void janela.fixarNaFrente(!compacta.naFrente)}
      >
        {compacta.naFrente ? <PinIcon /> : <PinOffIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Voltar ao app inteiro"
        title="Voltar ao app inteiro, com o tamanho de antes"
        onClick={() => void janela.desligar()}
      >
        <Maximize2Icon />
      </Button>
    </header>
  );
}

function MolduraComPaleta() {
  const barra = useBarraTitulo();
  const [{ ligada: compacta }] = useJanelaCompacta();
  const { painel } = useApp();
  const painelAberto = useSyncExternalStore(painel.observar, () => painel.obter().aberto);
  useAtalhosDaMoldura();
  useRotaDoAviso();
  useSaidaDoCompacto();
  useContinuidadeDaMoldura();
  // A janela nunca rola: cada coluna rola sozinha. `relative` contém o que tem posição absoluta (o
  // `sr-only` do trecho citado no leitor), e `overflow-clip`, ao contrário de `overflow-hidden`, não se
  // deixa rolar por código (o `scrollIntoView` até o trecho levava a moldura junto, com o cabeçalho).
  return (
    <div className="relative flex h-dvh flex-col overflow-clip bg-background text-foreground">
      {compacta ? <CabecalhoCompacto barra={barra} /> : <CabecalhoCompleto barra={barra} />}
      <AnunciosAtividades />
      <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden">
        <AvisoConexao />
        <AvisoContinuidade />
      </div>
      <div className="relative flex min-h-0 flex-1">
        {/* A tela é um contêiner (`@container/tela`): as telas se ajustam ao espaço que o painel deixa. */}
        {/* No modo compacto, o painel aberto cobre a tela: ela sai do teclado e do leitor de tela. */}
        <main className="@container/tela h-full min-w-0 flex-1" inert={compacta && painelAberto}>
          <AreaDaTela />
        </main>
        <PainelDoApp />
      </div>
    </div>
  );
}
