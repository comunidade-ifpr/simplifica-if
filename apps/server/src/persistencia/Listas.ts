/**
 * A lista viva de pendências no banco das conversas (migração 4, M1.11 etapa 5b): a lista, cada
 * pendência com a situação e a sugestão, o histórico e o uso das ações com IA. Os JSONs são do próprio
 * servidor; uma falha do banco é defeito, como nas `Revisoes`.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  AcaoPendencia,
  EventoPendencia,
  PendenciaRevisao,
  Provider,
  ResultadoRevisaoPpc,
  SituacaoPendencia,
  SugestaoTexto,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app";

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
  readonly nonce: string;
  readonly resultado: ResultadoRevisaoPpc;
  readonly paradasVistas: readonly number[];
  readonly paradaAtual: number;
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

export type NovaLista = Omit<RegistroLista, "criadaEm" | "atualizadaEm" | "paradasVistas" | "paradaAtual">;

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

export class Listas extends Context.Service<
  Listas,
  {
    /**
     * Cria a lista. A situação, o histórico e a sugestão das pendências de mesma chave passam da lista
     * mais recente do mesmo arquivo com o mesmo conteúdo (o "Vou ajustar" da pré-conferência continua
     * valendo depois da revisão com IA).
     */
    readonly criar: (
      lista: NovaLista,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    ) => Effect.Effect<void>;
    readonly buscar: (id: string) => Effect.Effect<RegistroLista | null>;
    readonly ultima: Effect.Effect<string | null>;
    readonly pendencias: (id: string) => Effect.Effect<ReadonlyArray<RegistroPendencia>>;
    readonly eventos: (id: string) => Effect.Effect<ReadonlyArray<EventoPendencia & { chave: string }>>;
    readonly mudar: (
      id: string,
      chave: string,
      mudanca: {
        situacao: SituacaoPendencia;
        resolvidaPor?: "pessoa" | "revisarDeNovo" | null;
        sugestao?: SugestaoTexto;
      },
      evento: Evento,
    ) => Effect.Effect<void>;
    readonly verParada: (id: string, ordem: number) => Effect.Effect<void>;
    readonly trocarResultado: (id: string, resultado: ResultadoRevisaoPpc) => Effect.Effect<void>;
    readonly gravarAcao: (id: string, chave: string, acao: AcaoIaGravada) => Effect.Effect<void>;
    readonly uso: (id: string) => Effect.Effect<UsoRevisaoIa>;
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** Acrescenta pendências novas (a triagem do arquivo da nova revisão), abertas, com o evento. */
    readonly acrescentar: (
      id: string,
      pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      texto: string,
    ) => Effect.Effect<void>;
    /** Apaga as listas sem uso desde `antesDe` (ISO), com o texto do PPC e os motivos. */
    readonly expirar: (antesDe: string) => Effect.Effect<number>;
    /** As contestações registradas, de todas as listas, com a pendência e o arquivo. */
    readonly contestacoes: Effect.Effect<
      ReadonlyArray<{ arquivo: string; em: string; motivo: string | null; texto: string; pendencia: PendenciaRevisao }>
    >;
  }
>()("@simplifica-if/server/persistencia/Listas") {}

interface Linha {
  readonly id: string;
  readonly arquivo: string;
  readonly sha256: string;
  readonly revisao_id: string | null;
  readonly provider: string | null;
  readonly modelo: string | null;
  readonly cnct: string | null;
  readonly forma: string | null;
  readonly markdown: string;
  readonly linhas_texto_ia: string;
  readonly nonce: string;
  readonly resultado: string;
  readonly paradas_vistas: string;
  readonly parada_atual: number;
  readonly criada_em: string;
  readonly atualizada_em: string;
}

