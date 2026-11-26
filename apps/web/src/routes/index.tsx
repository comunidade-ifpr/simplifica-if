/**
 * Início do Modo Servidor (M1.9): a linha do perfil ("Função · Campus", M1.8) e a data da base, a pergunta
 * "O que você precisa hoje?" com a caixa de pedido (`CaixaPedido`, com anexo e a escolha da IA), as tarefas que servem ao perfil
 * (do catálogo do servidor, as que rodam no app antes das que abrem um link), "Ver todas" e os recentes (conversas e a
 * última revisão de PPC). No primeiro uso (aviso não aceito ou boas-vindas por ver), leva às
 * boas-vindas.
 *
 * As novidades da base aparecem no aviso "Base atualizada" (`configuracoes/AvisoBaseAtualizada.tsx`),
 * logo abaixo da data da base, depois que uma versão nova entra.
 *
 * A IA (instalar, entrar) fica em Configurações › Sua IA; aqui, só o aviso quando nenhuma está pronta.
 *
 * "Perguntar à IA sobre isto", nas páginas do Explorar, chega aqui com o pedido escrito (`?pedido=`): a
 * caixa já vem com ele e com o foco, e nada é enviado sozinho.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { CaixaPedido } from "../components/CaixaPedido.tsx";
import { AvisoBaseAtualizada } from "../configuracoes/AvisoBaseAtualizada.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useConversa, useEstadoConexao } from "../contexto.tsx";
import { detectarIa } from "../deteccao.ts";
import { PROVIDERS } from "../providers.ts";
import { CartaoTarefa } from "../tarefas/CartaoTarefa.tsx";
import { tarefasDoInicio, useCatalogo } from "../tarefas/catalogo.ts";
import { Anexos, comecarTarefa, EscolhaIa, useAnexos } from "../tarefas/comecar.tsx";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import { linhaDoPerfil, primeiroUsoPendente, usePerfil, usePreferencias } from "../tarefas/perfil.ts";
import { tituloDoPedido } from "../tarefas/textos.ts";
import { EsperaPreferencias } from "../components/EsperaPreferencias.tsx";
import { classeColuna } from "../components/Pagina.tsx";
import { dataCurta } from "../lib/formato.ts";
import { cn } from "../lib/utils.ts";
// Composição: o módulo `revisao-ppc`.
import { UltimaRevisao } from "../modulos/revisao-ppc/UltimaRevisao.tsx";

/** A busca da rota: o pedido que veio pronto ("Perguntar à IA sobre isto", do Explorar). */
export interface BuscaInicio {
  readonly pedido?: string;
}

export const Route = createFileRoute("/")({
  component: Inicio,
  validateSearch: (busca: Record<string, unknown>): BuscaInicio =>
    typeof busca.pedido === "string" && busca.pedido !== "" ? { pedido: busca.pedido } : {},
});

/** Quantos cartões o Início mostra antes de "Ver todas". */
const CARTOES_NO_INICIO = 4;

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

function PedidoDoInicio({ pedido }: { readonly pedido: string | undefined }) {
  const api = useApi();
  const [estado, conversa] = useConversa();
  const navegar = useNavigate();
  const [texto, setTexto] = useState(pedido ?? "");
  const { anexos, mudar: setAnexos, recusados, soltar } = useAnexos();
  const [ia, setIa] = useState<EscolhaDaIa>({ provider: estado.provider });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  const enviar = async () => {
    if (texto.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(undefined);
    try {
      const sessao = await comecarTarefa(api, conversa, {
        titulo: tituloDoPedido(texto),
        ia,
        anexos,
        texto,
      });
      await navegar({ to: "/conversa", search: { id: sessao } });
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
      focar={pedido !== undefined}
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

function Tarefas() {
  const catalogo = useCatalogo();
  const perfil = usePerfil();
  if (catalogo.fase === "falhou") return <AvisoErro erro={catalogo.erro} />;
  const tarefas = tarefasDoInicio(catalogo.fase === "pronto" ? catalogo.tarefas : [], perfil);
  return (
    <section aria-labelledby="titulo-tarefas" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="titulo-tarefas" className="text-title">
          Tarefas
        </h2>
        <Link to="/tarefas" className="link-grifo text-small">
          Ver todas
        </Link>
      </div>
      <ul className="-mx-3.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {tarefas.slice(0, CARTOES_NO_INICIO).map((tarefa) => (
          <li key={tarefa.id}>
            <CartaoTarefa tarefa={tarefa} />
          </li>
        ))}
      </ul>
      {catalogo.fase === "carregando" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Carregando as tarefas…
        </p>
      ) : null}
    </section>
  );
}

function Inicio() {
  const { pedido } = Route.useSearch();
  const conexao = useEstadoConexao();
  const { preferencias } = usePreferencias();
  const perfil = linhaDoPerfil(preferencias?.perfil);
  const navegar = useNavigate();
  const pendente = primeiroUsoPendente(preferencias);
  useEffect(() => {
    // o pedido do Explorar vai junto e volta ao Início no fim das boas-vindas
    if (pendente === true) {
      void navegar({ to: "/boas-vindas", search: pedido === undefined ? {} : { pedido }, replace: true });
    }
  }, [pendente, navegar, pedido]);
  // Enquanto as preferências carregam (ou antes de desviar para as boas-vindas), nada pisca na tela.
  if (conexao.fase !== "sem-servidor" && pendente !== false) return <EsperaPreferencias />;
  return (
    <div className="h-full overflow-y-auto">
      {/* Uma coluna só, centrada: a pergunta em letras grandes e a caixa de pedido, que é o centro da tela. */}
      <div className={cn(classeColuna("estreita"), "flex flex-col gap-10 pt-14 pb-12")}>
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
              <PedidoDoInicio key={pedido ?? ""} pedido={pedido} />
            </>
          )}
        </div>
        {conexao.fase === "sem-servidor" ? null : (
          <>
            <Tarefas />
            <section aria-labelledby="titulo-recentes" className="flex flex-col gap-2">
              <h2 id="titulo-recentes" className="text-title">
                Recentes
              </h2>
              {/* Composição: a última revisão de PPC, do módulo `revisao-ppc`. */}
              <UltimaRevisao />
              <ListaConversas limite={5} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
