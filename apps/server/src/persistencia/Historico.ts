/**
 * O histórico das conversas no banco (`Banco.ts`): a tabela `conversas` e os `eventos` de cada uma.
 *
 * Uma falha do banco é defeito (`Effect.orDie`): sem o banco, o servidor não tem como guardar nem
 * mostrar as conversas, e o erro vai inteiro para o log.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  Decisao,
  type EstadoConversa,
  Evento,
  type ItemConversa,
  type Provider,
  type ResumoConversa,
} from "@simplifica-if/contratos-app";

/** Uma conversa gravada: o resumo da interface e o que o servidor precisa para reabrir a sessão. */
export interface RegistroConversa extends ResumoConversa {
  readonly buscaWeb?: boolean;
  /** O id da conversa no provider, para a retomada. */
  readonly idNativo?: string;
  /** A maior `ordem` gravada (0 sem itens). */
  readonly ultimaOrdem: number;
}

export interface NovaConversa {
  readonly id: string;
  readonly provider: Provider;
  readonly pastaTrabalho: string;
  readonly modelo?: string;
  readonly buscaWeb?: boolean;
  readonly idNativo?: string;
  readonly estado: EstadoConversa;
}

export interface Alteracao {
  readonly titulo?: string;
  readonly idNativo?: string;
  readonly estado?: EstadoConversa;
}

export class Historico extends Context.Service<
  Historico,
  {
    readonly criar: (conversa: NovaConversa) => Effect.Effect<void>;
    readonly buscar: (id: string) => Effect.Effect<Option.Option<RegistroConversa>>;
    /** Da mais recente (`atualizada_em`) para a mais antiga. */
    readonly listar: Effect.Effect<ReadonlyArray<RegistroConversa>>;
    /** Muda os campos dados e a data de atualização. */
    readonly alterar: (id: string, alteracao: Alteracao) => Effect.Effect<void>;
    readonly gravar: (conversa: string, item: ItemConversa) => Effect.Effect<void>;
    /** Os itens com `ordem` maior que `depois` (todos, sem ele), em ordem. */
    readonly itens: (conversa: string, depois?: number) => Effect.Effect<ReadonlyArray<ItemConversa>>;
    /** Apaga a conversa e os eventos dela. */
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** As conversas que o banco dá como abertas (`pronta`, `respondendo`), de uma execução anterior. */
    readonly abertas: Effect.Effect<ReadonlyArray<RegistroConversa>>;
  }
>()("@simplifica-if/server/persistencia/Historico") {}

interface LinhaConversa {
  readonly id: string;
  readonly provider: string;
  readonly pasta_trabalho: string;
  readonly modelo: string | null;
  readonly busca_web: number | null;
  readonly titulo: string;
  readonly id_nativo: string | null;
  readonly estado: string;
  readonly criada_em: string;
  readonly atualizada_em: string;
  readonly turnos: number | null;
  readonly ultima_ordem: number | null;
}

interface LinhaEvento {
  readonly ordem: number;
  readonly turno: number;
  readonly tipo: string;
  readonly dados: string;
}

const EventoJson = Schema.fromJsonString(Evento);
const MensagemJson = Schema.fromJsonString(Schema.Struct({ texto: Schema.String }));
const DecisaoJson = Schema.fromJsonString(Schema.Struct({ aprovacao: Schema.String, decisao: Decisao }));
const codificarEvento = Schema.encodeEffect(EventoJson);
const codificarMensagem = Schema.encodeEffect(MensagemJson);
const codificarDecisao = Schema.encodeEffect(DecisaoJson);
const decodificarEvento = Schema.decodeEffect(EventoJson);
const decodificarMensagem = Schema.decodeEffect(MensagemJson);
const decodificarDecisao = Schema.decodeEffect(DecisaoJson);

const paraRegistro = (linha: LinhaConversa): RegistroConversa => ({
  id: linha.id,
  provider: linha.provider as Provider,
  pastaTrabalho: linha.pasta_trabalho,
  ...(linha.modelo === null ? {} : { modelo: linha.modelo }),
  ...(linha.busca_web === null ? {} : { buscaWeb: linha.busca_web === 1 }),
  titulo: linha.titulo,
  ...(linha.id_nativo === null ? {} : { idNativo: linha.id_nativo }),
  estado: linha.estado as EstadoConversa,
  turnos: linha.turnos ?? 0,
  criadaEm: linha.criada_em,
  atualizadaEm: linha.atualizada_em,
  ultimaOrdem: linha.ultima_ordem ?? 0,
});

