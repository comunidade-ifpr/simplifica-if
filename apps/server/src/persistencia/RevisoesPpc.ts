/**
 * Persistência unificada da revisão de PPC no banco das conversas (`Banco.ts`): as listas vivas de
 * pendências (`listas_pendencias`, `pendencias_vivas`, `eventos_pendencia`, `acoes_ia`) e as revisões
 * com IA (`revisoes_ia`, `blocos_ia`, `tentativas_ia`).
 *
 * Os JSONs são do próprio servidor, gravados e lidos pelos schemas do contrato; uma falha do banco ou um
 * JSON fora de forma é defeito, como no `Historico`. Três colunas ficam de fora da decodificação por
 * schema: `resultados_ia` (`EntradaIa`), `plano` (`PlanoRevisaoIa`) e o resultado de bloco
 * (`ResultadoBloco`), cujos tipos são TypeScript puros; aqui só se confere que são JSON.
 *
 * A serialização de escritas que leem e regravam uma lista (`comTravaDaLista`) é por lista: listas
 * diferentes nunca bloqueiam umas às outras durante chamadas longas ao Worker.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import {
  type AcaoPendencia,
  EstimativaRevisaoIa,
  type EventoPendencia,
  type ModoRevisaoIa,
  PendenciaRevisao,
  type Provider,
  ResultadoRevisaoPpc,
  type SituacaoPendencia,
  type SituacaoRevisaoIa,
  SugestaoTexto,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app";
import type { EntradaIa } from "@simplifica-if/ppc/revisao-previa";
import { descarregar } from "./Banco.ts";

/** Tentativa de substituir uma lista enquanto há uma conferência com IA dela em andamento. */
export class RevisaoEmAndamento extends Schema.TaggedError<RevisaoEmAndamento>()("RevisaoEmAndamento", {
  arquivo: Schema.String,
}) {
  override get message(): string {
    return "A conferência com IA deste PPC está em andamento. Pause-a antes de revisar o arquivo de novo.";
  }
}

export const ehRevisaoEmAndamento = Schema.is(RevisaoEmAndamento);

export interface RegistroLista {
  readonly id: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly revisao: string | null;
  readonly provider: Provider | null;
  readonly modelo: string | null;
  readonly cnct: string | null;
  readonly forma: string | null;
  /** O PPC convertido, sem as linhas de texto dirigido a IA (o que as ações com IA recebem). */
  readonly markdown: string;
  readonly linhasTextoParaIa: readonly number[];
  readonly resultado: ResultadoRevisaoPpc;
  /** Os resultados conferidos da leitura com IA (com o que ficou de fora e se ela terminou), ou nulo. */
  readonly resultadosIa: EntradaIa | null;
  /** Sobe a cada mudança nas pendências. */
  readonly versao: number;
  /** A versão que a cópia comentada reflete; nula se nenhuma (a lista herdou situações de outra). */
  readonly versaoCopia: number | null;
  readonly criadaEm: string;
  readonly atualizadaEm: string;
}

export interface RegistroPendencia {
  readonly chave: string;
  readonly ordem: number;
  readonly pendencia: PendenciaRevisao;
  readonly situacao: SituacaoPendencia;
  readonly resolvidaPor: "pessoa" | "revisarDeNovo" | null;
  readonly sugestao: SugestaoTexto | null;
}

export type NovaLista = Omit<RegistroLista, "criadaEm" | "atualizadaEm" | "versao" | "versaoCopia">;

/** O que a mesclagem de um bloco da leitura com IA muda na lista (a mesma lista, nunca uma nova). */
export interface MesclagemIa {
  readonly resultado: ResultadoRevisaoPpc;
  readonly resultadosIa: EntradaIa;
  readonly revisao: string;
  readonly provider: Provider;
  readonly modelo: string | null;
}

/** O arquivo de uma lista, trocado por "Enviar a versão corrigida", com o resultado da cópia gravada dele. */
export type ArquivoLista = Pick<
  RegistroLista,
  "arquivo" | "sha256" | "markdown" | "linhasTextoParaIa" | "cnct" | "forma" | "resultado"
>;

/**
 * O que "Enviar a versão corrigida" muda numa pendência: a situação (com o evento) e, quando o arquivo
 * novo aponta o mesmo ponto com outro texto, a pendência como ele a aponta, com a chave nova.
 */
export interface MudancaPendencia {
  readonly chave: string;
  readonly nova?: { readonly chave: string; readonly pendencia: PendenciaRevisao };
  readonly situacao: SituacaoPendencia;
  readonly resolvidaPor: "pessoa" | "revisarDeNovo" | null;
  readonly evento: Evento | null;
}

export interface Evento {
  readonly acao: AcaoPendencia;
  readonly situacao: SituacaoPendencia;
  readonly texto: string;
  readonly motivo?: string | null;
  readonly uso?: UsoRevisaoIa | null;
}

export interface AcaoIaGravada {
  readonly acao: AcaoPendencia;
  readonly numero: number;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
  readonly ferramentas: ReadonlyArray<string>;
}

export interface RegistroRevisaoIa<Plano = unknown> {
  readonly id: string;
  /** A lista viva de onde a leitura nasceu; nula se a lista saiu (apagada, expirada ou substituída). */
  readonly lista: string | null;
  /** O arquivo e o conteúdo da lista quando a leitura foi preparada. */
  readonly arquivo: string;
  readonly sha256: string;
  readonly provider: Provider;
  readonly modelo: string | null;
  readonly modo: ModoRevisaoIa;
  readonly situacao: SituacaoRevisaoIa;
  readonly motivo: string | null;
  readonly limite: boolean;
  readonly plano: Plano;
  readonly estimativa: EstimativaRevisaoIa;
  readonly resultado: ResultadoRevisaoPpc | null;
  readonly criadaEm: string;
  readonly atualizadaEm: string;
}

