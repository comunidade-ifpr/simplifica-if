/**
 * Início do Modo Servidor (M1.9): a data da base, a linha do perfil ("Função · Campus", M1.8), a caixa
 * "O que você precisa hoje?" (com anexo e a escolha da IA), os cartões de tarefa que servem ao perfil
 * (as skills do catálogo e a tarefa nativa "Analisar um PPC"), "Ver todas" e os recentes (conversas e a
 * última análise de PPC). No primeiro uso (aviso não aceito ou boas-vindas por ver), leva às
 * boas-vindas.
 *
 * "Para você" (as novidades da base que afetam o perfil) é do Marco 2. No Marco 1 ele mostraria só as
 * novidades gerais da base, mas a base ainda não publica uma lista de novidades: o bloco fica oculto
 * até a atualização (M1.10) trazê-la.
 *
 * A IA (instalar, entrar) fica em Configurações › Sua IA; aqui, só o aviso quando nenhuma está pronta.
 */
import type { ListaPendencias, Provider } from "@simplifica-if/contratos-app";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CircleCheckIcon, FileSearchIcon, SendHorizontalIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button, buttonVariants } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useConversa, useEstadoConexao } from "../contexto.tsx";
import { PROVIDERS } from "../providers.ts";
import { CartaoTarefa } from "../tarefas/CartaoTarefa.tsx";
import { nomeTarefa, tarefasDoInicio, useCatalogo } from "../tarefas/catalogo.ts";
import { Anexos, comecarTarefa, EscolhaIa, nomeArquivo } from "../tarefas/comecar.tsx";
import { linhaDoPerfil, primeiroUsoPendente, usePerfil, usePreferencias } from "../tarefas/perfil.ts";
import { dataDaBase, tituloDoPedido } from "../tarefas/textos.ts";

export const Route = createFileRoute("/")({ component: Inicio });

/** Quantos cartões o Início mostra antes de "Ver todas". */
const CARTOES_NO_INICIO = 4;

function DataDaBase() {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [data, setData] = useState<{ readonly data: string; readonly versao: string }>();
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente.sobreABase({}))
      .then(
        (resposta) => vale && setData({ data: resposta.base.data_referencia, versao: resposta.base.versao }),
        () => undefined,
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  if (data === undefined) return null;
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-sm" title={`Versão ${data.versao}`}>
      Base de {dataDaBase(data.data)}
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
        api
          .chamar((cliente) => cliente["providers.detectar"]({ provider }))
          .then(
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

function CaixaPedido() {
  const api = useApi();
  const [estado, conversa] = useConversa();
  const navegar = useNavigate();
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<ReadonlyArray<string>>([]);
  const [provider, setProvider] = useState<Provider>(estado.provider);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();

  const enviar = async () => {
    if (texto.trim() === "" || enviando) return;
    setEnviando(true);
    setErro(undefined);
    try {
      const sessao = await comecarTarefa(api, conversa, {
        titulo: tituloDoPedido(texto),
        tarefa: "conversa",
        provider,
        anexos,
        texto: anexos.length === 0 ? texto : `${texto}\n\nArquivos na pasta: ${anexos.map(nomeArquivo).join(", ")}.`,
      });
      await navegar({ to: "/conversa", search: { id: sessao } });
    } catch (falha) {
      setErro(explicarErro(falha));
      setEnviando(false);
    }
  };
  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    void enviar();
  };
  const aoTeclar = (evento: KeyboardEvent<HTMLTextAreaElement>) => {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      void enviar();
    }
  };
  return (
    <form
      onSubmit={aoEnviar}
      aria-label="O que você precisa hoje?"
      className="flex flex-col gap-2 rounded-xl border border-input bg-card p-3 shadow-xs focus-within:ring-2 focus-within:ring-ring"
    >
      <Textarea
        aria-label="O que você precisa hoje?"
        placeholder="O que você precisa hoje? Ex.: quais normas tratam do estágio no técnico integrado?"
        rows={3}
        value={texto}
        onChange={(evento) => setTexto(evento.currentTarget.value)}
        onKeyDown={aoTeclar}
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Anexos anexos={anexos} aoMudar={setAnexos} />
        <div className="ml-auto flex items-center gap-2">
          <EscolhaIa valor={provider} aoMudar={setProvider} />
          <Button type="submit" disabled={texto.trim() === "" || enviando}>
            {enviando ? <Spinner /> : <SendHorizontalIcon />}
            {enviando ? "Abrindo…" : "Enviar"}
          </Button>
        </div>
      </div>
      {erro === undefined ? null : <AvisoErro erro={erro} />}
    </form>
  );
}

function Tarefas() {
  const catalogo = useCatalogo();
  const perfil = usePerfil();
  if (catalogo.fase === "falhou") return <AvisoErro erro={catalogo.erro} />;
  const tarefas = tarefasDoInicio(catalogo.fase === "pronto" ? catalogo.skills : [], perfil);
  return (
    <section aria-labelledby="titulo-tarefas" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="titulo-tarefas" className="font-semibold text-lg">
          Tarefas
        </h2>
        <Link to="/tarefas" className="flex items-center gap-1 font-medium text-primary text-sm hover:underline">
          Ver todas <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tarefas.slice(0, CARTOES_NO_INICIO).map((tarefa) => (
          <li key={nomeTarefa(tarefa)}>
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

/** A análise de PPC mais recente, para continuar de onde parou. */
function UltimaAnalise() {
  const api = useApi();
  const conectado = useEstadoConexao().fase === "conectada";
  const [lista, setLista] = useState<ListaPendencias | null>(null);
  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente["revisaoPpc.ultimaLista"]({}))
      .then(
        (ultima) => vale && setLista(ultima),
        () => undefined,
      );
    return () => {
      vale = false;
    };
  }, [api, conectado]);
  if (lista === null) return null;
  return (
    <Link
      to="/revisao-ppc"
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-sm hover:bg-accent"
    >
      <FileSearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">Análise do PPC: {nomeArquivo(lista.arquivoOriginal)}</span>
    </Link>
  );
}

function Inicio() {
  const conexao = useEstadoConexao();
  const { preferencias } = usePreferencias();
  const perfil = linhaDoPerfil(preferencias?.perfil);
  const navegar = useNavigate();
  const pendente = primeiroUsoPendente(preferencias);
  useEffect(() => {
    if (pendente === true) void navegar({ to: "/boas-vindas", replace: true });
  }, [pendente, navegar]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <section className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">Olá!</h1>
            {perfil !== undefined ? (
              <p className="text-muted-foreground" data-linha-perfil>
                {perfil}
              </p>
            ) : preferencias === undefined ? null : (
              <Link to="/configuracoes" hash="perfil" className="text-primary text-sm hover:underline">
                Preencha seu perfil para ver primeiro as tarefas da sua função
              </Link>
            )}
          </div>
          {conexao.fase === "sem-servidor" ? null : <DataDaBase />}
        </section>
        {conexao.fase === "sem-servidor" ? null : (
          <>
            <AvisoSemIa />
            <CaixaPedido />
            <Tarefas />
            <section aria-labelledby="titulo-recentes" className="flex max-w-xl flex-col gap-2">
              <h2 id="titulo-recentes" className="font-semibold text-lg">
                Recentes
              </h2>
              <UltimaAnalise />
              <ListaConversas limite={5} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
