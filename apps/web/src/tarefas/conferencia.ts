/**
 * O aviso ao anexar (M1.13), na interface: cada arquivo escolhido passa pelo detector local do servidor
 * (`pasta.conferirAnexo`) antes de ir para a pasta da tarefa. Achou dado pessoal, a pessoa decide:
 * "Enviar mesmo assim" ou "Retirar o anexo". O envio espera essa decisão e a conferência em curso; o
 * arquivo que não foi conferido (PDF, imagem) não espera, e a tela diz que não foi conferido.
 */
import type { ConferenciaAnexo } from "@simplifica-if/contratos-app";
import { useCallback, useMemo, useState } from "react";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";

export type EstadoConferencia =
  | { readonly fase: "conferindo" }
  | { readonly fase: "pronta"; readonly resultado: ConferenciaAnexo }
  | { readonly fase: "falhou"; readonly erro: MensagemErro };

export interface ConferenciaAnexos {
  readonly estado: (arquivo: string) => EstadoConferencia | undefined;
  readonly aceito: (arquivo: string) => boolean;
  readonly conferir: (arquivo: string) => void;
  /** "Enviar mesmo assim". */
  readonly aceitar: (arquivo: string) => void;
  /** Os anexos que seguram o envio: em conferência, ou com dado pessoal sem a decisão da pessoa. */
  readonly pendentes: (anexos: ReadonlyArray<string>) => ReadonlyArray<string>;
}

/** O arquivo tem achados que pedem decisão. */
export const temAchados = (estado: EstadoConferencia | undefined): boolean =>
  estado?.fase === "pronta" && estado.resultado.situacao === "conferido" && estado.resultado.total > 0;

export function useConferenciaAnexos(): ConferenciaAnexos {
  const api = useApi();
  const [estados, setEstados] = useState<ReadonlyMap<string, EstadoConferencia>>(new Map());
  const [aceitos, setAceitos] = useState<ReadonlySet<string>>(new Set());

  const mudar = useCallback(
    (arquivo: string, estado: EstadoConferencia) =>
      setEstados((anteriores) => new Map(anteriores).set(arquivo, estado)),
    [],
  );

  const conferir = useCallback(
    (arquivo: string) => {
      mudar(arquivo, { fase: "conferindo" });
      setAceitos((anteriores) => {
        const novos = new Set(anteriores);
        novos.delete(arquivo);
        return novos;
      });
      api
        .chamar((cliente) => cliente["pasta.conferirAnexo"]({ arquivo }))
        .then(
          (resultado) => mudar(arquivo, { fase: "pronta", resultado }),
          (falha: unknown) => mudar(arquivo, { fase: "falhou", erro: explicarErro(falha) }),
        );
    },
    [api, mudar],
  );

  return useMemo(
    () => ({
      estado: (arquivo) => estados.get(arquivo),
      aceito: (arquivo) => aceitos.has(arquivo),
      conferir,
      aceitar: (arquivo) => setAceitos((anteriores) => new Set(anteriores).add(arquivo)),
      pendentes: (anexos) =>
        anexos.filter((arquivo) => {
          const estado = estados.get(arquivo);
          return estado?.fase === "conferindo" || (temAchados(estado) && !aceitos.has(arquivo));
        }),
    }),
    [estados, aceitos, conferir],
  );
}
