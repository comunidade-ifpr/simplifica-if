/**
 * "Apagar a conversa" e "Apagar as selecionadas": as prévias do servidor (`conversa.previaApagar`, uma
 * por conversa) somadas no `DialogoApagar`, o apagamento uma a uma (`conversa.apagar`, com a falha de uma
 * relatada sem parar as outras) e, se a pessoa pediu, as pastas das tarefas para a Lixeira pelo desktop,
 * depois de o servidor fechar as sessões do provider (nenhum processo segura arquivo delas).
 *
 * **Destino:** quando o diálogo fecha, se a conversa aberta na tela (`/conversa?id=…`) está entre as
 * apagadas, a tela vai para o Início, trocando a entrada do histórico (voltar não reabre uma conversa que
 * não existe). Se a pessoa já foi para outra tela enquanto apagava, ela fica onde está. A conversa apagada
 * que estava no painel sai dele, e a aba Conversar diz "Conversa apagada" (`GerenteConversas.apagada`).
 */
import type { PreviaApagarConversa, Provider } from "@simplifica-if/contratos-app";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ehSessaoDesconhecida, explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi, useApp } from "../contexto.tsx";
import { registrarErro, textoDoErro } from "../diagnostico.ts";
import { ponteDesktop } from "../ponte-desktop.ts";
import { DESCRICOES } from "../providers.ts";
import { DialogoApagar } from "./DialogoApagar.tsx";
import {
  CONVERSA,
  type Desfecho,
  type NotaApagar,
  notaDepoisDeApagar,
  pastasParaLixeira,
  textosApagarConversas,
} from "./textos.ts";

export interface ConversaParaApagar {
  readonly id: string;
  readonly titulo: string;
  readonly provider: Provider;
}

export function ApagarConversas({
  conversas,
  aoFechar,
  aoApagadas,
}: {
  /** As conversas a apagar; nulo (ou vazio) com o diálogo fechado. */
  readonly conversas: ReadonlyArray<ConversaParaApagar> | null;
  readonly aoFechar: () => void;
  /** Depois de apagadas (e do diálogo fechado), com os ids das que saíram: quem mostra a lista a recarrega. */
  readonly aoApagadas?: (ids: ReadonlyArray<string>) => void;
}) {
  const api = useApi();
  const roteador = useRouter();
  const { conversas: gerente } = useApp();
  const ponte = ponteDesktop();
  const chave = conversas === null ? "" : conversas.map((c) => c.id).join(",");
  const [previas, setPrevias] = useState<{
    readonly chave: string;
    readonly previas: ReadonlyArray<PreviaApagarConversa>;
  } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<{ readonly chave: string; readonly erro: MensagemErro } | null>(null);
  // Uma ref, não estado: o `aoFechar` roda na mesma tarefa que apagou e precisa ver as marcas já postas.
  const apagadas = useRef<Array<string>>([]);

  useEffect(() => {
    if (chave === "") return;
    let vivo = true;
    Promise.all(chave.split(",").map((id) => api.chamar((c) => c["conversa.previaApagar"]({ sessao: id })))).then(
      (lidas) => vivo && setPrevias({ chave, previas: lidas }),
      (motivo: unknown) => vivo && setErroPrevia({ chave, erro: explicarErro(motivo) }),
    );
    return () => {
      vivo = false;
    };
  }, [api, chave]);

  const itens =
    conversas === null || previas === null || previas.chave !== chave
      ? null
      : conversas.map((conversa, i) => ({
          conversa,
          previa: previas.previas[i]!,
          titulo: conversa.titulo,
          ia: DESCRICOES[conversa.provider].nome,
        }));
  const textos = itens === null ? null : textosApagarConversas(itens, ponte !== undefined);

  const apagar = async (pastaParaLixeira: boolean): Promise<NotaApagar | null> => {
    if (itens === null) return null;
    const desfechos: Array<Desfecho & { readonly pasta: string }> = [];
    const apagarUma = async (item: (typeof itens)[number]) => {
      // Já apagada (a resposta de um pedido anterior se perdeu com a conexão): conta como apagada agora.
      const resultado = await api
        .chamar((c) => c["conversa.apagar"]({ sessao: item.conversa.id }))
        .catch((motivo: unknown) => {
          if (ehSessaoDesconhecida(motivo)) return { transcricao: "nenhuma" as const };
          throw motivo;
        });
      apagadas.current.push(item.conversa.id);
      return {
        titulo: item.titulo || "Conversa sem mensagens",
        pasta: item.previa.pasta.caminho,
        ...(resultado.transcricao === "ficou" ? { transcricaoFicou: item.ia } : {}),
      };
    };
    const falharam: Array<(typeof itens)[number]> = [];
    for (const item of itens) {
      try {
        desfechos.push(await apagarUma(item));
      } catch (motivo) {
        // Uma só: o erro aparece no diálogo, que fica aberto para tentar de novo.
        if (itens.length === 1) throw motivo;
        falharam.push(item);
      }
    }
    // Uma segunda vez para as que falharam: a conexão que caiu no meio volta, e a que o servidor já tinha
    // apagado responde `SessaoDesconhecida`, que conta como apagada.
    for (const item of falharam) {
      try {
        desfechos.push(await apagarUma(item));
      } catch (motivo) {
        registrarErro(`apagar a conversa em lote: ${textoDoErro(motivo)}`);
        desfechos.push({
          titulo: item.titulo || "Conversa sem mensagens",
          pasta: item.previa.pasta.caminho,
          falhou: true,
        });
      }
    }
    if (pastaParaLixeira && ponte !== undefined) {
      const saiu = new Set(desfechos.filter((d) => d.falhou !== true).map((d) => d.pasta));
      for (const pasta of pastasParaLixeira(itens).filter((p) => saiu.has(p))) {
        try {
          await ponte.pastaParaLixeira(pasta);
        } catch {
          const i = desfechos.findIndex((d) => d.pasta === pasta && d.falhou !== true);
          desfechos[i] = { ...desfechos[i]!, pastaFicou: pasta };
        }
      }
    }
    return notaDepoisDeApagar(desfechos, CONVERSA);
  };

  const fechar = () => {
    const foram = apagadas.current;
    apagadas.current = [];
    setPrevias(null);
    setErroPrevia(null);
    aoFechar();
    if (foram.length === 0) return;
    aoApagadas?.(foram);
    // Por último: zerar a conversa corrente desmonta quem abriu o diálogo (o cabeçalho dela) e muda a URL.
    const local = roteador.state.location;
    const aberta = local.pathname === "/conversa" ? (local.search as { readonly id?: unknown }).id : undefined;
    const sair = typeof aberta === "string" && foram.includes(aberta);
    void (sair ? roteador.navigate({ to: "/", replace: true }) : Promise.resolve()).finally(() => {
      for (const id of foram) gerente.apagada(id);
    });
  };

  return (
    <DialogoApagar
      aberto={chave !== ""}
      textos={textos}
      erroPrevia={erroPrevia !== null && erroPrevia.chave === chave ? erroPrevia.erro : undefined}
      aoConfirmar={apagar}
      aoFechar={fechar}
    />
  );
}