export interface RegistroBlocoIa<Resultado = unknown> {
  readonly bloco: string;
  readonly resultado: Resultado;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
}

export interface TentativaGravada {
  readonly numero: number;
  readonly uso: UsoRevisaoIa;
  readonly segundos: number;
  readonly ferramentas: ReadonlyArray<string>;
}

export type NovaRevisaoIa = Omit<RegistroRevisaoIa, "criadaEm" | "atualizadaEm" | "resultado" | "limite" | "motivo">;

export interface AlteracaoRevisaoIa {
  readonly situacao: SituacaoRevisaoIa;
  readonly motivo?: string | null;
  readonly limite?: boolean;
  readonly resultado?: ResultadoRevisaoPpc;
}

export class RevisoesPpc extends Context.Service<
  RevisoesPpc,
  {
    /**
     * Serializa operações compostas sobre a mesma lista (não reentrante para o mesmo `id`). Listas
     * diferentes correm em paralelo.
     */
    readonly comTravaDaLista: <A, E, R>(id: string, efeito: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

    /* ------------------------------------------------------------ listas */

    /**
     * Cria a lista. A situação, o histórico e a sugestão das pendências de mesma chave passam da lista
     * mais recente do mesmo arquivo com o mesmo conteúdo, e as listas anteriores do mesmo conteúdo saem.
     * Recusa com `RevisaoEmAndamento` se alguma lista a substituir tiver leitura com IA em andamento.
     */
    readonly criarLista: (
      lista: NovaLista,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    ) => Effect.Effect<void, RevisaoEmAndamento>;
    readonly buscarLista: (id: string) => Effect.Effect<RegistroLista | null>;
    /** Liga a lista à leitura com IA que começou (ou que retoma). */
    readonly ligarRevisao: (
      id: string,
      revisao: string,
      provider: Provider,
      modelo: string | null,
    ) => Effect.Effect<void>;
    /**
     * Os resultados da IA mesclados na mesma lista, numa transação: o resultado e os resultados da IA
     * novos, e as pendências que ainda não estavam nela, abertas (as que estavam ficam como a pessoa as
     * deixou). A cópia comentada deixa de estar em dia.
     */
    readonly mesclarIa: (
      id: string,
      mesclagem: MesclagemIa,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      /** Chaves da IA de uma leitura anterior que não existem mais no resultado recalculado. */
      obsoletas?: ReadonlyArray<string>,
    ) => Effect.Effect<void>;
    /** Todas as listas, da mais recente para a mais antiga. */
    readonly todasListas: Effect.Effect<ReadonlyArray<string>>;
    readonly pendencias: (id: string) => Effect.Effect<ReadonlyArray<RegistroPendencia>>;
    readonly eventos: (id: string) => Effect.Effect<ReadonlyArray<EventoPendencia & { chave: string }>>;
    readonly mudarPendencia: (
      id: string,
      chave: string,
      mudanca: {
        situacao: SituacaoPendencia;
        resolvidaPor?: "pessoa" | "revisarDeNovo" | null;
        sugestao?: SugestaoTexto;
      },
      evento: Evento,
    ) => Effect.Effect<void>;
    /** A lista do arquivo com este conteúdo (há uma só: a nova substitui a anterior), ou nula. */
    readonly listaDoConteudo: (arquivo: string, sha256: string) => Effect.Effect<string | null>;
    /**
     * "Enviar a versão corrigida", numa transação: as mudanças nas pendências, as novas (abertas, com o
     * evento `textoNovas`), onde cada pendência ficou na nova cópia comentada (`noDocumento`) e a lista
     * passando ao arquivo novo, com a cópia comentada dele em dia.
     */
    readonly aplicarArquivoNovo: (
      id: string,
      mudancas: ReadonlyArray<MudancaPendencia>,
      novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      textoNovas: string,
      arquivo: ArquivoLista,
      noDocumento?: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
    ) => Effect.Effect<void>;
    /**
     * O resultado da cópia comentada regravada, que reflete a `versaoCopia` da lista, e onde cada
     * pendência ficou no documento (`noDocumento`, pela chave), numa transação.
     */
    readonly trocarResultado: (
      id: string,
      resultado: ResultadoRevisaoPpc,
      versaoCopia: number,
      noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
    ) => Effect.Effect<void>;
    /** Grava o uso de uma ação com IA; sem efeito se a lista foi apagada enquanto a ação rodava. */
    readonly gravarAcao: (id: string, chave: string, acao: AcaoIaGravada) => Effect.Effect<void>;
    readonly usoLista: (id: string) => Effect.Effect<UsoRevisaoIa>;
    readonly apagarLista: (id: string) => Effect.Effect<void>;
    /** Acrescenta pendências novas (a triagem do arquivo da nova revisão), abertas, com o evento; sem efeito se a lista sumiu. */
    readonly acrescentarPendencias: (
      id: string,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      texto: string,
    ) => Effect.Effect<void>;
    /** Apaga as listas sem uso desde `antesDe` (ISO), com o texto do PPC e os motivos. */
    readonly expirarListas: (antesDe: string) => Effect.Effect<number>;
    /** As contestações registradas, de todas as listas, com a pendência e o arquivo. */
    readonly contestacoes: Effect.Effect<
      ReadonlyArray<{ arquivo: string; em: string; motivo: string | null; texto: string; pendencia: PendenciaRevisao }>
    >;

    /* ------------------------------------------------------------ revisões com IA */

    readonly criarRevisao: (revisao: NovaRevisaoIa) => Effect.Effect<void>;
    readonly buscarRevisao: (id: string) => Effect.Effect<RegistroRevisaoIa | null>;
    /** A revisão sem o plano (que pode ter centenas de KB): o estado a cada mudança lê só esta linha. */
    readonly resumoRevisao: (id: string) => Effect.Effect<RegistroRevisaoIa<null> | null>;
    /** Da mais recente para a mais antiga, sem o plano (que pode ser grande). */
    readonly listarRevisoes: Effect.Effect<ReadonlyArray<RegistroRevisaoIa<null>>>;
    readonly alterarRevisao: (id: string, alteracao: AlteracaoRevisaoIa) => Effect.Effect<void>;
    /**
     * Pausa a revisão somente se ainda estiver `em_andamento` no banco: não sobrescreve `concluida` nem
     * `falhou` numa corrida com o fim da execução.
     */
    readonly pausarRevisaoSeEmAndamento: (id: string, motivo: string) => Effect.Effect<void>;
    readonly gravarBloco: (revisao: string, bloco: RegistroBlocoIa) => Effect.Effect<void>;
    readonly blocos: (revisao: string) => Effect.Effect<ReadonlyArray<RegistroBlocoIa>>;
    /** As revisões que o banco dá como em andamento, de uma execução anterior do servidor. */
    readonly revisoesEmAndamento: Effect.Effect<ReadonlyArray<string>>;
    /** Grava o uso de uma tentativa (mesmo sem o bloco terminar). */
    readonly gravarTentativa: (revisao: string, bloco: string, tentativa: TentativaGravada) => Effect.Effect<void>;
    /** O uso somado de todas as tentativas da revisão e das ações com IA da lista viva dela. */
    readonly usoTotalRevisao: (revisao: string) => Effect.Effect<UsoRevisaoIa>;
    /** Apaga a revisão, o plano (com o texto do PPC), os blocos e as tentativas. */
    readonly apagarRevisao: (id: string) => Effect.Effect<void>;
    /** As revisões de uma lista, em qualquer situação. */
    readonly revisoesDaLista: (
      lista: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly id: string; readonly situacao: SituacaoRevisaoIa }>>;
    /**
     * As revisões que não estão `em_andamento` e cuja lista saiu (apagada, expirou ou foi substituída), e
     * as que nenhuma lista referencia mais e não estão `preparada` (uma leitura nova da mesma lista tomou
     * o lugar dela): o resultado já está (ou estava) na lista.
     */
    readonly revisoesOrfas: Effect.Effect<ReadonlyArray<string>>;
    /** Apaga as revisões `preparada` (nunca iniciadas) criadas antes de `antesDe` (ISO). */
    readonly expirarRevisoesPreparadas: (antesDe: string) => Effect.Effect<number>;
  }
>()("@simplifica-if/server/persistencia/RevisoesPpc") {}

const NumerosJson = Schema.fromJsonString(Schema.Array(Schema.Number));
const ResultadoJson = Schema.fromJsonString(ResultadoRevisaoPpc);
const PendenciaJson = Schema.fromJsonString(PendenciaRevisao);
const SugestaoJson = Schema.fromJsonString(SugestaoTexto);
const UsoJson = Schema.fromJsonString(UsoRevisaoIa);
const FerramentasJson = Schema.fromJsonString(Schema.Array(Schema.String));
const EstimativaJson = Schema.fromJsonString(EstimativaRevisaoIa);
/** Os resultados da IA, o plano e o resultado de um bloco, lidos com os tipos de quem os gravou. */
const DesconhecidoJson = Schema.fromJsonString(Schema.Unknown);

const LinhaLista = Schema.Struct({
  id: Schema.String,
  arquivo: Schema.String,
  sha256: Schema.String,
  revisao_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  modelo: Schema.NullOr(Schema.String),
  cnct: Schema.NullOr(Schema.String),
  forma: Schema.NullOr(Schema.String),
  markdown: Schema.String,
  linhas_texto_ia: NumerosJson,
  resultado: ResultadoJson,
  resultados_ia: Schema.NullOr(DesconhecidoJson),
  versao: Schema.Number,
  versao_copia: Schema.NullOr(Schema.Number),
  criada_em: Schema.String,
  atualizada_em: Schema.String,
});

const LinhaPendencia = Schema.Struct({
  chave: Schema.String,
  ordem: Schema.Number,
  pendencia: PendenciaJson,
  situacao: Schema.String,
  resolvida_por: Schema.NullOr(Schema.String),
  sugestao: Schema.NullOr(SugestaoJson),
});

const LinhaEvento = Schema.Struct({
  chave: Schema.String,
  em: Schema.String,
  acao: Schema.String,
  situacao: Schema.String,
  texto: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  uso: Schema.NullOr(UsoJson),
});

const LinhaContestacao = Schema.Struct({
  arquivo: Schema.String,
  em: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  texto: Schema.String,
  pendencia: PendenciaJson,
});

const LinhaRevisao = Schema.Struct({
  id: Schema.String,
  lista_id: Schema.NullOr(Schema.String),
  arquivo: Schema.String,
  sha256: Schema.String,
  provider: Schema.String,
  modelo: Schema.NullOr(Schema.String),
  modo: Schema.String,
  situacao: Schema.String,
  motivo: Schema.NullOr(Schema.String),
  limite: Schema.Number,
  plano: Schema.NullOr(DesconhecidoJson),
  estimativa: EstimativaJson,
  resultado: Schema.NullOr(ResultadoJson),
  criada_em: Schema.String,
  atualizada_em: Schema.String,
});

const LinhaBloco = Schema.Struct({
  bloco_id: Schema.String,
  resultado: DesconhecidoJson,
  uso: UsoJson,
  segundos: Schema.Number,
});

const lerLinhasLista = Schema.decodeUnknownEffect(Schema.Array(LinhaLista));
const lerPendencias = Schema.decodeUnknownEffect(Schema.Array(LinhaPendencia));
const lerEventos = Schema.decodeUnknownEffect(Schema.Array(LinhaEvento));
const lerContestacoes = Schema.decodeUnknownEffect(Schema.Array(LinhaContestacao));
const lerLinhasRevisao = Schema.decodeUnknownEffect(Schema.Array(LinhaRevisao));
const lerBlocos = Schema.decodeUnknownEffect(Schema.Array(LinhaBloco));
const lerUsos = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ uso: UsoJson })));

