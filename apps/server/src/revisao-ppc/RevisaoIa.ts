/**
 * `RevisaoIa`: a revisão completa de um PPC com a IA da conta da pessoa (M1.11, etapa 4), conduzida
 * pelo servidor, não pelo provider.
 *
 * 1. **Preparar** (`prepararIa`, sem IA nem o `.docx`): a leitura nasce de uma lista viva, e o
 *    `preparo.ts` monta os blocos (lotes S, temas J, transversais) e o texto de cada pedido sobre o texto
 *    e o curso que a lista guarda, com o contexto do `kb.sqlite`; a estimativa sai do tamanho real dos
 *    pedidos. O plano fica gravado (`Revisoes`), e preparar de novo a mesma lista substitui a preparada.
 * 2. **Executar** (`iniciarIa`): a revisão se liga à lista dela (uma leitura por lista), e os
 *    blocos pendentes vão ao `julgamento.ts`, `PARALELISMO` por vez; cada um se grava ao terminar e é
 *    mesclado na mesma lista (`Listas.mesclarIa`, sob `Listas.exclusivo`), com a montagem leve do
 *    `RevisorPpc` (sem Worker e sem reler o `.docx`): a pessoa vê os achados de cada bloco pronto, e a
 *    pausa não os prende no banco. As transversais vão por último, sobre os resumos dos temas. Uma
 *    `PausaRevisao` de limite de taxa ou de cota para tudo na hora; a de tempo esgotado ou de provider
 *    caído para de começar blocos e deixa o bloco irmão em andamento terminar e se gravar. A revisão
 *    fica `pausada` com a frase para a pessoa e o bloco que parou (`blocoPausado`); `iniciarIa` de novo
 *    retoma só o que falta, depois de mesclar de novo o que já estava pronto (o app pode ter fechado
 *    entre o bloco e a mesclagem). Uma revisão `em_andamento` de uma execução anterior do servidor (app
 *    fechado) aparece como `pausada`.
 * 3. **Concluir**: o último bloco mesclado, a cópia comentada da mesma lista é regravada com os
 *    resultados da IA (`copia-lista.ts`), e cada pendência guarda onde ficou no documento. O conteúdo da
 *    lista (sha256) tem de ser o da preparação: depois de "Enviar a versão corrigida", a leitura
 *    preparada sobre o texto anterior não começa.
 *
 * O andamento ao vivo (a etapa de cada bloco, quando começou, o último sinal da IA) fica em memória, com
 * o resumo dos blocos do plano: o estado a cada mudança não relê o plano (centenas de KB) do banco, e os
 * blocos gravados e o uso só se releem quando um bloco termina ou uma tentativa se grava.
 *
 * Preparar e executar esperam o aviso de uso aceito (M1.8): sem ele, recusam com `AvisoNaoAceito`.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
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
  type EtapaBlocoIa,
  FalhaRevisaoPpc,
  type ModoRevisaoIa,
  type PendenciaRevisao,
  type Provider,
  type ResultadoRevisaoPpc,
  type UsoRevisaoIa,
} from "@simplifica-if/contratos-app";
import type * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as PacoteContexto from "@simplifica-if/kb/PacoteContexto";
import type * as Motor from "@simplifica-if/motor";
import { estimar } from "./estimativa.ts";
import { CRITERIO_PADRAO, type CriterioInconclusivo, pedidoT } from "@simplifica-if/ppc/revisao-ia/pedido";
import { teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { MODELO_PADRAO } from "./modelos.ts";
import { chavePendencia, type EntradaIa, estadoDaIa } from "@simplifica-if/ppc/revisao-previa";
import * as Listas from "../persistencia/Listas.ts";
import * as Preferencias from "../persistencia/Preferencias.ts";
import * as Revisoes from "../persistencia/Revisoes.ts";
import * as RevisorPpc from "./RevisorPpc.ts";
import { cursoEscolhido, regravarCopia } from "./copia-lista.ts";
import { novoNonce } from "./criar-lista.ts";
import { julgarBloco, type PausaRevisao, type ResultadoBloco } from "./julgamento.ts";
import { cursoEmTexto, type PlanoRevisaoIa, preparar } from "./preparo.ts";

/** Sessões ao mesmo tempo (o padrão; `OpcoesRevisaoIa.paralelismo` muda). */
export const PARALELISMO = 2;
/**
 * Tempo máximo de um turno. Não é tempo de inatividade: os drivers não repassam o raciocínio da IA
 * (thinking), e um limite curto sobre o texto recebido pausaria à toa quem pensa antes de responder.
 */
