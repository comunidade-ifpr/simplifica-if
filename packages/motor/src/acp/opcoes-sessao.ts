/**
 * O modelo e o raciocínio de uma sessão ACP, para qualquer agente que os anuncie como opções de
 * configuração da sessão (`configOptions` do `session/new`: a opção de modelo e a de categoria
 * `thought_level`), trocadas por `session/set_config_option`. Hoje serve ao Antigravity; é o caminho
 * para outros agentes ACP (OpenCode).
 *
 * O que o `agy` faz, medido em 19/11/2026 no 1.5.9 (a lista e a troca, também no 1.5.12):
 * - a opção `thought_level` muda com o modelo (cada modelo tem os seus níveis; alguns, nenhum);
 * - ao trocar de modelo, o nível corrente continua, se o modelo novo o aceita; senão, vai o padrão do
 *   modelo novo. O Gemini 3.8 Flash, escolhido numa sessão nova, herda o `high` do modelo padrão, e o
 *   nível próprio dele (`medium`) só aparece vindo de um modelo sem raciocínio. O "Normal" do app é o
 *   nível próprio: a sondagem o lê passando por um modelo sem raciocínio (`esforcoNormal`), e quem
 *   abre a sessão o manda;
 * - a escolha vale só para a sessão (a seguinte abre no padrão) e volta no `session/load`;
 * - o modelo desconhecido falha com `Unknown model ID` (-32602).
 *
 * Agente que só anuncia `models` (a API antiga, `session/set_model`) lista os modelos, sem raciocínio.
 */
import type * as AcpClient from "@simplifica-if/effect-acp/client";
import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import type * as AcpErrors from "@simplifica-if/effect-acp/errors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type ModeloProvider, NIVEIS_ESFORCO, type NivelEsforco } from "../estados-provider.ts";
import { esforcoAcima } from "../modelos.ts";

/** Teto de modelos sondados: cada um custa até cinco pedidos ao agente. */
const MAXIMO_MODELOS = 24;
/** Quanto a sondagem espera por cada leitura de um modelo (pedidos locais, sem chamar a IA). */
const PRAZO_POR_MODELO = "3 seconds";

type Opcoes = ReadonlyArray<AcpSchema.SessionConfigOption> | null | undefined;
type Selecao = Extract<AcpSchema.SessionConfigOption, { readonly type: "select" }>;

/** O que a sondagem e a aplicação leem da resposta de `session/new`, `session/load` ou `session/resume`. */
export interface OpcoesDaSessao {
  readonly sessionId: string;
  readonly configOptions?: Opcoes;
  readonly models?: AcpSchema.SessionModelState | null | undefined;
}

type Agente = Pick<AcpClient.AcpClient["Service"]["agent"], "setSessionConfigOption" | "setSessionModel">;

/** O modelo pedido não está entre os que o agente oferece para a conta. */
export class ModeloAcpIndisponivel extends Schema.TaggedError<ModeloAcpIndisponivel>()("ModeloAcpIndisponivel", {
  modelo: Schema.String,
}) {
  override get message(): string {
    return `o modelo ${this.modelo} não está disponível nesta sessão`;
  }
}

const selecao = (opcoes: Opcoes, criterio: (opcao: AcpSchema.SessionConfigOption) => boolean): Selecao | undefined => {
  const achada = (opcoes ?? []).find(criterio);
  return achada?.type === "select" ? achada : undefined;
};

export const opcaoDeModelo = (opcoes: Opcoes): Selecao | undefined =>
  selecao(opcoes, (opcao) => opcao.id === "model" || opcao.category === "model");

/** `thinking` é a categoria que o Mistral Vibe usa para o mesmo fim (registrado no `sessionConfig.ts` do T3). */
export const opcaoDeRaciocinio = (opcoes: Opcoes): Selecao | undefined =>
  selecao(opcoes, (opcao) => opcao.category === "thought_level" || opcao.category === "thinking");

/** As escolhas de uma opção de seleção, com os grupos desfeitos. */
export const escolhas = (opcao: Selecao): ReadonlyArray<AcpSchema.SessionConfigSelectOption> =>
  opcao.options.flatMap((entrada) => ("value" in entrada ? [entrada] : entrada.options));

const ehNivel = (nivel: string): nivel is NivelEsforco => (NIVEIS_ESFORCO as ReadonlyArray<string>).includes(nivel);

/**
 * Os modelos que a sessão oferece, com o padrão da conta (o corrente da sessão nova), o nível próprio
 * de cada um (`esforcoNormal`) e o de "Aprofundado", logo acima. Troca o modelo da sessão para ler os
 * níveis: use numa sessão descartável.
 *
 * Duas leituras por modelo: a da sessão nova (volta ao começo e escolhe o modelo, o que dá o nível
 * herdado do padrão) e, havendo um modelo sem raciocínio, a do nível próprio (passa por ele antes).
 * Sem a segunda, o "Normal" é o herdado, e `esforcoNormal` fica de fora. Se uma leitura falha ou passa
 * de `PRAZO_POR_MODELO`, as seguintes não são feitas (a sessão pode ter ficado num estado
 * desconhecido), com aviso no log.
 */
