/**
 * As conversas gravadas no servidor (`conversa.listar`), da mais recente para a mais antiga: o título
 * (a primeira mensagem), a IA, a data e, quando importa, o estado da sessão. Cada uma abre a conversa
 * em `/conversa?id=…`, e o ⋯ ao lado apaga (`ApagarConversas`). A conversa que nasceu de outra tela (a
 * conversa ao lado de uma revisão de PPC) mostra a origem ("da
 * revisão do PPC de Enfermagem"; "revisão apagada" depois), e o ⋯ leva até ela enquanto ela existe. "Selecionar" troca os links por caixas de
 * marcar, para apagar várias de uma vez. Recarrega quando `atualizar` muda (a conversa corrente, o fim de
 * um turno), quando as atividades das conversas mudam (outra começa a responder, pede permissão, termina)
 * e depois de apagar; o selo de cada uma vem da atividade dela ("Resposta pronta", "Pede permissão").
 */
import type { Atividade, EstadoConversa, ResumoConversa } from "@simplifica-if/contratos-app";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { EllipsisIcon, MessageSquareTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { conversaDaAtividade } from "../atividades/ControleAtividades.ts";
import { useApi, useAtividades, useEstadoConexao } from "../contexto.tsx";
import { dataHora } from "../lib/formato.ts";
import { abrirEmNovaJanela, cliqueDeJanela } from "../painel/abrirLink.ts";
import { cn } from "../lib/utils.ts";
import { DESCRICOES } from "../providers.ts";
import { ApagarConversas, type ConversaParaApagar } from "../apagar/ApagarConversas.tsx";
import { BarraSelecao, useSelecao } from "../apagar/Selecao.tsx";
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

/** O selo pela atividade da conversa, que vale mais que o estado gravado. */
const SELOS_ATIVIDADE: Readonly<
  Record<Atividade["situacao"], { readonly rotulo: string; readonly variante: "info" | "warning" | "success" }>
> = {
  andamento: { rotulo: "Respondendo", variante: "info" },
  permissao: { rotulo: "Pede permissão", variante: "warning" },
  pronta: { rotulo: "Resposta pronta", variante: "success" },
  limite: { rotulo: "No limite da assinatura", variante: "warning" },
};

/** O selo de uma conversa na lista: o da atividade, senão o do estado (a queda), ou nenhum. */
function seloDe(
  conversa: ResumoConversa,
  atividade: Atividade | undefined,
): { readonly rotulo: string; readonly variante: "info" | "warning" | "success" } | undefined {
  if (atividade !== undefined) return SELOS_ATIVIDADE[atividade.situacao];
  const rotulo = ROTULOS_ESTADO[conversa.estado];
  return rotulo === undefined ? undefined : { rotulo, variante: conversa.estado === "caiu" ? "warning" : "info" };
}

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
  const navegar = useNavigate();
  const roteador = useRouter();
  const conexao = useEstadoConexao();
  const [lista, setLista] = useState<Lista>({ fase: "carregando" });
  const [apagando, setApagando] = useState<ReadonlyArray<ConversaParaApagar> | null>(null);
  const [apagadas, setApagadas] = useState(0);
  const conectado = conexao.fase === "conectada";
  const { atividades } = useAtividades();
  const atividadesPorConversa = new Map(
    atividades.flatMap((atividade) => {
      const id = conversaDaAtividade(atividade);
      return id === undefined ? [] : [[id, atividade] as const];
    }),
  );
  // A lista recarrega quando uma conversa muda de situação (o título e a data vêm com ela).
  const gatilhoAtividades = [...atividadesPorConversa]
    .map(([id, atividade]) => `${id}:${atividade.situacao}`)
    .sort()
    .join(",");
  const visiveis =
    lista.fase === "pronta" ? (limite === undefined ? lista.conversas : lista.conversas.slice(0, limite)) : [];
  const selecao = useSelecao(visiveis.map((c) => c.id));
  const paraApagar = (c: ResumoConversa): ConversaParaApagar => ({ id: c.id, titulo: c.titulo, provider: c.provider });

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
    // `atualizar`, `apagadas` e `gatilhoAtividades` são só gatilhos da recarga (a conversa corrente mudou, um
    // turno acabou, uma conversa saiu ou mudou de situação): o corpo não os lê.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [api, conectado, atualizar, apagadas, gatilhoAtividades]);

  // Em toda forma da lista: a recarga depois de apagar (vazia, com falha) não desmonta o diálogo, que ainda
  // mostra a nota e leva ao destino quando fecha.
  const dialogo = (
    <ApagarConversas
      conversas={apagando}
      aoFechar={() => setApagando(null)}
      aoApagadas={() => {
        selecao.encerrar();
        setApagadas((n) => n + 1);
      }}
    />
  );
  if (lista.fase === "carregando") {
    return (
      <>
        <p className="flex items-center gap-2 px-2 text-muted-foreground text-sm">
          <Spinner size="sm" /> Carregando as conversas…
        </p>
        {dialogo}
      </>
    );
  }
  if (lista.fase === "falhou")
    return (
      <>
        <AvisoErro erro={lista.erro} />
        {dialogo}
      </>
    );
  const conversas = visiveis;
  if (conversas.length === 0) {
    return (
      <>
        <p data-sem-conversas className="px-2 text-muted-foreground text-sm">
          Nenhuma conversa ainda.
        </p>
        {dialogo}
      </>
    );
  }
  return (
    <>
      <BarraSelecao
        selecao={selecao}
        total={conversas.length}
        nomes={["conversa", "conversas"]}
        aoApagar={() => setApagando(conversas.filter((c) => selecao.marcada(c.id)).map(paraApagar))}
      />
      <ul className="flex flex-col gap-1" aria-label="Conversas">
        {conversas.map((conversa) => {
          const selo = seloDe(conversa, atividadesPorConversa.get(conversa.id));
          const titulo = conversa.titulo || "Conversa sem mensagens";
          return (
            <li
              key={conversa.id}
              className={cn(
                "group flex items-start gap-1 rounded-md hover:bg-accent",
                conversa.id === atual && "bg-primary/8",
              )}
            >
              {selecao.ativa ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={selecao.marcada(conversa.id)}
                    onChange={() => selecao.alternar(conversa.id)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium" data-conteudo={conversa.titulo ? "" : undefined}>
                      {titulo}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-micro">
                      <span>{DESCRICOES[conversa.provider].nome}</span>
                      <span>{dataHora(conversa.atualizadaEm)}</span>
                      {selo === undefined ? null : (
                        <Badge variant={selo.variante} size="sm">
                          {selo.rotulo}
                        </Badge>
                      )}
                    </span>
                  </span>
                </label>
              ) : (
                <Link
                  to="/conversa"
                  search={{ id: conversa.id }}
                  // ⇧⌘-clique (Ctrl+Shift+clique): a conversa numa janela nova, no desktop.
                  onClick={(evento) => {
                    if (evento.button !== 0 || !cliqueDeJanela(evento)) return;
                    const rota = roteador.buildLocation({ to: "/conversa", search: { id: conversa.id } }).href;
                    if (abrirEmNovaJanela(rota)) evento.preventDefault();
                  }}
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
                    {selo === undefined ? null : (
                      <Badge variant={selo.variante} size="sm">
                        {selo.rotulo}
                      </Badge>
                    )}
                  </span>
                  {conversa.origem === undefined ? null : (
                    <span className="truncate text-muted-foreground text-micro" data-origem>
                      {conversa.origem.rotulo}
                    </span>
                  )}
                </Link>
              )}

              {selecao.ativa ? null : (
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
                    {conversa.origem?.rota == null ? null : (
                      <MenuItem onClick={() => void navegar({ href: conversa.origem!.rota! })}>
                        Ir para a origem
                      </MenuItem>
                    )}
                    <MenuItem
                      className="text-destructive-foreground"
                      onClick={() => setApagando([paraApagar(conversa)])}
                    >
                      Apagar…
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      {dialogo}
    </>
  );
}
