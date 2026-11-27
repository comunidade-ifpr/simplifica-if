/**
 * As leituras do leitor, com memória: voltar, avançar, ir a outro dispositivo da mesma norma e abrir a
 * norma da tela também no painel não pedem de novo ao servidor o documento (um PPC chega a 720 mil
 * caracteres) nem a ficha. Uma memória só para os leitores do app (`memoriaDa`, posta na moldura), com
 * as últimas `LIMITE` leituras. A que falhou fica com o erro até "Tentar de novo" (`esquecer`), para a
 * tela não pedir de novo sem parar.
 *
 * A memória vale só para a conexão em que foi lida, como o índice do Explorar (`explorar/indice.ts`):
 * quando ela cai (o servidor local reiniciou, talvez com outra base), tudo se esquece, e a próxima
 * leitura vai à conexão nova.
 */
import { createContext, use, useEffect, useReducer } from "react";
import type { Api } from "../conexao/api.ts";
import { mensagemDeErro } from "../conexao/erros.ts";

export type Carga<T> =
  | { readonly fase: "parada" }
  | { readonly fase: "carregando" }
  | { readonly fase: "lido"; readonly valor: T }
  | { readonly fase: "falhou"; readonly erro: string };

interface Entrada {
  estado: Carga<unknown>;
  readonly promessa: Promise<void>;
}

const LIMITE = 24;

export class MemoriaLeitor {
  private readonly entradas = new Map<string, Entrada>();

  obter<T>(chave: string, carregar: () => Promise<T>): Entrada & { estado: Carga<T> } {
    const existente = this.entradas.get(chave);
    if (existente !== undefined) {
      // a mais recente fica por último (a primeira é a que sai)
      this.entradas.delete(chave);
      this.entradas.set(chave, existente);
      return existente as Entrada & { estado: Carga<T> };
    }
    const entrada: Entrada = {
      estado: { fase: "carregando" },
      promessa: carregar().then(
        (valor) => {
          entrada.estado = { fase: "lido", valor };
        },
        (erro: unknown) => {
          entrada.estado = { fase: "falhou", erro: mensagemDeErro(erro) };
        },
      ),
    };
    this.entradas.set(chave, entrada);
    while (this.entradas.size > LIMITE) this.entradas.delete(this.entradas.keys().next().value!);
    return entrada as Entrada & { estado: Carga<T> };
  }

  esquecer(chave: string): void {
    this.entradas.delete(chave);
  }

  /** Esquece as leituras de chave começada por `prefixo` (as de um documento que deixou de existir). */
  esquecerPrefixo(prefixo: string): void {
    for (const chave of this.entradas.keys()) if (chave.startsWith(prefixo)) this.entradas.delete(chave);
  }

  limpar(): void {
    this.entradas.clear();
  }
}

const memorias = new WeakMap<Api, MemoriaLeitor>();

/** A memória dos leitores da `api`, esquecida sempre que a conexão sai de "conectada". */
export function memoriaDa(api: Api): MemoriaLeitor {
  const existente = memorias.get(api);
  if (existente !== undefined) return existente;
  const memoria = new MemoriaLeitor();
  memorias.set(api, memoria);
  let anterior = api.estado.obter().fase;
  api.estado.observar(() => {
    const fase = api.estado.obter().fase;
    if (anterior === "conectada" && fase !== "conectada") memoria.limpar();
    anterior = fase;
  });
  return memoria;
}

export const ContextoMemoria = createContext<MemoriaLeitor>(new MemoriaLeitor());

const PARADA: Carga<never> = { fase: "parada" };

/**
 * Lê `chave` pela memória do painel; com `chave` `null`, não lê nada. `tentarDeNovo` esquece o erro e
 * pede outra vez.
 */
export function useCarga<T>(
  chave: string | null,
  carregar: () => Promise<T>,
): Carga<T> & { readonly tentarDeNovo: () => void } {
  const memoria = use(ContextoMemoria);
  const entrada = chave === null ? null : memoria.obter(chave, carregar);
  const [, atualizar] = useReducer((n: number) => n + 1, 0);
  // A fase vista nesta renderização: se a leitura terminar entre a renderização e o efeito, o efeito
  // ainda encadeia o `then` (que roda logo, com a promessa já resolvida) e a tela sai de "Lendo na base…".
  const carregandoNoRender = entrada !== null && entrada.estado.fase === "carregando";
  useEffect(() => {
    if (entrada === null || !carregandoNoRender) return;
    let vivo = true;
    void entrada.promessa.then(() => {
      if (vivo) atualizar();
    });
    return () => {
      vivo = false;
    };
  }, [entrada, carregandoNoRender]);
  const tentarDeNovo = () => {
    if (chave === null) return;
    memoria.esquecer(chave);
    atualizar();
  };
  return { ...(entrada === null ? PARADA : entrada.estado), tentarDeNovo };
}
