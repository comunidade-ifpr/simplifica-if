/**
 * Selecionar vários itens de uma lista para apagar de uma vez (as conversas, as revisões recentes): o
 * estado da seleção (`useSelecao`) e a barra acima da lista (`BarraSelecao`), com "Selecionar", a contagem,
 * "Marcar todas", "Apagar" e "Cancelar". Os itens que somem da lista saem da seleção.
 */
import { CheckSquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button.tsx";

export interface Selecao {
  readonly ativa: boolean;
  /** Os ids selecionados que ainda estão na lista. */
  readonly ids: ReadonlyArray<string>;
  readonly marcada: (id: string) => boolean;
  readonly alternar: (id: string) => void;
  readonly comecar: () => void;
  readonly todas: () => void;
  readonly encerrar: () => void;
}

/** A seleção sobre os `visiveis` (os ids da lista, na ordem). */
export function useSelecao(visiveis: ReadonlyArray<string>): Selecao {
  const [ativa, setAtiva] = useState(false);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const ids = visiveis.filter((id) => marcados.has(id));
  return {
    // Com menos de dois itens não há o que selecionar: a lista volta ao normal.
    ativa: ativa && visiveis.length >= 2,
    ids,
    marcada: (id) => marcados.has(id),
    alternar: (id) =>
      setMarcados((atuais) => {
        const proximos = new Set(atuais);
        if (!proximos.delete(id)) proximos.add(id);
        return proximos;
      }),
    comecar: () => setAtiva(true),
    todas: () => setMarcados(ids.length === visiveis.length ? new Set() : new Set(visiveis)),
    encerrar: () => {
      setAtiva(false);
      setMarcados(new Set());
    },
  };
}

export function BarraSelecao({
  selecao,
  total,
  nomes,
  aoApagar,
}: {
  readonly selecao: Selecao;
  /** Quantos itens a lista mostra. */
  readonly total: number;
  /** O nome do item, no singular e no plural ("conversa", "conversas"). */
  readonly nomes: readonly [string, string];
  readonly aoApagar: () => void;
}) {
  const [um, varios] = nomes;
  // O botão que se clicou some ao trocar de modo: o foco vai para o primeiro botão do outro modo.
  const entrou = useRef<HTMLButtonElement>(null);
  const saiu = useRef<HTMLButtonElement>(null);
  const antes = useRef(selecao.ativa);
  useEffect(() => {
    if (antes.current === selecao.ativa) return;
    antes.current = selecao.ativa;
    (selecao.ativa ? entrou : saiu).current?.focus();
  }, [selecao.ativa]);
  if (!selecao.ativa) {
    if (total < 2) return null;
    return (
      <div className="flex justify-end">
        <Button ref={saiu} variant="ghost" size="xs" onClick={selecao.comecar}>
          <CheckSquareIcon /> Selecionar
        </Button>
      </div>
    );
  }
  const n = selecao.ids.length;
  return (
    <div role="group" aria-label={`Selecionar ${varios}`} className="flex flex-wrap items-center gap-1 px-1">
      <span className="mr-auto text-muted-foreground text-small" aria-live="polite">
        {n === 0 ? `Nenhuma ${um} marcada` : n === 1 ? `1 ${um} marcada` : `${n} ${varios} marcadas`}
      </span>
      <Button ref={entrou} variant="ghost" size="xs" onClick={selecao.todas}>
        {n === total ? "Desmarcar todas" : "Marcar todas"}
      </Button>
      <Button variant="destructive" size="xs" disabled={n === 0} onClick={aoApagar}>
        <Trash2Icon /> Apagar
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Cancelar a seleção"
        title="Cancelar"
        onClick={selecao.encerrar}
      >
        <XIcon />
      </Button>
    </div>
  );
}
