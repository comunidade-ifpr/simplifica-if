/**
 * Conversa: conversar, aprovar ou negar o que a IA pede, interromper e começar outra. As citações
 * `ifpr://` das respostas são chips que abrem no painel do app, ao lado (é uma tela de trabalho; ⌥-clique
 * abre na página do Explorar).
 *
 * Modo Servidor (M1.9): a conversa de uma tarefa mostra as etapas da skill (✓ ◐ ○), as chamadas de
 * ferramenta ficam recolhidas em "Detalhes técnicos", cada resposta tem 👍/👎 e "Isto está errado" (o
 * relato para a curadoria, M1.12, logo abaixo da resposta), e "Pasta da tarefa" abre a aba Pasta do
 * painel do app, com os arquivos e o "Desfazer". O painel é do app: trocar de conversa não o fecha.
 *
 * As conversas ficam gravadas no servidor: a barra lateral as lista, e a conversa aberta fica na URL
 * (`/conversa?id=…`). A tela pega o controle dela no `GerenteConversas` (o mesmo da aba Conversar, se a
 * conversa está no painel: "⤢" a traz para cá) e o solta ao sair, sem encerrar a sessão do provider. Ao
 * recarregar a tela ou reabrir o app numa conversa, ela volta com o histórico e, se a IA estava
 * respondendo, com o resto da resposta.
 *
 * No limite da assinatura, "Continuar com…" abre aqui a conversa nova, com a caixa que a continuação traz:
 * as fichas (o histórico e as da última mensagem), removíveis, e a última pergunta escrita.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, FolderIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApagarConversas, type ConversaParaApagar } from "../apagar/ApagarConversas.tsx";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { AvisoUsoPendente } from "../components/AvisoUso.tsx";
import { CaixaPedido } from "../components/CaixaPedido.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { classeColuna } from "../components/Pagina.tsx";
import { Button } from "../components/ui/button.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useApp, useControleConversa, useEstadoConversa, useTelaDeTrabalho } from "../contexto.tsx";
import { rascunhoDaContinuacao } from "../conversa/continuacao.ts";
import type { ControleConversa } from "../conversa/ControleConversa.ts";
import type { AoContinuar } from "../conversa/controleDaVista.ts";
import { FichasNaCaixa, useFocoDasFichas } from "../conversa/FichasContexto.tsx";
import { VistaConversa } from "../conversa/VistaConversa.tsx";
import { cn } from "../lib/utils.ts";
import { useAbrirLink } from "../painel/abrirLink.ts";
import { DESCRICOES } from "../providers.ts";
import { tituloDaTarefa, useCatalogo } from "../tarefas/catalogo.ts";
import { Anexos, useAnexos } from "../tarefas/comecar.tsx";

/** A busca da rota: o id da conversa aberta, quando há. */
export interface BuscaConversa {
  readonly id?: string;
}

export const Route = createFileRoute("/conversa")({
  component: TelaConversa,
  validateSearch: (busca: Record<string, unknown>): BuscaConversa =>
    typeof busca.id === "string" && busca.id !== "" ? { id: busca.id } : {},
});

/**
 * A caixa da conversa. Os anexos (pelo clipe ou soltos na caixa) entram na pasta da tarefa ao enviar;
 * o servidor avisa a IA deles junto com a mensagem. Recusada pelo aviso de uso, a mensagem volta à caixa.
 * A conversa que continua outra começa com a caixa que a continuação trouxe (as fichas e a pergunta).
 */