const agora = Effect.map(DateTime.now, DateTime.formatIso);
const json = (valor: unknown): string => JSON.stringify(valor);
/** JSON dos próprios dados do servidor, lido fora do código Effect (como nas `Revisoes`). */
const ler = <T>(texto: string): T => JSON.parse(texto) as T;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tocar = (id: string, data: string) =>
    sql`UPDATE listas_pendencias SET atualizada_em = ${data} WHERE id = ${id}`;

  const criar = Effect.fn("Listas.criar")(function* (
    l: NovaLista,
    pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
  ) {
    const data = yield* agora;
    const anterior = (yield* sql<{ id: string; paradas_vistas: string; parada_atual: number }>`
      SELECT id, paradas_vistas, parada_atual FROM listas_pendencias
      WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} ORDER BY atualizada_em DESC LIMIT 1
    `)[0];
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO listas_pendencias (id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma, markdown,
            linhas_texto_ia, nonce, resultado, paradas_vistas, parada_atual, criada_em, atualizada_em)
          VALUES (${l.id}, ${l.arquivo}, ${l.sha256}, ${l.revisao}, ${l.provider}, ${l.modelo}, ${l.cnct}, ${l.forma},
            ${l.markdown}, ${json(l.linhasTextoParaIa)}, ${l.nonce}, ${json(l.resultado)},
            ${anterior?.paradas_vistas ?? "[]"}, ${anterior?.parada_atual ?? 0}, ${data}, ${data})
        `;
        let ordem = 0;
        for (const p of pendencias) {
          yield* sql`
            INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
            VALUES (${l.id}, ${p.chave}, ${ordem++}, ${json(p.pendencia)}, 'aberta', NULL, NULL)
          `;
        }
        if (anterior) {
          yield* sql`
            UPDATE pendencias_vivas AS nova SET
              situacao = velha.situacao, resolvida_por = velha.resolvida_por, sugestao = velha.sugestao
            FROM pendencias_vivas AS velha
            WHERE nova.lista_id = ${l.id} AND velha.lista_id = ${anterior.id} AND velha.chave = nova.chave
          `;
          yield* sql`
            INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
            SELECT ${l.id}, e.chave, e.em, e.acao, e.situacao, e.texto, e.motivo, e.uso
            FROM eventos_pendencia e JOIN pendencias_vivas p ON p.lista_id = ${l.id} AND p.chave = e.chave
            WHERE e.lista_id = ${anterior.id}
          `;
          // O uso das ações continua contado; as listas anteriores do mesmo conteúdo saem (o texto do
          // PPC e os motivos não ficam guardados em dobro).
          yield* sql`
            UPDATE acoes_ia SET lista_id = ${l.id}
            WHERE lista_id IN (SELECT id FROM listas_pendencias WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} AND id <> ${l.id})
          `;
          yield* sql`DELETE FROM listas_pendencias WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} AND id <> ${l.id}`;
        }
      }),
    );
  }, Effect.orDie);

  const buscar = Effect.fn("Listas.buscar")(function* (id: string) {
    const l = (yield* sql<Linha>`SELECT * FROM listas_pendencias WHERE id = ${id}`)[0];
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
      linhasTextoParaIa: ler<number[]>(l.linhas_texto_ia),
      nonce: l.nonce,
      resultado: ler<ResultadoRevisaoPpc>(l.resultado),
      paradasVistas: ler<number[]>(l.paradas_vistas),
      paradaAtual: l.parada_atual,
      criadaEm: l.criada_em,
      atualizadaEm: l.atualizada_em,
    } satisfies RegistroLista;
  }, Effect.orDie);

  const ultima = sql<{ id: string }>`SELECT id FROM listas_pendencias ORDER BY atualizada_em DESC LIMIT 1`.pipe(
    Effect.map((linhas) => linhas[0]?.id ?? null),
    Effect.orDie,
  );

  const pendencias = Effect.fn("Listas.pendencias")(function* (id: string) {
    const linhas = yield* sql<{
      chave: string;
      ordem: number;
      pendencia: string;
      situacao: string;
      resolvida_por: string | null;
      sugestao: string | null;
    }>`SELECT chave, ordem, pendencia, situacao, resolvida_por, sugestao FROM pendencias_vivas WHERE lista_id = ${id} ORDER BY ordem`;
    return linhas.map((l): RegistroPendencia => ({
      chave: l.chave,
      ordem: l.ordem,
      pendencia: ler<PendenciaRevisao>(l.pendencia),
      situacao: l.situacao as SituacaoPendencia,
      resolvidaPor: l.resolvida_por as RegistroPendencia["resolvidaPor"],
      sugestao: l.sugestao === null ? null : ler<SugestaoTexto>(l.sugestao),
    }));
  }, Effect.orDie);

  const eventos = Effect.fn("Listas.eventos")(function* (id: string) {
    const linhas = yield* sql<{
      chave: string;
      em: string;
      acao: string;
      situacao: string;
      texto: string;
      motivo: string | null;
      uso: string | null;
    }>`SELECT chave, em, acao, situacao, texto, motivo, uso FROM eventos_pendencia WHERE lista_id = ${id} ORDER BY em, rowid`;
    return linhas.map((l) => ({
      chave: l.chave,
      em: l.em,
      acao: l.acao as AcaoPendencia,
      situacao: l.situacao as SituacaoPendencia,
      texto: l.texto,
      motivo: l.motivo,
      uso: l.uso === null ? null : ler<UsoRevisaoIa>(l.uso),
    }));
  }, Effect.orDie);

  const mudar = Effect.fn("Listas.mudar")(function* (
    id: string,
    chave: string,
    m: { situacao: SituacaoPendencia; resolvidaPor?: "pessoa" | "revisarDeNovo" | null; sugestao?: SugestaoTexto },
    e: Evento,
  ) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          UPDATE pendencias_vivas SET
            situacao = ${m.situacao},
            resolvida_por = ${m.situacao === "resolvida" ? (m.resolvidaPor ?? "pessoa") : null},
            sugestao = COALESCE(${m.sugestao === undefined ? null : json(m.sugestao)}, sugestao)
          WHERE lista_id = ${id} AND chave = ${chave}
        `;
        yield* sql`
          INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
          VALUES (${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null},
            ${e.uso ? json(e.uso) : null})
        `;
        yield* tocar(id, data);
      }),
    );
  }, Effect.orDie);

  const verParada = Effect.fn("Listas.verParada")(function* (id: string, ordem: number) {
    const data = yield* agora;
    const linha = (yield* sql<{
      paradas_vistas: string;
    }>`SELECT paradas_vistas FROM listas_pendencias WHERE id = ${id}`)[0];
    if (!linha) return;
    const vistas = new Set(ler<number[]>(linha.paradas_vistas));
    vistas.add(ordem);
    yield* sql`
      UPDATE listas_pendencias SET paradas_vistas = ${json([...vistas].sort((a, b) => a - b))}, parada_atual = ${ordem},
        atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const trocarResultado = Effect.fn("Listas.trocarResultado")(function* (id: string, r: ResultadoRevisaoPpc) {
    const data = yield* agora;
    yield* sql`UPDATE listas_pendencias SET resultado = ${json(r)}, atualizada_em = ${data} WHERE id = ${id}`;
  }, Effect.orDie);

  const gravarAcao = Effect.fn("Listas.gravarAcao")(function* (id: string, chave: string, a: AcaoIaGravada) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
      VALUES (${id}, ${chave}, ${a.acao}, ${a.numero}, ${json(a.uso)}, ${a.segundos}, ${json(a.ferramentas)}, ${data})
    `;
  }, Effect.orDie);

  const uso = Effect.fn("Listas.uso")(function* (id: string) {
    const linhas = yield* sql<{ uso: string }>`SELECT uso FROM acoes_ia WHERE lista_id = ${id}`;
    const total = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 };
    for (const l of linhas) {
      const u = ler<UsoRevisaoIa>(l.uso);
      for (const k of Object.keys(total) as (keyof UsoRevisaoIa)[]) total[k] += u[k];
    }
    return total as UsoRevisaoIa;
  }, Effect.orDie);

  const apagar = Effect.fn("Listas.apagar")(function* (id: string) {
    yield* sql`DELETE FROM listas_pendencias WHERE id = ${id}`;
  }, Effect.orDie);

  const acrescentar = Effect.fn("Listas.acrescentar")(function* (
    id: string,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    texto: string,
  ) {
    const data = yield* agora;
    const maior =
      (yield* sql<{ m: number | null }>`SELECT MAX(ordem) AS m FROM pendencias_vivas WHERE lista_id = ${id}`)[0]?.m ??
      0;
    let ordem = maior + 1;
    for (const p of novas) {
      yield* sql`
        INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
        VALUES (${id}, ${p.chave}, ${ordem++}, ${json(p.pendencia)}, 'aberta', NULL, NULL)
      `;
      yield* sql`
        INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
        VALUES (${id}, ${p.chave}, ${data}, 'revisarDeNovo', 'aberta', ${texto}, NULL, NULL)
      `;
    }
    yield* tocar(id, data);
  }, Effect.orDie);

  const expirar = Effect.fn("Listas.expirar")(function* (antesDe: string) {
    const linhas = yield* sql<{ id: string }>`SELECT id FROM listas_pendencias WHERE atualizada_em < ${antesDe}`;
    for (const l of linhas) yield* sql`DELETE FROM listas_pendencias WHERE id = ${l.id}`;
    return linhas.length;
  }, Effect.orDie);

  const contestacoes = sql<{ arquivo: string; em: string; motivo: string | null; texto: string; pendencia: string }>`
    SELECT l.arquivo, e.em, e.motivo, e.texto, p.pendencia
    FROM eventos_pendencia e
    JOIN pendencias_vivas p ON p.lista_id = e.lista_id AND p.chave = e.chave
    JOIN listas_pendencias l ON l.id = e.lista_id
    WHERE e.acao = 'contestar'
    ORDER BY e.em
  `.pipe(
    Effect.map((linhas) => linhas.map((l) => ({ ...l, pendencia: ler<PendenciaRevisao>(l.pendencia) }))),
    Effect.orDie,
  );

  return Listas.of({
    acrescentar,
    expirar,
    contestacoes,
    criar,
    buscar,
    ultima,
    pendencias,
    eventos,
    mudar,
    verParada,
    trocarResultado,
    gravarAcao,
    uso,
    apagar,
  });
});

/** Pede o `SqlClient` do banco das conversas. */
export const layer = Layer.effect(Listas, make);
