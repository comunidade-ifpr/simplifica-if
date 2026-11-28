/**
 * Início do Modo Servidor (M1.9): a linha do perfil ("Função · Campus", M1.8) e a data da base, a pergunta
 * "O que você precisa hoje?" com a caixa de pedido (`CaixaPedido`, com anexo e a escolha da IA),
 * "Continuar de onde parou" (o que roda, o que terminou sem ser visto, o que ficou aberto no painel e a
 * última revisão de PPC) e as conversas recentes. No primeiro uso (aviso não aceito ou boas-vindas por ver),
 * leva às boas-vindas; ao reabrir o app, espera a continuidade decidir para onde voltar, sem piscar.
 *
 * As novidades da base aparecem no aviso "Base atualizada" (`configuracoes/AvisoBaseAtualizada.tsx`),
 * logo abaixo da data da base, depois que uma versão nova entra.
 *
 * A IA (instalar, entrar) fica em Configurações › Sua IA; aqui, só o aviso quando nenhuma está pronta.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleCheckIcon, CompassIcon, ListChecksIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { CaixaPedido } from "../components/CaixaPedido.tsx";
import { AvisoBaseAtualizada } from "../configuracoes/AvisoBaseAtualizada.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useApp, useContinuidade, useEstadoConexao } from "../contexto.tsx";
import { ContinuarDeOndeParou } from "../continuidade/ContinuarDeOndeParou.tsx";
import { detectarIa } from "../deteccao.ts";
import { PROVIDERS } from "../providers.ts";
import { Anexos, comecarTarefa, EscolhaIa, useAnexos } from "../tarefas/comecar.tsx";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import { linhaDoPerfil, primeiroUsoPendente, usePreferencias } from "../tarefas/perfil.ts";
import { tituloDoPedido } from "../tarefas/textos.ts";
import { EsperaPreferencias } from "../components/EsperaPreferencias.tsx";
import { classeColuna } from "../components/Pagina.tsx";
import { dataCurta } from "../lib/formato.ts";
import { cn } from "../lib/utils.ts";
// Composição: o módulo `revisao-ppc`.
import { UltimaRevisao } from "../modulos/revisao-ppc/UltimaRevisao.tsx";

export const Route = createFileRoute("/")({
  component: Inicio,
});

function DataDaBase() {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [data, setData] = useState<{ readonly data: string | null; readonly versao: string }>();
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente.sobreABase({}))
      .then(
        (resposta) => vale && setData({ data: resposta.base.data, versao: resposta.base.versao }),
        () => undefined,
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  if (data === undefined) return null;
  return (
    <p className="flex items-center gap-1.5" title={`Versão ${data.versao}`}>
      {data.data === null ? "Base de desenvolvimento" : `Base de ${dataCurta(data.data)}`}
      <CircleCheckIcon aria-label="em dia" className="size-4 text-success" />
    </p>
  );
}

/** Nenhuma IA pronta (instalada e com login): o caminho para Configurações › Sua IA. */
function AvisoSemIa() {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [semIa, setSemIa] = useState(false);
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    Promise.all(
      PROVIDERS.map((provider) =>
        detectarIa(api, provider).then(
          (estado) => estado.instalado && estado.autenticado,
          () => false,
        ),
      ),
    ).then((prontas) => vale && setSemIa(!prontas.some(Boolean)));
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  if (!semIa) return null;
  return (
    <Alert variant="warning">
      <AlertTitle>Conecte uma IA para começar</AlertTitle>
      <AlertDescription>
        <p>O Simplifica IF usa a IA da sua conta pessoal (Claude, ChatGPT ou Gemini).</p>
        <Link to="/configuracoes" className={buttonVariants({ size: "sm", variant: "outline" })}>
          Ir para Sua IA
        </Link>
      </AlertDescription>
    </Alert>
  );
}

