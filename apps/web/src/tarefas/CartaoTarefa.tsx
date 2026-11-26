/**
 * Uma tarefa no Início e em "Todas as tarefas". O clique depende da abertura: a de conversa abre o
 * formulário; a de módulo, a tela do módulo; a de link, o navegador do sistema, e o cartão diz isso e
 * mostra o domínio de destino; se o link não abre, o cartão diz. Sem borda: o título e o resumo, e o
 * título fica grifado ao passar o mouse ou receber o foco.
 */
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import type { MensagemErro } from "../conexao/erros.ts";
import { abrirLinkDaTarefa, dominioDoLink, ROTAS_MODULO } from "./abrir.ts";
import type { Tarefa } from "./catalogo.ts";

const CLASSE =
  "group flex h-full flex-col gap-1 rounded-xl px-3.5 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CartaoTarefa({ tarefa, paraVoce = false }: { readonly tarefa: Tarefa; readonly paraVoce?: boolean }) {
  const { abre: abertura } = tarefa;
  // A falha ao abrir o link, dita no próprio cartão.
  const [erro, setErro] = useState<MensagemErro>();
  /** Abre o link pelo caminho de link externo do app (no desktop, o navegador do sistema). */
  const aoClicarNoLink = (evento: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (evento.defaultPrevented || evento.button !== 0) return;
    evento.preventDefault();
    setErro(undefined);
    void abrirLinkDaTarefa(url).then(setErro);
  };
  const conteudo: ReactNode = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2.5 font-bold text-heading tracking-tight">
        <span className="rounded-xs group-hover:bg-grifo group-hover:shadow-[0_0_0_3px_var(--grifo)] group-focus-visible:bg-grifo group-focus-visible:shadow-[0_0_0_3px_var(--grifo)]">
          {tarefa.titulo}
        </span>
        {paraVoce ? <span className="font-medium text-micro text-muted-foreground">Para a sua função</span> : null}
      </span>
      <span className="line-clamp-3 text-muted-foreground text-sm">{tarefa.resumo}</span>
      {abertura.tipo === "link" ? (
        <span className="flex items-center gap-1.5 text-micro text-muted-foreground" data-destino-link>
          <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
          Abre no navegador: {dominioDoLink(abertura.url)}
          {abertura.requerLogin ? " (pede o seu login de lá)" : ""}
        </span>
      ) : null}
      {erro === undefined ? null : (
        <span role="alert" className="text-destructive-foreground text-small" data-erro-link>
          {erro.texto}
        </span>
      )}
    </>
  );
  switch (abertura.tipo) {
    case "link":
      return (
        <a
          href={abertura.url}
          target="_blank"
          rel="noopener noreferrer"
          className={CLASSE}
          data-tarefa={tarefa.id}
          onClick={(evento) => aoClicarNoLink(evento, abertura.url)}
        >
          {conteudo}
        </a>
      );
    case "modulo":
      return (
        <Link to={ROTAS_MODULO[abertura.modulo]} className={CLASSE} data-tarefa={tarefa.id}>
          {conteudo}
        </Link>
      );
    case "conversa":
      return (
        <Link to="/tarefa/$nome" params={{ nome: tarefa.id }} className={CLASSE} data-tarefa={tarefa.id}>
          {conteudo}
        </Link>
      );
  }
}
