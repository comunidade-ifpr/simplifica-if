/**
 * "Em andamento", no cabeçalho (`docs/plans/multitarefa.md`, "Em andamento"): o botão com a contagem, ao
 * lado do estado da conexão (e na barra da janela compacta), abre a bandeja do que está rodando ou espera a
 * pessoa. Cada item leva à rota dele (a conversa da aba Conversar abre no painel, `useAbrirRota`); as setas
 * passam de um item a outro. O pedido de aprovação de uma conversa em segundo plano vem com
 * o mesmo texto da conversa e com Permitir e Negar, sem trocar de tela.
 *
 * A região `aria-live` (`AnunciosAtividades`, na moldura) fica sempre na página: anuncia "Resposta pronta" e
 * "A IA pede permissão".
 */
import type { Atividade, Decisao } from "@simplifica-if/contratos-app";
import { CheckIcon, CircleCheckIcon, GaugeIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { AvisoErro } from "../components/AvisoErro.tsx";
import { Button } from "../components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "../components/ui/popover.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useAtividades } from "../contexto.tsx";
import { useAbrirRota } from "../painel/abrirLink.ts";
import { rotuloAprovacao } from "../conversa/estado.ts";
import { DESCRICOES } from "../providers.ts";

/** "há 40 s", "há 3 min", "há 2 h", de `desde` até `agora`. */
function haQuanto(desde: string, agora: number): string {
  const segundos = Math.max(0, Math.round((agora - Date.parse(desde)) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.round(segundos / 60);
  return minutos < 60 ? `há ${minutos} min` : `há ${Math.round(minutos / 60)} h`;
}

/** O que o item diz à direita do título. */
export function situacaoDoItem(atividade: Atividade, agora: number): string {
  switch (atividade.situacao) {
    case "andamento":
      return atividade.detalhe ?? `respondendo ${haQuanto(atividade.desde, agora)}`;
    case "permissao":
      return "pede permissão";
    case "pronta":
      return "resposta pronta";
    case "limite":
      return atividade.provider === undefined
        ? "no limite da assinatura"
        : `o ${DESCRICOES[atividade.provider].curto} chegou ao limite`;
  }
}

export function IconeDoItem({ atividade }: { readonly atividade: Atividade }) {
  switch (atividade.situacao) {
    case "andamento":
      return <Spinner size="sm" tone="muted" />;
    case "permissao":
      return <ShieldQuestionIcon aria-hidden className="size-3.5 text-warning-foreground" />;
    case "pronta":
      return <CircleCheckIcon aria-hidden className="size-3.5 text-success-foreground" />;
    case "limite":
      return <GaugeIcon aria-hidden className="size-3.5 text-warning-foreground" />;
  }
}

/** O relógio da bandeja aberta: "respondendo há 40 s" anda sozinho. */
export function useAgora(ligado: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ligado) return;
    // A primeira volta logo, para a bandeja que reabre não mostrar o tempo de quando fechou.
    const primeira = window.setTimeout(() => setAgora(Date.now()), 0);
    const relogio = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => {
      window.clearTimeout(primeira);
      window.clearInterval(relogio);
    };
  }, [ligado]);
  return agora;
}

