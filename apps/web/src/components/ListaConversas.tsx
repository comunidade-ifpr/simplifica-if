/**
 * As conversas gravadas no servidor (`conversa.listar`), da mais recente para a mais antiga: o título
 * (a primeira mensagem), a IA, a data e, quando importa, o estado da sessão. Cada uma abre a conversa
 * em `/conversa?id=…`. Recarrega quando `atualizar` muda (a conversa corrente, o fim de um turno).
 */
import type { EstadoConversa, ResumoConversa } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { MessageSquareTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import { cn } from "../lib/utils.ts";
import { DESCRICOES } from "../providers.ts";
import { AvisoErro } from "./AvisoErro.tsx";
import { Badge } from "./ui/badge.tsx";
import { Spinner } from "./ui/spinner.tsx";

type Lista =
  | { readonly fase: "carregando" }
  | { readonly fase: "pronta"; readonly conversas: ReadonlyArray<ResumoConversa> }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** O estado da sessão, quando a pessoa precisa saber dele. */
const ROTULOS_ESTADO: Partial<Record<EstadoConversa, string>> = {
  respondendo: "Respondendo",
  caiu: "A IA parou; retoma na próxima mensagem",
};

export function ListaConversas({
  atual,
  atualizar,
  limite,
}: {
  /** O id da conversa aberta, destacada na lista. */
  readonly atual?: string | undefined;
  /** Qualquer valor que, quando muda, faz a lista recarregar. */
  readonly atualizar?: string;
  /** Quantas mostrar (todas, sem ele). */
  readonly limite?: number;
}) {
  const api = useApi();
  const conexao = useEstadoConexao();
  const [lista, setLista] = useState<Lista>({ fase: "carregando" });
  const conectado = conexao.fase === "conectada";

  useEffect(() => {
    if (!conectado) return;
    let vale = true;
    api
      .chamar((cliente) => cliente["conversa.listar"]({}))
      .then(
        (conversas) => vale && setLista({ fase: "pronta", conversas }),
        (erro: unknown) => vale && setLista({ fase: "falhou", erro: explicarErro(erro) }),
      );
    return () => {
      vale = false;
    };
    // `atualizar` é só o gatilho da recarga (a conversa corrente mudou, um turno acabou): o corpo não o lê.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, conectado, atualizar]);

  if (lista.fase === "carregando") {
    return (
      <p className="flex items-center gap-2 px-2 text-muted-foreground text-sm">
        <Spinner size="sm" /> Carregando as conversas…
      </p>
    );
  }
  if (lista.fase === "falhou") return <AvisoErro erro={lista.erro} />;
  const conversas = limite === undefined ? lista.conversas : lista.conversas.slice(0, limite);
  if (conversas.length === 0) {
    return <p className="px-2 text-muted-foreground text-sm">Nenhuma conversa ainda.</p>;
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Conversas">
      {conversas.map((conversa) => {
        const rotulo = ROTULOS_ESTADO[conversa.estado];
        return (
          <li key={conversa.id}>
            <Link
              to="/conversa"
              search={{ id: conversa.id }}
              aria-current={conversa.id === atual ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                conversa.id === atual && "bg-primary/8",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <MessageSquareTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" data-conteudo={conversa.titulo ? "" : undefined}>
                  {conversa.titulo || "Conversa sem mensagens"}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
                <span>{DESCRICOES[conversa.provider].nome}</span>
                <span>{FORMATO_DATA.format(new Date(conversa.atualizadaEm))}</span>
                {rotulo === undefined ? null : (
                  <Badge variant={conversa.estado === "caiu" ? "warning" : "info"} size="sm">
                    {rotulo}
                  </Badge>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
