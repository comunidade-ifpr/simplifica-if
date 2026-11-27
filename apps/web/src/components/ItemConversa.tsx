/**
 * Um item da conversa: a mensagem da pessoa (com as fichas de contexto que foram junto), a resposta
 * (Markdown, com o texto parcial enquanto chega), uma ferramenta como etapa (nome e resumo), um pedido de
 * aprovação com "Permitir" e "Negar" (respondido pelo controle da vista em que o item está), o cartão do
 * limite da assinatura, com "Continuar com…" as outras IAs prontas, ou um aviso.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import {
  CheckIcon,
  CircleAlertIcon,
  FolderSyncIcon,
  GaugeIcon,
  InfoIcon,
  ShieldQuestionIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useEstadoConversa } from "../contexto.tsx";
import { FichasDaMensagem } from "../conversa/FichasContexto.tsx";
import { useAoContinuar, useControleDaVista } from "../conversa/controleDaVista.ts";
import { DESCRICOES } from "../providers.ts";
import { useIasProntas } from "../tarefas/modelos.ts";
import { usePreferencias } from "../tarefas/perfil.ts";
import { detalheWeb, type Item, rotuloAprovacao, rotuloFerramenta } from "../conversa/estado.ts";
import { resumoMudancasPasta } from "../tarefas/textos.ts";
import { AvisoErro, DetalhesTecnicos } from "./AvisoErro.tsx";
import { Markdown } from "./Markdown.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Spinner } from "./ui/spinner.tsx";
import type { AoAbrirLink } from "../painel/abrirLink.ts";

function Aprovacao({ item }: { readonly item: Extract<Item, { tipo: "aprovacao" }> }) {
  const conversa = useControleDaVista();
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
      <AlertTitle>A IA pede permissão: {rotuloAprovacao(item)}</AlertTitle>
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

/**
 * O limite de uso da assinatura (`docs/plans/multitarefa.md`, "Limite da assinatura"): "Continuar com…" as
 * outras IAs instaladas e conectadas abre uma conversa nova na mesma pasta, com o histórico e as fichas à
 * vista na caixa e a última pergunta escrita, sem enviar. Depois de continuar, a vista diz com qual IA.
 */
function CartaoLimite({ item }: { readonly item: Extract<Item, { tipo: "limite" }> }) {
  const controle = useControleDaVista();
  const estado = useEstadoConversa(controle);
  const aoContinuar = useAoContinuar();
  const prontas = useIasProntas();
  const desligadas = usePreferencias().preferencias?.iasDesligadas ?? [];
  const [abrindo, setAbrindo] = useState<Provider>();
  const [erro, setErro] = useState<MensagemErro>();
  const nome = DESCRICOES[item.provider].curto;
  // Só o limite do último turno, com a conversa parada nele: o de um turno antigo já passou (a conversa
  // seguiu com a mesma IA), e a continuação levaria outra pergunta.
  const doUltimoTurno =
    estado.itens.at(-1)?.turno === item.turno && estado.fase !== "respondendo" && estado.fase !== "interrompendo";
  const outras = doUltimoTurno ? (prontas ?? []).filter((ia) => ia !== item.provider && !desligadas.includes(ia)) : [];
  const continuar = async (provider: Provider) => {
    setAbrindo(provider);
    setErro(undefined);
    try {
      aoContinuar(await controle.continuarCom(provider));
    } catch (falha) {
      setErro(explicarErro(falha));
    } finally {
      setAbrindo(undefined);
    }
  };
  return (
    <Alert variant="warning" data-limite>
      <GaugeIcon />
      <AlertTitle>O {nome} chegou ao limite da sua assinatura</AlertTitle>
      <AlertDescription>
        <p>
          {outras.length === 0 || estado.continuadaCom !== undefined
            ? `Espere o limite renovar para continuar com o ${nome}.`
            : `Espere o limite renovar ou passe a conversa para outra IA: a conversa nova leva o histórico e as fichas, e a última pergunta fica escrita na caixa, para você enviar.`}
        </p>
        {estado.continuadaCom !== undefined || outras.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {outras.map((ia) => (
              <Button
                key={ia}
                size="sm"
                variant="outline"
                disabled={abrindo !== undefined}
                onClick={() => void continuar(ia)}
              >
                {abrindo === ia ? `Abrindo com ${DESCRICOES[ia].curto}…` : `Continuar com ${DESCRICOES[ia].curto}`}
              </Button>
            ))}
          </div>
        )}
        {erro === undefined ? null : <AvisoErro erro={erro} />}
        <DetalhesTecnicos detalhe={item.detalhe} />
      </AlertDescription>
    </Alert>
  );
}

export function ItemConversa({ item, aoAbrirLink }: { readonly item: Item; readonly aoAbrirLink: AoAbrirLink }) {
  switch (item.tipo) {
    case "pessoa":
      return (
        <>
          <div
            data-conteudo
            className="ml-auto max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl rounded-br-sm bg-message px-4 py-2.5 text-message-foreground"
          >
            {item.texto}
          </div>
          {item.fichas === undefined ? null : <FichasDaMensagem fichas={item.fichas} />}
        </>
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
    case "ferramenta": {
      const web = item.web === undefined ? undefined : detalheWeb(item.web);
      const subtitulo =
        item.situacao === "falhou" && item.resumo !== undefined && item.resumo.length > 0
          ? web !== undefined && !item.resumo.includes(web)
            ? `${web} — ${item.resumo}`
            : item.resumo
          : (web ?? item.resumo);
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
            <p className="font-medium">{rotuloFerramenta(item)}</p>
            {subtitulo === undefined || subtitulo.length === 0 ? null : (
              <p data-conteudo className="line-clamp-2 text-muted-foreground text-small">
                {subtitulo}
              </p>
            )}
          </div>
        </div>
      );
    }
    case "aprovacao":
      return <Aprovacao item={item} />;
    case "limite":
      return <CartaoLimite item={item} />;
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
