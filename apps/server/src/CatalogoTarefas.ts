/**
 * O catálogo de tarefas do app: os manifestos de uma pasta (`--pasta-tarefas`, `catalogo/tarefas/<id>.yaml`)
 * ou do catálogo que a atualização baixou, cruzados com as skills do `CatalogoSkills` e com o que este
 * app tem.
 *
 * - **De onde vem:** do catálogo baixado, quando o commit dele é mais recente que o do instalador
 *   (`Abertura.catalogo`, decidido por `prepararAbertura`); senão, da pasta. Um ou outro, inteiro: nada se
 *   mescla, e a tarefa que saiu do repositório some do app.
 * - **Quais entram:** os manifestos válidos (`@simplifica-if/mcp/tarefas`, o mesmo Effect Schema do
 *   `validar_base.ts`). O inválido fica de fora com o erro no log; não derruba o servidor nem os outros.
 * - **O que o app não atende, não mostra:** fica de fora a tarefa `descontinuada`, a que pede um módulo
 *   que este app não tem ou cita uma skill ausente do `CatalogoSkills` (`conferirAbertura`, a regra do
 *   `validar_base.ts` e do build), e a de `app_minimo` ou `base_minima` maior que a versão do app ou da
 *   base em uso, ou que não se consegue comparar com ela (`motivoDeFora`). A tarefa de fora continua
 *   em `retiradas`, com o título: a conversa que nasceu dela segue com o nome da tarefa.
 * - **`experimental` só no canal beta:** `listar` e `recusaDeConversa` recebem o canal da atualização (o de
 *   "Atualizações", que a pessoa troca com o servidor aberto): fora dele, a experimental sai do catálogo
 *   e não abre conversa nova.
 * - **Quando se lê:** uma vez, na abertura do servidor, como as skills.
 *
 * O `id` da tarefa é o que a conversa guarda (`conversas.tarefa`). As `Conversas` perguntam por ele duas
 * coisas: se a tarefa abre conversa nova (`recusaDeConversa`) e o que ela impõe à sessão (`regraDaSessao`: a
 * única skill que a sessão leva e a web desligada pelo manifesto).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { atende, ehVersaoDev } from "@simplifica-if/atualizacao/manifesto";
import type {
  AberturaTarefa,
  CatalogoTarefas as CatalogoTarefasContrato,
  ResumoTarefa,
  TarefaRetirada,
} from "@simplifica-if/contratos-app";
import type { CanalDistribuicao } from "@simplifica-if/kb/canal";
import {
  type AberturaConferida,
  aberturaDe,
  conferirAbertura,
  lerPastaTarefas,
  lerTarefasDoCanal,
  type ManifestoTarefa,
} from "@simplifica-if/mcp/tarefas";
import * as CatalogoSkills from "./CatalogoSkills.ts";

/** Por que uma tarefa de manifesto válido não entra no catálogo. */
export type MotivoDeFora = "descontinuada" | "modulo-ausente" | "skill-ausente" | "app-antigo" | "base-antiga";

/**
 * O que a tarefa impõe à sessão da conversa que nasceu dela. Só restringe: a conversa livre leva todas as
 * skills e a web da política do app.
 */
export interface RegraDaSessao {
  /** A única skill que a sessão leva; `undefined`: nenhuma. */
  readonly skill: string | undefined;
  /** `false`: o manifesto desliga a busca e a leitura na web (`abre.conversa.web: false`). */
  readonly web: boolean;
}

/**
 * A regra da conversa cuja tarefa não tem mais manifesto de conversa: nenhuma skill. O `web: false` com
 * que a conversa nasceu não se perde aqui: fica gravado nela (`conversas.sem_web`).
 */
const SEM_MANIFESTO: RegraDaSessao = { skill: undefined, web: true };

/** Por que uma tarefa não abre conversa nova (o `motivo` de `TarefaDesconhecida`). */
export type RecusaDeConversa = "indisponivel" | "so-no-beta";

