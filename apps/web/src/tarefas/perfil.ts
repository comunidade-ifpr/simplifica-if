/**
 * O perfil da pessoa (campus, função e cursos) e o resto do primeiro uso (M1.8): o aviso de uso
 * aceito, as boas-vindas feitas e as IAs em uso. Fica só neste computador, no servidor local
 * (`preferencias.*`); a interface guarda uma cópia, carregada quando a conexão abre e trocada pela
 * resposta de cada mudança.
 */
import type { Perfil, Preferencias, Provider } from "@simplifica-if/contratos-app";
import type * as Effect from "effect/Effect";
import { useEffect, useSyncExternalStore } from "react";
import type { Api } from "../conexao/api.ts";
import type { ClienteApp } from "../conexao/Conexao.ts";
import { useApi, useEstadoConexao } from "../contexto.tsx";

export { linhaDoPerfil } from "@simplifica-if/contratos-app";
export type { Perfil };

type Chamada = (cliente: ClienteApp) => Effect.Effect<Preferencias, unknown>;

class LojaPreferencias {
  valor: Preferencias | undefined = undefined;
  private carregando: Promise<void> | undefined;
  private readonly ouvintes = new Set<() => void>();

  private readonly api: Api;

  constructor(api: Api) {
    this.api = api;
  }

  readonly observar = (ouvinte: () => void) => {
    this.ouvintes.add(ouvinte);
    return () => void this.ouvintes.delete(ouvinte);
  };
  readonly obter = () => this.valor;

  private trocar(valor: Preferencias) {
    this.valor = valor;
    for (const ouvinte of this.ouvintes) ouvinte();
  }

  carregar(): Promise<void> {
    this.carregando ??= this.api
      .chamar((cliente) => cliente["preferencias.ler"]({}))
      .then(
        (valor) => this.trocar(valor),
        () => {
          // Tenta de novo na próxima tela que pedir.
          this.carregando = undefined;
        },
      );
    return this.carregando;
  }

  async mudar(chamada: Chamada): Promise<Preferencias> {
    const valor = await this.api.chamar(chamada);
    this.trocar(valor);
    return valor;
  }
}

const lojas = new WeakMap<Api, LojaPreferencias>();
const lojaDe = (api: Api): LojaPreferencias => {
  let loja = lojas.get(api);
  if (loja === undefined) lojas.set(api, (loja = new LojaPreferencias(api)));
  return loja;
};

export interface UsoPreferencias {
  /** `undefined` enquanto carrega (ou sem servidor). */
  readonly preferencias: Preferencias | undefined;
  readonly gravarPerfil: (perfil: Perfil) => Promise<Preferencias>;
  readonly apagarPerfil: () => Promise<Preferencias>;
  readonly aceitarAviso: () => Promise<Preferencias>;
  readonly concluirBoasVindas: () => Promise<Preferencias>;
  readonly usarIa: (provider: Provider, usar: boolean) => Promise<Preferencias>;
}

export function usePreferencias(): UsoPreferencias {
  const api = useApi();
  const loja = lojaDe(api);
  const conectado = useEstadoConexao().fase === "conectada";
  const preferencias = useSyncExternalStore(loja.observar, loja.obter);
  useEffect(() => {
    if (conectado) void loja.carregar();
  }, [loja, conectado]);
  return {
    preferencias,
    gravarPerfil: (perfil) => loja.mudar((cliente) => cliente["preferencias.gravarPerfil"]({ perfil })),
    apagarPerfil: () => loja.mudar((cliente) => cliente["preferencias.apagarPerfil"]({})),
    aceitarAviso: () => loja.mudar((cliente) => cliente["preferencias.aceitarAviso"]({})),
    concluirBoasVindas: () => loja.mudar((cliente) => cliente["preferencias.concluirBoasVindas"]({})),
    usarIa: (provider, usar) => loja.mudar((cliente) => cliente["preferencias.usarIa"]({ provider, usar })),
  };
}

/** O perfil gravado; `undefined` enquanto carrega ou quando a pessoa pulou o passo. */
export function usePerfil(): Perfil | undefined {
  return usePreferencias().preferencias?.perfil;
}

/** O primeiro uso ainda por fazer (aviso não aceito ou boas-vindas por ver); `undefined` enquanto carrega. */
export function primeiroUsoPendente(preferencias: Preferencias | undefined): boolean | undefined {
  if (preferencias === undefined) return undefined;
  return preferencias.avisoAceitoEm === undefined || preferencias.boasVindasEm === undefined;
}
