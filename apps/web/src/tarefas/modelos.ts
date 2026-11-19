/**
 * A escolha do modelo e do raciocínio ao lado da IA: os modelos que a conta oferece (os `modelos` de
 * `providers.detectar`), a opção "Automático" (o padrão da conta) e o raciocínio "Aprofundado", quando
 * o modelo aceita. O que a pessoa não escolhe não vai ao servidor.
 */
import type { ModeloProvider, NivelEsforco, Provider } from "@simplifica-if/contratos-app";
import { useEffect, useState } from "react";
import type { Api } from "../conexao/api.ts";
import { useApi } from "../contexto.tsx";
import { detectarIa } from "../deteccao.ts";

/** A IA da tarefa e, quando a pessoa escolhe, o modelo e o esforço (`EntradaIniciar`). */
export interface EscolhaDaIa {
  readonly provider: Provider;
  /** Sem ele, "Automático". */
  readonly modelo?: string;
  /** Sem ele, raciocínio "Normal". */
  readonly esforco?: NivelEsforco;
}

/**
 * O modelo que vale para a escolha: o escolhido ou, em "Automático", o padrão da conta, quando o
 * provider diz qual é.
 */
export function modeloEfetivo(
  modelos: ReadonlyArray<ModeloProvider>,
  modelo: string | undefined,
): ModeloProvider | undefined {
  return modelo === undefined
    ? modelos.find((candidato) => candidato.padrao === true)
    : modelos.find((candidato) => candidato.id === modelo);
}

/**
 * A escolha depois de trocar o modelo (`undefined`: "Automático"). O raciocínio "Aprofundado" continua
 * se o modelo novo o aceita, com o nível dele; senão, volta a "Normal".
 */
export function comModelo(
  escolha: EscolhaDaIa,
  modelos: ReadonlyArray<ModeloProvider>,
  modelo: string | undefined,
): EscolhaDaIa {
  const esforco = escolha.esforco === undefined ? undefined : modeloEfetivo(modelos, modelo)?.esforcoAprofundado;
  return {
    provider: escolha.provider,
    ...(modelo === undefined ? {} : { modelo }),
    ...(esforco === undefined ? {} : { esforco }),
  };
}

/** A escolha depois de ligar ou desligar o raciocínio "Aprofundado". */
export function comRaciocinio(
  escolha: EscolhaDaIa,
  modelos: ReadonlyArray<ModeloProvider>,
  aprofundado: boolean,
): EscolhaDaIa {
  const esforco = aprofundado ? modeloEfetivo(modelos, escolha.modelo)?.esforcoAprofundado : undefined;
  return {
    provider: escolha.provider,
    ...(escolha.modelo === undefined ? {} : { modelo: escolha.modelo }),
    ...(esforco === undefined ? {} : { esforco }),
  };
}

/** O texto do botão: "Automático", "Opus", "Opus · Aprofundado". */
export function rotuloDaEscolha(escolha: EscolhaDaIa, modelos: ReadonlyArray<ModeloProvider>): string {
  const nome =
    escolha.modelo === undefined
      ? "Automático"
      : (modelos.find((modelo) => modelo.id === escolha.modelo)?.nome ?? escolha.modelo);
  return escolha.esforco === undefined ? nome : `${nome} · Aprofundado`;
}

/** Uma observação curta para os modelos de nome conhecido; os demais ficam só com o nome. */
export function dicaDoModelo(nome: string): string | undefined {
  if (/opus/i.test(nome)) return "tarefas longas e difíceis";
  if (/sonnet/i.test(nome)) return "equilíbrio para o dia a dia";
  if (/haiku|mini|nano/i.test(nome)) return "mais rápido";
  return undefined;
}

/**
 * Os modelos da IA, da detecção guardada (`detectarIa`) ou de uma nova, se ainda não houve. As telas
 * que detectam por conta própria (o Início, Configurações › Sua IA) renovam a guardada.
 */
export function modelosDaIa(api: Api, provider: Provider): Promise<ReadonlyArray<ModeloProvider>> {
  return detectarIa(api, provider, { guardada: true }).then(
    (estado) => estado.modelos ?? [],
    () => [],
  );
}

/** Os modelos da IA escolhida; vazio enquanto carrega e quando a IA não deixa escolher. */
export function useModelos(provider: Provider): ReadonlyArray<ModeloProvider> {
  const api = useApi();
  const [modelos, setModelos] = useState<{
    readonly provider: Provider;
    readonly lista: ReadonlyArray<ModeloProvider>;
  }>();
  useEffect(() => {
    let vale = true;
    void modelosDaIa(api, provider).then((lista) => vale && setModelos({ provider, lista }));
    return () => {
      vale = false;
    };
  }, [api, provider]);
  return modelos?.provider === provider ? modelos.lista : [];
}