const agora = Effect.map(DateTime.now, DateTime.formatIso);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selecionar = (filtro: ReturnType<typeof sql.unsafe> | undefined) => sql<LinhaConversa>`
    SELECT c.*,
      (SELECT MAX(turno) FROM eventos e WHERE e.conversa_id = c.id) AS turnos,
      (SELECT MAX(ordem) FROM eventos e WHERE e.conversa_id = c.id) AS ultima_ordem
    FROM conversas c
    ${filtro ?? sql.unsafe("")}
    ORDER BY c.atualizada_em DESC, c.criada_em DESC
  `;

  const criar = Effect.fn("Historico.criar")(function* (conversa: NovaConversa) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO conversas (id, provider, pasta_trabalho, modelo, busca_web, id_nativo, estado, criada_em, atualizada_em)
      VALUES (${conversa.id}, ${conversa.provider}, ${conversa.pastaTrabalho}, ${conversa.modelo ?? null},
        ${conversa.buscaWeb === undefined ? null : conversa.buscaWeb ? 1 : 0}, ${conversa.idNativo ?? null},
        ${conversa.estado}, ${data}, ${data})
    `;
  }, Effect.orDie);

  const buscar = Effect.fn("Historico.buscar")(function* (id: string) {
    const linhas = yield* selecionar(sql`WHERE c.id = ${id}`);
    return Option.map(Option.fromNullishOr(linhas[0]), paraRegistro);
  }, Effect.orDie);

  const listar = selecionar(undefined).pipe(
    Effect.map((linhas) => linhas.map(paraRegistro)),
    Effect.orDie,
    Effect.withSpan("Historico.listar"),
  );

  const abertas = selecionar(sql`WHERE c.estado IN ('pronta', 'respondendo')`).pipe(
    Effect.map((linhas) => linhas.map(paraRegistro)),
    Effect.orDie,
    Effect.withSpan("Historico.abertas"),
  );

  const alterar = Effect.fn("Historico.alterar")(function* (id: string, alteracao: Alteracao) {
    const data = yield* agora;
    yield* sql`
      UPDATE conversas SET
        titulo = COALESCE(${alteracao.titulo ?? null}, titulo),
        id_nativo = COALESCE(${alteracao.idNativo ?? null}, id_nativo),
        estado = COALESCE(${alteracao.estado ?? null}, estado),
        atualizada_em = ${data}
      WHERE id = ${id}
    `;
  }, Effect.orDie);

  const gravar = Effect.fn("Historico.gravar")(function* (conversa: string, item: ItemConversa) {
    const data = yield* agora;
    const [tipo, dados] =
      item._tag === "Mensagem"
        ? ["mensagem", yield* codificarMensagem({ texto: item.texto })]
        : item._tag === "EventoTurno"
          ? ["evento", yield* codificarEvento(item.evento)]
          : ["decisao", yield* codificarDecisao({ aprovacao: item.aprovacao, decisao: item.decisao })];
    yield* sql`
      INSERT INTO eventos (conversa_id, ordem, turno, tipo, dados, criado_em)
      VALUES (${conversa}, ${item.ordem}, ${item.turno}, ${tipo}, ${dados}, ${data})
    `;
  }, Effect.orDie);

  const paraItem = Effect.fnUntraced(function* (linha: LinhaEvento) {
    const base = { turno: linha.turno, ordem: linha.ordem };
    switch (linha.tipo) {
      case "mensagem":
        return { _tag: "Mensagem", ...base, ...(yield* decodificarMensagem(linha.dados)) } as const;
      case "decisao":
        return {
          _tag: "DecisaoAprovacao",
          ...base,
          ...(yield* decodificarDecisao(linha.dados)),
        } as const;
      default:
        return { _tag: "EventoTurno", ...base, evento: yield* decodificarEvento(linha.dados) } as const;
    }
  });

  const itens = Effect.fn("Historico.itens")(function* (conversa: string, depois = 0) {
    const linhas = yield* sql<LinhaEvento>`
      SELECT ordem, turno, tipo, dados FROM eventos
      WHERE conversa_id = ${conversa} AND ordem > ${depois}
      ORDER BY ordem
    `;
    return yield* Effect.forEach(linhas, paraItem);
  }, Effect.orDie);

  const apagar = Effect.fn("Historico.apagar")(function* (id: string) {
    yield* sql`DELETE FROM conversas WHERE id = ${id}`;
  }, Effect.orDie);

  return Historico.of({ criar, buscar, listar, alterar, gravar, itens, abertas, apagar });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(Historico, make);