const codificarNumeros = Schema.encodeEffect(NumerosJson);
const codificarResultado = Schema.encodeEffect(ResultadoJson);
const codificarPendencia = Schema.encodeEffect(PendenciaJson);
const codificarSugestao = Schema.encodeEffect(SugestaoJson);
const codificarUso = Schema.encodeEffect(UsoJson);
const codificarFerramentas = Schema.encodeEffect(FerramentasJson);
const codificarEstimativa = Schema.encodeEffect(EstimativaJson);
const codificarDesconhecido = Schema.encodeEffect(DesconhecidoJson);

const paraRegistroRevisao = (linha: typeof LinhaRevisao.Type): RegistroRevisaoIa => ({
  id: linha.id,
  lista: linha.lista_id,
  arquivo: linha.arquivo,
  sha256: linha.sha256,
  provider: linha.provider as Provider,
  modelo: linha.modelo,
  modo: linha.modo as ModoRevisaoIa,
  situacao: linha.situacao as SituacaoRevisaoIa,
  motivo: linha.motivo,
  limite: linha.limite === 1,
  plano: linha.plano,
  estimativa: linha.estimativa,
  resultado: linha.resultado,
  criadaEm: linha.criada_em,
  atualizadaEm: linha.atualizada_em,
});

const somarUsos = (linhas: ReadonlyArray<{ readonly uso: UsoRevisaoIa }>): UsoRevisaoIa => {
  const total = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 };
  for (const l of linhas) {
    const u = l.uso;
    for (const k of Object.keys(total) as (keyof UsoRevisaoIa)[]) total[k] += u[k];
  }
  return total as UsoRevisaoIa;
};

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const travas = new Map<string, { readonly semaforo: Semaphore.Semaphore; ativos: number }>();

  const comTravaDaLista = <A, E, R>(id: string, efeito: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      let entrada = travas.get(id);
      if (entrada === undefined) {
        entrada = { semaforo: Semaphore.makeUnsafe(1), ativos: 0 };
        travas.set(id, entrada);
      }
      entrada.ativos += 1;
      const atual = entrada;
      return atual.semaforo
        .withPermits(1)(efeito)
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              atual.ativos -= 1;
              if (atual.ativos === 0 && travas.get(id) === atual) travas.delete(id);
            }),
          ),
        );
    });

  /** Uma mudança nas pendências: a cópia comentada deixa de estar em dia. */
  const tocar = (id: string, data: string) =>
    sql`UPDATE listas_pendencias SET atualizada_em = ${data}, versao = versao + 1 WHERE id = ${id}`;

  /* ------------------------------------------------------------ listas */

  const criarLista = Effect.fn("RevisoesPpc.criarLista")(function* (
    l: NovaLista,
    pendenciasLista: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
  ) {
    const data = yield* agora;
    const linhasTextoIa = yield* codificarNumeros(l.linhasTextoParaIa).pipe(Effect.orDie);
    const resultadoJson = yield* codificarResultado(l.resultado).pipe(Effect.orDie);
    const resultadosIaJson =
      l.resultadosIa === null ? null : yield* codificarDesconhecido(l.resultadosIa).pipe(Effect.orDie);
    const pendenciasCodificadas = yield* Effect.forEach(pendenciasLista, (p) =>
      codificarPendencia(p.pendencia).pipe(Effect.map((json) => ({ chave: p.chave, json }))),
    ).pipe(Effect.orDie);

    const anterior = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Garante atomicamente que nenhuma lista deste conteúdo tem leitura com IA em andamento.
          const ativa = yield* sql<{ id: string }>`
            SELECT r.id FROM revisoes_ia r
            WHERE r.situacao = 'em_andamento'
              AND (
                r.lista_id IN (SELECT id FROM listas_pendencias WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256})
                OR r.id IN (
                  SELECT revisao_id FROM listas_pendencias
                  WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} AND revisao_id IS NOT NULL
                )
              )
            LIMIT 1
          `;
          if (ativa.length > 0) return yield* new RevisaoEmAndamento({ arquivo: l.arquivo });

          const ant = (yield* sql<{ id: string }>`
            SELECT id FROM listas_pendencias
            WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} ORDER BY atualizada_em DESC LIMIT 1
          `)[0];

          yield* sql`
            INSERT INTO listas_pendencias (id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma, markdown,
              linhas_texto_ia, resultado, resultados_ia, versao, versao_copia, criada_em, atualizada_em)
            VALUES (${l.id}, ${l.arquivo}, ${l.sha256}, ${l.revisao}, ${l.provider}, ${l.modelo}, ${l.cnct}, ${l.forma},
              ${l.markdown}, ${linhasTextoIa}, ${resultadoJson}, ${resultadosIaJson},
              0, ${ant ? null : 0}, ${data}, ${data})
          `;
          let ordem = 0;
          for (const p of pendenciasCodificadas) {
            yield* sql`
              INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
              VALUES (${l.id}, ${p.chave}, ${ordem++}, ${p.json}, 'aberta', NULL, NULL)
            `;
          }
          if (ant) {
            yield* sql`
              UPDATE pendencias_vivas AS nova SET
                situacao = velha.situacao, resolvida_por = velha.resolvida_por, sugestao = velha.sugestao
              FROM pendencias_vivas AS velha
              WHERE nova.lista_id = ${l.id} AND velha.lista_id = ${ant.id} AND velha.chave = nova.chave
            `;
            yield* sql`
              INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
              SELECT ${l.id}, e.chave, e.em, e.acao, e.situacao, e.texto, e.motivo, e.uso
              FROM eventos_pendencia e JOIN pendencias_vivas p ON p.lista_id = ${l.id} AND p.chave = e.chave
              WHERE e.lista_id = ${ant.id}
            `;
            // A leitura com IA que a lista nova leva passa a ela antes de a anterior sair.
            if (l.revisao !== null) yield* sql`UPDATE revisoes_ia SET lista_id = ${l.id} WHERE id = ${l.revisao}`;
            // O uso das ações continua contado; as listas anteriores do mesmo conteúdo saem (o texto do
            // PPC e os motivos não ficam guardados em dobro).
            yield* sql`
              UPDATE acoes_ia SET lista_id = ${l.id}
              WHERE lista_id IN (SELECT id FROM listas_pendencias WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} AND id <> ${l.id})
            `;
            yield* sql`DELETE FROM listas_pendencias WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} AND id <> ${l.id}`;
          }
          return ant;
        }),
      )
      .pipe(Effect.catchIf((e) => !ehRevisaoEmAndamento(e), Effect.die));
    // A lista substituída levava o texto do PPC.
    if (anterior) yield* descarregar(sql).pipe(Effect.orDie);
  });

  const buscarLista = Effect.fn("RevisoesPpc.buscarLista")(function* (id: string) {
    const l = (yield* lerLinhasLista(yield* sql`SELECT * FROM listas_pendencias WHERE id = ${id}`))[0];
    if (!l) return null;
    return {
      id: l.id,
      arquivo: l.arquivo,
      sha256: l.sha256,
      revisao: l.revisao_id,
      provider: l.provider as Provider | null,
      modelo: l.modelo,
      cnct: l.cnct,
      forma: l.forma,
      markdown: l.markdown,
      linhasTextoParaIa: l.linhas_texto_ia,
      resultado: l.resultado,
      resultadosIa: l.resultados_ia as EntradaIa | null,
      versao: l.versao,
      versaoCopia: l.versao_copia,
      criadaEm: l.criada_em,
      atualizadaEm: l.atualizada_em,
    } satisfies RegistroLista;
  }, Effect.orDie);

  const ligarRevisao = Effect.fn("RevisoesPpc.ligarRevisao")(function* (
    id: string,
    revisao: string,
    provider: Provider,
    modelo: string | null,
  ) {
    yield* sql`
      UPDATE listas_pendencias SET revisao_id = ${revisao}, provider = ${provider}, modelo = ${modelo}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const todasListas = sql<{ id: string }>`SELECT id FROM listas_pendencias ORDER BY atualizada_em DESC`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const pendencias = Effect.fn("RevisoesPpc.pendencias")(function* (id: string) {
    const linhas = yield* lerPendencias(
      yield* sql`SELECT chave, ordem, pendencia, situacao, resolvida_por, sugestao FROM pendencias_vivas WHERE lista_id = ${id} ORDER BY ordem`,
    );
    return linhas.map((l): RegistroPendencia => ({
      chave: l.chave,
      ordem: l.ordem,
      pendencia: l.pendencia,
      situacao: l.situacao as SituacaoPendencia,
      resolvidaPor: l.resolvida_por as RegistroPendencia["resolvidaPor"],
      sugestao: l.sugestao,
    }));
  }, Effect.orDie);

  const eventos = Effect.fn("RevisoesPpc.eventos")(function* (id: string) {
    const linhas = yield* lerEventos(
      yield* sql`SELECT chave, em, acao, situacao, texto, motivo, uso FROM eventos_pendencia WHERE lista_id = ${id} ORDER BY em, rowid`,
    );
    return linhas.map((l) => ({
      chave: l.chave,
      em: l.em,
      acao: l.acao as AcaoPendencia,
      situacao: l.situacao as SituacaoPendencia,
      texto: l.texto,
      motivo: l.motivo,
      uso: l.uso,
    }));
  }, Effect.orDie);

  const mudarPendencia = Effect.fn("RevisoesPpc.mudarPendencia")(function* (
    id: string,
    chave: string,
    m: { situacao: SituacaoPendencia; resolvidaPor?: "pessoa" | "revisarDeNovo" | null; sugestao?: SugestaoTexto },
    e: Evento,
  ) {
    const data = yield* agora;
    const sugestao = m.sugestao === undefined ? null : yield* codificarSugestao(m.sugestao);
    const usoEvento = e.uso ? yield* codificarUso(e.uso) : null;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          UPDATE pendencias_vivas SET
            situacao = ${m.situacao},
            resolvida_por = ${m.situacao === "resolvida" ? (m.resolvidaPor ?? "pessoa") : null},
            sugestao = COALESCE(${sugestao}, sugestao)
          WHERE lista_id = ${id} AND chave = ${chave}
        `;
        // A lista pode ter sido apagada enquanto a ação com IA rodava: nada se grava nela.
        yield* sql`
          INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
          SELECT ${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null}, ${usoEvento}
          WHERE EXISTS (SELECT 1 FROM listas_pendencias WHERE id = ${id})
        `;
        yield* tocar(id, data);
      }),
    );
  }, Effect.orDie);

  const listaDoConteudo = Effect.fn("RevisoesPpc.listaDoConteudo")(function* (arquivo: string, sha256: string) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM listas_pendencias WHERE arquivo = ${arquivo} AND sha256 = ${sha256}
      ORDER BY atualizada_em DESC LIMIT 1
    `;
    return linhas[0]?.id ?? null;
  }, Effect.orDie);

  /** Insere as pendências novas, abertas, depois da última, cada uma com o evento. */
  const inserirNovas = Effect.fn("RevisoesPpc.inserirNovas")(function* (
    id: string,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    texto: string,
    data: string,
  ) {
    const maior =
      (yield* sql<{ m: number | null }>`SELECT MAX(ordem) AS m FROM pendencias_vivas WHERE lista_id = ${id}`)[0]?.m ??
      0;
    let ordem = maior + 1;
    for (const p of novas) {
      yield* sql`
        INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
        VALUES (${id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL)
      `;
      yield* sql`
        INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
        VALUES (${id}, ${p.chave}, ${data}, 'revisarDeNovo', 'aberta', ${texto}, NULL, NULL)
      `;
    }
  });

  /** Atualiza `noDocumento` de cada pendência conforme a cópia comentada gravada. */
  const atualizarLocais = Effect.fn("RevisoesPpc.atualizarLocais")(function* (
    id: string,
    noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    for (const p of yield* pendencias(id)) {
      const local = noDocumento.get(p.chave);
      if (local === undefined || local === p.pendencia.noDocumento) continue;
      yield* sql`
        UPDATE pendencias_vivas SET pendencia = ${yield* codificarPendencia({ ...p.pendencia, noDocumento: local })}
        WHERE lista_id = ${id} AND chave = ${p.chave}
      `;
    }
  });

  const aplicarArquivoNovo = Effect.fn("RevisoesPpc.aplicarArquivoNovo")(function* (
    id: string,
    mudancas: ReadonlyArray<MudancaPendencia>,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    textoNovas: string,
    a: ArquivoLista,
    noDocumento?: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const m of mudancas) {
          let chave = m.chave;
          if (m.nova !== undefined) {
            // O mesmo ponto com outro texto: a pendência, o histórico e o uso passam à chave nova.
            yield* sql`
              UPDATE pendencias_vivas SET chave = ${m.nova.chave}, pendencia = ${yield* codificarPendencia(m.nova.pendencia)}
              WHERE lista_id = ${id} AND chave = ${chave}
            `;
            yield* sql`UPDATE eventos_pendencia SET chave = ${m.nova.chave} WHERE lista_id = ${id} AND chave = ${chave}`;
            yield* sql`UPDATE acoes_ia SET chave = ${m.nova.chave} WHERE lista_id = ${id} AND chave = ${chave}`;
            chave = m.nova.chave;
          }
          yield* sql`
            UPDATE pendencias_vivas SET situacao = ${m.situacao}, resolvida_por = ${m.situacao === "resolvida" ? m.resolvidaPor : null}
            WHERE lista_id = ${id} AND chave = ${chave}
          `;
          if (m.evento !== null) {
            const e = m.evento;
            yield* sql`
              INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
              VALUES (${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null},
                ${e.uso ? yield* codificarUso(e.uso) : null})
            `;
          }
        }
        yield* inserirNovas(id, novas, textoNovas, data);
        if (noDocumento !== undefined) yield* atualizarLocais(id, noDocumento);
        // A cópia comentada já foi gravada com o estado final: fica em dia.
        yield* sql`
          UPDATE listas_pendencias SET arquivo = ${a.arquivo}, sha256 = ${a.sha256}, markdown = ${a.markdown},
            linhas_texto_ia = ${yield* codificarNumeros(a.linhasTextoParaIa)}, cnct = ${a.cnct}, forma = ${a.forma},
            resultado = ${yield* codificarResultado(a.resultado)}, versao = versao + 1, versao_copia = versao + 1,
            atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
  }, Effect.orDie);

  const mesclarIa = Effect.fn("RevisoesPpc.mesclarIa")(function* (
    id: string,
    m: MesclagemIa,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    obsoletas: ReadonlyArray<string> = [],
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(m.resultado);
    const resultadosIa = yield* codificarDesconhecido(m.resultadosIa);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const chave of obsoletas)
          yield* sql`DELETE FROM pendencias_vivas WHERE lista_id = ${id} AND chave = ${chave}`;
        const maior =
          (yield* sql<{ m: number | null }>`SELECT MAX(ordem) AS m FROM pendencias_vivas WHERE lista_id = ${id}`)[0]
            ?.m ?? 0;
        let ordem = maior + 1;
        for (const p of novas)
          yield* sql`
            INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
            VALUES (${id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL)
          `;
        yield* sql`
          UPDATE listas_pendencias SET resultado = ${resultado}, resultados_ia = ${resultadosIa},
            revisao_id = ${m.revisao}, provider = ${m.provider}, modelo = ${m.modelo},
            versao = versao + 1, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
  }, Effect.orDie);

  const trocarResultado = Effect.fn("RevisoesPpc.trocarResultado")(function* (
    id: string,
    r: ResultadoRevisaoPpc,
    versaoCopia: number,
    noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(r);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* atualizarLocais(id, noDocumento);
        yield* sql`
          UPDATE listas_pendencias SET resultado = ${resultado}, versao_copia = ${versaoCopia}, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
  }, Effect.orDie);

  const gravarAcao = Effect.fn("RevisoesPpc.gravarAcao")(function* (id: string, chave: string, a: AcaoIaGravada) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
      SELECT ${id}, ${chave}, ${a.acao}, ${a.numero}, ${yield* codificarUso(a.uso)}, ${a.segundos},
        ${yield* codificarFerramentas(a.ferramentas)}, ${data}
      WHERE EXISTS (SELECT 1 FROM listas_pendencias WHERE id = ${id})
    `;
  }, Effect.orDie);

  const usoLista = Effect.fn("RevisoesPpc.usoLista")(function* (id: string) {
    return somarUsos(yield* lerUsos(yield* sql`SELECT uso FROM acoes_ia WHERE lista_id = ${id}`));
  }, Effect.orDie);

  const apagarLista = Effect.fn("RevisoesPpc.apagarLista")(function* (id: string) {
    yield* sql`DELETE FROM listas_pendencias WHERE id = ${id}`;
    yield* descarregar(sql);
  }, Effect.orDie);

  const acrescentarPendencias = Effect.fn("RevisoesPpc.acrescentarPendencias")(function* (
    id: string,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    texto: string,
  ) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // A lista apagada no meio da nova revisão de uma pendência não ganha pendências.
        const existe = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM listas_pendencias WHERE id = ${id}`;
        if ((existe[0]?.n ?? 0) === 0) return;
        yield* inserirNovas(id, novas, texto, data);
        yield* tocar(id, data);
      }),
    );
  }, Effect.orDie);

  const expirarListas = Effect.fn("RevisoesPpc.expirarListas")(function* (antesDe: string) {
    const linhas = yield* sql<{ id: string }>`SELECT id FROM listas_pendencias WHERE atualizada_em < ${antesDe}`;
    for (const l of linhas) yield* sql`DELETE FROM listas_pendencias WHERE id = ${l.id}`;
    if (linhas.length > 0) yield* descarregar(sql);
    return linhas.length;
  }, Effect.orDie);

  const contestacoes = sql`
    SELECT l.arquivo, e.em, e.motivo, e.texto, p.pendencia
    FROM eventos_pendencia e
    JOIN pendencias_vivas p ON p.lista_id = e.lista_id AND p.chave = e.chave
    JOIN listas_pendencias l ON l.id = e.lista_id
    WHERE e.acao = 'contestar'
    ORDER BY e.em
  `.pipe(Effect.flatMap(lerContestacoes), Effect.orDie);

  /* ------------------------------------------------------------ revisões com IA */

  const criarRevisao = Effect.fn("RevisoesPpc.criarRevisao")(function* (r: NovaRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisoes_ia (id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, plano, estimativa, criada_em, atualizada_em)
      VALUES (${r.id}, ${r.lista}, ${r.arquivo}, ${r.sha256}, ${r.provider}, ${r.modelo}, ${r.modo},
        ${r.situacao}, ${yield* codificarDesconhecido(r.plano)}, ${yield* codificarEstimativa(r.estimativa)}, ${data}, ${data})
    `;
  }, Effect.orDie);

  const buscarRevisao = Effect.fn("RevisoesPpc.buscarRevisao")(function* (id: string) {
    const linhas = yield* lerLinhasRevisao(yield* sql`SELECT * FROM revisoes_ia WHERE id = ${id}`);
    return linhas[0] ? paraRegistroRevisao(linhas[0]) : null;
  }, Effect.orDie);

  const resumoRevisao = Effect.fn("RevisoesPpc.resumoRevisao")(function* (id: string) {
    const linhas = yield* lerLinhasRevisao(
      yield* sql`
        SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
          estimativa, resultado, criada_em, atualizada_em
        FROM revisoes_ia WHERE id = ${id}
      `,
    );
    return linhas[0] ? (paraRegistroRevisao(linhas[0]) as RegistroRevisaoIa<null>) : null;
  }, Effect.orDie);

  const listarRevisoes = sql`
    SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
      estimativa, NULL AS resultado, criada_em, atualizada_em
    FROM revisoes_ia ORDER BY atualizada_em DESC
  `.pipe(
    Effect.flatMap(lerLinhasRevisao),
    Effect.map((linhas) => linhas.map((l) => paraRegistroRevisao(l) as RegistroRevisaoIa<null>)),
    Effect.orDie,
  );

  const alterarRevisao = Effect.fn("RevisoesPpc.alterarRevisao")(function* (id: string, a: AlteracaoRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      UPDATE revisoes_ia SET
        situacao = ${a.situacao},
        motivo = ${a.motivo ?? null},
        limite = ${a.limite === true ? 1 : 0},
        resultado = COALESCE(${a.resultado === undefined ? null : yield* codificarResultado(a.resultado)}, resultado),
        atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const pausarRevisaoSeEmAndamento = Effect.fn("RevisoesPpc.pausarRevisaoSeEmAndamento")(function* (
    id: string,
    motivo: string,
  ) {
    const data = yield* agora;
    yield* sql`
      UPDATE revisoes_ia SET
        situacao = 'pausada',
        motivo = ${motivo},
        limite = 0,
        atualizada_em = ${data}
      WHERE id = ${id} AND situacao = 'em_andamento'
    `;
  }, Effect.orDie);

  const gravarBloco = Effect.fn("RevisoesPpc.gravarBloco")(function* (revisao: string, b: RegistroBlocoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT OR REPLACE INTO blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em)
      VALUES (${revisao}, ${b.bloco}, ${yield* codificarDesconhecido(b.resultado)}, ${yield* codificarUso(b.uso)}, ${b.segundos}, ${data})
    `;
    yield* sql`UPDATE revisoes_ia SET atualizada_em = ${data} WHERE id = ${revisao}`;
  }, Effect.orDie);

  const blocos = Effect.fn("RevisoesPpc.blocos")(function* (revisao: string) {
    const linhas = yield* lerBlocos(
      yield* sql`SELECT bloco_id, resultado, uso, segundos FROM blocos_ia WHERE revisao_id = ${revisao}`,
    );
    return linhas.map((l): RegistroBlocoIa => ({
      bloco: l.bloco_id,
      resultado: l.resultado,
      uso: l.uso,
      segundos: l.segundos,
    }));
  }, Effect.orDie);

  const revisoesEmAndamento = sql<{ id: string }>`SELECT id FROM revisoes_ia WHERE situacao = 'em_andamento'`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const gravarTentativa = Effect.fn("RevisoesPpc.gravarTentativa")(function* (
    revisao: string,
    bloco: string,
    t: TentativaGravada,
  ) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO tentativas_ia (revisao_id, bloco_id, numero, uso, segundos, ferramentas, criada_em)
      VALUES (${revisao}, ${bloco}, ${t.numero}, ${yield* codificarUso(t.uso)}, ${t.segundos},
        ${yield* codificarFerramentas(t.ferramentas)}, ${data})
    `;
  }, Effect.orDie);

  const usoTotalRevisao = Effect.fn("RevisoesPpc.usoTotalRevisao")(function* (revisao: string) {
    // As tentativas do lote e as ações com IA da lista viva que veio dela (etapa 5b).
    const linhas = yield* lerUsos(
      yield* sql`
        SELECT uso FROM tentativas_ia WHERE revisao_id = ${revisao}
        UNION ALL
        SELECT a.uso FROM acoes_ia a JOIN listas_pendencias l ON l.id = a.lista_id WHERE l.revisao_id = ${revisao}
      `,
    );
    return somarUsos(linhas);
  }, Effect.orDie);

  const apagarRevisao = Effect.fn("RevisoesPpc.apagarRevisao")(function* (id: string) {
    yield* sql`DELETE FROM revisoes_ia WHERE id = ${id}`;
    yield* descarregar(sql);
  }, Effect.orDie);

  const revisoesDaLista = Effect.fn("RevisoesPpc.revisoesDaLista")(function* (lista: string) {
    const linhas = yield* sql<{ id: string; situacao: string }>`
      SELECT id, situacao FROM revisoes_ia WHERE lista_id = ${lista}
    `;
    return linhas.map((l) => ({ id: l.id, situacao: l.situacao as SituacaoRevisaoIa }));
  }, Effect.orDie);

  const revisoesOrfas = sql<{ id: string }>`
    SELECT r.id FROM revisoes_ia r
    WHERE r.situacao <> 'em_andamento'
      AND (
        r.lista_id IS NULL
        OR (r.situacao <> 'preparada' AND NOT EXISTS (SELECT 1 FROM listas_pendencias l WHERE l.revisao_id = r.id))
      )
  `.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const expirarRevisoesPreparadas = Effect.fn("RevisoesPpc.expirarRevisoesPreparadas")(function* (antesDe: string) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM revisoes_ia WHERE situacao = 'preparada' AND criada_em < ${antesDe}
    `;
    for (const l of linhas) yield* sql`DELETE FROM revisoes_ia WHERE id = ${l.id}`;
    if (linhas.length > 0) yield* descarregar(sql);
    return linhas.length;
  }, Effect.orDie);

  return RevisoesPpc.of({
    comTravaDaLista,
    criarLista,
    buscarLista,
    ligarRevisao,
    mesclarIa,
    todasListas,
    pendencias,
    eventos,
    mudarPendencia,
    listaDoConteudo,
    aplicarArquivoNovo,
    trocarResultado,
    gravarAcao,
    usoLista,
    apagarLista,
    acrescentarPendencias,
    expirarListas,
    contestacoes,
    criarRevisao,
    buscarRevisao,
    resumoRevisao,
    listarRevisoes,
    alterarRevisao,
    pausarRevisaoSeEmAndamento,
    gravarBloco,
    blocos,
    revisoesEmAndamento,
    gravarTentativa,
    usoTotalRevisao,
    apagarRevisao,
    revisoesDaLista,
    revisoesOrfas,
    expirarRevisoesPreparadas,
  });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(RevisoesPpc, make);
