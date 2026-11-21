/** O cartão de uma tarefa no Início e em "Todas as tarefas": a skill abre o formulário; a nativa, a tela dela. */
import { Link } from "@tanstack/react-router";
import { FileSearchIcon, SparklesIcon } from "lucide-react";
import { nomeTarefa, resumoTarefa, type Tarefa, tituloTarefa } from "./catalogo.ts";

export function CartaoTarefa({ tarefa, paraVoce = false }: { readonly tarefa: Tarefa; readonly paraVoce?: boolean }) {
  const classe =
    "group flex h-full flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const conteudo = (
    <>
      <span className="flex items-center gap-2 font-semibold">
        {tarefa.tipo === "nativa" ? (
          <FileSearchIcon aria-hidden className="size-4 text-link" />
        ) : (
          <SparklesIcon aria-hidden className="size-4 text-link" />
        )}
        {tituloTarefa(tarefa)}
        {paraVoce ? (
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-micro">
            Para a sua função
          </span>
        ) : null}
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
