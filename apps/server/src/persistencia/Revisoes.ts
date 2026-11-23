/**
 * As revisões de PPC com IA no banco (`Banco.ts`): a revisão, o plano e o resultado
 * conferido de cada bloco. Os JSONs são do próprio servidor (`revisao-ppc/RevisaoIa.ts`), gravados e
 * lidos pelos schemas do contrato; uma falha do banco ou um JSON fora de forma é defeito, como no
 * `Historico`.
 *
 * Duas colunas ficam de fora da decodificação por schema: o plano (`revisoes_ia.plano`) e o resultado
 * do bloco (`blocos_ia.resultado`). Os tipos delas (`PlanoRevisaoIa` em `preparo.ts`, `ResultadoBloco`
 * em `julgamento.ts`) são tipos TypeScript, não `Schema`, e reescrevê-los como schema (com as fichas,
 * os blocos e o contexto normativo) não se paga: aqui só se confere que são JSON, e a `RevisaoIa`, que
 * os gravou, lê com os tipos dela.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  EstimativaRevisaoIa,
  type ModoRevisaoIa,
  type Provider,
  ResultadoRevisaoPpc,
  type SituacaoRevisaoIa,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app";
import { descarregar } from "./Banco.ts";

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

export class Revisoes extends Context.Service<
  Revisoes,
  {
    readonly criar: (revisao: NovaRevisaoIa) => Effect.Effect<void>;
    readonly buscar: (id: string) => Effect.Effect<RegistroRevisaoIa | null>;
    /** A revisão sem o plano (que pode ter centenas de KB): o estado a cada mudança lê só esta linha. */
    readonly resumo: (id: string) => Effect.Effect<RegistroRevisaoIa<null> | null>;
    /** Da mais recente para a mais antiga, sem o plano (que pode ser grande). */
    readonly listar: Effect.Effect<ReadonlyArray<RegistroRevisaoIa<null>>>;
    readonly alterar: (id: string, alteracao: AlteracaoRevisaoIa) => Effect.Effect<void>;
    readonly gravarBloco: (revisao: string, bloco: RegistroBlocoIa) => Effect.Effect<void>;
    readonly blocos: (revisao: string) => Effect.Effect<ReadonlyArray<RegistroBlocoIa>>;
    /** As revisões que o banco dá como em andamento, de uma execução anterior do servidor. */
    readonly emAndamento: Effect.Effect<ReadonlyArray<string>>;
    /** Grava o uso de uma tentativa (mesmo sem o bloco terminar). */
    readonly gravarTentativa: (revisao: string, bloco: string, tentativa: TentativaGravada) => Effect.Effect<void>;
    /** O uso somado de todas as tentativas da revisão e das ações com IA da lista viva dela. */
    readonly usoTotal: (revisao: string) => Effect.Effect<UsoRevisaoIa>;
    /** Apaga a revisão, o plano (com o texto do PPC), os blocos e as tentativas. */
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** As revisões de uma lista, em qualquer situação. */
    readonly daLista: (
      lista: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly id: string; readonly situacao: SituacaoRevisaoIa }>>;
    /**
     * As revisões que não estão `em_andamento` e cuja lista saiu (apagada, expirou ou foi substituída), e
     * as que nenhuma lista referencia mais e não estão `preparada` (uma leitura nova da mesma lista tomou
     * o lugar dela): o resultado já está (ou estava) na lista.
     */
    readonly orfas: Effect.Effect<ReadonlyArray<string>>;
    /** Apaga as revisões `preparada` (nunca iniciadas) criadas antes de `antesDe` (ISO). */
    readonly expirarPreparadas: (antesDe: string) => Effect.Effect<number>;
  }
>()("@simplifica-if/server/persistencia/Revisoes") {}

const EstimativaJson = Schema.fromJsonString(EstimativaRevisaoIa);
const ResultadoJson = Schema.fromJsonString(ResultadoRevisaoPpc);
const UsoJson = Schema.fromJsonString(UsoRevisaoIa);
const FerramentasJson = Schema.fromJsonString(Schema.Array(Schema.String));
/** O plano e o resultado de um bloco, que a `RevisaoIa` lê com os tipos dela. */
const DesconhecidoJson = Schema.fromJsonString(Schema.Unknown);

/** Uma linha de `revisoes_ia`, com as colunas JSON decodificadas. */
const Linha = Schema.Struct({
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
const lerLinhas = Schema.decodeUnknownEffect(Schema.Array(Linha));
const lerBlocos = Schema.decodeUnknownEffect(Schema.Array(LinhaBloco));
const lerUsos = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ uso: UsoJson })));
const codificarDesconhecido = Schema.encodeEffect(DesconhecidoJson);
const codificarEstimativa = Schema.encodeEffect(EstimativaJson);
const codificarResultado = Schema.encodeEffect(ResultadoJson);
const codificarUso = Schema.encodeEffect(UsoJson);
const codificarFerramentas = Schema.encodeEffect(FerramentasJson);

