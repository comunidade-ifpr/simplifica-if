/**
 * A escolha do modelo e do raciocínio ao lado da IA: os modelos que a conta oferece (os `modelos` de
 * `providers.detectar`), com o padrão da conta já escolhido pelo nome, e o raciocínio "Aprofundado",
 * quando o modelo aceita. O padrão da conta não vai ao servidor como modelo: a sessão abre sem modelo,
 * e a conta decide (inclusive a troca de modelo que ela faz por conta própria). Só quando o provider
 * não diz qual é o padrão a interface mostra "Automático". E as IAs que entram na escolha: só as prontas.
 */
import type { ModeloProvider, NivelEsforco, Provider } from "@simplifica-if/contratos-app";
import { useEffect, useState } from "react";
import type { Api } from "../conexao/api.ts";
import { useApi } from "../contexto.tsx";
import { detectarIa } from "../deteccao.ts";
import { PROVIDERS } from "../providers.ts";

/** A IA da tarefa e, quando a pessoa escolhe, o modelo e o esforço (`EntradaIniciar`). */
export interface EscolhaDaIa {
  readonly provider: Provider;
  /** Sem ele, o padrão da conta. */
  readonly modelo?: string;
  /** Sem ele, raciocínio "Normal". */
  readonly esforco?: NivelEsforco;
}

/**
 * O modelo que vale para a escolha: o escolhido ou, sem escolha, o padrão da conta, quando o provider
 * diz qual é.
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
 * A escolha depois de trocar o modelo (`undefined`: o padrão da conta). O raciocínio "Aprofundado" continua
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

/** O texto do botão: "Opus", "Opus · Aprofundado"; "Automático" sem padrão conhecido. */
export function rotuloDaEscolha(escolha: EscolhaDaIa, modelos: ReadonlyArray<ModeloProvider>): string {
  const nome = modeloEfetivo(modelos, escolha.modelo)?.nome ?? escolha.modelo ?? "Automático";
  return escolha.esforco === undefined ? nome : `${nome} · Aprofundado`;
}

/**
 * A observação ao lado do modelo no menu: "recomendado" no padrão da conta; nos demais, uma frase
 * curta para os de nome conhecido, e nada para os outros.
 */
export function dicaDoModelo(modelo: ModeloProvider): string | undefined {
  if (modelo.padrao === true) return "recomendado";
  const nome = modelo.nome;
  if (/fable/i.test(nome)) return "o mais capaz, gasta mais do plano";
  if (/opus/i.test(nome)) return "tarefas longas e difíceis";
  if (/sonnet/i.test(nome)) return "equilíbrio para o dia a dia";
  if (/haiku|flash|mini|nano/i.test(nome)) return "mais rápido";
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

/**
 * As IAs prontas para uma conversa (instaladas e com login), por uma detecção nova de cada uma;
 * `undefined` enquanto ela não termina. A IA cuja detecção falha conta como não pronta.
 */
export function useIasProntas(): ReadonlyArray<Provider> | undefined {
  const api = useApi();
  const [prontas, setProntas] = useState<ReadonlyArray<Provider>>();
  useEffect(() => {
    let vale = true;
    void Promise.all(
      PROVIDERS.map((provider) =>
        detectarIa(api, provider).then(
          (estado) => estado.instalado && estado.autenticado,
          () => false,
        ),
      ),
    ).then((estados) => vale && setProntas(PROVIDERS.filter((_, indice) => estados[indice] === true)));
    return () => {
      vale = false;
    };
  }, [api]);
  return prontas;
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
