// @effect-diagnostics nodeBuiltinImport:off -- o nonce da rodada (`node:crypto`)
/**
 * `RevisaoIa`: a revisão completa de um PPC com a IA da conta da pessoa (M1.11, etapa 4), conduzida
 * pelo servidor, não pelo provider.
 *
 * 1. **Preparar** (`prepararIa`, sem IA): o arquivo é convertido de novo no Worker do `RevisorPpc` (o
 *    mesmo da pré-conferência), o `preparo.ts` monta os blocos (lotes S, temas J, transversais) e o
 *    texto de cada pedido com o contexto do `kb.sqlite`, e a estimativa sai do tamanho real dos
 *    pedidos. O plano fica gravado (`Revisoes`).
 * 2. **Executar** (`iniciarIa`): os blocos pendentes vão ao `julgamento.ts`, `PARALELISMO` por vez; cada
 *    um se grava ao terminar. As transversais vão por último, sobre os resumos dos temas. Uma
 *    `PausaRevisao` (limite de taxa, cota, provider caído) para tudo e deixa a revisão `pausada` com a
 *    frase para a pessoa; `iniciarIa` de novo retoma só o que falta. Uma revisão `em_andamento` de uma
 *    execução anterior do servidor (app fechado) aparece como `pausada`.
 * 3. **Concluir**: o Worker roda a pré-conferência de novo com os resultados conferidos da IA, e a
 *    cópia comentada sai com as pendências do código e da IA juntas; o arquivo tem de ser o mesmo da
 *    preparação (sha256).
 *
 * Preparar e executar esperam o aviso de uso aceito (M1.8): sem ele, recusam com `AvisoNaoAceito`.
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import {
  type AvisoNaoAceito,
  type BlocoRevisaoIa,
  type EstadoRevisaoIa,
  FalhaRevisaoPpc,
  type ModoRevisaoIa,
  type Provider,
} from "@simplifica-if/contratos-app";
import type * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as PacoteContexto from "@simplifica-if/kb/PacoteContexto";
import * as Motor from "@simplifica-if/motor";
import { estimar } from "./estimativa.ts";
import { CRITERIO_PADRAO, type CriterioInconclusivo, pedidoT } from "@simplifica-if/ppc/revisao-ia/pedido";
import { teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { MODELO_PADRAO } from "./modelos.ts";
import { NOME_DA_FORMA, type ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import * as Preferencias from "../persistencia/Preferencias.ts";
import * as Revisoes from "../persistencia/Revisoes.ts";
import type * as Listas from "../persistencia/Listas.ts";
import * as RevisorPpc from "./RevisorPpc.ts";
import { criarLista } from "./ListaViva.ts";
import { julgarBloco, type PausaRevisao, type ResultadoBloco } from "./julgamento.ts";
import { type PlanoRevisaoIa, preparar } from "./preparo.ts";

/** Sessões ao mesmo tempo (o padrão; `OpcoesRevisaoIa.paralelismo` muda). */
export const PARALELISMO = 2;
export const TEMPO_TURNO = Duration.minutes(6);

export interface EntradaPreparoIa {
  readonly arquivo: string;
  readonly provider: Provider;
  readonly modo: ModoRevisaoIa;
  readonly modelo?: string;
  readonly cnct?: string;
  readonly forma?: string;
}

export class RevisaoIa extends Context.Service<
  RevisaoIa,
  {
    readonly preparar: (entrada: EntradaPreparoIa) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly iniciar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly pausar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly acompanhar: (id: string) => Stream.Stream<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly listar: Effect.Effect<ReadonlyArray<EstadoRevisaoIa>>;
    /** Para a execução, se houver, e apaga a revisão inteira (plano com o texto do PPC, blocos, tentativas). */
    readonly apagar: (id: string) => Effect.Effect<void>;
  }
>()("@simplifica-if/server/revisao-ppc/RevisaoIa") {}

export interface OpcoesRevisaoIa {
  readonly paralelismo?: number;
  readonly tempoTurno?: Duration.Duration;
  /**
   * O critério do INCONCLUSIVO das revisões novas (`pedido.ts`): `conservador`, o padrão, ou
   * `ausencia`, em avaliação (M1.11, etapa 5). A revisão grava o seu no plano; a retomada usa o dela.
   */
  readonly criterio?: CriterioInconclusivo;
}

/** Dias que uma revisão `preparada` e nunca iniciada fica guardada. */
export const DIAS_PREPARADA = 7;

const MOTIVO_APP_FECHADO = "A revisão foi interrompida quando o app foi fechado. O que já foi revisado está guardado.";
const MOTIVO_PAUSA = "Pausada por você. O que já foi revisado está guardado.";