/** A tarefa `experimental` só existe no canal beta: a regra de `listar` e de `recusaDeConversa`. */
const noCanal = (situacao: ResumoTarefa["situacao"], canal: CanalDistribuicao): boolean =>
  situacao !== "experimental" || canal === "beta";

export class CatalogoTarefas extends Context.Service<
  CatalogoTarefas,
  {
    /** O que `tarefas.listar` devolve à interface, no canal dado. */
    readonly listar: (canal: CanalDistribuicao) => CatalogoTarefasContrato;
    /**
     * Por que `id` não abre conversa nova no canal dado: não é uma tarefa de conversa que este app atende
     * (`indisponivel`) ou é `experimental` fora do beta (`so-no-beta`). `undefined`: abre.
     */
    readonly recusaDeConversa: (id: string, canal: CanalDistribuicao) => RecusaDeConversa | undefined;
    /**
     * A regra da sessão de uma conversa que nasceu da tarefa `id`, em qualquer canal e também para a
     * tarefa que saiu do catálogo (a conversa antiga segue com a regra enquanto o manifesto existir): a
     * skill citada, se ainda é do `CatalogoSkills`, e o `web` do manifesto.
     */
    readonly regraDaSessao: (id: string) => RegraDaSessao;
    /** O título de toda tarefa de manifesto válido, inclusive as de fora do catálogo. */
    readonly titulo: (id: string) => string | undefined;
  }
>()("@simplifica-if/server/CatalogoTarefas") {}

