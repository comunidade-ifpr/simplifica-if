/**
 * "Continuar de onde parou", no Início (`docs/plans/multitarefa.md`, "Continuidade"): o que está rodando e o
 * que terminou sem ser visto (as atividades, `atividades/ControleAtividades.ts`), o que ficou aberto no
 * painel (o documento do Ler e a conversa ao lado) e o que cada módulo põe aqui (`extras`: a última revisão
 * de PPC, que o Início compõe). A seção some quando não há nada.
 */
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon, MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconeDoItem, situacaoDoItem, useAgora } from "../atividades/EmAndamento.tsx";
import { useAtividades, usePainel } from "../contexto.tsx";
import { linkAtual } from "../leitor/historico.ts";
import { nomeCurtoLink } from "../tarefas/textos.ts";

const classeItem =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Item({
  icone,
  titulo,
  situacao,
  aoAbrir,
}: {
  readonly icone: ReactNode;
  readonly titulo: string;
  readonly situacao: string;
  readonly aoAbrir: () => void;
}) {
  return (
    <li data-continuar>
      <button type="button" className={classeItem} onClick={aoAbrir}>
        <span className="flex size-4 shrink-0 items-center justify-center">{icone}</span>
        <span className="min-w-0 truncate font-medium" data-conteudo>
          {titulo}
        </span>
        <span className="shrink-0 text-muted-foreground text-micro">{situacao}</span>
      </button>
    </li>
  );
}

export function ContinuarDeOndeParou({ extras }: { readonly extras?: ReactNode }) {
  const { atividades } = useAtividades();
  const [painel, controle] = usePainel();
  const navegar = useNavigate();
  // "respondendo há 40 s", que anda (como na bandeja do cabeçalho); sem ele, o relógio fica parado.
  const agora = useAgora(atividades.some((a) => a.situacao === "andamento" && a.detalhe === undefined));
  const lendo = linkAtual(painel.historico);
  const aoLado = painel.conversa.id;
  const aoLadoNaLista = aoLado !== undefined && atividades.some((a) => a.id === `conversa:${aoLado}`);
  return (
    // Sem nenhum item (nem o dos módulos), a seção some.
    <section aria-labelledby="titulo-continuar" className="hidden flex-col gap-2 has-[[data-continuar]]:flex">
      <h2 id="titulo-continuar" className="text-title">
        Continuar de onde parou
      </h2>
      <ul className="-mx-2 flex flex-col empty:hidden">
        {atividades.map((atividade) => (
          <Item
            key={atividade.id}
            icone={<IconeDoItem atividade={atividade} />}
            titulo={atividade.titulo}
            situacao={situacaoDoItem(atividade, agora)}
            aoAbrir={() => void navegar({ href: atividade.rota })}
          />
        ))}
        {lendo === undefined ? null : (
          <Item
            icone={<FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />}
            titulo={nomeCurtoLink(lendo)}
            situacao="aberto no painel"
            aoAbrir={() => controle.mostrar("ler")}
          />
        )}
        {aoLado === undefined || aoLadoNaLista ? null : (
          <Item
            icone={<MessageSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />}
            titulo="Conversa ao lado"
            situacao="aberta no painel"
            aoAbrir={() => controle.mostrar("conversar")}
          />
        )}
      </ul>
      {extras}
    </section>
  );
}
