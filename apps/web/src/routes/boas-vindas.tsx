/**
 * Boas-vindas (M1.8): o aviso de uso, com "Entendi" gravado, e três passos que se podem pular:
 *
 * 1. **Conectar a IA:** Claude, ChatGPT (Codex) ou Gemini (Antigravity), com o cartão de
 *    Configurações (o app instala e faz o login do Codex e do Antigravity; o Claude tem o passo guiado);
 * 2. **Seu perfil:** campus, função e cursos, só neste computador;
 * 3. **Uma tarefa de exemplo:** a mais útil para o perfil, com o tempo e o gasto da cota.
 *
 * O Início traz a pessoa para cá enquanto o aviso não foi aceito ou as boas-vindas não terminaram
 * (concluídas ou puladas); Configurações tem "Rever as boas-vindas".
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CheckCircle2Icon, FileSearchIcon, SparklesIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { AvisoUso } from "../components/AvisoUso.tsx";
import { Pagina } from "../components/Pagina.tsx";
import { CartaoProvider } from "../components/CartaoProvider.tsx";
import { FormPerfil } from "../components/FormPerfil.tsx";
import { Button } from "../components/ui/button.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useConversa, useEstadoConexao } from "../contexto.tsx";
import { DESCRICOES, PROVIDERS } from "../providers.ts";
import { useCatalogo } from "../tarefas/catalogo.ts";
import { comecarTarefa } from "../tarefas/comecar.tsx";
import { type Exemplo, exemplosDoPerfil } from "../tarefas/exemplo.ts";
import { usePreferencias } from "../tarefas/perfil.ts";
import { EsperaPreferencias } from "../components/EsperaPreferencias.tsx";
import { MarcaIa } from "../components/MarcaIa.tsx";

/**
 * A busca da rota: o pedido que veio pronto do Explorar ("Perguntar à IA sobre isto") e foi desviado
 * para cá porque o primeiro uso estava por fazer; "Pular e ir para o Início" o devolve à caixa do Início.
 */
export interface BuscaBoasVindas {
  readonly pedido?: string;
}

export const Route = createFileRoute("/boas-vindas")({
  component: BoasVindas,
  validateSearch: (busca: Record<string, unknown>): BuscaBoasVindas =>
    typeof busca.pedido === "string" && busca.pedido !== "" ? { pedido: busca.pedido } : {},
});

type Passo = "aviso" | "ia" | "perfil" | "exemplo";

const PASSOS: ReadonlyArray<{ readonly passo: Exclude<Passo, "aviso">; readonly rotulo: string }> = [
  { passo: "ia", rotulo: "Conectar a IA" },
  { passo: "perfil", rotulo: "Seu perfil" },
  { passo: "exemplo", rotulo: "Uma tarefa de exemplo" },
];

function Etapas({ atual }: { readonly atual: Passo }) {
  const indice = PASSOS.findIndex((item) => item.passo === atual);
  return (
    <ol aria-label="Passos das boas-vindas" className="flex flex-wrap gap-2 text-sm">
      {PASSOS.map((item, i) => (
        <li
          key={item.passo}
          aria-current={i === indice ? "step" : undefined}
          className={
            i === indice
              ? "rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground"
              : i < indice
                ? "rounded-full bg-primary/10 px-3 py-1 text-primary"
                : "rounded-full bg-muted px-3 py-1 text-muted-foreground"
          }
        >
          {i + 1}. {item.rotulo}
        </li>
      ))}
    </ol>
  );
}

function Moldura({
  passo,
  titulo,
  children,
}: {
  readonly passo: Passo;
  readonly titulo: string;
  readonly children: ReactNode;
}) {
  const indice = PASSOS.findIndex((item) => item.passo === passo);
  return (
    <Pagina largura="estreita">
      {passo === "aviso" ? null : <Etapas atual={passo} />}
      <header className="flex flex-col gap-1">
        {indice < 0 ? null : (
          <p className="font-medium text-muted-foreground text-sm">
            Passo {indice + 1} de {PASSOS.length}
          </p>
        )}
        <h1 className="text-display">{titulo}</h1>
      </header>
      {children}
    </Pagina>
  );
}

