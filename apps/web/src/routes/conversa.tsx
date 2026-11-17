/**
 * Conversa: conversar, aprovar ou negar o que a IA pede, interromper e começar outra. As citações
 * `ifpr://` das respostas são chips que abrem o painel de leitura ao lado.
 *
 * Modo Servidor (M1.9): a conversa de uma tarefa mostra as etapas da skill (✓ ◐ ○), as chamadas de
 * ferramenta ficam recolhidas em "Detalhes técnicos", cada resposta tem 👍/👎 e "Isto está errado", e o
 * painel "Pasta da tarefa" mostra os arquivos e o "Desfazer". Sem conversa aberta, a tela é a conversa
 * com uma pasta escolhida à mão (a tela técnica de antes, que as Configurações abrem em "Avançado").
 *
 * As conversas ficam gravadas no servidor: a barra lateral as lista, e a conversa aberta fica na URL
 * (`/conversa?id=…`). Ao recarregar a tela ou reabrir o app numa conversa, ela volta com o histórico
 * e, se a IA estava respondendo, com o resto da resposta.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderIcon, FolderOpenIcon, PlusIcon, WrenchIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Avaliacao } from "../components/Avaliacao.tsx";
import { CaixaPedido } from "../components/CaixaPedido.tsx";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { IndicadorEtapas } from "../components/IndicadorEtapas.tsx";
import { ItemConversa } from "../components/ItemConversa.tsx";
import { PainelPasta } from "../components/PainelPasta.tsx";
import { etapasVistas } from "../conversa/etapas.ts";
import { type Item, rotuloFerramenta } from "../conversa/estado.ts";
import { useCatalogo } from "../tarefas/catalogo.ts";
import { ListaConversas } from "../components/ListaConversas.tsx";
import { PainelLeitura } from "../components/PainelLeitura.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { useConversa } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../providers.ts";

/** A busca da rota: o id da conversa aberta, quando há. */
export interface BuscaConversa {
  readonly id?: string;
}

export const Route = createFileRoute("/conversa")({
  component: TelaConversa,
  validateSearch: (busca: Record<string, unknown>): BuscaConversa =>
    typeof busca.id === "string" && busca.id !== "" ? { id: busca.id } : {},
});

function EscolhaProvider() {
  const [estado, conversa] = useConversa();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">Com qual IA?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((provider: Provider) => (
          <label
            key={provider}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/8 has-focus-visible:ring-2 has-focus-visible:ring-ring",
            )}
          >
            <input
              type="radio"
              name="provider"
              value={provider}
              className="accent-primary"
              checked={estado.provider === provider}
              onChange={() => conversa.escolher({ provider })}
            />
            {DESCRICOES[provider].nome}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EscolhaPasta() {
  const [estado, conversa] = useConversa();
  const escolherPasta = ponteDesktop()?.escolherPasta;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="pasta-trabalho" className="font-semibold">
        Pasta de trabalho
      </label>
      <p className="text-muted-foreground text-sm">
        A IA lê e escreve só nesta pasta. Use uma pasta com os documentos da tarefa.
      </p>
      <div className="flex gap-2">
        <Input
          id="pasta-trabalho"
          nativeInput
          placeholder="/Users/voce/Documents/Simplifica IF/minha-tarefa"
          value={estado.pastaTrabalho}
          readOnly={escolherPasta !== undefined}
          onChange={(evento) => conversa.escolher({ pastaTrabalho: evento.currentTarget.value })}
        />
        {escolherPasta === undefined ? null : (
          <Button
            variant="outline"
            onClick={async () => {
              const pasta = await escolherPasta();
              if (pasta !== null) conversa.escolher({ pastaTrabalho: pasta });
            }}
          >
            <FolderOpenIcon /> Escolher pasta…
          </Button>
        )}
      </div>
    </div>
  );
}

function FormularioInicio() {
  const [estado, conversa] = useConversa();
  const iniciando = estado.fase === "iniciando";
  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    void conversa.iniciar();
  };
  return (
    <form onSubmit={aoEnviar} className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6" aria-label="Nova conversa">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Conversa com uma pasta escolhida</h1>
        <p className="text-muted-foreground">
          A IA consulta a base do IFPR pelo app e cita as fontes. Para começar por uma tarefa, volte ao Início.
        </p>
      </div>
      <EscolhaProvider />
      <EscolhaPasta />
      {estado.erroInicio === undefined ? null : <AvisoErro erro={estado.erroInicio} />}
      <div>
        <Button type="submit" size="lg" disabled={iniciando}>
          {iniciando ? <Spinner /> : null}
          {iniciando ? "Abrindo a conversa…" : "Começar conversa"}
        </Button>
      </div>
    </form>
  );
}