/** O pedido de aprovação na bandeja: o texto da conversa e Permitir e Negar. */
function Aprovacao({ atividade }: { readonly atividade: Atividade }) {
  const api = useApi();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<MensagemErro>();
  const pedido = atividade.aprovacao;
  if (pedido === undefined) return null;
  const responder = async (decisao: Decisao) => {
    setEnviando(true);
    setErro(undefined);
    try {
      await api.chamar((cliente) =>
        cliente["conversa.responderAprovacao"]({ sessao: pedido.conversa, aprovacao: pedido.id, decisao }),
      );
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 pl-6 text-small">
      <p className="font-medium">
        A IA pede permissão: {rotuloAprovacao({ ferramenta: pedido.ferramenta, classe: pedido.tipo })}
      </p>
      <p className="text-muted-foreground" data-conteudo>
        {pedido.descricao}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={enviando} onClick={() => void responder("permitir")}>
          <CheckIcon /> Permitir
        </Button>
        <Button size="sm" variant="outline" disabled={enviando} onClick={() => void responder("negar")}>
          <XIcon /> Negar
        </Button>
      </div>
      {erro === undefined ? null : <AvisoErro erro={erro} />}
    </div>
  );
}

/** As setas e Home/End passam de um item a outro da bandeja. */
function aoTeclarNaLista(evento: KeyboardEvent<HTMLUListElement>) {
  const itens = [...evento.currentTarget.querySelectorAll<HTMLElement>("[data-item-atividade]")];
  // O item do foco, também quando ele está em Permitir ou Negar, dentro do item.
  const doFoco = (document.activeElement as HTMLElement | null)
    ?.closest("[data-atividade]")
    ?.querySelector<HTMLElement>("[data-item-atividade]");
  const atual = doFoco == null ? -1 : itens.indexOf(doFoco);
  const proximo =
    evento.key === "ArrowDown"
      ? Math.min(itens.length - 1, atual + 1)
      : evento.key === "ArrowUp"
        ? Math.max(0, atual - 1)
        : evento.key === "Home"
          ? 0
          : evento.key === "End"
            ? itens.length - 1
            : undefined;
  if (proximo === undefined) return;
  evento.preventDefault();
  itens[proximo]?.focus();
}

/** A região `aria-live` dos anúncios, fora do cabeçalho (que só tem os itens dele). */
export function AnunciosAtividades() {
  const { anuncio } = useAtividades();
  return (
    <div aria-live="polite" aria-atomic className="sr-only" data-anuncio-atividades>
      {anuncio === undefined ? null : <span key={anuncio.numero}>{anuncio.texto}</span>}
    </div>
  );
}

export function EmAndamento() {
  const { atividades } = useAtividades();
  const abrirRota = useAbrirRota();
  const [aberta, setAberta] = useState(false);
  const total = atividades.length;
  // Sem nada na bandeja, ela fecha de vez (o último item saiu com ela aberta): o próximo item não a reabre.
  if (aberta && total === 0) setAberta(false);
  const visivel = aberta && total > 0;
  const agora = useAgora(visivel);
  const rodando = atividades.some((a) => a.situacao === "andamento");
  if (total === 0) return null;
  return (
    <Popover open={visivel} onOpenChange={setAberta}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Em andamento: ${total}`}
            title="Em andamento"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted-foreground text-sm hover:border-input hover:text-foreground"
          />
        }
      >
        {rodando ? <Spinner size="xs" /> : <span aria-hidden className="size-2 rounded-full bg-primary" />}
        <span aria-hidden className="tabular-nums">
          {total}
        </span>
      </PopoverTrigger>
      {/* Na coluna do modo compacto (320 px), a bandeja cabe na janela. */}
      <PopoverContent className="w-[min(24rem,calc(100vw-1rem))] p-2">
        <PopoverTitle className="px-2 pt-1 pb-2 font-semibold text-small">Em andamento</PopoverTitle>
        <ul className="flex flex-col gap-1" aria-label="Em andamento" onKeyDown={aoTeclarNaLista}>
          {atividades.map((atividade) => (
            <li key={atividade.id} className="flex flex-col gap-1 rounded-md" data-atividade={atividade.id}>
              <button
                type="button"
                data-item-atividade
                onClick={() => {
                  setAberta(false);
                  abrirRota(atividade.rota);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <IconeDoItem atividade={atividade} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium" data-conteudo>
                  {atividade.titulo}
                </span>
                <span className="shrink-0 text-muted-foreground text-micro">{situacaoDoItem(atividade, agora)}</span>
              </button>
              {atividade.situacao === "permissao" ? <Aprovacao atividade={atividade} /> : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
