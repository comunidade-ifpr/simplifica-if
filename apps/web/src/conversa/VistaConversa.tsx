/**
 * A vista de uma conversa (`docs/plans/multitarefa.md`, "A vista"): as mensagens, as etapas da tarefa, as
 * ferramentas recolhidas em "Detalhes técnicos", a avaliação de cada resposta com "Isto está errado" e, presa
 * ao pé da rolagem, a caixa que quem a usa põe (a da tela cheia, com anexos; a do painel, com as fichas).
 * Recebe o controle da conversa por prop: a rota `/conversa` e a aba Conversar do painel usam a mesma vista,
 * cada uma com o controle que pegou no `GerenteConversas`. Os itens (a aprovação, em `ItemConversa`) acham o
 * controle pelo contexto da vista, e o cartão do limite e o "Continuada com…", o que fazer com a conversa que
 * continua esta (`aoContinuar`: a tela cheia vai a ela; o painel a troca na aba).
 *
 * Mostrar a conversa a marca como vista (`conversa.marcarVista`), ao abrir e a cada resposta que termina
 * à vista, com a janela visível e em foco (ou quando a pessoa volta a ela): a bandeja deixa de dizer
 * "resposta pronta". A vista também diz ao `GerenteConversas` que a conversa está na tela (`mostrar`).
 */
import { WrenchIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Avaliacao } from "../components/Avaliacao.tsx";
import { IndicadorEtapas } from "../components/IndicadorEtapas.tsx";
import { ItemConversa } from "../components/ItemConversa.tsx";
import { RelatoErro } from "../components/RelatoErro.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { useApp, useEstadoConversa } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import type { AoAbrirLink } from "../painel/abrirLink.ts";
import { useCatalogo } from "../tarefas/catalogo.ts";
import type { ControleConversa } from "./ControleConversa.ts";
import { type AoContinuar, ContextoContinuar, ContextoControle } from "./controleDaVista.ts";
import { DESCRICOES } from "../providers.ts";
import { type Item, rotuloFerramenta } from "./estado.ts";
import { etapasVistas } from "./etapas.ts";

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
 * técnicos"), e depois da última resposta de cada turno fechado vem a avaliação. O turno é o do item
 * (o do servidor).
 */
function emBlocos(itens: ReadonlyArray<Item>, turnoAberto: number | undefined): ReadonlyArray<Bloco> {
  const ultimaResposta = new Map<number, string>();
  for (const item of itens) if (item.tipo === "resposta") ultimaResposta.set(item.turno, item.chave);
  const blocos: Array<Bloco> = [];
  for (const item of itens) {
    const { turno } = item;
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
  readonly aoAbrirLink: AoAbrirLink;
}) {
  const rodando = itens.find((item) => item.situacao === "andamento");
  const consultas = itens.length === 1 ? "1 consulta" : `${itens.length} consultas`;
  return (
    <details className="group text-sm" data-detalhes-tecnicos>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rodando === undefined ? <WrenchIcon aria-hidden className="size-3.5" /> : <Spinner size="sm" tone="muted" />}
        {rodando === undefined
          ? `Detalhes técnicos · ${consultas}`
          : `Consultando a base: ${rotuloFerramenta(rodando)}…`}
      </summary>
      <div className="mt-2 flex flex-col gap-2 border-border border-l-2 pl-3">
        {itens.map((item) => (
          <ItemConversa key={item.chave} item={item} aoAbrirLink={aoAbrirLink} />
        ))}
      </div>
    </details>
  );
}

