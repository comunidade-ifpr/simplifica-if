/**
 * O índice do Explorar (`explorarIndice`): as coleções inteiras da base, lidas uma vez por conexão e
 * guardadas. As telas de coleção filtram na memória; as fichas de curso e de campus completam com ele
 * (horários, itens do Consepe). Uma falha não fica guardada: "Tentar de novo" pede outra vez.
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { useEffect, useReducer } from "react";
import type { Api } from "../conexao/api.ts";
import { mensagemDeErro } from "../conexao/erros.ts";
import { useApi } from "../contexto.tsx";
import type { Carga } from "../leitor/carga.ts";

interface Guardado {
  estado: Carga<DadosIndice>;
  readonly promessa: Promise<void>;
}

const guardados = new WeakMap<Api, Guardado>();

function carregar(api: Api): Guardado {
  const existente = guardados.get(api);
  if (existente !== undefined) return existente;
  const guardado: Guardado = {
    estado: { fase: "carregando" },
    promessa: api
      .chamar((cliente) => cliente.explorarIndice({}))
      .then(
        (resposta) => {
          guardado.estado = { fase: "lido", valor: resposta.dados };
        },
        (erro: unknown) => {
          guardado.estado = { fase: "falhou", erro: mensagemDeErro(erro) };
        },
      ),
  };
  guardados.set(api, guardado);
  return guardado;
}

/** O índice do Explorar, com "Tentar de novo" se a leitura falhou. */
export function useIndiceExplorar(): Carga<DadosIndice> & { readonly tentarDeNovo: () => void } {
  const api = useApi();
  const guardado = carregar(api);
  const [, atualizar] = useReducer((n: number) => n + 1, 0);
  const carregando = guardado.estado.fase === "carregando";
  useEffect(() => {
    if (!carregando) return;
    let vivo = true;
    void guardado.promessa.then(() => {
      if (vivo) atualizar();
    });
    return () => {
      vivo = false;
    };
  }, [guardado, carregando]);
  const tentarDeNovo = () => {
    guardados.delete(api);
    atualizar();
  };
  return { ...guardado.estado, tentarDeNovo };
}