function Compositor() {
  const [estado, conversa] = useConversa();
  const [texto, setTexto] = useState("");
  const ocupada = estado.fase === "respondendo" || estado.fase === "interrompendo";
  return (
    <CaixaPedido
      rotulo="Mensagem"
      valor={texto}
      aoMudar={setTexto}
      aoEnviar={() => {
        conversa.enviar(texto);
        setTexto("");
      }}
      interromper={
        ocupada
          ? {
              aoInterromper: () => void conversa.interromper(),
              interrompendo: estado.fase === "interrompendo",
            }
          : undefined
      }
      className="pointer-events-auto"
    />
  );
}

/** Rola a conversa até o fim quando `sinal` muda (item novo, texto chegando). */
function RolarParaOFim({ sinal }: { readonly sinal: string }) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sinal.length > 0) fim.current?.scrollIntoView({ block: "end" });
  }, [sinal]);
  return <div ref={fim} />;
}

type Bloco =
  | { readonly tipo: "item"; readonly item: Item; readonly turno: number }
  | {
      readonly tipo: "ferramentas";
      readonly chave: string;
      readonly itens: ReadonlyArray<Extract<Item, { tipo: "ferramenta" }>>;
    }
  | { readonly tipo: "avaliacao"; readonly chave: string; readonly turno: number };

/**
 * Os itens em blocos para a tela: as chamadas de ferramenta seguidas viram um grupo (os "detalhes
 * técnicos"), e depois da última resposta de cada turno fechado vem a avaliação.
 */
function emBlocos(itens: ReadonlyArray<Item>, turnoAberto: number | undefined): ReadonlyArray<Bloco> {
  const ultimaResposta = new Map<number, string>();
  let turno = 0;
  for (const item of itens) {
    if (item.tipo === "pessoa") turno++;
    else if (item.tipo === "resposta") ultimaResposta.set(turno, item.chave);
  }
  const blocos: Array<Bloco> = [];
  turno = 0;
  for (const item of itens) {
    if (item.tipo === "pessoa") turno++;
    const anterior = blocos.at(-1);
    if (item.tipo === "ferramenta") {
      if (anterior?.tipo === "ferramentas")
        blocos[blocos.length - 1] = { ...anterior, itens: [...anterior.itens, item] };
      else blocos.push({ tipo: "ferramentas", chave: item.chave, itens: [item] });
      continue;
    }
    blocos.push({ tipo: "item", item, turno });
    if (item.tipo === "resposta" && ultimaResposta.get(turno) === item.chave && turno !== turnoAberto) {
      blocos.push({ tipo: "avaliacao", chave: `avaliacao-${turno}`, turno });
    }
  }
  return blocos;
}

/** As chamadas de ferramenta de um trecho do turno, recolhidas; enquanto uma roda, o nome dela à vista. */
function DetalhesTecnicos({
  itens,
  aoAbrirLink,
}: {
  readonly itens: ReadonlyArray<Extract<Item, { tipo: "ferramenta" }>>;
  readonly aoAbrirLink: (link: string) => void;
}) {
  const rodando = itens.find((item) => item.situacao === "andamento");
  const consultas = itens.length === 1 ? "1 consulta" : `${itens.length} consultas`;
  return (
    <details className="group text-sm" data-detalhes-tecnicos>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rodando === undefined ? <WrenchIcon aria-hidden className="size-3.5" /> : <Spinner size="sm" tone="muted" />}
        {rodando === undefined
          ? `Detalhes técnicos · ${consultas}`
          : `Consultando a base: ${rotuloFerramenta(rodando.nome)}…`}
      </summary>
      <div className="mt-2 flex flex-col gap-2 border-border border-l-2 pl-3">
        {itens.map((item) => (
          <ItemConversa key={item.chave} item={item} aoAbrirLink={aoAbrirLink} />
        ))}
      </div>
    </details>
  );
}