export const make = Effect.fn("RevisaoIa.make")(function* (opcoes: OpcoesRevisaoIa = {}) {
  const paralelismo = Math.max(1, opcoes.paralelismo ?? PARALELISMO);
  const tempoTurno = opcoes.tempoTurno ?? TEMPO_TURNO;
  const criterio = opcoes.criterio ?? CRITERIO_PADRAO;
  const revisoes = yield* Revisoes.Revisoes;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const contextoKb = yield* Effect.context<FontesNormativas.FontesNormativas | PacoteContexto.PacoteContexto>();
  const contextoMotor = yield* Effect.context<Motor.Motor | FileSystem.FileSystem>();
  const contextoListas = yield* Effect.context<Listas.Listas>();
  const execucoes = yield* FiberMap.make<string>();
  const expirar = DateTime.now.pipe(
    Effect.map((agora) => DateTime.formatIso(DateTime.subtract(agora, { days: DIAS_PREPARADA }))),
    Effect.flatMap(revisoes.expirarPreparadas),
  );
  const mudancas = yield* PubSub.unbounded<string>();
  /** Os blocos em andamento de cada revisão (só em memória: depois de reiniciar, nada está em andamento). */
  const emAndamento = new Map<string, Set<string>>();

  // Uma revisão em andamento numa execução anterior do servidor ficou parada no meio.
  // Revisões preparadas e nunca iniciadas guardam o texto do PPC à toa: expiram em `DIAS_PREPARADA`.
  yield* expirar;
  for (const id of yield* revisoes.emAndamento)
    yield* revisoes.alterar(id, { situacao: "pausada", motivo: MOTIVO_APP_FECHADO });

  const falha = (arquivo: string, motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });

  const buscar = (id: string) =>
    revisoes
      .buscar(id)
      .pipe(
        Effect.flatMap((r) =>
          r === null
            ? Effect.fail(falha("", "Esta revisão não existe mais."))
            : Effect.succeed(r as Revisoes.RegistroRevisaoIa<PlanoRevisaoIa | null>),
        ),
      );

  const estado = Effect.fn("RevisaoIa.estado")(function* (registro: Revisoes.RegistroRevisaoIa<PlanoRevisaoIa | null>) {
    const gravados = new Map((yield* revisoes.blocos(registro.id)).map((b) => [b.bloco, b]));
    const andando = emAndamento.get(registro.id) ?? new Set();
    // O uso é o de todas as tentativas, gravadas uma a uma: inclui as dos blocos que não terminaram.
    const uso = yield* revisoes.usoTotal(registro.id);
    const blocos: BlocoRevisaoIa[] = (registro.plano?.blocos ?? []).map((b) => {
      const gravado = gravados.get(b.id);
      const resultado = gravado?.resultado as ResultadoBloco | undefined;
      return {
        id: b.id,
        tipo: b.tipo,
        tema: b.tema,
        ordemTema: b.ordemTema,
        fichas: b.fichas.length,
        estado: gravado ? "pronto" : andando.has(b.id) ? "em_andamento" : "pendente",
        naoConferidas: resultado?.resultados.filter((r) => r.estado === "FALHOU").length ?? 0,
        segundos: gravado?.segundos ?? null,
      };
    });
    return {
      id: registro.id,
      arquivoOriginal: registro.arquivo,
      provider: registro.provider,
      modelo: registro.modelo,
      modo: registro.modo,
      situacao: registro.situacao,
      motivo: registro.motivo,
      limite: registro.limite,
      blocos,
      estimativa: registro.estimativa,
      uso: { ...uso, custoUsd: Math.round(uso.custoUsd * 1000) / 1000 },
      resultado: registro.resultado,
      criadaEm: registro.criadaEm,
      atualizadaEm: registro.atualizadaEm,
    } satisfies EstadoRevisaoIa;
  });

  const estadoPorId = (id: string) => buscar(id).pipe(Effect.flatMap(estado));
  const avisar = (id: string) => PubSub.publish(mudancas, id).pipe(Effect.asVoid);

  /* ------------------------------------------------------------ preparar */

  const prepararRevisao = Effect.fn("RevisaoIa.preparar")(function* (entrada: EntradaPreparoIa) {
    yield* exigirAviso;
    const revisado = yield* revisor.revisarArquivo({
      arquivo: entrada.arquivo,
      gravar: false,
      ...(entrada.cnct === undefined ? {} : { cnct: entrada.cnct }),
      ...(entrada.forma === undefined ? {} : { forma: entrada.forma }),
    });
    const curso = revisado.revisao.curso;
    const nonce = NodeCrypto.randomBytes(8).toString("hex");
    const plano = yield* preparar({
      markdown: revisado.revisao.markdown,
      linhasTextoParaIa: revisado.revisao.linhasTextoParaIa,
      cnct: curso.cnct?.slug ?? null,
      curso: curso.cnct
        ? `${curso.cnct.denominacao}${curso.forma ? `, forma de oferta ${NOME_DA_FORMA[curso.forma] ?? curso.forma}` : ", forma de oferta não identificada"}`
        : null,
      modo: entrada.modo,
      nonce,
      criterio,
    }).pipe(
      Effect.provideContext(contextoKb),
      Effect.tapError((erro) => Effect.logError("revisão com IA: preparo falhou", erro)),
      Effect.mapError(() =>
        falha(entrada.arquivo, "Não foi possível preparar a revisão com IA. Reinicie o app e tente de novo."),
      ),
    );
    const estimativa = estimar(
      plano.blocos.map((b) => ({ caracteres: b.caracteres, fichas: b.fichas.length })),
      entrada.provider,
      paralelismo,
    );
    // Preparar de novo o mesmo arquivo substitui a preparada anterior (nunca iniciada).
    for (const antiga of yield* revisoes.preparadasDoArquivo(entrada.arquivo)) yield* revisoes.apagar(antiga);
    const id = `revisao-${NodeCrypto.randomUUID()}`;
    yield* revisoes.criar({
      id,
      arquivo: entrada.arquivo,
      sha256: revisado.sha256,
      provider: entrada.provider,
      modelo: entrada.modelo ?? MODELO_PADRAO[entrada.provider] ?? null,
      modo: entrada.modo,
      cnct: curso.cnct?.slug ?? null,
      forma: curso.forma,
      situacao: "preparada",
      plano,
      estimativa,
    });
    return yield* estadoPorId(id);
  });

  /* ------------------------------------------------------------ executar */

  const executar = Effect.fn("RevisaoIa.executar")(function* (id: string) {
    const registro = yield* buscar(id);
    const plano = registro.plano!;
    const porId = new Map(plano.fichas.map((f) => [f.id, f]));
    const andando = new Set<string>();
    emAndamento.set(id, andando);
    const prontos = new Map((yield* revisoes.blocos(id)).map((b) => [b.bloco, b.resultado as ResultadoBloco] as const));

    const rodarBloco = Effect.fn("RevisaoIa.rodarBloco")(
      function* (bloco: PlanoRevisaoIa["blocos"][number], pedido: string, conteudoPpc?: string) {
        andando.add(bloco.id);
        yield* avisar(id);
        const julgado = yield* julgarBloco({
          provider: registro.provider,
          modelo: registro.modelo,
          nonce: plano.nonce,
          bloco,
          fichas: bloco.fichas.map((f) => porId.get(f)!),
          pedido,
          ...(conteudoPpc === undefined ? {} : { conteudoPpc }),
          fontes: new Set(bloco.fontes),
          tempoTurno,
          criterio: plano.criterio ?? CRITERIO_PADRAO,
          revisaoHumana: teveTextoParaIa(plano.markdown),
          registrarTentativa: (t) => revisoes.gravarTentativa(id, bloco.id, t),
        });
        yield* revisoes.gravarBloco(id, {
          bloco: bloco.id,
          resultado: julgado.resultado,
          uso: julgado.uso,
          segundos: julgado.segundos,
        });
        prontos.set(bloco.id, julgado.resultado);
      },
      (efeito, bloco) =>
        efeito.pipe(
          Effect.ensuring(Effect.suspend(() => (andando.delete(bloco.id), avisar(id)))),
          Effect.provideContext(contextoMotor),
        ),
    );

    const comuns = plano.blocos.filter((b) => b.tipo !== "T" && !prontos.has(b.id));
    yield* Effect.forEach(comuns, (b) => rodarBloco(b, b.pedido), { concurrency: paralelismo, discard: true });

    const transversal = plano.blocos.find((b) => b.tipo === "T");
    if (transversal && !prontos.has(transversal.id) && plano.transversais) {
      const resumos = plano.blocos.flatMap((b) => {
        const r = prontos.get(b.id)?.resumo;
        return r ? [{ tema: b.tema, resumo: r }] : [];
      });
      const resultados = [...prontos.values()].flatMap((r) =>
        r.resultados.map((x) => ({ ficha: x.ficha, titulo: porId.get(x.ficha)?.titulo ?? x.ficha, estado: x.estado })),
      );
      const pedido = pedidoT(
        transversal,
        transversal.fichas.map((f) => porId.get(f)!),
        resumos,
        resultados,
        plano.transversais.trechos,
        plano.transversais.contexto,
        plano.nonce,
        plano.criterio ?? CRITERIO_PADRAO,
      );
      // O alvo dos trechos das transversais é só o PPC entregue (`trechos`), nunca os resumos da IA.
      yield* rodarBloco(transversal, pedido, plano.transversais.trechos);
    }

    // Concluir: a pré-conferência de novo, com os resultados conferidos da IA, no mesmo DOCX.
    const resultadosIa: ResultadoFichaIa[] = [...prontos.values()].flatMap((r) => r.resultados);
    const final = yield* revisor.revisarArquivo({
      arquivo: registro.arquivo,
      gravar: true,
      sha256: registro.sha256,
      ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
      ...(registro.forma === null ? {} : { forma: registro.forma }),
      ia: { resultados: resultadosIa, fora: plano.fora },
    });
    // A lista viva (etapa 5b) desta revisão: a situação marcada na pré-conferência do mesmo arquivo passa a ela.
    const resultado = yield* criarLista({
      arquivo: registro.arquivo,
      revisado: final,
      revisao: id,
      provider: registro.provider,
      modelo: registro.modelo,
    }).pipe(Effect.provideContext(contextoListas));
    yield* revisoes.alterar(id, { situacao: "concluida", resultado });
  });

  const executarComPausa = (id: string) =>
    executar(id).pipe(
      Effect.catchTags({
        PausaRevisao: (pausa: PausaRevisao) =>
          revisoes.alterar(id, { situacao: "pausada", motivo: pausa.motivo, limite: pausa.limite }),
        FalhaRevisaoPpc: (erro: FalhaRevisaoPpc) => revisoes.alterar(id, { situacao: "falhou", motivo: erro.motivo }),
      }),
      Effect.catchCause((causa) =>
        Effect.logError("revisão com IA: defeito", causa).pipe(
          Effect.andThen(
            revisoes.alterar(id, {
              situacao: "pausada",
              motivo:
                "A revisão parou por um erro interno do Simplifica IF. O que já foi revisado está guardado; tente retomar.",
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.suspend(() => (emAndamento.delete(id), avisar(id)))),
    );

  const iniciar = Effect.fn("RevisaoIa.iniciar")(function* (id: string) {
    yield* exigirAviso;
    const registro = yield* buscar(id);
    if (registro.situacao === "concluida") return yield* estado(registro);
    if (yield* FiberMap.has(execucoes, id)) return yield* estado(registro);
    if (registro.plano === null)
      return yield* falha(registro.arquivo, "Esta revisão não tem plano. Prepare-a de novo.");
    yield* revisoes.alterar(id, { situacao: "em_andamento" });
    yield* FiberMap.run(execucoes, id, executarComPausa(id), { onlyIfMissing: true });
    yield* avisar(id);
    return yield* estadoPorId(id);
  });

  const pausar = Effect.fn("RevisaoIa.pausar")(function* (id: string) {
    const registro = yield* buscar(id);
    if (registro.situacao !== "em_andamento") return yield* estado(registro);
    yield* FiberMap.remove(execucoes, id);
    yield* revisoes.alterar(id, { situacao: "pausada", motivo: MOTIVO_PAUSA });
    yield* avisar(id);
    return yield* estadoPorId(id);
  });

  const terminou = (e: EstadoRevisaoIa) => e.situacao === "concluida" || e.situacao === "falhou";

  const acompanhar = (id: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const inscricao = yield* PubSub.subscribe(mudancas);
        const inicial = yield* estadoPorId(id);
        const seguintes = Stream.fromSubscription(inscricao).pipe(
          Stream.filter((alterada) => alterada === id),
          Stream.mapEffect(() => estadoPorId(id)),
        );
        return Stream.make(inicial).pipe(
          Stream.concat(terminou(inicial) ? Stream.empty : seguintes),
          Stream.takeUntil(terminou),
        );
      }),
    );

  const listar = revisoes.listar.pipe(
    Effect.flatMap((linhas) => Effect.forEach(linhas, (r) => estado({ ...r, plano: null }))),
  );

  const apagar = Effect.fn("RevisaoIa.apagar")(function* (id: string) {
    yield* FiberMap.remove(execucoes, id);
    yield* revisoes.apagar(id);
    yield* avisar(id);
  });

  return RevisaoIa.of({
    preparar: prepararRevisao,
    iniciar,
    pausar,
    acompanhar,
    listar: expirar.pipe(Effect.andThen(listar)),
    apagar,
  });
});

/**
 * Pede o `Motor`, o `FileSystem`, o `RevisorPpc`, as `Revisoes`, as `Preferencias`, as `FontesNormativas`
 * e o `PacoteContexto` do `kb.sqlite`.
 */
export const layer = (opcoes: OpcoesRevisaoIa = {}) => Layer.effect(RevisaoIa, make(opcoes));
