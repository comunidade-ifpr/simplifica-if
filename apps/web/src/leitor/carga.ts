/**
 * As leituras do leitor, com memória: voltar, avançar e ir a outro dispositivo da mesma norma não
 * pedem de novo ao servidor o documento (um PPC chega a 720 mil caracteres) nem a ficha. Uma memória por
 * painel aberto, com as últimas `LIMITE` leituras. A que falhou fica com o erro até "Tentar de novo"
 * (`esquecer`), para a tela não pedir de novo sem parar.
 */
import { createContext, use, useEffect, useReducer } from "react";
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

const LIMITE = 16;

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
  useEffect(() => {
    if (entrada === null || entrada.estado.fase !== "carregando") return;
    let vivo = true;
    void entrada.promessa.then(() => vivo && atualizar());
    return () => {
      vivo = false;
    };
  }, [entrada]);
  const tentarDeNovo = () => {
    if (chave === null) return;
    memoria.esquecer(chave);
    atualizar();
  };
  return { ...(entrada === null ? PARADA : entrada.estado), tentarDeNovo };
}