function Conversa({
  aoAbrirLink,
  pastaAberta,
  aoAlternarPasta,
}: {
  readonly aoAbrirLink: (link: string) => void;
  readonly pastaAberta: boolean;
  readonly aoAlternarPasta: () => void;
}) {
  const [estado, conversa] = useConversa();
  const catalogo = useCatalogo();
  const navegar = useNavigate();
  const ultimo = estado.itens.at(-1);
  const tamanhoUltimo = ultimo?.tipo === "resposta" ? ultimo.texto.length : 0;
  const emTurno = estado.fase === "respondendo" || estado.fase === "interrompendo";
  const turnoAberto = emTurno ? estado.itens.filter((item) => item.tipo === "pessoa").length : undefined;
  const skill =
    catalogo.fase === "pronto" && estado.tarefa !== undefined
      ? catalogo.skills.find((candidata) => candidata.nome === estado.tarefa)
      : undefined;
  const etapas =
    skill === undefined || skill.etapas.length === 0 ? undefined : etapasVistas(skill.etapas, estado.itens, emTurno);
  const deTarefa = estado.tarefa !== undefined;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-border border-b px-4 py-2 text-sm">
        <p className="min-w-0 truncate">
          <span className="font-semibold">{skill?.titulo ?? estado.titulo ?? "Conversa"}</span>
          <span className="text-muted-foreground"> · {DESCRICOES[estado.provider].nome}</span>
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" aria-pressed={pastaAberta} onClick={aoAlternarPasta}>
            {pastaAberta ? <FolderOpenIcon /> : <FolderIcon />} Pasta da tarefa
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // A tarefa nova começa no Início. Sai da tela antes de esvaziar a conversa, para o efeito que
              // acompanha a URL não trazer a tela de volta.
              if (deTarefa) void navegar({ to: "/" }).then(() => conversa.nova());
              else conversa.nova();
            }}
          >
            <PlusIcon /> {deTarefa ? "Nova tarefa" : "Nova conversa"}
          </Button>
        </div>
      </div>
      {/* A caixa de pedido flutua sobre o fim da conversa: fica presa ao pé da rolagem (sticky), e a conversa
          passa por baixo dela; rolada até o fim, a última mensagem fica acima da caixa. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className="mx-auto flex w-full max-w-3xl shrink-0 grow flex-col gap-4 px-4 pt-6 pb-4"
          role="log"
          aria-label="Mensagens"
        >
          {etapas === undefined || skill === undefined ? null : (
            <IndicadorEtapas titulo={skill.titulo} etapas={etapas} />
          )}
          {estado.itens.length === 0 ? (
            <p className="text-center text-muted-foreground">Conversa aberta. Escreva sua pergunta abaixo.</p>
          ) : null}
          {estado.fase === "pronta" && estado.estadoServidor === "caiu" ? (
            <p className="text-center text-muted-foreground text-sm">
              A IA parou de funcionar na última resposta. A próxima mensagem retoma a conversa de onde parou.
            </p>
          ) : null}
          {emBlocos(estado.itens, turnoAberto).map((bloco) =>
            bloco.tipo === "item" ? (
              <ItemConversa key={bloco.item.chave} item={bloco.item} aoAbrirLink={aoAbrirLink} />
            ) : bloco.tipo === "ferramentas" ? (
              <DetalhesTecnicos key={bloco.chave} itens={bloco.itens} aoAbrirLink={aoAbrirLink} />
            ) : (
              <Avaliacao
                key={bloco.chave}
                turno={bloco.turno}
                nota={estado.avaliacoes[bloco.turno]}
                aoAvaliar={(turno, nota) => void conversa.avaliar(turno, nota)}
              />
            ),
          )}
          {estado.fase === "respondendo" && ultimo?.tipo === "pessoa" ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner size="sm" /> Pensando…
            </p>
          ) : null}
        </div>
        <div className="pointer-events-none sticky bottom-0 z-10 mx-auto w-full max-w-3xl shrink-0 bg-linear-to-t from-30% from-background to-transparent px-4 pt-3 pb-4">
          <Compositor />
        </div>
        <RolarParaOFim sinal={`${estado.itens.length}:${tamanhoUltimo}`} />
      </div>
    </div>
  );
}

/** A barra lateral: as conversas gravadas. */
function BarraConversas() {
  const [estado] = useConversa();
  return (
    <nav
      aria-label="Conversas gravadas"
      className="hidden h-full w-64 shrink-0 flex-col gap-3 overflow-y-auto border-border border-r p-3 md:flex"
    >
      <h2 className="px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Conversas</h2>
      <ListaConversas atual={estado.sessao} atualizar={`${estado.sessao ?? ""}:${estado.fase}`} />
    </nav>
  );
}

function TelaConversa() {
  const [estado, conversa] = useConversa();
  const { id } = Route.useSearch();
  const navegar = useNavigate({ from: "/conversa" });
  // O painel ao lado (leitura ou pasta) é da conversa em que foi aberto: trocar de conversa o fecha.
  const [painel, setPainel] = useState<{
    readonly sessao?: string;
    readonly links: ReadonlyArray<string>;
    readonly pasta: boolean;
  }>({ links: [], pasta: false });
  const daConversa = painel.sessao === estado.sessao;
  const leitura = daConversa ? painel.links : [];
  const pastaAberta = daConversa && painel.pasta && leitura.length === 0;
  const mudarPainel = (
    mudar: (atual: { links: ReadonlyArray<string>; pasta: boolean }) => {
      links: ReadonlyArray<string>;
      pasta: boolean;
    },
  ) =>
    setPainel((anterior) => ({
      ...(estado.sessao === undefined ? {} : { sessao: estado.sessao }),
      ...mudar(anterior.sessao === estado.sessao ? anterior : { links: [], pasta: false }),
    }));
  const setLeitura = (mudar: (links: ReadonlyArray<string>) => ReadonlyArray<string>) =>
    mudarPainel((atual) => ({ ...atual, links: mudar(atual.links) }));
  const abrirLink = (link: string) => setLeitura((historico) => [...historico, link]);
  const alternarPasta = () =>
    mudarPainel((atual) => ({ links: [], pasta: !(atual.pasta && atual.links.length === 0) }));

  // A URL manda: um id que não é o da conversa corrente abre aquela conversa.
  useEffect(() => {
    if (id !== undefined && id !== conversa.obter().sessao) void conversa.abrir(id);
  }, [id, conversa]);
  // E a URL acompanha a conversa corrente (a que acabou de começar, ou nenhuma depois de "Nova"). Se o
  // efeito de cima acabou de abrir a conversa da URL, `estado` ainda é o da renderização anterior: o
  // controle já está noutra sessão, e a URL fica.
  useEffect(() => {
    const atual = estado.sessao;
    if (atual === id || conversa.obter().sessao !== atual) return;
    void navegar({ search: atual === undefined ? {} : { id: atual }, replace: true });
  }, [estado.sessao, id, conversa, navegar]);

  let conteudo: ReactNode;
  if (estado.fase === "carregando") {
    conteudo = (
      <p className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
        <Spinner /> Abrindo a conversa…
      </p>
    );
  } else if (estado.fase === "configurando" || estado.fase === "iniciando") {
    conteudo = (
      <div className="h-full flex-1 overflow-y-auto">
        <FormularioInicio />
      </div>
    );
  } else {
    conteudo = (
      <>
        <Conversa aoAbrirLink={abrirLink} pastaAberta={pastaAberta} aoAlternarPasta={alternarPasta} />
        {pastaAberta && estado.sessao !== undefined ? (
          <div className="h-full w-[min(26rem,45vw)] shrink-0">
            <PainelPasta
              sessao={estado.sessao}
              atualizar={`${estado.fase}:${estado.itens.length}`}
              emTurno={estado.fase === "respondendo" || estado.fase === "interrompendo"}
              aoFechar={alternarPasta}
            />
          </div>
        ) : null}
        {leitura.length === 0 ? null : (
          <div className="h-full w-[min(32rem,45vw)] shrink-0">
            <PainelLeitura
              historico={leitura}
              aoAbrirLink={abrirLink}
              aoVoltar={() => setLeitura((historico) => historico.slice(0, -1))}
              aoFechar={() => setLeitura(() => [])}
            />
          </div>
        )}
      </>
    );
  }
  return (
    <div className="flex h-full">
      <BarraConversas />
      {conteudo}
    </div>
  );
}
