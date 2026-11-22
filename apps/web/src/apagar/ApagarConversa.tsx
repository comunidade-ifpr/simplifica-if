/**
 * "Apagar a conversa": a prévia do servidor (`conversa.previaApagar`) no `DialogoApagar`, o apagamento
 * (`conversa.apagar`) e, se a pessoa pediu, a pasta da tarefa para a Lixeira pelo desktop, depois de o
 * servidor fechar a sessão do provider (nenhum processo segura arquivo dela). Quando o diálogo fecha, se a
 * conversa apagada é a corrente, a tela de conversa volta ao começo.
 */
import type { PreviaApagarConversa, Provider } from "@simplifica-if/contratos-app";
import { useEffect, useRef, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useConversa } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES } from "../providers.ts";
import { DialogoApagar } from "./DialogoApagar.tsx";
import { notaDepoisDeApagar, textosApagarConversa } from "./textos.ts";

export interface ConversaParaApagar {
  readonly id: string;
  readonly titulo: string;
  readonly provider: Provider;
}

export function ApagarConversa({
  conversa,
  aoFechar,
  aoApagada,
}: {
  /** A conversa a apagar; nula com o diálogo fechado. */
  readonly conversa: ConversaParaApagar | null;
  readonly aoFechar: () => void;
  /**
   * Depois de apagada (e do diálogo fechado): quem mostra a lista a recarrega; quem sai da tela devolve a
   * navegação, e a conversa corrente só se zera depois dela.
   */
  readonly aoApagada?: (id: string) => Promise<unknown> | void;
}) {
  const api = useApi();
  const [, controle] = useConversa();
  const ponte = ponteDesktop();
  const [previa, setPrevia] = useState<{ readonly id: string; readonly previa: PreviaApagarConversa } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<{ readonly id: string; readonly erro: MensagemErro } | null>(null);
  // Uma ref, não estado: o `aoFechar` roda na mesma tarefa que apagou e precisa ver a marca já posta.
  const apagada = useRef<string | null>(null);
  const id = conversa?.id;

  useEffect(() => {
    if (id === undefined) return;
    let vivo = true;
    api
      .chamar((c) => c["conversa.previaApagar"]({ sessao: id }))
      .then(
        (lida) => vivo && setPrevia({ id, previa: lida }),
        (motivo: unknown) => vivo && setErroPrevia({ id, erro: explicarErro(motivo) }),
      );
    return () => {
      vivo = false;
    };
  }, [api, id]);

  const ia = conversa === null ? "" : DESCRICOES[conversa.provider].nome;
  const daConversa = previa !== null && previa.id === id ? previa.previa : null;
  const textos =
    conversa === null || daConversa === null
      ? null
      : textosApagarConversa(daConversa, { titulo: conversa.titulo, ia }, ponte?.pastaParaLixeira !== undefined);

  const apagar = async (pastaParaLixeira: boolean): Promise<string | null> => {
    if (conversa === null || daConversa === null) return null;
    // Já apagada (a resposta de um pedido anterior se perdeu com a conexão): conta como apagada agora.
    const resultado = await api
      .chamar((c) => c["conversa.apagar"]({ sessao: conversa.id }))
      .catch((motivo: unknown) => {
        if ((motivo as { _tag?: unknown } | null)?._tag === "SessaoDesconhecida")
          return { transcricao: "nenhuma" as const };
        throw motivo;
      });
    apagada.current = conversa.id;
    let pastaFicou: string | null = null;
    if (pastaParaLixeira && ponte?.pastaParaLixeira !== undefined) {
      try {
        await ponte.pastaParaLixeira(daConversa.pasta.caminho);
      } catch {
        pastaFicou = daConversa.pasta.caminho;
      }
    }
    return notaDepoisDeApagar({ transcricao: resultado.transcricao, pastaFicou }, ia);
  };

  return (
    <DialogoApagar
      aberto={conversa !== null}
      textos={textos}
      erroPrevia={erroPrevia !== null && erroPrevia.id === id ? erroPrevia.erro : undefined}
      aoConfirmar={apagar}
      aoFechar={() => {
        const foi = apagada.current;
        apagada.current = null;
        setPrevia(null);
        setErroPrevia(null);
        aoFechar();
        if (foi === null) return;
        // Por último: zerar a conversa corrente desmonta quem abriu o diálogo (o cabeçalho dela) e muda a URL.
        void Promise.resolve(aoApagada?.(foi)).then(() => controle.apagada(foi));
      }}
    />
  );
}
