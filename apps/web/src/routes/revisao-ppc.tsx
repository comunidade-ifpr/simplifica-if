/**
 * "Revisar um PPC": a entrada (soltar ou escolher o `.docx`, e as revisões recentes), a leitura com as
 * etapas (o stream de `revisaoPpc.revisar`) e o resultado (`revisao/Leitura.tsx`), com a lista viva de
 * pendências e a leitura com IA como continuação. O servidor converte, confere os critérios que o
 * código decide e grava uma cópia com comentários do Word ao lado do original.
 *
 * No navegador (sem o desktop), o caminho do arquivo é digitado: é o modo de desenvolvimento.
 */
import type { EtapaLeituraPpc, ListaPendencias } from "@simplifica-if/contratos-app";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Acompanhamento } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import { Entrada } from "../revisao/Entrada.tsx";
import { Leitura } from "../revisao/Leitura.tsx";
import { Lendo } from "../revisao/Lendo.tsx";

export const Route = createFileRoute("/revisao-ppc")({ component: RevisaoPpc });

type Tela =
  | { readonly fase: "entrada"; readonly erro?: MensagemErro }
  | { readonly fase: "lendo"; readonly arquivo: string; readonly etapa: EtapaLeituraPpc | null }
  | { readonly fase: "resultado"; readonly lista: ListaPendencias };

function RevisaoPpc() {
  const api = useApi();
  const [tela, setTela] = useState<Tela>({ fase: "entrada" });
  const leitura = useRef<Acompanhamento | undefined>(undefined);
  useEffect(() => () => leitura.current?.cancelar(), []);

  const revisar = (arquivo: string) => {
    leitura.current?.cancelar();
    setTela({ fase: "lendo", arquivo, etapa: null });
    let lista: string | undefined;
    const acompanhamento = api.acompanhar(
      (c) => c["revisaoPpc.revisar"]({ arquivo }),
      (evento) => {
        if (evento.tipo === "etapa") setTela({ fase: "lendo", arquivo, etapa: evento.etapa });
        else lista = evento.resultado.lista;
      },
    );
    leitura.current = acompanhamento;
    acompanhamento.fim
      .then(async (fim) => {
        if (fim === "cancelado") return;
        if (lista === undefined) throw new Error("a revisão terminou sem a lista de pendências");
        const id = lista;
        const aberta = await api.chamar((c) => c["revisaoPpc.lista"]({ lista: id }));
        setTela({ fase: "resultado", lista: aberta });
      })
      .catch((erro: unknown) => setTela({ fase: "entrada", erro: explicarErro(erro) }));
  };

  if (tela.fase === "lendo") return <Lendo arquivo={tela.arquivo} etapa={tela.etapa} />;
  if (tela.fase === "resultado")
    return <Leitura key={tela.lista.id} inicial={tela.lista} aoSair={() => setTela({ fase: "entrada" })} />;
  return (
    <Entrada
      erro={tela.erro}
      aoEscolher={(arquivo) => revisar(arquivo)}
      aoAbrirLista={(lista) => setTela({ fase: "resultado", lista })}
    />
  );
}
