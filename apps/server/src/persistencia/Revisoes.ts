/**
 * As revisões de PPC com IA no banco (`Banco.ts`, migração 2): a revisão, o plano e o resultado
 * conferido de cada bloco. Os JSONs são do próprio servidor (`revisao-ppc/RevisaoIa.ts`); uma falha do
 * banco é defeito, como no `Historico`.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  EstimativaRevisaoIa,
  ModoRevisaoIa,
  Provider,
  ResultadoRevisaoPpc,
  SituacaoRevisaoIa,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app";

export interface RegistroRevisaoIa<Plano = unknown> {
  readonly id: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly provider: Provider;
  readonly modelo: string | null;
  readonly modo: ModoRevisaoIa;
  readonly cnct: string | null;
  readonly forma: string | null;
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
    /** Da mais recente para a mais antiga, sem o plano (que pode ser grande). */
    readonly listar: Effect.Effect<ReadonlyArray<RegistroRevisaoIa<null>>>;
    readonly alterar: (id: string, alteracao: AlteracaoRevisaoIa) => Effect.Effect<void>;
    readonly gravarBloco: (revisao: string, bloco: RegistroBlocoIa) => Effect.Effect<void>;
    readonly blocos: (revisao: string) => Effect.Effect<ReadonlyArray<RegistroBlocoIa>>;
    /** As revisões que o banco dá como em andamento, de uma execução anterior do servidor. */
    readonly emAndamento: Effect.Effect<ReadonlyArray<string>>;
  }
>()("@simplifica-if/server/persistencia/Revisoes") {}

interface Linha {
  readonly id: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly provider: string;
  readonly modelo: string | null;
  readonly modo: string;
  readonly cnct: string | null;
  readonly forma: string | null;
  readonly situacao: string;
  readonly motivo: string | null;
  readonly limite: number;
  readonly plano: string | null;
  readonly estimativa: string;
  readonly resultado: string | null;
  readonly criada_em: string;
  readonly atualizada_em: string;
}

const paraRegistro = (linha: Linha): RegistroRevisaoIa => ({
  id: linha.id,
  arquivo: linha.arquivo,
  sha256: linha.sha256,
  provider: linha.provider as Provider,
  modelo: linha.modelo,
  modo: linha.modo as ModoRevisaoIa,
  cnct: linha.cnct,
  forma: linha.forma,
  situacao: linha.situacao as SituacaoRevisaoIa,
  motivo: linha.motivo,
  limite: linha.limite === 1,
  plano: linha.plano === null ? null : JSON.parse(linha.plano),
  estimativa: JSON.parse(linha.estimativa) as EstimativaRevisaoIa,
  resultado: linha.resultado === null ? null : (JSON.parse(linha.resultado) as ResultadoRevisaoPpc),
  criadaEm: linha.criada_em,
  atualizadaEm: linha.atualizada_em,
});

const agora = Effect.map(DateTime.now, DateTime.formatIso);

/** JSON dos próprios dados do servidor (planos e resultados já validados), fora do código Effect. */
const json = (valor: unknown): string => JSON.stringify(valor);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const criar = Effect.fn("Revisoes.criar")(function* (r: NovaRevisaoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO revisoes_ia (id, arquivo, sha256, provider, modelo, modo, cnct, forma, situacao, plano, estimativa, criada_em, atualizada_em)
      VALUES (${r.id}, ${r.arquivo}, ${r.sha256}, ${r.provider}, ${r.modelo}, ${r.modo}, ${r.cnct}, ${r.forma},
        ${r.situacao}, ${json(r.plano)}, ${json(r.estimativa)}, ${data}, ${data})
    `;
  }, Effect.orDie);

  const buscar = Effect.fn("Revisoes.buscar")(function* (id: string) {
    const linhas = yield* sql<Linha>`SELECT * FROM revisoes_ia WHERE id = ${id}`;
    return linhas[0] ? paraRegistro(linhas[0]) : null;
  }, Effect.orDie);

  const listar = sql<Linha>`
    SELECT id, arquivo, sha256, provider, modelo, modo, cnct, forma, situacao, motivo, limite, NULL AS plano,
      estimativa, NULL AS resultado, criada_em, atualizada_em
    FROM revisoes_ia ORDER BY atualizada_em DESC
  `.pipe(
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
        resultado = COALESCE(${a.resultado === undefined ? null : json(a.resultado)}, resultado),
        atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const gravarBloco = Effect.fn("Revisoes.gravarBloco")(function* (revisao: string, b: RegistroBlocoIa) {
    const data = yield* agora;
    yield* sql`
      INSERT OR REPLACE INTO blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em)
      VALUES (${revisao}, ${b.bloco}, ${json(b.resultado)}, ${json(b.uso)}, ${b.segundos}, ${data})
    `;
    yield* sql`UPDATE revisoes_ia SET atualizada_em = ${data} WHERE id = ${revisao}`;
  }, Effect.orDie);

  const blocos = Effect.fn("Revisoes.blocos")(function* (revisao: string) {
    const linhas = yield* sql<{ bloco_id: string; resultado: string; uso: string; segundos: number }>`
      SELECT bloco_id, resultado, uso, segundos FROM blocos_ia WHERE revisao_id = ${revisao}
    `;
    return linhas.map((l): RegistroBlocoIa => ({
      bloco: l.bloco_id,
      resultado: JSON.parse(l.resultado),
      uso: JSON.parse(l.uso) as UsoRevisaoIa,
      segundos: l.segundos,
    }));
  }, Effect.orDie);

  const emAndamento = sql<{ id: string }>`SELECT id FROM revisoes_ia WHERE situacao = 'em_andamento'`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
    Effect.orDie,
  );

  return Revisoes.of({ criar, buscar, listar, alterar, gravarBloco, blocos, emAndamento });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(Revisoes, make);
