/**
 * A detecção de uma IA (`providers.detectar`), compartilhada pelas telas: cada chamada abre o processo
 * do provider, então as que coincidem viram uma só, e o último resultado fica guardado para quem só
 * precisa dos modelos.
 */
import type { EstadoProvider, Provider } from "@simplifica-if/contratos-app";
import type { Api } from "./conexao/api.ts";

interface Guardada {
  readonly promessa: Promise<EstadoProvider>;
  terminou: boolean;
}

const guardadas = new WeakMap<Api, Map<Provider, Guardada>>();

/**
 * O estado da IA. Uma detecção em andamento é sempre reaproveitada; a que já terminou, só com
 * `guardada` (o botão do modelo): sem isso, detecta de novo, e o resultado novo substitui o guardado.
 * A que falha não fica guardada.
 */
export function detectarIa(
  api: Api,
  provider: Provider,
  opcoes: { readonly guardada?: boolean } = {},
): Promise<EstadoProvider> {
  const daApi = guardadas.get(api) ?? new Map<Provider, Guardada>();
  guardadas.set(api, daApi);
  const anterior = daApi.get(provider);
  if (anterior !== undefined && (!anterior.terminou || opcoes.guardada === true)) return anterior.promessa;
  const nova: Guardada = {
    promessa: api.chamar((cliente) => cliente["providers.detectar"]({ provider })),
    terminou: false,
  };
  daApi.set(provider, nova);
  nova.promessa.then(
    () => {
      nova.terminou = true;
    },
    () => {
      if (daApi.get(provider) === nova) daApi.delete(provider);
    },
  );
  return nova.promessa;
}
