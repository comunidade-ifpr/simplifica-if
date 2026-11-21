/**
 * Um item da conversa: a mensagem da pessoa, a resposta (Markdown, com o texto parcial enquanto chega),
 * uma ferramenta como etapa (nome e resumo), um pedido de aprovação com "Permitir" e "Negar", ou um aviso.
 */
import { CheckIcon, CircleAlertIcon, FolderSyncIcon, InfoIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { useConversa } from "../contexto.tsx";
import { type Item, rotuloAprovacao, rotuloFerramenta } from "../conversa/estado.ts";
import { resumoMudancasPasta } from "../tarefas/textos.ts";
import { AvisoErro } from "./AvisoErro.tsx";
import { Markdown } from "./Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";

function Aprovacao({ item }: { readonly item: Extract<Item, { tipo: "aprovacao" }> }) {
  const [, conversa] = useConversa();
  const situacoes = {
    pendente: undefined,
    enviando: "Enviando a resposta…",
    permitida: "Permitido.",
    negada: "Negado.",
    expirada: "Sem efeito: a resposta terminou antes da sua escolha.",
  } as const;
  return (
    <Alert variant="warning" data-aprovacao={item.id}>
      <ShieldQuestionIcon />
      <AlertTitle>A IA pede permissão: {rotuloAprovacao(item.ferramenta)}</AlertTitle>
      <AlertDescription>
        <p>{item.descricao}</p>
        {item.situacao === "pendente" ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void conversa.responder(item.id, "permitir")}>
              <CheckIcon /> Permitir
            </Button>
            <Button size="sm" variant="outline" onClick={() => void conversa.responder(item.id, "negar")}>
              <XIcon /> Negar
            </Button>
          </div>
        ) : (
          <p className="font-medium">{situacoes[item.situacao]}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ItemConversa({
  item,
  aoAbrirLink,
}: {
  readonly item: Item;
  readonly aoAbrirLink: (link: string) => void;
}) {
  switch (item.tipo) {
    case "pessoa":
      return (
        <div
          data-conteudo
          className="ml-auto max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl rounded-br-sm bg-message px-4 py-2.5 text-message-foreground"
        >
          {item.texto}
        </div>
      );
    case "pasta":
      return (
        <p
          className="-mt-2 ml-auto flex max-w-[85%] items-start gap-1.5 text-right text-muted-foreground text-micro"
          data-mudancas-pasta
        >
          <FolderSyncIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="wrap-anywhere">{resumoMudancasPasta(item)}</span>
        </p>
      );
    case "resposta":
      return (
        <div data-final={item.final} className="max-w-full">
          <Markdown texto={item.texto} aoAbrirLink={aoAbrirLink} />
          {item.final ? null : <span aria-hidden className="cursor-resposta" />}
        </div>
      );
    case "ferramenta":
      return (
        <div className="flex items-start gap-2 text-sm" data-ferramenta={item.id}>
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {item.situacao === "andamento" ? (
              <Spinner size="sm" tone="muted" />
            ) : item.situacao === "falhou" ? (
              <CircleAlertIcon aria-label="Falhou" className="size-4 text-destructive" />
            ) : (
              <CheckIcon aria-label="Concluída" className="size-4 text-success" />
            )}
          </span>
          <div className="min-w-0">
            <p className="font-medium">{rotuloFerramenta(item.nome)}</p>
            {item.resumo === undefined || item.resumo.length === 0 ? null : (
              <p data-conteudo className="line-clamp-2 text-muted-foreground text-small">
                {item.resumo}
              </p>
            )}
          </div>
        </div>
      );
    case "aprovacao":
      return <Aprovacao item={item} />;
    case "aviso":
      return item.gravidade === "erro" ? (
        <AvisoErro
          icone
          erro={{ texto: item.texto, ...(item.detalhe === undefined ? {} : { detalhe: item.detalhe }) }}
        />
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <InfoIcon className="size-4" /> {item.texto}
        </p>
      );
  }
}