function Compositor({ controle }: { readonly controle: ControleConversa }) {
  const api = useApi();
  const { conversas } = useApp();
  const estado = useEstadoConversa(controle);
  const sessao = estado.sessao;
  const [rascunho] = useState(() => (sessao === undefined ? undefined : conversas.rascunhoDe(sessao)));
  const [texto, setTexto] = useState(rascunho?.texto ?? "");
  const [fichas, setFichas] = useState(rascunho?.fichas ?? []);
  const { anexos, mudar, recusados, soltar, limpar } = useAnexos();
  const [anexando, setAnexando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();
  const [avisoPendente, setAvisoPendente] = useState(false);
  const ocupada = estado.fase === "respondendo" || estado.fase === "interrompendo";
  // A caixa da continuação guardada acompanha o que a pessoa muda nela: a ficha tirada (o histórico que ela
  // não quer mandar à outra empresa) não volta ao sair e voltar à conversa.
  const guardando = useRef(rascunho !== undefined);
  useEffect(() => {
    if (guardando.current && sessao !== undefined) conversas.guardarRascunho(sessao, { texto, fichas });
  }, [sessao, conversas, texto, fichas]);
  const fichasRef = useRef<HTMLDivElement>(null);
  const foco = useFocoDasFichas(fichasRef, fichas);
  const tirar = (chave: string) => {
    foco.tirando(chave);
    setFichas((atuais) => atuais.filter((ficha) => ficha.chave !== chave));
  };
  const enviar = async () => {
    setErro(undefined);
    setAvisoPendente(false);
    if (anexos.length > 0) {
      setAnexando(true);
      let faltam = anexos;
      try {
        for (const arquivo of anexos) {
          await api.chamar((cliente) => cliente["pasta.anexar"]({ pasta: estado.pastaTrabalho, arquivo }));
          faltam = faltam.filter((outro) => outro !== arquivo);
        }
      } catch (falha) {
        // Os que já entraram saem da lista: tentar de novo não os copia outra vez.
        mudar(faltam);
        setErro(explicarErro(falha));
        return;
      } finally {
        setAnexando(false);
      }
    }
    const enviado = texto;
    const junto = fichas;
    setTexto("");
    setFichas([]);
    limpar();
    const resultado = await controle.enviar(
      enviado,
      junto.flatMap((ficha) => (ficha.ficha === undefined ? [] : [ficha.ficha])),
    );
    if (resultado === "enviada") {
      guardando.current = false;
      if (sessao !== undefined) conversas.esquecerRascunho(sessao);
      return;
    }
    setTexto((atual) => (atual === "" ? enviado : atual));
    setFichas((atuais) => [...junto, ...atuais]);
    if (resultado === "avisoNaoAceito") setAvisoPendente(true);
  };
  const caixa = (
    <CaixaPedido
      rotulo="Mensagem"
      valor={texto}
      aoMudar={setTexto}
      aoEnviar={() => void enviar()}
      enviando={anexando}
      rotuloEnviando="Anexando…"
      interromper={
        ocupada
          ? {
              aoInterromper: () => void controle.interromper(),
              interrompendo: estado.fase === "interrompendo",
            }
          : undefined
      }
      aoSoltarArquivos={soltar === undefined ? undefined : (arquivos) => void soltar(arquivos)}
      esquerda={<Anexos anexos={anexos} aoMudar={mudar} recusados={recusados} />}
      abaixo={avisoPendente ? <AvisoUsoPendente /> : erro === undefined ? undefined : <AvisoErro erro={erro} />}
      className="pointer-events-auto"
    />
  );
  return (
    <div
      ref={fichasRef}
      className={fichas.length === 0 ? "contents" : "pointer-events-auto flex flex-col gap-2 rounded-2xl bg-card"}
    >
      {fichas.length === 0 ? null : <FichasNaCaixa fichas={fichas} ofertas={[]} aoTirar={tirar} aoPor={() => {}} />}
      {caixa}
    </div>
  );
}

/**
 * "Pasta da tarefa": abre a aba Pasta do painel na pasta desta conversa (também com outra conversa na aba
 * Conversar), e a fecha. Só ele assina o painel, não a conversa inteira.
 */
function BotaoPasta({ sessao }: { readonly sessao: string | undefined }) {
  const { painel } = useApp();
  const pastaAberta = useSyncExternalStore(painel.observar, () => {
    const estado = painel.obter();
    return estado.aberto && estado.aba === "pasta";
  });
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={pastaAberta}
      onClick={() =>
        pastaAberta ? painel.fechar() : sessao === undefined ? painel.mostrar("pasta") : painel.mostrarPasta(sessao)
      }
    >
      {pastaAberta ? <FolderOpenIcon /> : <FolderIcon />} Pasta da tarefa
    </Button>
  );
}

/**
 * A conversa ao lado levada à tela cheia (⤢) com uma pergunta começada na caixa do painel: a caixa daqui não
 * a tem (as fichas da revisão se preparam só no painel), e "Trazer de volta" volta a ela.
 */
function RascunhoNoPainel({ sessao }: { readonly sessao: string | undefined }) {
  const { painel } = useApp();
  const navegar = useNavigate();
  const voltarPara = useSyncExternalStore(painel.observar, () => {
    const conversa = painel.obter().conversa;
    const comRascunho = conversa.texto.trim() !== "" || conversa.fichas.length > 0;
    return sessao !== undefined && conversa.id === sessao && comRascunho ? (conversa.voltarPara ?? "/") : undefined;
  });
  if (voltarPara === undefined) return null;
  return (
    <p className="pointer-events-auto mb-1 flex flex-wrap items-center gap-x-2 text-muted-foreground text-small">
      Há uma pergunta começada na caixa do painel, com as fichas dela.
      <Button size="xs" variant="ghost" onClick={() => void navegar({ href: voltarPara })}>
        Trazer de volta
      </Button>
    </p>
  );
}