function PedidoDoInicio() {
  const api = useApi();
  const { conversas } = useApp();
  const navegar = useNavigate();
  const [texto, setTexto] = useState("");
  const { anexos, mudar: setAnexos, recusados, soltar } = useAnexos();
  const [ia, setIa] = useState<EscolhaDaIa>(() => ({ provider: conversas.ultimaIa() }));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  const enviar = async () => {
    if (texto.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(undefined);
    try {
      await comecarTarefa(api, conversas, { titulo: tituloDoPedido(texto), ia, anexos, texto }, (sessao) =>
        navegar({ to: "/conversa", search: { id: sessao } }),
      );
    } catch (falha) {
      setErro(explicarErro(falha));
      setEnviando(false);
    }
  };
  return (
    <CaixaPedido
      rotulo="O que você precisa hoje?"
      rotuloFormulario="O que você precisa hoje?"
      placeholder="Pergunte sobre uma norma, um curso ou um PPC"
      linhas={2}
      valor={texto}
      aoMudar={setTexto}
      aoEnviar={() => void enviar()}
      enviando={enviando}
      aoSoltarArquivos={soltar === undefined ? undefined : (arquivos) => void soltar(arquivos)}
      esquerda={<Anexos anexos={anexos} aoMudar={setAnexos} recusados={recusados} />}
      direita={<EscolhaIa compacta valor={ia} aoMudar={setIa} />}
      abaixo={erro === undefined ? undefined : <AvisoErro erro={erro} />}
    />
  );
}

/** Atalhos exibidos abaixo da caixa de pedido quando ainda não há trabalho em aberto nem conversas. */
function AtalhosDoInicio() {
  const classeChip =
    "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-medium text-foreground transition-colors hover:border-input hover:bg-muted";
  return (
    <div data-atalhos-inicio className="hidden flex-wrap items-center gap-2 text-small">
      <span className="text-muted-foreground">Ou comece por:</span>
      <Link to="/tarefas" className={classeChip}>
        <ListChecksIcon aria-hidden className="size-3.5 text-muted-foreground" />
        Tarefas
      </Link>
      <Link to="/explorar" className={classeChip}>
        <CompassIcon aria-hidden className="size-3.5 text-muted-foreground" />
        Explorar o IFPR
      </Link>
    </div>
  );
}

function Inicio() {
  const conexao = useEstadoConexao();
  const { preferencias } = usePreferencias();
  const perfil = linhaDoPerfil(preferencias?.perfil);
  const navegar = useNavigate();
  const pendente = primeiroUsoPendente(preferencias);
  const { restaurando } = useContinuidade();
  useEffect(() => {
    if (pendente === true) void navegar({ to: "/boas-vindas", replace: true });
  }, [pendente, navegar]);
  // Enquanto as preferências carregam (ou antes de desviar para as boas-vindas), nada pisca na tela.
  if (conexao.fase !== "sem-servidor" && (pendente !== false || restaurando)) return <EsperaPreferencias />;
  return (
    <div className="h-full overflow-y-auto">
      {/* Uma coluna só, centrada: a pergunta em letras grandes e a caixa de pedido, que é o centro da tela. */}
      <div
        className={cn(
          classeColuna("estreita"),
          "flex flex-col gap-10 pt-14 pb-12 [&:has([data-sem-conversas]):not(:has([data-continuar]))_[data-atalhos-inicio]]:flex",
        )}
      >
        <div className="flex flex-col gap-6">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-small">
              {perfil !== undefined ? (
                <p data-linha-perfil>{perfil}</p>
              ) : preferencias === undefined ? null : (
                <Link to="/configuracoes" hash="perfil" className="link-grifo text-foreground">
                  Preencha seu perfil para ver primeiro as tarefas da sua função
                </Link>
              )}
              {conexao.fase === "sem-servidor" ? null : <DataDaBase />}
            </div>
            <h1 className="text-hero">O que você precisa hoje?</h1>
          </section>
          {conexao.fase === "sem-servidor" ? null : (
            <>
              <AvisoBaseAtualizada />
              <AvisoSemIa />
              <div className="flex flex-col gap-3">
                <PedidoDoInicio />
                <AtalhosDoInicio />
              </div>
            </>
          )}
        </div>
        {conexao.fase === "sem-servidor" ? null : (
          <>
            {/* Composição: a última revisão de PPC, do módulo `revisao-ppc`. */}
            <ContinuarDeOndeParou extras={<UltimaRevisao />} />
            <section aria-labelledby="titulo-recentes" className="flex flex-col gap-2">
              <h2 id="titulo-recentes" className="text-title">
                Conversas recentes
              </h2>
              <ListaConversas limite={5} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