export function VistaConversa({
  controle,
  aoAbrirLink,
  caixa,
  aoContinuar,
  estreita = false,
}: {
  readonly controle: ControleConversa;
  readonly aoAbrirLink: AoAbrirLink;
  /** A conversa nova que continua esta com outra IA (o cartão do limite). */
  readonly aoContinuar: AoContinuar;
  /** A caixa de mensagem, presa ao pé da rolagem. */
  readonly caixa: ReactNode;
  /** No painel: menos margem, a coluna inteira. */
  readonly estreita?: boolean;
}) {
  const estado = useEstadoConversa(controle);
  const catalogo = useCatalogo();
  const ultimo = estado.itens.at(-1);
  const tamanhoUltimo = ultimo?.tipo === "resposta" ? ultimo.texto.length : 0;
  const emTurno = estado.fase === "respondendo" || estado.fase === "interrompendo";
  const turnoAberto = emTurno ? estado.turno : undefined;
  const tarefa =
    catalogo.fase === "pronto" && estado.tarefa !== undefined
      ? catalogo.tarefas.find((candidata) => candidata.id === estado.tarefa)
      : undefined;
  const declaradas = tarefa?.abre.tipo === "conversa" ? tarefa.abre.etapas : [];
  const etapas = declaradas.length === 0 ? undefined : etapasVistas(declaradas, estado.itens, emTurno);
  // O relato aberto é da conversa em que foi aberto.
  const [relato, setRelato] = useState<{ readonly sessao?: string; readonly turno: number }>();
  const turnoRelato = relato !== undefined && relato.sessao === estado.sessao ? relato.turno : undefined;
  const coluna = estreita ? "w-full px-3" : "mx-auto w-full max-w-(--page-narrow) px-4";
  const sessao = estado.sessao;
  const emRepouso = estado.fase === "pronta";
  const turno = estado.turno;
  const { conversas } = useApp();
  useEffect(() => (sessao === undefined ? undefined : conversas.mostrar(sessao)), [conversas, sessao]);
  useEffect(() => {
    if (sessao === undefined || !emRepouso) return;
    // Só a janela à vista e em foco mostra a conversa: a resposta que termina com a pessoa no Word fica
    // "pronta" (a bandeja, o selo e o aviso) até ela voltar à janela.
    let pendente = true;
    const marcarSeVista = () => {
      if (!pendente || document.visibilityState !== "visible" || !document.hasFocus()) return;
      pendente = false;
      void controle.marcarVista();
    };
    marcarSeVista();
    window.addEventListener("focus", marcarSeVista);
    document.addEventListener("visibilitychange", marcarSeVista);
    return () => {
      window.removeEventListener("focus", marcarSeVista);
      document.removeEventListener("visibilitychange", marcarSeVista);
    };
    // `turno` é só o gatilho: cada resposta que termina à vista marca de novo.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [controle, sessao, emRepouso, turno]);

  return (
    <ContextoControle value={controle}>
      <ContextoContinuar value={aoContinuar}>
        {/* A caixa de pedido flutua sobre o fim da conversa: fica presa ao pé da rolagem (sticky), e a conversa
          passa por baixo dela; rolada até o fim, a última mensagem fica acima da caixa. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div
            className={cn(coluna, "flex shrink-0 grow flex-col gap-4 pb-4", estreita ? "pt-3" : "pt-6")}
            role="log"
            aria-label="Mensagens"
          >
            {etapas === undefined || tarefa === undefined ? null : (
              <IndicadorEtapas titulo={tarefa.titulo} etapas={etapas} />
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
                <div key={bloco.chave} className="flex flex-col gap-2">
                  <Avaliacao
                    turno={bloco.turno}
                    nota={estado.avaliacoes[bloco.turno]}
                    aoAvaliar={(turno, nota) => void controle.avaliar(turno, nota)}
                    relatoAberto={turnoRelato === bloco.turno}
                    aoApontarErro={(turno) =>
                      setRelato(
                        turnoRelato === turno
                          ? undefined
                          : { ...(estado.sessao === undefined ? {} : { sessao: estado.sessao }), turno },
                      )
                    }
                  />
                  {turnoRelato === bloco.turno && estado.sessao !== undefined ? (
                    <RelatoErro
                      sessao={estado.sessao}
                      turno={bloco.turno}
                      // O relato enviado marca o 👎 da resposta.
                      aoRegistrado={() => {
                        if (estado.avaliacoes[bloco.turno] !== "nao_util")
                          void controle.avaliar(bloco.turno, "nao_util");
                      }}
                      aoFechar={() => setRelato(undefined)}
                    />
                  ) : null}
                </div>
              ),
            )}
            {estado.continuadaCom === undefined ? null : (
              <p className="text-muted-foreground text-sm" data-continuada>
                Continuada com o {DESCRICOES[estado.continuadaCom.provider].curto}.{" "}
                {/* Como o cartão do limite: a tela cheia vai à conversa nova, e o painel a troca na aba. */}
                <button
                  type="button"
                  className="link-grifo"
                  onClick={() => aoContinuar({ sessao: estado.continuadaCom!.id, continuacao: undefined })}
                >
                  Abrir a conversa
                </button>
              </p>
            )}
            {estado.fase === "respondendo" && (ultimo?.tipo === "pessoa" || ultimo?.tipo === "pasta") ? (
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner size="sm" /> Pensando…
              </p>
            ) : null}
          </div>
          <div
            className={cn(
              coluna,
              "pointer-events-none sticky bottom-0 z-10 shrink-0 bg-linear-to-t from-30% from-background to-transparent pt-3",
              estreita ? "pb-3" : "pb-4",
            )}
          >
            {caixa}
          </div>
          <RolarParaOFim sinal={`${estado.itens.length}:${tamanhoUltimo}`} />
        </div>
      </ContextoContinuar>
    </ContextoControle>
  );
}
