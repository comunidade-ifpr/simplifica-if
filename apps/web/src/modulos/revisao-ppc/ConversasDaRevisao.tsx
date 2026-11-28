/**
 * "Conversas desta revisão" (`docs/plans/multitarefa.md`, "Conversa ao lado", decisão 12): as conversas ao
 * lado da revisão aberta, na ordem em que se abriram, cada uma pelo título (e pela pendência de que nasceu,
 * quando ela ainda está na lista), que abre no painel, na aba Conversar; e "Nova conversa sobre esta
 * revisão", o rascunho de uma conversa geral nova com a ficha do PPC. Na tela inteira, fica na coluna dos
 * temas (abaixo de 960 px, no pé da lista); na coluna ao lado do Word, recolhida acima da caixa curta, onde
 * a conversa aberta cobre a coluna (o painel) e a nova fica na caixa curta.
 *
 * A conversa sem título ainda (a primeira mensagem dá o título, e a tela relê a lista depois do envio) aparece
 * pela pendência, ou como "Conversa sobre a revisão". A apagada nesta execução (também em outra janela, quando
 * esta janela fica sabendo) sai daqui na hora; a lista do servidor já não a traz depois. `aoEscolher`: a
 * pessoa escolheu uma conversa (ou a nova), que a coluna compacta não troca pela da pendência aberta.
 */
import { MessageSquareIcon, PlusIcon } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { Button } from "../../components/ui/button.tsx";
import { useApp } from "../../contexto.tsx";
import { useRevisao } from "./contexto.ts";
import { conversasVivas, pedidoDaConversa, pedidoDeConversaNova } from "./conversa.ts";

export function ConversasDaRevisao({
  compacta = false,
  aoEscolher,
}: {
  readonly compacta?: boolean;
  readonly aoEscolher?: () => void;
}) {
  const [estado] = useRevisao();
  const app = useApp();
  const idTitulo = useId();
  // Redesenha quando uma conversa passa a apagada (`conversasVivas` a tira).
  useSyncExternalStore(app.conversas.observarApagadas, app.conversas.quantasApagadas);
  const lista = estado.lista;
  if (lista === undefined) return null;
  const conversas = conversasVivas(lista, app.conversas);

  const abrir = (conversa: (typeof conversas)[number]) => {
    const pedido = pedidoDaConversa(app, conversa);
    if (pedido === undefined) return;
    app.painel.conversar(pedido);
    aoEscolher?.();
  };
  const nova = () => {
    const pedido = pedidoDeConversaNova(app);
    if (pedido === undefined) return;
    app.painel.conversar(pedido, { mostrar: !compacta });
    aoEscolher?.();
  };

  const itens = conversas.map((c) => {
    const pendencia =
      c.pendencia === null ? undefined : lista.pendencias.find((v) => v.chave === c.pendencia)?.pendencia.titulo;
    const titulo = c.titulo.trim() || pendencia || "Conversa sobre a revisão";
    return (
      <li key={c.conversa}>
        <button
          type="button"
          onClick={() => abrir(c)}
          className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-small outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageSquareIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-2 break-words">{titulo}</span>
            {pendencia === undefined || titulo === pendencia ? null : (
              <span className="line-clamp-1 text-muted-foreground text-micro">Pendência: {pendencia}</span>
            )}
          </span>
        </button>
      </li>
    );
  });
  const botaoNova = (
    <Button size="sm" variant="ghost" className="self-start" onClick={nova}>
      <PlusIcon /> Nova conversa sobre esta revisão
    </Button>
  );

  if (compacta)
    return (
      <details className="group px-1 pb-2 text-small">
        <summary className="cursor-pointer text-muted-foreground">
          Conversas desta revisão{conversas.length === 0 ? "" : ` (${conversas.length})`}
        </summary>
        <div className="flex flex-col gap-1 pt-1">
          {itens.length === 0 ? null : <ul className="flex max-h-40 flex-col overflow-y-auto">{itens}</ul>}
          {botaoNova}
        </div>
      </details>
    );

  return (
    <section aria-labelledby={idTitulo} className="flex flex-col gap-1">
      <h2 id={idTitulo} className="px-2 font-semibold text-small">
        Conversas desta revisão
      </h2>
      {itens.length === 0 ? (
        <p className="px-2 text-muted-foreground text-small">
          Nenhuma ainda. “Conversar sobre esta pendência” abre uma para cada pendência.
        </p>
      ) : (
        <ul className="flex flex-col">{itens}</ul>
      )}
      {botaoNova}
    </section>
  );
}