function PassoAviso({ aoSeguir }: { readonly aoSeguir: () => Promise<unknown> }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();
  return (
    <Moldura passo="aviso" titulo="Boas-vindas ao Simplifica IF">
      <p className="max-w-prose text-muted-foreground">
        Consulte normas, PPCs e cursos usando a base pública do IFPR com a IA da sua conta pessoal. Antes de começar,
        veja como seus dados circulam.
      </p>
      <AvisoUso />
      {erro === undefined ? null : <AvisoErro erro={erro} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={gravando}
          onClick={async () => {
            setGravando(true);
            try {
              await aoSeguir();
            } catch (falha) {
              setErro(explicarErro(falha));
              setGravando(false);
            }
          }}
        >
          {gravando ? <Spinner /> : null}
          Entendi, continuar
          <ArrowRightIcon />
        </Button>
        <p className="text-muted-foreground text-sm">
          Depois: 3 passos rápidos (IA, perfil e exemplo). Você pode rever este aviso em Configurações.
        </p>
      </div>
    </Moldura>
  );
}

function PassoIa({
  escolhida,
  aoEscolher,
  prontas,
  aoMudarPronta,
  aoSeguir,
}: {
  readonly escolhida: Provider;
  readonly aoEscolher: (provider: Provider) => void;
  readonly prontas: ReadonlySet<Provider>;
  readonly aoMudarPronta: (provider: Provider, pronta: boolean) => void;
  readonly aoSeguir: () => void;
}) {
  const pronta = prontas.has(escolhida);
  return (
    <Moldura passo="ia" titulo="Conecte a sua IA">
      <p className="max-w-prose text-muted-foreground">
        Escolha a IA da sua conta pessoal. Você pode conectar outra depois, em Configurações.
      </p>
      <div role="radiogroup" aria-label="Qual IA você usa?" className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            role="radio"
            aria-checked={provider === escolhida}
            onClick={() => aoEscolher(provider)}
            className="flex flex-col items-start gap-0.5 rounded-xl border border-border bg-card p-3 text-left hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-primary/6"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <MarcaIa provider={provider} />
              {DESCRICOES[provider].nome}
              {prontas.has(provider) ? (
                <CheckCircle2Icon aria-label="conectada" className="size-4 text-success" />
              ) : null}
            </span>
            <span className="text-muted-foreground text-micro">{DESCRICOES[provider].conta}</span>
          </button>
        ))}
      </div>
      <CartaoProvider
        key={escolhida}
        provider={escolhida}
        aoMudarEstado={(estado) => aoMudarPronta(escolhida, estado.instalado && estado.autenticado)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {pronta ? (
          <Button onClick={aoSeguir}>
            Continuar <ArrowRightIcon />
          </Button>
        ) : null}
        <Button variant={pronta ? "ghost" : "outline"} onClick={aoSeguir}>
          {pronta ? "Pular" : "Pular, conecto depois"}
        </Button>
        {pronta ? <p className="text-success text-sm">Pronto: {DESCRICOES[escolhida].nome} conectado.</p> : null}
      </div>
    </Moldura>
  );
}

function PassoPerfil({ aoSeguir }: { readonly aoSeguir: () => void }) {
  const { preferencias, gravarPerfil } = usePreferencias();
  return (
    <Moldura passo="perfil" titulo="Conte quem você é">
      {preferencias === undefined ? (
        <EsperaPreferencias telaInteira={false} />
      ) : (
        <FormPerfil
          inicial={preferencias.perfil}
          rotuloGravar="Salvar e continuar"
          aoGravar={async (perfil) => {
            await gravarPerfil(perfil);
            aoSeguir();
          }}
          secundaria={
            <Button type="button" variant="ghost" onClick={aoSeguir}>
              Pular
            </Button>
          }
        />
      )}
    </Moldura>
  );
}

function CartaoExemplo({
  exemplo,
  principal,
  semIa,
  aoFazer,
}: {
  readonly exemplo: Exemplo;
  readonly principal: boolean;
  readonly semIa: boolean;
  readonly aoFazer: () => Promise<void>;
}) {
  const [fazendo, setFazendo] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();
  const precisaIa = exemplo.tipo === "conversa";
  return (
    <section
      aria-label={exemplo.titulo}
      className={`flex flex-col gap-2 rounded-xl border bg-card p-4 ${principal ? "border-primary/60" : "border-border"}`}
    >
      <h2 className="flex items-center gap-2 font-semibold">
        {exemplo.tipo === "revisar-ppc" ? (
          <FileSearchIcon aria-hidden className="size-4 text-link" />
        ) : (
          <SparklesIcon aria-hidden className="size-4 text-link" />
        )}
        {exemplo.titulo}
        {principal ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-micro">Sugerida</span>
        ) : null}
      </h2>
      <p className="text-muted-foreground text-sm">{exemplo.frase}</p>
      <p className="text-sm">
        <span className="font-medium">Estimativa:</span> {exemplo.custo}
      </p>
      {precisaIa && semIa ? (
        <p className="text-muted-foreground text-sm">
          Conecte uma IA no passo 1 (ou em Configurações) para fazer este.
        </p>
      ) : (
        <Button
          className="self-start"
          variant={principal ? "default" : "outline"}
          disabled={fazendo}
          onClick={async () => {
            setFazendo(true);
            setErro(undefined);
            try {
              await aoFazer();
            } catch (falha) {
              setErro(explicarErro(falha));
              setFazendo(false);
            }
          }}
        >
          {fazendo ? <Spinner /> : null}
          Fazer agora
        </Button>
      )}
      {erro === undefined ? null : <AvisoErro erro={erro} />}
    </section>
  );
}

