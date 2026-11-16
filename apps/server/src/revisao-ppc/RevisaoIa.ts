// @effect-diagnostics nodeBuiltinImport:off -- o nonce da rodada (`node:crypto`)
/**
 * `RevisaoIa`: a revisão completa de um PPC com a IA da conta da pessoa (M1.11, etapa 4), conduzida
 * pelo servidor, não pelo provider.
 *
 * 1. **Preparar** (`prepararIa`, sem IA): o arquivo é convertido de novo no Worker da `AnalisePpc` (o
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
 */
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import {
  type BlocoRevisaoIa,
  type EstadoRevisaoIa,
  FalhaRevisaoPpc,
  type ModoRevisaoIa,
  type Provider,
  type UsoRevisaoIa,
} from "@simplifica-if/contratos-app";
import type { FontesNormativas } from "@simplifica-if/kb/FontesNormativas";
import * as Motor from "@simplifica-if/motor";
import { estimar } from "@simplifica-if/ppc/revisao-ia/estimativa";
import { pedidoT } from "@simplifica-if/ppc/revisao-ia/pedido";
import { MODELO_PADRAO } from "@simplifica-if/ppc/revisao-ia/tipos";
import type { ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import { type RegistroRevisaoIa, Revisoes } from "../persistencia/Revisoes.ts";
import { AnalisePpc, resultadoParaInterface } from "./AnalisePpc.ts";
import { alvoDosTrechos, julgarBloco, type PausaRevisao, type ResultadoBloco } from "./julgamento.ts";
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
    readonly preparar: (entrada: EntradaPreparoIa) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly iniciar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly pausar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly acompanhar: (id: string) => Stream.Stream<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly listar: Effect.Effect<ReadonlyArray<EstadoRevisaoIa>>;
  }
>()("@simplifica-if/server/revisao-ppc/RevisaoIa") {}

export interface OpcoesRevisaoIa {
  readonly paralelismo?: number;
  readonly tempoTurno?: Duration.Duration;
}

const MOTIVO_APP_FECHADO = "A revisão foi interrompida quando o app foi fechado. O que já foi revisado está guardado.";
const MOTIVO_PAUSA = "Pausada por você. O que já foi revisado está guardado.";

