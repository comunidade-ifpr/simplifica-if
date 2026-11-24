/**
 * Uma tarefa no Início e em "Todas as tarefas": a skill abre o formulário; a nativa, a tela dela. Sem
 * borda nem ícone: o título e o resumo, e o título fica grifado ao passar o mouse ou receber o foco.
 */
import { Link } from "@tanstack/react-router";
import { nomeTarefa, resumoTarefa, type Tarefa, tituloTarefa } from "./catalogo.ts";

export function CartaoTarefa({ tarefa, paraVoce = false }: { readonly tarefa: Tarefa; readonly paraVoce?: boolean }) {
  const classe =
    "group flex h-full flex-col gap-1 rounded-xl px-3.5 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const conteudo = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2.5 font-bold text-heading tracking-tight">
        <span className="rounded-xs group-hover:bg-grifo group-hover:shadow-[0_0_0_3px_var(--grifo)] group-focus-visible:bg-grifo group-focus-visible:shadow-[0_0_0_3px_var(--grifo)]">
          {tituloTarefa(tarefa)}
        </span>
        {paraVoce ? <span className="font-medium text-micro text-muted-foreground">Para a sua função</span> : null}
      </span>
      <span className="line-clamp-3 text-muted-foreground text-sm">{resumoTarefa(tarefa)}</span>
    </>
  );
  return tarefa.tipo === "nativa" ? (
    <Link to={tarefa.rota} className={classe} data-tarefa={nomeTarefa(tarefa)}>
      {conteudo}
    </Link>
  ) : (
    <Link to="/tarefa/$nome" params={{ nome: tarefa.skill.nome }} className={classe} data-tarefa={nomeTarefa(tarefa)}>
      {conteudo}
    </Link>
  );
}