function Conversa({ controle }: { readonly controle: ControleConversa }) {
  const estado = useEstadoConversa(controle);
  const aoAbrirLink = useAbrirLink();
  const catalogo = useCatalogo();
  const navegar = useNavigate();
  const { conversas, painel } = useApp();
  const aoContinuar: AoContinuar = ({ sessao, continuacao }) => {
    if (continuacao !== undefined) conversas.guardarRascunho(sessao, rascunhoDaContinuacao(continuacao));
    // A conversa ao lado levada à tela cheia continua nela: o painel passa à nova (a caixa fica aqui).
    if (estado.sessao !== undefined) painel.continuada(estado.sessao, sessao);
    void navegar({ to: "/conversa", search: { id: sessao } });
  };
  // A tarefa que saiu do catálogo ainda dá o título à conversa.
  const tituloTarefa =
    catalogo.fase === "pronto" && estado.tarefa !== undefined ? tituloDaTarefa(catalogo, estado.tarefa) : undefined;
  const [apagando, setApagando] = useState<ConversaParaApagar | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border border-b px-4 py-2 text-sm">
        <p className="min-w-0 truncate">
          <span className="font-semibold" data-conteudo={tituloTarefa === undefined && estado.titulo ? "" : undefined}>
            {tituloTarefa ?? estado.titulo ?? "Conversa"}
          </span>
          <span className="text-muted-foreground"> · {DESCRICOES[estado.provider].nome}</span>
        </p>
        <div className="ml-auto flex gap-2">
          <BotaoPasta sessao={estado.sessao} />
          <Button variant="outline" size="sm" onClick={() => void navegar({ to: "/" })}>
            <PlusIcon /> Nova tarefa
          </Button>
          {estado.sessao === undefined ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Mais ações da conversa" title="Mais ações" />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem
                  className="text-destructive-foreground"
                  onClick={() =>
                    setApagando({ id: estado.sessao!, titulo: estado.titulo ?? "", provider: estado.provider })
                  }
                >
                  Apagar a conversa…
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        </div>
      </div>
      {/* Apagada a conversa aberta, a tela vai para o Início (`ApagarConversas`). */}
      <ApagarConversas conversas={apagando === null ? null : [apagando]} aoFechar={() => setApagando(null)} />
      <VistaConversa
        controle={controle}
        aoAbrirLink={aoAbrirLink}
        aoContinuar={aoContinuar}
        caixa={
          <>
            <RascunhoNoPainel sessao={estado.sessao} />
            <Compositor key={estado.sessao} controle={controle} />
          </>
        }
      />
    </div>
  );
}

/** A barra lateral: as conversas gravadas. */
function BarraConversas({ controle }: { readonly controle: ControleConversa | undefined }) {
  const estado = useSyncExternalStore(controle?.observar ?? semObservar, () =>
    controle === undefined ? undefined : controle.obter(),
  );
  return (
    <nav
      aria-label="Conversas gravadas"
      className="hidden h-full w-64 shrink-0 flex-col gap-3 overflow-y-auto border-border border-r p-3 @3xl/tela:flex"
    >
      <h2 className="px-2 font-semibold text-muted-foreground text-small">Conversas</h2>
      <ListaConversas atual={estado?.sessao} atualizar={`${estado?.sessao ?? ""}:${estado?.fase ?? ""}`} />
    </nav>
  );
}

const semObservar = () => () => undefined;

function TelaConversa() {
  const { id } = Route.useSearch();
  const navegar = useNavigate({ from: "/conversa" });
  const controle = useControleConversa(id);
  // Os links abrem no painel do app, e a conversa fica na tela.
  useTelaDeTrabalho();

  // Sem id, não há conversa a mostrar: volta ao Início.
  useEffect(() => {
    if (id === undefined) void navegar({ to: "/", replace: true });
  }, [id, navegar]);

  return (
    <div className="flex h-full">
      <BarraConversas controle={controle} />
      {controle === undefined ? <Abrindo /> : <ConteudoConversa controle={controle} />}
    </div>
  );
}

function Abrindo() {
  return (
    <p className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
      <Spinner /> Abrindo a conversa…
    </p>
  );
}

function ConteudoConversa({ controle }: { readonly controle: ControleConversa }) {
  const estado = useEstadoConversa(controle);
  let conteudo: ReactNode;
  if (estado.fase === "carregando" || estado.fase === "iniciando") {
    conteudo = <Abrindo />;
  } else if (estado.fase === "configurando") {
    conteudo =
      estado.erroInicio === undefined ? null : (
        <div className={cn(classeColuna("estreita"), "flex flex-1 flex-col justify-center gap-4 py-8")}>
          <AvisoErro erro={estado.erroInicio} />
        </div>
      );
  } else {
    conteudo = <Conversa controle={controle} />;
  }
  return conteudo;
}