export const sondarModelos = Effect.fn("AcpOpcoes.sondarModelos")(function* (agente: Agente, sessao: OpcoesDaSessao) {
  const modelo = opcaoDeModelo(sessao.configOptions);
  if (modelo === undefined) {
    return (sessao.models?.availableModels ?? []).slice(0, MAXIMO_MODELOS).map((antigo): ModeloProvider => ({
      id: antigo.modelId,
      nome: antigo.name,
      ...(antigo.modelId === sessao.models?.currentModelId ? { padrao: true } : {}),
    }));
  }
  const raciocinioInicial = opcaoDeRaciocinio(sessao.configOptions);
  const definir = (configId: string, value: string) =>
    agente
      .setSessionConfigOption({ sessionId: sessao.sessionId, configId, value })
      .pipe(Effect.map((resposta): Opcoes => resposta.configOptions));
  let desistiu = false;
  /** As opções depois dos `passos`, ou nada: depois da primeira falha, nenhuma leitura é feita. */
  const ler = Effect.fn("AcpOpcoes.ler")(function* (valor: string, passos: Effect.Effect<Opcoes, AcpErrors.AcpError>) {
    if (desistiu) return undefined;
    const lido = yield* passos.pipe(
      Effect.timeout(PRAZO_POR_MODELO),
      Effect.tapError((erro) => Effect.logWarning(`ACP: a sondagem do modelo ${valor} falhou`, erro)),
      Effect.option,
    );
    if (lido._tag === "Some") return lido.value;
    desistiu = true;
    return undefined;
  });
  const lidos: Array<{
    readonly escolha: AcpSchema.SessionConfigSelectOption;
    readonly padrao: boolean;
    readonly opcoes: Opcoes;
  }> = [];
  for (const escolha of escolhas(modelo).slice(0, MAXIMO_MODELOS)) {
    const padrao = escolha.value === modelo.currentValue;
    const opcoes = padrao
      ? sessao.configOptions
      : yield* ler(
          escolha.value,
          Effect.gen(function* () {
            yield* definir(modelo.id, modelo.currentValue);
            if (raciocinioInicial !== undefined) yield* definir(raciocinioInicial.id, raciocinioInicial.currentValue);
            return yield* definir(modelo.id, escolha.value);
          }),
        );
    lidos.push({ escolha, padrao, opcoes });
  }
  const neutro = lidos.find((lido) => lido.opcoes != null && opcaoDeRaciocinio(lido.opcoes) === undefined);
  const modelos: Array<ModeloProvider> = [];
  for (const { escolha, padrao, opcoes } of lidos) {
    const herdado = opcaoDeRaciocinio(opcoes);
    // O padrão da conta abre no nível dele: só os outros modelos herdam.
    const proprio =
      herdado === undefined || padrao || neutro === undefined
        ? undefined
        : opcaoDeRaciocinio(
            yield* ler(
              escolha.value,
              definir(modelo.id, neutro.escolha.value).pipe(Effect.andThen(definir(modelo.id, escolha.value))),
            ),
          )?.currentValue;
    const normal = proprio ?? herdado?.currentValue;
    const esforco =
      herdado === undefined || normal === undefined
        ? undefined
        : esforcoAcima(
            normal,
            escolhas(herdado).map((nivel) => nivel.value),
          );
    modelos.push({
      id: escolha.value,
      nome: escolha.name,
      ...(padrao ? { padrao: true } : {}),
      ...(proprio !== undefined && ehNivel(proprio) ? { esforcoNormal: proprio } : {}),
      ...(esforco === undefined ? {} : { esforcoAprofundado: esforco }),
    });
  }
  return modelos;
});

/**
 * Aplica à sessão o modelo e o esforço escolhidos. Sem modelo, fica o da sessão; sem esforço, o nível
 * que o agente deu ao modelo (quem chama manda o `esforcoNormal` do modelo, se o conhece). O esforço que o modelo não oferece é ignorado; o modelo
 * que o agente não oferece falha com `ModeloAcpIndisponivel`.
 */
export const aplicarEscolha = Effect.fn("AcpOpcoes.aplicarEscolha")(function* (
  agente: Agente,
  sessao: OpcoesDaSessao,
  escolha: { readonly modelo?: string | undefined; readonly esforco?: string | undefined },
): Effect.fn.Return<void, AcpErrors.AcpError | ModeloAcpIndisponivel> {
  let opcoes = sessao.configOptions;
  const definir = (configId: string, value: string) =>
    agente
      .setSessionConfigOption({ sessionId: sessao.sessionId, configId, value })
      .pipe(Effect.map((resposta) => resposta.configOptions));
  if (escolha.modelo !== undefined) {
    const modelo = opcaoDeModelo(opcoes);
    if (modelo !== undefined) {
      if (!escolhas(modelo).some((candidata) => candidata.value === escolha.modelo))
        return yield* new ModeloAcpIndisponivel({ modelo: escolha.modelo });
      if (modelo.currentValue !== escolha.modelo) opcoes = yield* definir(modelo.id, escolha.modelo);
    } else if (sessao.models?.availableModels.some((antigo) => antigo.modelId === escolha.modelo) === true) {
      if (sessao.models.currentModelId !== escolha.modelo)
        yield* agente.setSessionModel({ sessionId: sessao.sessionId, modelId: escolha.modelo });
    } else {
      return yield* new ModeloAcpIndisponivel({ modelo: escolha.modelo });
    }
  }
  if (escolha.esforco !== undefined) {
    const raciocinio = opcaoDeRaciocinio(opcoes);
    if (
      raciocinio !== undefined &&
      raciocinio.currentValue !== escolha.esforco &&
      escolhas(raciocinio).some((candidata) => candidata.value === escolha.esforco)
    )
      yield* definir(raciocinio.id, escolha.esforco);
  }
});