/** A pasta de tarefas dada não pode ser lida (não existe, não é pasta, sem permissão). */
export class PastaTarefasInvalida extends Schema.TaggedError<PastaTarefasInvalida>()("PastaTarefasInvalida", {
  pasta: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler a pasta de tarefas: ${this.pasta}`;
  }
}

/** O que o app tem, para decidir o que ele atende. */
export interface Ambiente {
  /** As skills do catálogo, pelo nome, com as etapas de cada uma (`CatalogoSkills.etapas`). */
  readonly etapasDasSkills: CatalogoSkills.CatalogoSkills["Service"]["etapas"];
  /** A versão do app; sem ela (testes, servidor avulso), o `app_minimo` não é conferido. */
  readonly versaoApp?: string | undefined;
  /** A versão da base em uso; sem ela, ou na base de desenvolvimento, a `base_minima` não é conferida. */
  readonly versaoBase?: string | undefined;
}

/**
 * A versão em uso atende o mínimo? Só com a comparação feita: a que não dá número (uma versão fora do
 * padrão, de um lado ou do outro) conta como não atender, e a tarefa fica escondida.
 */
const atendeMinimo = atende;

/** A tarefa que o app atende, com a abertura já conferida, ou o motivo de ela ficar de fora. */
type Classificada =
  | { readonly motivo: MotivoDeFora }
  | {
      readonly motivo?: never;
      readonly situacao: ResumoTarefa["situacao"];
      readonly conferida: AberturaConferida;
    };

function classificar(manifesto: ManifestoTarefa, ambiente: Ambiente): Classificada {
  const { situacao } = manifesto;
  if (situacao === "descontinuada") return { motivo: "descontinuada" };
  const { ausente, conferida } = conferirAbertura(manifesto, ambiente.etapasDasSkills);
  if (ausente !== undefined) return { motivo: ausente.tipo === "modulo" ? "modulo-ausente" : "skill-ausente" };
  const { versaoApp, versaoBase } = ambiente;
  if (manifesto.app_minimo !== undefined && versaoApp !== undefined && !atendeMinimo(manifesto.app_minimo, versaoApp))
    return { motivo: "app-antigo" };
  if (
    manifesto.base_minima !== undefined &&
    versaoBase !== undefined &&
    !ehVersaoDev(versaoBase) &&
    !atendeMinimo(manifesto.base_minima, versaoBase)
  )
    return { motivo: "base-antiga" };
  return { situacao, conferida };
}

/** Por que a tarefa fica fora do catálogo deste app; `undefined` se ele a atende. */
export const motivoDeFora = (manifesto: ManifestoTarefa, ambiente: Ambiente): MotivoDeFora | undefined =>
  classificar(manifesto, ambiente).motivo;

const EXPLICACOES: Readonly<Record<MotivoDeFora, string>> = {
  descontinuada: "está descontinuada",
  "modulo-ausente": "pede um módulo que este app não tem",
  "skill-ausente": "cita uma skill que não está no catálogo de skills",
  "app-antigo": "pede um app mais novo (app_minimo)",
  "base-antiga": "pede uma base mais nova (base_minima)",
};

/** A abertura como vai à interface. O `web` do manifesto não vai: é regra da sessão (`regraDaSessao`). */
function aberturaDoResumo(abertura: AberturaConferida, ambiente: Ambiente): AberturaTarefa {
  switch (abertura.tipo) {
    case "link":
      return { tipo: "link", url: abertura.url, requerLogin: abertura.requerLogin };
    case "conversa":
      return {
        tipo: "conversa",
        ...(abertura.skill === undefined ? {} : { skill: abertura.skill }),
        pedido: abertura.pedido,
        entradas: abertura.entradas,
        etapas: abertura.skill === undefined ? [] : (ambiente.etapasDasSkills.get(abertura.skill) ?? []),
      };
    case "modulo":
      return { tipo: "modulo", modulo: abertura.modulo };
  }
}

const paraResumo = (
  manifesto: ManifestoTarefa,
  situacao: ResumoTarefa["situacao"],
  abertura: AberturaTarefa,
): ResumoTarefa => ({
  id: manifesto.id,
  titulo: manifesto.titulo,
  resumo: manifesto.resumo,
  area: manifesto.area,
  publico: manifesto.publico ?? [],
  situacao,
  mantenedor: manifesto.mantenedor,
  ...(manifesto.limites === undefined ? {} : { limites: manifesto.limites }),
  ...(manifesto.autoria === undefined ? {} : { autoria: manifesto.autoria }),
  ...(manifesto.duracao_estimada === undefined ? {} : { duracaoEstimada: manifesto.duracao_estimada }),
  abre: abertura,
});

/** O catálogo a partir de manifestos já lidos (o `layer` e os testes), e o que ficou de fora, para o log. */
export function deManifestos(manifestos: ReadonlyArray<ManifestoTarefa>, ambiente: Ambiente) {
  const atendidas: Array<ResumoTarefa> = [];
  const retiradas: Array<TarefaRetirada> = [];
  const deFora: Array<{ readonly id: string; readonly motivo: MotivoDeFora }> = [];
  const regras = new Map<string, RegraDaSessao>();
  for (const manifesto of manifestos) {
    const abertura = aberturaDe(manifesto);
    if (abertura.tipo === "conversa") {
      const { skill, web } = abertura;
      regras.set(manifesto.id, {
        skill: skill !== undefined && ambiente.etapasDasSkills.has(skill) ? skill : undefined,
        web,
      });
    }
    const classificada = classificar(manifesto, ambiente);
    if (classificada.motivo !== undefined) {
      retiradas.push({ id: manifesto.id, titulo: manifesto.titulo });
      deFora.push({ id: manifesto.id, motivo: classificada.motivo });
      continue;
    }
    atendidas.push(paraResumo(manifesto, classificada.situacao, aberturaDoResumo(classificada.conferida, ambiente)));
  }
  const situacoesDeConversa = new Map(
    atendidas.flatMap((tarefa) => (tarefa.abre.tipo === "conversa" ? [[tarefa.id, tarefa.situacao] as const] : [])),
  );
  const titulos = new Map(manifestos.map((manifesto) => [manifesto.id, manifesto.titulo]));
  const servico = CatalogoTarefas.of({
    listar: (canal) => ({
      tarefas: atendidas.filter((tarefa) => noCanal(tarefa.situacao, canal)),
      retiradas: [
        ...retiradas,
        ...atendidas.filter((tarefa) => !noCanal(tarefa.situacao, canal)).map(({ id, titulo }) => ({ id, titulo })),
      ],
    }),
    recusaDeConversa: (id, canal) => {
      const situacao = situacoesDeConversa.get(id);
      if (situacao === undefined) return "indisponivel";
      return noCanal(situacao, canal) ? undefined : "so-no-beta";
    },
    regraDaSessao: (id) => regras.get(id) ?? SEM_MANIFESTO,
    titulo: (id) => titulos.get(id),
  });
  return { servico, deFora };
}

/** Um catálogo vazio: o servidor sem `--pasta-tarefas`. */
export const layerVazio = Layer.succeed(CatalogoTarefas, deManifestos([], { etapasDasSkills: new Map() }).servico);

/** Um catálogo fixo sobre o `CatalogoSkills` do ambiente, para os testes. */
export const layerFixo = (manifestos: ReadonlyArray<ManifestoTarefa>) =>
  Layer.effect(
    CatalogoTarefas,
    Effect.gen(function* () {
      const skills = yield* CatalogoSkills.CatalogoSkills;
      return deManifestos(manifestos, { etapasDasSkills: skills.etapas }).servico;
    }),
  );

/** O catálogo que a atualização baixou (`Abertura.catalogo`): a versão do canal e as tarefas como vieram. */
export interface CatalogoBaixado {
  readonly versao: string;
  readonly tarefas: ReadonlyArray<unknown>;
}

/**
 * Lê o catálogo na abertura: o baixado, se há (`opcoes.baixado`), no lugar da pasta inteira; senão, a
 * pasta (sem pasta nem baixado, nenhuma tarefa). Falha com `PastaTarefasInvalida` se a pasta não puder ser listada; os manifestos inválidos e as
 * tarefas que o app não atende só vão para o log. Pede o `CatalogoSkills`, o `FileSystem` e o `Path`.
 */
export const layer = (
  pasta: string | undefined,
  opcoes: {
    readonly versaoApp?: string | undefined;
    readonly versaoBase?: string | undefined;
    readonly baixado?: CatalogoBaixado | null | undefined;
  } = {},
) =>
  Layer.effect(
    CatalogoTarefas,
    Effect.gen(function* () {
      const skills = yield* CatalogoSkills.CatalogoSkills;
      const { baixado, ...versoes } = opcoes;
      const origem = baixado == null ? (pasta ?? "nenhuma pasta") : `catálogo baixado ${baixado.versao}`;
      const lida =
        baixado != null
          ? lerTarefasDoCanal(baixado.tarefas)
          : pasta === undefined
            ? { tarefas: [], invalidas: [] }
            : yield* lerPastaTarefas(pasta).pipe(
                Effect.mapError((erro) => new PastaTarefasInvalida({ pasta, cause: erro })),
              );
      for (const invalida of lida.invalidas) yield* Effect.logError(`tarefa fora do catálogo: ${invalida.message}`);
      const { servico, deFora } = deManifestos(lida.tarefas, { etapasDasSkills: skills.etapas, ...versoes });
      for (const { id, motivo } of deFora) {
        yield* Effect.logInfo(`tarefa ${id} fora do catálogo: ${EXPLICACOES[motivo]}`);
      }
      const noCatalogo = lida.tarefas
        .filter((tarefa) => !deFora.some((fora) => fora.id === tarefa.id))
        .map((tarefa) => tarefa.id);
      yield* Effect.logInfo(
        lida.tarefas.length === 0
          ? `nenhuma tarefa em ${origem}`
          : noCatalogo.length === 0
            ? `nenhuma tarefa do app em ${origem}: as ${lida.tarefas.length} lidas ficaram fora do catálogo`
            : `tarefas do app (${origem}): ${noCatalogo.join(", ")}`,
      );
      return servico;
    }),
  );
