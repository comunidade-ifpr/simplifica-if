/**
 * O índice do Explorar (`explorarIndice`): as coleções inteiras da base, lidas uma vez por conexão e
 * guardadas. As telas de coleção filtram na memória; as fichas de curso e de campus completam com ele
 * (horários, itens do Consepe). Uma falha não fica guardada: "Tentar de novo" pede outra vez.
 *
 * O índice guardado vale só para a conexão em que foi lido: quando ela cai (o servidor local reiniciou,
 * talvez com outra base, depois de uma atualização ou de "Voltar"), ele é esquecido, e a próxima tela
 * lê de novo da conexão nova.
 */
import type { DadosIndice } from "@simplifica-if/contratos-app";
import { useEffect, useReducer } from "react";
import type { Api } from "../conexao/api.ts";
import { mensagemDeErro } from "../conexao/erros.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";
import type { Carga } from "../leitor/carga.ts";

export interface Guardado {
  estado: Carga<DadosIndice>;
  readonly promessa: Promise<void>;
}

const guardados = new WeakMap<Api, Guardado>();
const vigiadas = new WeakSet<Api>();

/** Esquece o índice da `api` sempre que a conexão sai de "conectada". */
function vigiar(api: Api): void {
  if (vigiadas.has(api)) return;
  vigiadas.add(api);
  let anterior = api.estado.obter().fase;
  api.estado.observar(() => {
    const fase = api.estado.obter().fase;
    if (anterior === "conectada" && fase !== "conectada") guardados.delete(api);
    anterior = fase;
  });
}

/** Testes: o índice guardado da `api`, se há. */
export function indiceGuardado(api: Api): Carga<DadosIndice> | undefined {
  return guardados.get(api)?.estado;
}

export function carregarIndice(api: Api): Guardado {
  vigiar(api);
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
  // a conexão nova (depois de cair) lê o índice de novo: o estado faz a tela renderizar e carregar
  useEstadoConexao();
  const guardado = carregarIndice(api);
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