export const TEMPO_TURNO = Duration.minutes(6);

export interface EntradaPreparoIa {
  /** A lista viva cujo texto e curso a leitura confere. */
  readonly lista: string;
  readonly provider: Provider;
  readonly modo: ModoRevisaoIa;
  readonly modelo?: string;
}

export class RevisaoIa extends Context.Service<
  RevisaoIa,
  {
    readonly preparar: (entrada: EntradaPreparoIa) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly iniciar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly pausar: (id: string) => Effect.Effect<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly acompanhar: (id: string) => Stream.Stream<EstadoRevisaoIa, FalhaRevisaoPpc>;
    readonly listar: Effect.Effect<ReadonlyArray<EstadoRevisaoIa>>;
    /**
     * Para a execução, se houver, e apaga a revisão inteira (plano com o texto do PPC, blocos,
     * tentativas). A lista fica, com os resultados já mesclados ("Encerrar leitura por aqui").
     */
    readonly apagar: (id: string) => Effect.Effect<void>;
    /**
     * Apaga as leituras que nenhuma lista referencia mais (a lista foi apagada, expirou ou foi
     * substituída): a leitura vive enquanto a lista dela vive, inclusive a concluída, que guarda o texto
     * do PPC no plano e os trechos no resultado.
     */
    readonly apagarOrfas: Effect.Effect<void>;
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
const SEM_LISTA =
  "A lista de pendências deste PPC foi apagada ou trocada (outro curso, outra versão do arquivo). Revise o PPC de novo para começar outra conferência com IA.";

/** O que o estado mostra de cada bloco do plano, guardado em memória (o plano não se relê a cada mudança). */
interface ResumoBloco {
  readonly id: string;
  readonly tipo: BlocoRevisaoIa["tipo"];
  readonly tema: string;
  readonly ordemTema: number;
  readonly titulosFichas: ReadonlyArray<string>;
}

/** Um bloco em andamento nesta execução. */
interface Andamento {
  readonly etapa: EtapaBlocoIa;
  readonly iniciadoEm: string;
  readonly ultimaAtividadeEm: string | null;
}

/** Os blocos gravados e o uso, como o banco os tem: relidos só quando um bloco termina ou uma tentativa se grava. */
interface Gravados {
  readonly blocos: ReadonlyMap<string, Revisoes.RegistroBlocoIa>;
  readonly uso: UsoRevisaoIa;
}

const resumoDoPlano = (plano: PlanoRevisaoIa): ReadonlyArray<ResumoBloco> => {
  const titulos = new Map(plano.fichas.map((f) => [f.id, f.titulo]));
  return plano.blocos.map((b) => ({
    id: b.id,
    tipo: b.tipo,
    tema: b.tema,
    ordemTema: b.ordemTema,
    titulosFichas: b.fichas.map((f) => titulos.get(f) ?? f),
  }));
};

/**
 * Os resultados da IA que a lista passa a ter: os desta leitura e, das fichas que ela ainda não leu, os
 * que a lista já tinha de uma leitura anterior encerrada antes do fim. Da mesma leitura, os novos já
 * contêm os anteriores: mesclar de novo dá o mesmo resultado.
 */
export function unirResultadosIa(anterior: EntradaIa | null, nova: EntradaIa): EntradaIa {
  const lidas = new Set(nova.resultados.map((r) => r.ficha));
  const mantidos = (anterior?.resultados ?? []).filter((r) => !lidas.has(r.ficha));
  const resultados = [...mantidos, ...nova.resultados];
  const comResultado = new Set(resultados.map((r) => r.ficha));
  return {
    resultados,
    fora: nova.fora.filter((f) => !comResultado.has(f)),
    parcial: nova.parcial === true,
  };
}

const agoraIso = Effect.map(DateTime.now, DateTime.formatIso);

export const make = Effect.fn("RevisaoIa.make")(function* (opcoes: OpcoesRevisaoIa = {}) {
  const paralelismo = Math.max(1, opcoes.paralelismo ?? PARALELISMO);
  const tempoTurno = opcoes.tempoTurno ?? TEMPO_TURNO;
  const criterio = opcoes.criterio ?? CRITERIO_PADRAO;
  const revisoes = yield* Revisoes.Revisoes;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const listas = yield* Listas.Listas;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const contextoKb = yield* Effect.context<FontesNormativas.FontesNormativas | PacoteContexto.PacoteContexto>();
  const contextoMotor = yield* Effect.context<Motor.Motor | FileSystem.FileSystem>();
  const contextoCopia = yield* Effect.context<Listas.Listas | RevisorPpc.RevisorPpc | FileSystem.FileSystem>();
  const aleatorio = yield* SecureRandom.SecureRandom;
  const execucoes = yield* FiberMap.make<string>();
  const expirar = DateTime.now.pipe(
    Effect.map((agora) => DateTime.formatIso(DateTime.subtract(agora, { days: DIAS_PREPARADA }))),
    Effect.flatMap(revisoes.expirarPreparadas),
  );
  const mudancas = yield* PubSub.unbounded<string>();
  // Só em memória: depois de reiniciar, nada está em andamento.
  /** O resumo dos blocos do plano de cada revisão. */
  const resumos = new Map<string, ReadonlyArray<ResumoBloco>>();
  /** Os blocos em andamento de cada revisão que está rodando. */
  const andamentos = new Map<string, Map<string, Andamento>>();
  /** Os blocos gravados e o uso das revisões que estão rodando. */
  const gravadosEmCache = new Map<string, Gravados>();
  /** O bloco que parou a leitura (tempo, falha do provider, limite). */
  const pausados = new Map<string, string>();

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

  /** O resumo dos blocos: da memória ou, na primeira vez, do plano (lido uma vez só). */
  const resumoDe = Effect.fn("RevisaoIa.resumo")(function* (id: string) {
    const guardado = resumos.get(id);
    if (guardado !== undefined) return guardado;
    const plano = (yield* revisoes.buscar(id))?.plano as PlanoRevisaoIa | null | undefined;
    if (plano === null || plano === undefined) return [];
    const resumo = resumoDoPlano(plano);
    resumos.set(id, resumo);
    return resumo;
  });

  /** Os blocos gravados e o uso: em cache enquanto a revisão roda (as ações da lista também somam ao uso). */
  const gravadosDe = Effect.fn("RevisaoIa.gravados")(function* (id: string) {
    const guardado = gravadosEmCache.get(id);
    if (guardado !== undefined) return guardado;
    const gravados: Gravados = {
      blocos: new Map((yield* revisoes.blocos(id)).map((b) => [b.bloco, b])),
      // O uso é o de todas as tentativas, gravadas uma a uma: inclui as dos blocos que não terminaram.
      uso: yield* revisoes.usoTotal(id),
    };
    if (andamentos.has(id)) gravadosEmCache.set(id, gravados);
    return gravados;
  });

  const estado = Effect.fn("RevisaoIa.estado")(function* (
    registro: Revisoes.RegistroRevisaoIa<unknown>,
    resumo: ReadonlyArray<ResumoBloco>,
  ) {
    const { blocos: gravados, uso } = yield* gravadosDe(registro.id);
    const andando = andamentos.get(registro.id);
    const blocos: BlocoRevisaoIa[] = resumo.map((b) => {
      const gravado = gravados.get(b.id);
      const resultado = gravado?.resultado as ResultadoBloco | undefined;
      const andamento = gravado ? undefined : andando?.get(b.id);
      return {
        id: b.id,
        tipo: b.tipo,
        tema: b.tema,
        ordemTema: b.ordemTema,
        fichas: b.titulosFichas.length,
        titulosFichas: [...b.titulosFichas],
        estado: gravado ? "pronto" : andamento ? "em_andamento" : "pendente",
        etapa: andamento?.etapa ?? null,
        iniciadoEm: andamento?.iniciadoEm ?? null,
        ultimaAtividadeEm: andamento?.ultimaAtividadeEm ?? null,
        naoConferidas: resultado?.resultados.filter((r) => r.estado === "FALHOU").length ?? 0,
        pendenciasEncontradas: resultado?.resultados.filter((r) => estadoDaIa(r) !== null).length ?? 0,
        segundos: gravado?.segundos ?? null,
      };
    });
    return {
      id: registro.id,
      lista: registro.lista,
      arquivoOriginal: registro.arquivo,
      provider: registro.provider,
      modelo: registro.modelo,
      modo: registro.modo,
      situacao: registro.situacao,
      motivo: registro.motivo,
      limite: registro.limite,
      blocoPausado:
        registro.situacao === "pausada" || registro.situacao === "falhou" ? (pausados.get(registro.id) ?? null) : null,
      blocos,
      estimativa: registro.estimativa,
      uso: { ...uso, custoUsd: Math.round(uso.custoUsd * 1000) / 1000 },
      resultado: registro.resultado,
      criadaEm: registro.criadaEm,
      atualizadaEm: registro.atualizadaEm,
    } satisfies EstadoRevisaoIa;
  });

  /** O estado agora, sem o plano: a linha da revisão, o resumo em memória e os gravados em cache. */
  const estadoPorId = Effect.fn("RevisaoIa.estadoPorId")(function* (id: string) {
    const registro = yield* revisoes.resumo(id);
    if (registro === null) return yield* falha("", "Esta revisão não existe mais.");
    return yield* estado(registro, yield* resumoDe(id));
  });
  const avisar = (id: string) => PubSub.publish(mudancas, id).pipe(Effect.asVoid);

  /* ------------------------------------------------------------ preparar */

  const prepararRevisao = Effect.fn("RevisaoIa.preparar")(function* (entrada: EntradaPreparoIa) {
    yield* exigirAviso;
    const lista = yield* listas.buscar(entrada.lista);
    if (lista === null) return yield* falha("", "Esta lista de pendências não existe mais. Revise o PPC de novo.");
    const nonce = yield* novoNonce(aleatorio);
    const plano = yield* preparar({
      markdown: lista.markdown,
      linhasTextoParaIa: lista.linhasTextoParaIa,
      cnct: lista.cnct,
      curso: cursoEmTexto(lista.resultado.curso),
      modo: entrada.modo,
      nonce,
      criterio,
    }).pipe(
      Effect.provideContext(contextoKb),
      Effect.tapError((erro) => Effect.logError("revisão com IA: preparo falhou", erro)),
      Effect.mapError(() =>
        falha(lista.arquivo, "Não foi possível preparar a revisão com IA. Reinicie o app e tente de novo."),
      ),
    );
    const estimativa = estimar(
      plano.blocos.map((b) => ({ caracteres: b.caracteres, fichas: b.fichas.length })),
      entrada.provider,
      paralelismo,
    );
    // Preparar de novo a mesma lista substitui a preparada anterior (nunca iniciada).
    for (const antiga of yield* revisoes.daLista(lista.id)) {
      if (antiga.situacao !== "preparada") continue;
      yield* revisoes.apagar(antiga.id);
      resumos.delete(antiga.id);
    }
    const id = `revisao-${yield* aleatorio.uuidV4()}`;
    yield* revisoes.criar({
      id,
      lista: lista.id,
      arquivo: lista.arquivo,
      sha256: lista.sha256,
      provider: entrada.provider,
      modelo: entrada.modelo ?? MODELO_PADRAO[entrada.provider] ?? null,
      modo: entrada.modo,
      situacao: "preparada",
      plano,
      estimativa,
    });
    resumos.set(id, resumoDoPlano(plano));
    return yield* estadoPorId(id);
  });

  /* ------------------------------------------------------------ a lista da revisão */

  /**
   * A lista da revisão, com o conteúdo da preparação, ou a falha que para a leitura: a lista saiu (outro
   * curso, outra revisão do arquivo) ou passou a outra versão do arquivo.
   */
  const listaDa = Effect.fn("RevisaoIa.listaDa")(function* (registro: Revisoes.RegistroRevisaoIa<unknown>) {
    const lista = registro.lista === null ? null : yield* listas.buscar(registro.lista);
    if (lista === null || lista.sha256 !== registro.sha256) return yield* falha(registro.arquivo, SEM_LISTA);
    return lista;
  });

  /**
   * Os blocos prontos mesclados na lista da revisão, sempre na mesma lista: o resultado e os resultados
   * da IA refeitos com todos os blocos prontos (a montagem leve do `RevisorPpc`), e só as pendências
   * novas inseridas. Idempotente. Quem chama segura `Listas.exclusivo`. Devolve a lista.
   */
  const mesclar = Effect.fn("RevisaoIa.mesclar")(function* (
    registro: Revisoes.RegistroRevisaoIa<unknown>,
    plano: PlanoRevisaoIa,
    prontos: ReadonlyMap<string, ResultadoBloco>,
    completa: boolean,
  ) {
    const lista = yield* listaDa(registro);
    const ia = unirResultadosIa(lista.resultadosIa, {
      resultados: [...prontos.values()].flatMap((r) => r.resultados),
      fora: plano.fora,
      parcial: !completa,
    });
    const { resultado, pendencias } = yield* revisor.montar({
      arquivo: lista.arquivo,
      markdown: lista.markdown,
      ...cursoEscolhido(lista),
      arquivoComentado: lista.resultado.arquivoComentado,
      ia,
    });
    const atuais = yield* listas.pendencias(lista.id);
    const existentes = new Set(atuais.map((p) => p.chave));
    const chavesResultado = new Set<string>();
    const novas: { chave: string; pendencia: PendenciaRevisao }[] = [];
    for (const pendencia of pendencias) {
      const chave = chavePendencia(pendencia);
      chavesResultado.add(chave);
      if (existentes.has(chave)) continue;
      existentes.add(chave);
      novas.push({ chave, pendencia });
    }
    // Se uma ficha foi relida depois de "Encerrar leitura por aqui", pendências antigas dela da IA que
    // não existem mais no resultado recalculado saem de `pendencias_vivas` para acompanhar a régua.
    const obsoletas = atuais
      .filter((p) => p.pendencia.origem === "ia" && !chavesResultado.has(p.chave))
      .map((p) => p.chave);
    yield* listas.mesclarIa(
      lista.id,
      {
        resultado: { ...resultado, lista: lista.id },
        resultadosIa: ia,
        revisao: registro.id,
        provider: registro.provider,
        modelo: registro.modelo,
      },
      novas,
      obsoletas,
    );
    return lista.id;
  });

  /* ------------------------------------------------------------ executar */

  const mudarEtapa = Effect.fn("RevisaoIa.mudarEtapa")(function* (id: string, bloco: string, etapa: EtapaBlocoIa) {
    const andando = andamentos.get(id);
    const atual = andando?.get(bloco);
    if (andando === undefined || atual === undefined) return;
    const agora = yield* agoraIso;
    andando.set(bloco, {
      ...atual,
      etapa,
      ultimaAtividadeEm: etapa === "recebendo" ? agora : atual.ultimaAtividadeEm,
    });
    yield* avisar(id);
  });

  const executar = Effect.fn("RevisaoIa.executar")(function* (id: string) {
    const registro = yield* buscar(id);
    const plano = registro.plano!;
    resumos.set(id, resumoDoPlano(plano));
    const porId = new Map(plano.fichas.map((f) => [f.id, f]));
    const andando = new Map<string, Andamento>();
    andamentos.set(id, andando);
    gravadosEmCache.delete(id);
    pausados.delete(id);
    const prontos = new Map((yield* revisoes.blocos(id)).map((b) => [b.bloco, b.resultado as ResultadoBloco] as const));
    const total = plano.blocos.length;
    // O app pode ter fechado entre gravar um bloco e mesclá-lo: o que já estava pronto entra de novo.
    if (prontos.size > 0) yield* listas.exclusivo(mesclar(registro, plano, prontos, prontos.size === total));
    /** A pausa que não interrompe o bloco irmão (tempo esgotado, provider caído): nada novo começa. */
    let pausa: PausaRevisao | null = null;

    const rodarBloco = Effect.fn("RevisaoIa.rodarBloco")(
      function* (bloco: PlanoRevisaoIa["blocos"][number], pedido: string, conteudoPpc?: string) {
        andando.set(bloco.id, { etapa: "aguardando", iniciadoEm: yield* agoraIso, ultimaAtividadeEm: null });
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
          registrarTentativa: (t) =>
            revisoes
              .gravarTentativa(id, bloco.id, t)
              .pipe(Effect.andThen(Effect.sync(() => gravadosEmCache.delete(id)))),
          aoEtapa: (etapa) => mudarEtapa(id, bloco.id, etapa),
        });
        yield* revisoes.gravarBloco(id, {
          bloco: bloco.id,
          resultado: julgado.resultado,
          uso: julgado.uso,
          segundos: julgado.segundos,
        });
        prontos.set(bloco.id, julgado.resultado);
        gravadosEmCache.delete(id);
        // Os achados do bloco já na lista; o último bloco é mesclado de novo na conclusão.
        if (prontos.size < total) yield* listas.exclusivo(mesclar(registro, plano, prontos, false));
      },
      (efeito, bloco) =>
        efeito.pipe(
          Effect.catchTags({
            PausaRevisao: (p: PausaRevisao) => {
              // Limite de taxa ou cota: o bloco irmão bateria no mesmo limite; para tudo na hora.
              if (p.limite) {
                pausados.set(id, bloco.id);
                return Effect.fail(p);
              }
              if (pausa === null) {
                pausados.set(id, bloco.id);
                pausa = p;
              }
              return Effect.void;
            },
          }),
          Effect.ensuring(Effect.suspend(() => (andando.delete(bloco.id), avisar(id)))),
          Effect.provideContext(contextoMotor),
        ),
    );
    /** Começa o bloco só se nenhum outro pausou a leitura. */
    const seNaoPausou = (efeito: Effect.Effect<void, FalhaRevisaoPpc | PausaRevisao>) =>
      Effect.suspend(() => (pausa === null ? efeito : Effect.void));

    const comuns = plano.blocos.filter((b) => b.tipo !== "T" && !prontos.has(b.id));
    yield* Effect.forEach(comuns, (b) => seNaoPausou(rodarBloco(b, b.pedido)), {
      concurrency: paralelismo,
      discard: true,
    });
    if (pausa !== null) return yield* Effect.fail<PausaRevisao>(pausa);

    const transversal = plano.blocos.find((b) => b.tipo === "T");
    if (transversal && !prontos.has(transversal.id) && plano.transversais) {
      const resumosTemas = plano.blocos.flatMap((b) => {
        const r = prontos.get(b.id)?.resumo;
        return r ? [{ tema: b.tema, resumo: r }] : [];
      });
      const resultados = [...prontos.values()].flatMap((r) =>
        r.resultados.map((x) => ({ ficha: x.ficha, titulo: porId.get(x.ficha)?.titulo ?? x.ficha, estado: x.estado })),
      );
      const pedido = pedidoT(
        transversal,
        transversal.fichas.map((f) => porId.get(f)!),
        resumosTemas,
        resultados,
        plano.transversais.trechos,
        plano.transversais.contexto,
        plano.nonce,
        plano.criterio ?? CRITERIO_PADRAO,
      );
      // O alvo dos trechos das transversais é só o PPC entregue (`trechos`), nunca os resumos da IA.
      yield* rodarBloco(transversal, pedido, plano.transversais.trechos);
      if (pausa !== null) return yield* Effect.fail<PausaRevisao>(pausa);
    }

    // Concluir na mesma lista: o último bloco mesclado e a cópia comentada regravada com a IA.
    const resultado: ResultadoRevisaoPpc = yield* listas.exclusivo(
      Effect.gen(function* () {
        const listaId = yield* mesclar(registro, plano, prontos, true);
        const lista = yield* listas.buscar(listaId);
        if (lista === null) return yield* falha(registro.arquivo, SEM_LISTA);
        yield* regravarCopia(lista).pipe(Effect.provideContext(contextoCopia));
        return (yield* listas.buscar(listaId))?.resultado ?? lista.resultado;
      }),
    );
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
      Effect.ensuring(Effect.suspend(() => (andamentos.delete(id), gravadosEmCache.delete(id), avisar(id)))),
    );

  /**
   * Uma leitura com IA por lista: liga a revisão à lista dela, ou recusa se a lista já tem outra leitura
   * por terminar (em andamento ou pausada).
   */
  const ligarALista = Effect.fn("RevisaoIa.ligarALista")(function* (registro: Revisoes.RegistroRevisaoIa<unknown>) {
    const lista = yield* listaDa(registro);
    if (lista.revisao !== null && lista.revisao !== registro.id) {
      const outra = yield* revisoes.resumo(lista.revisao);
      if (outra !== null && outra.situacao !== "concluida" && outra.situacao !== "falhou")
        return yield* falha(
          registro.arquivo,
          "Já há uma conferência com IA deste PPC por terminar. Retome-a ou encerre-a antes de começar outra.",
        );
    }
    yield* listas.ligarRevisao(lista.id, registro.id, registro.provider, registro.modelo);
  });

  const iniciar = Effect.fn("RevisaoIa.iniciar")(function* (id: string) {
    yield* exigirAviso;
    const registro = yield* buscar(id);
    const resumo = registro.plano === null ? [] : resumoDoPlano(registro.plano);
    if (registro.situacao === "concluida") return yield* estado(registro, resumo);
    if (yield* FiberMap.has(execucoes, id)) return yield* estado(registro, resumo);
    // O fim da leitura relê o arquivo: depois de fechar o app, a pessoa o escolhe de novo antes, e não
    // descobre no fim, com a leitura paga, que ele não podia ser lido.
    yield* revisor.exigirLiberado(registro.arquivo);
    if (registro.plano === null)
      return yield* falha(registro.arquivo, "Esta revisão não tem plano. Prepare-a de novo.");
    yield* listas.exclusivo(ligarALista(registro));
    yield* revisoes.alterar(id, { situacao: "em_andamento" });
    // A revisão roda além do pedido que a iniciou: abre o próprio trace.
    yield* FiberMap.run(
      execucoes,
      id,
      executarComPausa(id).pipe(Effect.withSpan("RevisaoIa.revisao", { root: true })),
      { onlyIfMissing: true },
    );
    yield* avisar(id);
    return yield* estadoPorId(id);
  });

  const pausar = Effect.fn("RevisaoIa.pausar")(function* (id: string) {
    const registro = yield* revisoes.resumo(id);
    if (registro === null) return yield* falha("", "Esta revisão não existe mais.");
    if (registro.situacao !== "em_andamento") return yield* estadoPorId(id);
    yield* FiberMap.remove(execucoes, id);
    pausados.delete(id);
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
          Stream.mapEffect((): Effect.Effect<EstadoRevisaoIa | null> =>
            revisoes
              .resumo(id)
              .pipe(
                Effect.flatMap((registro) =>
                  registro === null
                    ? Effect.succeed(null)
                    : resumoDe(id).pipe(Effect.flatMap((resumo) => estado(registro, resumo))),
                ),
              ),
          ),
          Stream.takeWhile((e) => e !== null),
          Stream.filter((e): e is EstadoRevisaoIa => e !== null),
        );
        return Stream.make(inicial).pipe(
          Stream.concat(terminou(inicial) ? Stream.empty : seguintes),
          Stream.takeUntil(terminou),
        );
      }),
    );

  const listar = revisoes.listar.pipe(
    Effect.flatMap((linhas) => Effect.forEach(linhas, (r) => estado(r, resumos.get(r.id) ?? []))),
  );

  const apagar = Effect.fn("RevisaoIa.apagar")(function* (id: string) {
    yield* FiberMap.remove(execucoes, id);
    yield* revisoes.apagar(id);
    resumos.delete(id);
    pausados.delete(id);
    yield* avisar(id);
  });

  const apagarOrfas = Effect.gen(function* () {
    for (const id of yield* revisoes.orfas) yield* apagar(id);
  }).pipe(Effect.withSpan("RevisaoIa.apagarOrfas"));

  yield* apagarOrfas;

  return RevisaoIa.of({
    preparar: prepararRevisao,
    iniciar,
    pausar,
    acompanhar,
    listar: expirar.pipe(Effect.andThen(apagarOrfas), Effect.andThen(listar)),
    apagar,
    apagarOrfas,
  });
});

/**
 * Pede o `Motor`, o `FileSystem`, o `RevisorPpc`, as `Revisoes`, as `Listas`, as `Preferencias`, o
 * `SecureRandom`, as `FontesNormativas` e o `PacoteContexto` do `kb.sqlite`.
 */
export const layer = (opcoes: OpcoesRevisaoIa = {}) => Layer.effect(RevisaoIa, make(opcoes));