export const make = Effect.fn("RevisaoIa.make")(function* (opcoes: OpcoesRevisaoIa = {}) {
  const paralelismo = Math.max(1, opcoes.paralelismo ?? PARALELISMO);
  const tempoTurno = opcoes.tempoTurno ?? TEMPO_TURNO;
  const revisoes = yield* Revisoes;
  const analise = yield* AnalisePpc;
  const contextoKb = yield* Effect.context<FontesNormativas | SqlClient.SqlClient>();
  const contextoMotor = yield* Effect.context<Motor.Motor>();
  const execucoes = yield* FiberMap.make<string>();
  const mudancas = yield* PubSub.unbounded<string>();
  /** Os blocos em andamento de cada revisão (só em memória: depois de reiniciar, nada está em andamento). */
  const emAndamento = new Map<string, Set<string>>();

  // Uma revisão em andamento numa execução anterior do servidor ficou parada no meio.
  for (const id of yield* revisoes.emAndamento)
    yield* revisoes.alterar(id, { situacao: "pausada", motivo: MOTIVO_APP_FECHADO });

  const falha = (arquivo: string, motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });

  const buscar = (id: string) =>
    revisoes
      .buscar(id)
      .pipe(
        Effect.flatMap((r) =>
          r === null ? Effect.fail(falha("", "Esta revisão não existe mais.")) : Effect.succeed(r as RegistroRevisaoIa<PlanoRevisaoIa | null>),
        ),
      );

  const estado = Effect.fn("RevisaoIa.estado")(function* (registro: RegistroRevisaoIa<PlanoRevisaoIa | null>) {
    const gravados = new Map((yield* revisoes.blocos(registro.id)).map((b) => [b.bloco, b]));
    const andando = emAndamento.get(registro.id) ?? new Set();
    const uso: { -readonly [K in keyof UsoRevisaoIa]: number } = {
      entrada: 0,
      saida: 0,
      cacheLeitura: 0,
      cacheEscrita: 0,
      custoUsd: 0,
    };
    for (const b of gravados.values()) for (const k of Object.keys(uso) as (keyof UsoRevisaoIa)[]) uso[k] += b.uso[k];
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
    const analisado = yield* analise.revisarArquivo({
      arquivo: entrada.arquivo,
      gravar: false,
      ...(entrada.cnct === undefined ? {} : { cnct: entrada.cnct }),
      ...(entrada.forma === undefined ? {} : { forma: entrada.forma }),
    });
    const curso = analisado.revisao.curso;
    const nonce = NodeCrypto.randomBytes(8).toString("hex");
    const plano = yield* preparar({
      markdown: analisado.revisao.markdown,
      linhasTextoParaIa: analisado.revisao.linhasTextoParaIa,
      cnct: curso.cnct?.slug ?? null,
      modo: entrada.modo,
      nonce,
    }).pipe(
      Effect.provideContext(contextoKb),
      Effect.tapError((erro) => Effect.logError("revisão com IA: preparo falhou", erro)),
      Effect.mapError(() => falha(entrada.arquivo, "Não foi possível preparar a revisão com IA. Reinicie o app e tente de novo.")),
    );
    const estimativa = estimar(
      plano.blocos.map((b) => ({ caracteres: b.caracteres, fichas: b.fichas.length })),
      entrada.provider,
      paralelismo,
    );
    const id = `revisao-${NodeCrypto.randomUUID()}`;
    yield* revisoes.criar({
      id,
      arquivo: entrada.arquivo,
      sha256: analisado.sha256,
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
    const alvo = alvoDosTrechos(plano.markdown);
    const porId = new Map(plano.fichas.map((f) => [f.id, f]));
    const andando = new Set<string>();
    emAndamento.set(id, andando);
    const prontos = new Map(
      (yield* revisoes.blocos(id)).map((b) => [b.bloco, b.resultado as ResultadoBloco] as const),
    );

    const rodarBloco = (bloco: PlanoRevisaoIa["blocos"][number], pedido: string) =>
      Effect.gen(function* () {
        andando.add(bloco.id);
        yield* avisar(id);
        const julgado = yield* julgarBloco({
          provider: registro.provider,
          modelo: registro.modelo,
          nonce: plano.nonce,
          bloco,
          fichas: bloco.fichas.map((f) => porId.get(f)!),
          pedido,
          alvo,
          fontes: new Set(bloco.fontes),
          tempoTurno,
        });
        yield* revisoes.gravarBloco(id, {
          bloco: bloco.id,
          resultado: julgado.resultado,
          uso: julgado.uso,
          segundos: julgado.segundos,
        });
        prontos.set(bloco.id, julgado.resultado);
      }).pipe(
        Effect.ensuring(Effect.suspend(() => (andando.delete(bloco.id), avisar(id)))),
        Effect.provideContext(contextoMotor),
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
      );
      yield* rodarBloco(transversal, pedido);
    }

    // Concluir: a pré-conferência de novo, com os resultados conferidos da IA, no mesmo DOCX.
    const resultadosIa: ResultadoFichaIa[] = [...prontos.values()].flatMap((r) => r.resultados);
    const final = yield* analise.revisarArquivo({
      arquivo: registro.arquivo,
      gravar: true,
      sha256: registro.sha256,
      ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
      ...(registro.forma === null ? {} : { forma: registro.forma }),
      ia: { resultados: resultadosIa, fora: plano.fora },
    });
    yield* revisoes.alterar(id, { situacao: "concluida", resultado: resultadoParaInterface(registro.arquivo, final) });
  });

  const executarComPausa = (id: string) =>
    executar(id).pipe(
      Effect.catchTags({
        PausaRevisao: (pausa: PausaRevisao) =>
          revisoes.alterar(id, { situacao: "pausada", motivo: pausa.motivo, limite: pausa.limite }),
        FalhaRevisaoPpc: (erro: FalhaRevisaoPpc) =>
          revisoes.alterar(id, { situacao: "falhou", motivo: erro.motivo }),
      }),
      Effect.catchCause((causa) =>
        Effect.logError("revisão com IA: defeito", causa).pipe(
          Effect.andThen(
            revisoes.alterar(id, {
              situacao: "pausada",
              motivo: "A revisão parou por um erro interno do Simplifica IF. O que já foi revisado está guardado; tente retomar.",
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.suspend(() => (emAndamento.delete(id), avisar(id)))),
    );

  const iniciar = Effect.fn("RevisaoIa.iniciar")(function* (id: string) {
    const registro = yield* buscar(id);
    if (registro.situacao === "concluida") return yield* estado(registro);
    if (yield* FiberMap.has(execucoes, id)) return yield* estado(registro);
    if (registro.plano === null) return yield* falha(registro.arquivo, "Esta revisão não tem plano. Prepare-a de novo.");
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

  return RevisaoIa.of({ preparar: prepararRevisao, iniciar, pausar, acompanhar, listar });
});

/** Pede o `Motor`, a `AnalisePpc`, as `Revisoes`, as `FontesNormativas` e o `SqlClient` do `kb.sqlite`. */
export const layer = (opcoes: OpcoesRevisaoIa = {}) => Layer.effect(RevisaoIa, make(opcoes));