function PassoExemplo({
  provider,
  aoTerminar,
}: {
  readonly provider: Provider | undefined;
  readonly aoTerminar: () => Promise<unknown>;
}) {
  const api = useApi();
  const [, conversa] = useConversa();
  const navegar = useNavigate();
  const { pedido } = Route.useSearch();
  const catalogo = useCatalogo();
  const { preferencias } = usePreferencias();
  const exemplos = exemplosDoPerfil(preferencias?.perfil, catalogo.fase === "pronto" ? catalogo.skills : []);

  const fazer = async (exemplo: Exemplo) => {
    await aoTerminar();
    if (exemplo.tipo === "revisar-ppc") {
      await navegar({ to: "/revisao-ppc" });
      return;
    }
    if (provider === undefined) return;
    const sessao = await comecarTarefa(api, conversa, {
      titulo: "Exemplo - fundamentação normativa",
      tarefa: exemplo.skill,
      ia: { provider },
      anexos: [],
      texto: exemplo.pedido,
    });
    await navegar({ to: "/conversa", search: { id: sessao } });
  };

  return (
    <Moldura passo="exemplo" titulo="Experimente uma tarefa">
      <p className="max-w-prose text-muted-foreground">
        Uma tarefa curta para ver como o Simplifica IF trabalha. As outras ficam no Início.
      </p>
      {catalogo.fase === "carregando" ? <Spinner /> : null}
      {catalogo.fase === "falhou" ? <AvisoErro erro={catalogo.erro} /> : null}
      <div className="flex flex-col gap-3">
        {exemplos.map((exemplo, i) => (
          <CartaoExemplo
            key={exemplo.tipo}
            exemplo={exemplo}
            principal={i === 0}
            semIa={provider === undefined}
            aoFazer={() => fazer(exemplo)}
          />
        ))}
      </div>
      <Button
        variant="ghost"
        className="self-start"
        onClick={async () => {
          await aoTerminar();
          await navegar({ to: "/", search: pedido === undefined ? {} : { pedido } });
        }}
      >
        Pular e ir para o Início
      </Button>
    </Moldura>
  );
}

function BoasVindas() {
  const conexao = useEstadoConexao();
  const [estadoConversa, conversa] = useConversa();
  const { preferencias, aceitarAviso, concluirBoasVindas } = usePreferencias();
  const [passo, setPasso] = useState<Passo>("aviso");
  const [escolhida, setEscolhida] = useState<Provider>(estadoConversa.provider);
  const [prontas, setProntas] = useState<ReadonlySet<Provider>>(new Set());

  if (conexao.fase === "sem-servidor") return null;
  if (preferencias === undefined) return <EsperaPreferencias />;

  const mudarPronta = (provider: Provider, pronta: boolean) =>
    setProntas((antes) => {
      if (antes.has(provider) === pronta) return antes;
      const depois = new Set(antes);
      if (pronta) depois.add(provider);
      else depois.delete(provider);
      return depois;
    });

  switch (passo) {
    case "aviso":
      return (
        <PassoAviso
          aoSeguir={async () => {
            await aceitarAviso();
            setPasso("ia");
          }}
        />
      );
    case "ia":
      return (
        <PassoIa
          escolhida={escolhida}
          aoEscolher={setEscolhida}
          prontas={prontas}
          aoMudarPronta={mudarPronta}
          aoSeguir={() => {
            // A IA conectada vira a escolha padrão das conversas.
            if (prontas.has(escolhida)) conversa.escolher({ provider: escolhida });
            setPasso("perfil");
          }}
        />
      );
    case "perfil":
      return <PassoPerfil aoSeguir={() => setPasso("exemplo")} />;
    case "exemplo":
      return (
        <PassoExemplo provider={prontas.has(escolhida) ? escolhida : [...prontas][0]} aoTerminar={concluirBoasVindas} />
      );
  }
}
