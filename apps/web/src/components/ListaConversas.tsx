/**
 * As conversas gravadas no servidor (`conversa.listar`), da mais recente para a mais antiga: o título
 * (a primeira mensagem), a IA, a data e, quando importa, o estado da sessão. Cada uma abre a conversa
 * em `/conversa?id=…`, e o ⋯ ao lado apaga (`ApagarConversa`). Recarrega quando `atualizar` muda (a
 * conversa corrente, o fim de um turno) e depois de apagar.
 */
import type { EstadoConversa, ResumoConversa } from "@simplifica-if/contratos-app";
import { Link } from "@tanstack/react-router";
import { EllipsisIcon, MessageSquareTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import { dataHora } from "../lib/formato.ts";
import { cn } from "../lib/utils.ts";
import { DESCRICOES } from "../providers.ts";
import { ApagarConversa, type ConversaParaApagar } from "../apagar/ApagarConversa.tsx";
import { AvisoErro } from "./AvisoErro.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu.tsx";
import { Spinner } from "./ui/spinner.tsx";

type Lista =
  | { readonly fase: "carregando" }
  | { readonly fase: "pronta"; readonly conversas: ReadonlyArray<ResumoConversa> }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

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
  const [apagando, setApagando] = useState<ConversaParaApagar | null>(null);
  const [apagadas, setApagadas] = useState(0);
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
    // `atualizar` e `apagadas` são só gatilhos da recarga (a conversa corrente mudou, um turno acabou, uma
    // conversa saiu): o corpo não os lê.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, conectado, atualizar, apagadas]);

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
    <>
      <ul className="flex flex-col gap-1" aria-label="Conversas">
        {conversas.map((conversa) => {
          const rotulo = ROTULOS_ESTADO[conversa.estado];
          const titulo = conversa.titulo || "Conversa sem mensagens";
          return (
            <li
              key={conversa.id}
              className={cn(
                "group flex items-start gap-1 rounded-md hover:bg-accent",
                conversa.id === atual && "bg-primary/8",
              )}
            >
              <Link
                to="/conversa"
                search={{ id: conversa.id }}
                aria-current={conversa.id === atual ? "page" : undefined}
                className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <MessageSquareTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate" data-conteudo={conversa.titulo ? "" : undefined}>
                    {titulo}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-micro">
                  <span>{DESCRICOES[conversa.provider].nome}</span>
                  <span>{dataHora(conversa.atualizadaEm)}</span>
                  {rotulo === undefined ? null : (
                    <Badge variant={conversa.estado === "caiu" ? "warning" : "info"} size="sm">
                      {rotulo}
                    </Badge>
                  )}
                </span>
              </Link>
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Mais ações da conversa “${titulo}”`}
                      // O rótulo leva o título, que é texto da pessoa.
                      data-conteudo={conversa.titulo ? "" : undefined}
                      title="Mais ações"
                      className="mt-1 mr-1 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
                    />
                  }
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup>
                  <MenuItem
                    className="text-destructive-foreground"
                    onClick={() =>
                      setApagando({ id: conversa.id, titulo: conversa.titulo, provider: conversa.provider })
                    }
                  >
                    Apagar…
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </li>
          );
        })}
      </ul>
      <ApagarConversa
        conversa={apagando}
        aoFechar={() => setApagando(null)}
        aoApagada={() => setApagadas((n) => n + 1)}
      />
    </>
  );
}