const paraRegistro = (linha: typeof Linha.Type): RegistroRevisaoIa => ({
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

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const criar = Effect.fn("Revisoes.criar")(function* (r: NovaRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisoes_ia (id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, plano, estimativa, criada_em, atualizada_em)
      VALUES (${r.id}, ${r.lista}, ${r.arquivo}, ${r.sha256}, ${r.provider}, ${r.modelo}, ${r.modo},
        ${r.situacao}, ${yield* codificarDesconhecido(r.plano)}, ${yield* codificarEstimativa(r.estimativa)}, ${data}, ${data})
    `;
  }, Effect.orDie);

  const buscar = Effect.fn("Revisoes.buscar")(function* (id: string) {
    const linhas = yield* lerLinhas(yield* sql`SELECT * FROM revisoes_ia WHERE id = ${id}`);
    return linhas[0] ? paraRegistro(linhas[0]) : null;
  }, Effect.orDie);

  const resumo = Effect.fn("Revisoes.resumo")(function* (id: string) {
    const linhas = yield* lerLinhas(
      yield* sql`
        SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
          estimativa, resultado, criada_em, atualizada_em
        FROM revisoes_ia WHERE id = ${id}
      `,
    );
    return linhas[0] ? (paraRegistro(linhas[0]) as RegistroRevisaoIa<null>) : null;
  }, Effect.orDie);

  const listar = sql`
    SELECT id, lista_id, arquivo, sha256, provider, modelo, modo, situacao, motivo, limite, NULL AS plano,
      estimativa, NULL AS resultado, criada_em, atualizada_em
    FROM revisoes_ia ORDER BY atualizada_em DESC
  `.pipe(
    Effect.flatMap(lerLinhas),
    Effect.map((linhas) => linhas.map((l) => paraRegistro(l) as RegistroRevisaoIa<null>)),
    Effect.orDie,
  );

  const alterar = Effect.fn("Revisoes.alterar")(function* (id: string, a: AlteracaoRevisaoIa) {
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

  const gravarBloco = Effect.fn("Revisoes.gravarBloco")(function* (revisao: string, b: RegistroBlocoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT OR REPLACE INTO blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em)
      VALUES (${revisao}, ${b.bloco}, ${yield* codificarDesconhecido(b.resultado)}, ${yield* codificarUso(b.uso)}, ${b.segundos}, ${data})
    `;
    yield* sql`UPDATE revisoes_ia SET atualizada_em = ${data} WHERE id = ${revisao}`;
  }, Effect.orDie);

  const blocos = Effect.fn("Revisoes.blocos")(function* (revisao: string) {
    const linhas = yield* lerBlocos(
      yield* sql`
      SELECT bloco_id, resultado, uso, segundos FROM blocos_ia WHERE revisao_id = ${revisao}
    `,
    );
    return linhas.map((l): RegistroBlocoIa => ({
      bloco: l.bloco_id,
      resultado: l.resultado,
      uso: l.uso,
      segundos: l.segundos,
    }));
  }, Effect.orDie);

  const emAndamento = sql<{ id: string }>`SELECT id FROM revisoes_ia WHERE situacao = 'em_andamento'`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  const gravarTentativa = Effect.fn("Revisoes.gravarTentativa")(function* (
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

  const usoTotal = Effect.fn("Revisoes.usoTotal")(function* (revisao: string) {
    // As tentativas do lote e as ações com IA da lista viva que veio dela (etapa 5b).
    const linhas = yield* lerUsos(
      yield* sql`
      SELECT uso FROM tentativas_ia WHERE revisao_id = ${revisao}
      UNION ALL
      SELECT a.uso FROM acoes_ia a JOIN listas_pendencias l ON l.id = a.lista_id WHERE l.revisao_id = ${revisao}
    `,
    );
    const total = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 };
    for (const l of linhas) {
      const u = l.uso;
      for (const k of Object.keys(total) as (keyof UsoRevisaoIa)[]) total[k] += u[k];
    }
    return total as UsoRevisaoIa;
  }, Effect.orDie);

  const apagar = Effect.fn("Revisoes.apagar")(function* (id: string) {
    yield* sql`DELETE FROM revisoes_ia WHERE id = ${id}`;
    yield* descarregar(sql);
  }, Effect.orDie);

  const daLista = Effect.fn("Revisoes.daLista")(function* (lista: string) {
    const linhas = yield* sql<{ id: string; situacao: string }>`
      SELECT id, situacao FROM revisoes_ia WHERE lista_id = ${lista}
    `;
    return linhas.map((l) => ({ id: l.id, situacao: l.situacao as SituacaoRevisaoIa }));
  }, Effect.orDie);

  const orfas = sql<{ id: string }>`
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

  const expirarPreparadas = Effect.fn("Revisoes.expirarPreparadas")(function* (antesDe: string) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM revisoes_ia WHERE situacao = 'preparada' AND criada_em < ${antesDe}
    `;
    for (const l of linhas) yield* sql`DELETE FROM revisoes_ia WHERE id = ${l.id}`;
    if (linhas.length > 0) yield* descarregar(sql);
    return linhas.length;
  }, Effect.orDie);

  return Revisoes.of({
    criar,
    buscar,
    resumo,
    listar,
    alterar,
    gravarBloco,
    blocos,
    emAndamento,
    gravarTentativa,
    usoTotal,
    apagar,
    daLista,
    orfas,
    expirarPreparadas,
  });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(Revisoes, make);
