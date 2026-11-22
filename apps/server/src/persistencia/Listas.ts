/**
 * A lista viva de pendências no banco das conversas (M1.11 etapa 5b): a lista, cada
 * pendência com a situação e a sugestão, o histórico e o uso das ações com IA. Os JSONs são do próprio
 * servidor, gravados e lidos pelos schemas do contrato; uma falha do banco ou um JSON fora de forma é
 * defeito, como nas `Revisoes`.
 *
 * A lista é dona dos resultados conferidos da leitura com IA (`resultados_ia`), mesclados pela
 * `RevisaoIa` a cada bloco pronto (`mesclarIa`); o tipo deles (`EntradaIa` do `ppc`) é tipo TypeScript,
 * não `Schema`, e fica de fora da decodificação, como o plano nas `Revisoes`.
 *
 * As escritas que leem a lista e a regravam (marcar, a cópia comentada, trocar o curso, o arquivo novo,
 * a mesclagem da IA) esperam a vez umas das outras em `exclusivo`.
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
  type EventoPendencia,
  PendenciaRevisao,
  type Provider,
  ResultadoRevisaoPpc,
  type SituacaoPendencia,
  SugestaoTexto,
  UsoRevisaoIa,
} from "@simplifica-if/contratos-app";
import type { EntradaIa } from "@simplifica-if/ppc/revisao-previa";
import { descarregar } from "./Banco.ts";

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
    /** Roda a escrita quando nenhuma outra escrita da lista está rodando (não reentrante). */
    readonly exclusivo: <A, E, R>(efeito: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** A lista mais recente do mesmo arquivo, conteúdo, curso e forma (a da leitura com IA), ou nula. */
    readonly localizar: (chave: {
      readonly arquivo: string;
      readonly sha256: string;
      readonly cnct: string | null;
      readonly forma: string | null;
    }) => Effect.Effect<string | null>;
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
    readonly ultima: Effect.Effect<string | null>;
    /** Todas as listas, da mais recente para a mais antiga. */
    readonly todas: Effect.Effect<ReadonlyArray<string>>;
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
    /** A lista mais recente de um arquivo, ou nula. */
    readonly doArquivo: (arquivo: string) => Effect.Effect<string | null>;
    /**
     * "Enviar a versão corrigida", numa transação: as mudanças nas pendências, as novas (abertas, com o
     * evento `textoNovas`) e a lista passando ao arquivo novo, com a cópia comentada dele em dia.
     */
    readonly aplicarArquivoNovo: (
      id: string,
      mudancas: ReadonlyArray<MudancaPendencia>,
      novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
      textoNovas: string,
      arquivo: ArquivoLista,
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
    readonly uso: (id: string) => Effect.Effect<UsoRevisaoIa>;
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** Acrescenta pendências novas (a triagem do arquivo da nova revisão), abertas, com o evento; sem efeito se a lista sumiu. */
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
/** Os resultados da IA, que quem os gravou lê com o tipo dele (`EntradaIa`). */
const ResultadosIaJson = Schema.fromJsonString(Schema.Unknown);

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
  resultados_ia: Schema.NullOr(ResultadosIaJson),
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
const codificarResultadosIa = Schema.encodeEffect(ResultadosIaJson);

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const escrita = yield* Semaphore.make(1);
  const exclusivo = <A, E, R>(efeito: Effect.Effect<A, E, R>) => escrita.withPermits(1)(efeito);
  /** Uma mudança nas pendências: a cópia comentada deixa de estar em dia. */
  const tocar = (id: string, data: string) =>
    sql`UPDATE listas_pendencias SET atualizada_em = ${data}, versao = versao + 1 WHERE id = ${id}`;

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
            linhas_texto_ia, nonce, resultado, resultados_ia, versao, versao_copia, criada_em, atualizada_em)
          VALUES (${l.id}, ${l.arquivo}, ${l.sha256}, ${l.revisao}, ${l.provider}, ${l.modelo}, ${l.cnct}, ${l.forma},
            ${l.markdown}, ${yield* codificarNumeros(l.linhasTextoParaIa)}, ${l.nonce}, ${yield* codificarResultado(l.resultado)},
            ${l.resultadosIa === null ? null : yield* codificarResultadosIa(l.resultadosIa)},
            0, ${anterior ? null : 0}, ${data}, ${data})
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
    // A lista substituída levava o texto do PPC.
    if (anterior) yield* descarregar(sql);
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
      resultadosIa: l.resultados_ia as EntradaIa | null,
      versao: l.versao,
      versaoCopia: l.versao_copia,
      criadaEm: l.criada_em,
      atualizadaEm: l.atualizada_em,
    } satisfies RegistroLista;
  }, Effect.orDie);

  const localizar = Effect.fn("Listas.localizar")(function* (c: {
    readonly arquivo: string;
    readonly sha256: string;
    readonly cnct: string | null;
    readonly forma: string | null;
  }) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM listas_pendencias
      WHERE arquivo = ${c.arquivo} AND sha256 = ${c.sha256} AND cnct IS ${c.cnct} AND forma IS ${c.forma}
      ORDER BY atualizada_em DESC LIMIT 1
    `;
    return linhas[0]?.id ?? null;
  }, Effect.orDie);

  const ligarRevisao = Effect.fn("Listas.ligarRevisao")(function* (
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

  const ultima = sql<{ id: string }>`SELECT id FROM listas_pendencias ORDER BY atualizada_em DESC LIMIT 1`.pipe(
    Effect.map((linhas) => linhas[0]?.id ?? null),
    Effect.orDie,
  );

  const todas = sql<{ id: string }>`SELECT id FROM listas_pendencias ORDER BY atualizada_em DESC`.pipe(
    Effect.map((linhas) => linhas.map((l) => l.id)),
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

  const doArquivo = Effect.fn("Listas.doArquivo")(function* (arquivo: string) {
    const linhas = yield* sql<{ id: string }>`
      SELECT id FROM listas_pendencias WHERE arquivo = ${arquivo} ORDER BY atualizada_em DESC LIMIT 1
    `;
    return linhas[0]?.id ?? null;
  }, Effect.orDie);

  /** Insere as pendências novas, abertas, depois da última, cada uma com o evento. */
  const inserirNovas = Effect.fn("Listas.inserirNovas")(function* (
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

  const aplicarArquivoNovo = Effect.fn("Listas.aplicarArquivoNovo")(function* (
    id: string,
    mudancas: ReadonlyArray<MudancaPendencia>,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    textoNovas: string,
    a: ArquivoLista,
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

  const mesclarIa = Effect.fn("Listas.mesclarIa")(function* (
    id: string,
    m: MesclagemIa,
    novas: ReadonlyArray<{ chave: string; pendencia: PendenciaRevisao }>,
    obsoletas: ReadonlyArray<string> = [],
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(m.resultado);
    const resultadosIa = yield* codificarResultadosIa(m.resultadosIa);
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

  const trocarResultado = Effect.fn("Listas.trocarResultado")(function* (
    id: string,
    r: ResultadoRevisaoPpc,
    versaoCopia: number,
    noDocumento: ReadonlyMap<string, PendenciaRevisao["noDocumento"]>,
  ) {
    const data = yield* agora;
    const resultado = yield* codificarResultado(r);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // Onde cada pendência ficou na cópia gravada (no trecho, no título ou só na lista).
        for (const p of yield* pendencias(id)) {
          const local = noDocumento.get(p.chave);
          if (local === undefined || local === p.pendencia.noDocumento) continue;
          yield* sql`
            UPDATE pendencias_vivas SET pendencia = ${yield* codificarPendencia({ ...p.pendencia, noDocumento: local })}
            WHERE lista_id = ${id} AND chave = ${p.chave}
          `;
        }
        yield* sql`
          UPDATE listas_pendencias SET resultado = ${resultado}, versao_copia = ${versaoCopia}, atualizada_em = ${data}
          WHERE id = ${id}
        `;
      }),
    );
  }, Effect.orDie);

  const gravarAcao = Effect.fn("Listas.gravarAcao")(function* (id: string, chave: string, a: AcaoIaGravada) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
      SELECT ${id}, ${chave}, ${a.acao}, ${a.numero}, ${yield* codificarUso(a.uso)}, ${a.segundos},
        ${yield* codificarFerramentas(a.ferramentas)}, ${data}
      WHERE EXISTS (SELECT 1 FROM listas_pendencias WHERE id = ${id})
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
    yield* descarregar(sql);
  }, Effect.orDie);

  const acrescentar = Effect.fn("Listas.acrescentar")(function* (
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

  const expirar = Effect.fn("Listas.expirar")(function* (antesDe: string) {
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

  return Listas.of({
    acrescentar,
    expirar,
    contestacoes,
    criar,
    buscar,
    exclusivo,
    localizar,
    ligarRevisao,
    mesclarIa,
    ultima,
    todas,
    pendencias,
    eventos,
    mudar,
    doArquivo,
    aplicarArquivoNovo,
    trocarResultado,
    gravarAcao,
    uso,
    apagar,
  });
});

/** Pede o `SqlClient` do banco das conversas. */
export const layer = Layer.effect(Listas, make);
