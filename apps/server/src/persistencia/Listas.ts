/**
 * A lista viva de pendências no banco das conversas (M1.11 etapa 5b): a lista, cada
 * pendência com a situação e a sugestão, o histórico e o uso das ações com IA. Os JSONs são do próprio
 * servidor, gravados e lidos pelos schemas do contrato; uma falha do banco ou um JSON fora de forma é
 * defeito, como nas `Revisoes`.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  type AcaoPendencia,
  type EventoPendencia,
  PendenciaRevisao,
  type Provider,
  ResultadoRevisaoPpc,
  type SituacaoPendencia,
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

export type NovaLista = Omit<RegistroLista, "criadaEm" | "atualizadaEm">;

/** O arquivo de uma lista, trocado por "Enviar a versão corrigida". */
export type ArquivoLista = Pick<RegistroLista, "arquivo" | "sha256" | "markdown" | "linhasTextoParaIa">;

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
     * mais recente do mesmo arquivo com o mesmo conteúdo (o "Feito" da pré-conferência continua
     * valendo depois da revisão com IA, e na revisão com o curso escolhido pela pessoa), e essa lista sai.
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
    /** A lista passa a ser do arquivo novo (o texto convertido dele, para as ações com IA). */
    readonly trocarArquivo: (id: string, arquivo: ArquivoLista) => Effect.Effect<void>;
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

const NumerosJson = Schema.fromJsonString(Schema.Array(Schema.Number));
const ResultadoJson = Schema.fromJsonString(ResultadoRevisaoPpc);
const PendenciaJson = Schema.fromJsonString(PendenciaRevisao);
const SugestaoJson = Schema.fromJsonString(SugestaoTexto);
const UsoJson = Schema.fromJsonString(UsoRevisaoIa);
const FerramentasJson = Schema.fromJsonString(Schema.Array(Schema.String));

/** Uma linha de `listas_pendencias`, com as colunas JSON decodificadas. */
const Linha = Schema.Struct({
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
  nonce: Schema.String,
  resultado: ResultadoJson,
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
const lerLinhas = Schema.decodeUnknownEffect(Schema.Array(Linha));
const lerPendencias = Schema.decodeUnknownEffect(Schema.Array(LinhaPendencia));
const lerEventos = Schema.decodeUnknownEffect(Schema.Array(LinhaEvento));
const lerContestacoes = Schema.decodeUnknownEffect(Schema.Array(LinhaContestacao));
const lerUsos = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ uso: UsoJson })));
const codificarNumeros = Schema.encodeEffect(NumerosJson);
const codificarResultado = Schema.encodeEffect(ResultadoJson);
const codificarPendencia = Schema.encodeEffect(PendenciaJson);
const codificarSugestao = Schema.encodeEffect(SugestaoJson);
const codificarUso = Schema.encodeEffect(UsoJson);
const codificarFerramentas = Schema.encodeEffect(FerramentasJson);

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tocar = (id: string, data: string) =>
    sql`UPDATE listas_pendencias SET atualizada_em = ${data} WHERE id = ${id}`;

  const criar = Effect.fn("Listas.criar")(function* (
    l: NovaLista,
    pendencias: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
  ) {
    const data = yield* agora;
    const anterior = (yield* sql<{ id: string }>`
      SELECT id FROM listas_pendencias
      WHERE arquivo = ${l.arquivo} AND sha256 = ${l.sha256} ORDER BY atualizada_em DESC LIMIT 1
    `)[0];
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO listas_pendencias (id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma, markdown,
            linhas_texto_ia, nonce, resultado, criada_em, atualizada_em)
          VALUES (${l.id}, ${l.arquivo}, ${l.sha256}, ${l.revisao}, ${l.provider}, ${l.modelo}, ${l.cnct}, ${l.forma},
            ${l.markdown}, ${yield* codificarNumeros(l.linhasTextoParaIa)}, ${l.nonce}, ${yield* codificarResultado(l.resultado)},
            ${data}, ${data})
        `;
        let ordem = 0;
        for (const p of pendencias) {
          yield* sql`
            INSERT OR IGNORE INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
            VALUES (${l.id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL)
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
    const l = (yield* lerLinhas(yield* sql`SELECT * FROM listas_pendencias WHERE id = ${id}`))[0];
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
      nonce: l.nonce,
      resultado: l.resultado,
      criadaEm: l.criada_em,
      atualizadaEm: l.atualizada_em,
    } satisfies RegistroLista;
  }, Effect.orDie);

  const ultima = sql<{ id: string }>`SELECT id FROM listas_pendencias ORDER BY atualizada_em DESC LIMIT 1`.pipe(
    Effect.map((linhas) => linhas[0]?.id ?? null),
    Effect.orDie,
  );

  const pendencias = Effect.fn("Listas.pendencias")(function* (id: string) {
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

  const eventos = Effect.fn("Listas.eventos")(function* (id: string) {
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

  const mudar = Effect.fn("Listas.mudar")(function* (
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
        yield* sql`
          INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
          VALUES (${id}, ${chave}, ${data}, ${e.acao}, ${e.situacao}, ${e.texto}, ${e.motivo ?? null},
            ${usoEvento})
        `;
        yield* tocar(id, data);
      }),
    );
  }, Effect.orDie);

  const trocarArquivo = Effect.fn("Listas.trocarArquivo")(function* (id: string, a: ArquivoLista) {
    const data = yield* agora;
    yield* sql`
      UPDATE listas_pendencias SET arquivo = ${a.arquivo}, sha256 = ${a.sha256}, markdown = ${a.markdown},
        linhas_texto_ia = ${yield* codificarNumeros(a.linhasTextoParaIa)}, atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const trocarResultado = Effect.fn("Listas.trocarResultado")(function* (id: string, r: ResultadoRevisaoPpc) {
    const data = yield* agora;
    yield* sql`UPDATE listas_pendencias SET resultado = ${yield* codificarResultado(r)}, atualizada_em = ${data} WHERE id = ${id}`;
  }, Effect.orDie);

  const gravarAcao = Effect.fn("Listas.gravarAcao")(function* (id: string, chave: string, a: AcaoIaGravada) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
      VALUES (${id}, ${chave}, ${a.acao}, ${a.numero}, ${yield* codificarUso(a.uso)}, ${a.segundos},
        ${yield* codificarFerramentas(a.ferramentas)}, ${data})
    `;
  }, Effect.orDie);

  const uso = Effect.fn("Listas.uso")(function* (id: string) {
    const linhas = yield* lerUsos(yield* sql`SELECT uso FROM acoes_ia WHERE lista_id = ${id}`);
    const total = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0 };
    for (const l of linhas) {
      const u = l.uso;
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
        VALUES (${id}, ${p.chave}, ${ordem++}, ${yield* codificarPendencia(p.pendencia)}, 'aberta', NULL, NULL)
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

  const contestacoes = sql`
    SELECT l.arquivo, e.em, e.motivo, e.texto, p.pendencia
    FROM eventos_pendencia e
    JOIN pendencias_vivas p ON p.lista_id = e.lista_id AND p.chave = e.chave
    JOIN listas_pendencias l ON l.id = e.lista_id
    WHERE e.acao = 'contestar'
    ORDER BY e.em
  `.pipe(Effect.flatMap(lerContestacoes), Effect.orDie);

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
    trocarArquivo,
    trocarResultado,
    gravarAcao,
    uso,
    apagar,
  });
});

/** Pede o `SqlClient` do banco das conversas. */
export const layer = Layer.effect(Listas, make);
