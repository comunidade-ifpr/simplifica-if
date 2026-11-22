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
  type AvaliacaoResposta,
  Decisao,
  type EstadoConversa,
  EventoConversa,
  type ItemConversa,
  type NivelEsforco,
  type NotaResposta,
  type Provider,
  type ResumoConversa,
} from "@simplifica-if/contratos-app";
import { descarregar } from "./Banco.ts";

/** Uma conversa gravada: o resumo da interface e o que o servidor precisa para reabrir a sessão. */
export interface RegistroConversa extends ResumoConversa {
  readonly esforco?: NivelEsforco;
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
  readonly esforco?: NivelEsforco;
  readonly idNativo?: string;
  readonly estado: EstadoConversa;
  readonly tarefa?: string;
}

export interface Alteracao {
  readonly titulo?: string;
  readonly idNativo?: string;
  readonly estado?: EstadoConversa;
}

/** O que falta apagar fora do banco depois de apagar a conversa: as cópias do Desfazer e o registro do provider. */
export interface ApagamentoPendente {
  readonly conversa: string;
  readonly provider: Provider;
  readonly idNativo: string | null;
  readonly pastaTrabalho: string;
  readonly tentativas: number;
}

export interface PreviaHistorico {
  readonly mensagens: number;
  readonly anexos: number;
  /** Outra conversa usa a mesma pasta de trabalho. */
  readonly pastaCompartilhada: boolean;
}

export interface NovoRelato {
  readonly conversa: string;
  readonly turno: number;
  readonly via: "github" | "arquivo" | "copia";
  readonly titulo: string;
  readonly corpo: string;
  readonly arquivo: string | null;
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
    /**
     * Apaga a conversa, os eventos, as avaliações e os relatos dela e, se nenhuma outra conversa usa a
     * mesma pasta, o registro dos anexos da pasta. Na mesma transação, grava o que falta apagar fora do
     * banco (`apagamentos_pendentes`) e o devolve; nulo se a conversa não existia.
     */
    readonly apagar: (id: string) => Effect.Effect<ApagamentoPendente | null>;
    /** O que ficou por apagar fora do banco, das conversas apagadas antes. */
    readonly apagamentosPendentes: Effect.Effect<ReadonlyArray<ApagamentoPendente>>;
    /** O que faltava apagar da conversa saiu: a pendência sai também. */
    readonly concluirApagamento: (conversa: string) => Effect.Effect<void>;
    /** Uma tentativa de apagar o que faltava não deu certo; fica para a próxima partida do servidor. */
    readonly registrarTentativaApagamento: (conversa: string) => Effect.Effect<void>;
    /** O que apagar a conversa tira do app: as mensagens, os anexos registrados e se outra conversa usa a pasta. */
    readonly previa: (id: string) => Effect.Effect<PreviaHistorico>;
    /** As conversas que o banco dá como abertas (`pronta`, `respondendo`), de uma execução anterior. */
    readonly abertas: Effect.Effect<ReadonlyArray<RegistroConversa>>;
    /** Grava (ou, com `null`, retira) a avaliação da resposta do turno. */
    readonly avaliar: (conversa: string, turno: number, nota: NotaResposta | null) => Effect.Effect<void>;
    readonly avaliacoes: (conversa: string) => Effect.Effect<ReadonlyArray<AvaliacaoResposta>>;
    /** Registra um arquivo que entrou na pasta pelo "Anexar" do app. */
    readonly registrarAnexo: (pasta: string, nome: string) => Effect.Effect<void>;
    /** Os nomes (relativos à pasta) dos arquivos anexados pelo app. */
    readonly anexos: (pasta: string) => Effect.Effect<ReadonlySet<string>>;
    /** Registra um relato de "Isto está errado" (M1.12) e devolve o id. */
    readonly registrarRelato: (relato: NovoRelato) => Effect.Effect<number>;
    /** Os relatos de uma conversa, do mais antigo ao mais novo. */
    readonly relatos: (conversa: string) => Effect.Effect<ReadonlyArray<NovoRelato & { readonly id: number }>>;
  }
>()("@simplifica-if/server/persistencia/Historico") {}

interface LinhaConversa {
  readonly id: string;
  readonly provider: string;
  readonly pasta_trabalho: string;
  readonly modelo: string | null;
  readonly esforco: string | null;
  readonly titulo: string;
  readonly id_nativo: string | null;
  readonly estado: string;
  readonly criada_em: string;
  readonly atualizada_em: string;
  readonly turnos: number | null;
  readonly ultima_ordem: number | null;
  readonly tarefa: string | null;
}

interface LinhaEvento {
  readonly ordem: number;
  readonly turno: number;
  readonly tipo: string;
  readonly dados: string;
}

const EventoJson = Schema.fromJsonString(EventoConversa);
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
  ...(linha.esforco === null ? {} : { esforco: linha.esforco as NivelEsforco }),
  titulo: linha.titulo,
  ...(linha.id_nativo === null ? {} : { idNativo: linha.id_nativo }),
  estado: linha.estado as EstadoConversa,
  turnos: linha.turnos ?? 0,
  criadaEm: linha.criada_em,
  atualizadaEm: linha.atualizada_em,
  ultimaOrdem: linha.ultima_ordem ?? 0,
  ...(linha.tarefa === null ? {} : { tarefa: linha.tarefa }),
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
      INSERT INTO conversas (id, provider, pasta_trabalho, modelo, esforco, id_nativo, estado, tarefa, criada_em, atualizada_em)
      VALUES (${conversa.id}, ${conversa.provider}, ${conversa.pastaTrabalho}, ${conversa.modelo ?? null},
        ${conversa.esforco ?? null}, ${conversa.idNativo ?? null},
        ${conversa.estado}, ${conversa.tarefa ?? null}, ${data}, ${data})
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

  // `fnUntraced`: roda por linha lida, dentro do span da leitura.
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

  const lerPendentes = (filtro: string | null) =>
    sql<{
      conversa: string;
      provider: string;
      id_nativo: string | null;
      pasta_trabalho: string;
      tentativas: number;
    }>`
      SELECT conversa, provider, id_nativo, pasta_trabalho, tentativas FROM apagamentos_pendentes
      WHERE ${filtro === null ? sql`1 = 1` : sql`conversa = ${filtro}`}
      ORDER BY criado_em
    `.pipe(
      Effect.map((linhas) =>
        linhas.map((linha): ApagamentoPendente => ({
          conversa: linha.conversa,
          provider: linha.provider as Provider,
          idNativo: linha.id_nativo,
          pastaTrabalho: linha.pasta_trabalho,
          tentativas: linha.tentativas,
        })),
      ),
    );

  const apagar = Effect.fn("Historico.apagar")(function* (id: string) {
    const data = yield* agora;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT OR REPLACE INTO apagamentos_pendentes (conversa, provider, id_nativo, pasta_trabalho, criado_em)
          SELECT id, provider, id_nativo, pasta_trabalho, ${data} FROM conversas WHERE id = ${id}
        `;
        yield* sql`
          DELETE FROM anexos_pasta
          WHERE pasta = (SELECT pasta_trabalho FROM conversas WHERE id = ${id})
            AND NOT EXISTS (
              SELECT 1 FROM conversas c
              WHERE c.id <> ${id} AND c.pasta_trabalho = (SELECT pasta_trabalho FROM conversas WHERE id = ${id})
            )
        `;
        yield* sql`DELETE FROM conversas WHERE id = ${id}`;
      }),
    );
    yield* descarregar(sql);
    return (yield* lerPendentes(id))[0] ?? null;
  }, Effect.orDie);

  const apagamentosPendentes = lerPendentes(null).pipe(Effect.orDie);

  const concluirApagamento = Effect.fn("Historico.concluirApagamento")(function* (conversa: string) {
    yield* sql`DELETE FROM apagamentos_pendentes WHERE conversa = ${conversa}`;
  }, Effect.orDie);

  const registrarTentativaApagamento = Effect.fn("Historico.registrarTentativaApagamento")(function* (
    conversa: string,
  ) {
    const data = yield* agora;
    yield* sql`
      UPDATE apagamentos_pendentes SET tentativas = tentativas + 1, ultima_tentativa_em = ${data}
      WHERE conversa = ${conversa}
    `;
  }, Effect.orDie);

  const previa = Effect.fn("Historico.previa")(function* (id: string) {
    const linha = (yield* sql<{ mensagens: number; anexos: number; compartilhada: number }>`
      SELECT
        (SELECT COUNT(*) FROM eventos WHERE conversa_id = c.id AND tipo = 'mensagem') AS mensagens,
        (SELECT COUNT(*) FROM anexos_pasta WHERE pasta = c.pasta_trabalho) AS anexos,
        EXISTS (SELECT 1 FROM conversas o WHERE o.id <> c.id AND o.pasta_trabalho = c.pasta_trabalho) AS compartilhada
      FROM conversas c WHERE c.id = ${id}
    `)[0];
    return {
      mensagens: linha?.mensagens ?? 0,
      anexos: linha?.anexos ?? 0,
      pastaCompartilhada: linha?.compartilhada === 1,
    } satisfies PreviaHistorico;
  }, Effect.orDie);

  const avaliar = Effect.fn("Historico.avaliar")(function* (
    conversa: string,
    turno: number,
    nota: NotaResposta | null,
  ) {
    if (nota === null) {
      yield* sql`DELETE FROM avaliacoes WHERE conversa_id = ${conversa} AND turno = ${turno}`;
      return;
    }
    const data = yield* agora;
    yield* sql`
      INSERT INTO avaliacoes (conversa_id, turno, nota, avaliada_em) VALUES (${conversa}, ${turno}, ${nota}, ${data})
      ON CONFLICT (conversa_id, turno) DO UPDATE SET nota = excluded.nota, avaliada_em = excluded.avaliada_em
    `;
  }, Effect.orDie);

  const avaliacoes = Effect.fn("Historico.avaliacoes")(function* (conversa: string) {
    const linhas = yield* sql<{ readonly turno: number; readonly nota: string }>`
      SELECT turno, nota FROM avaliacoes WHERE conversa_id = ${conversa} ORDER BY turno
    `;
    return linhas.map((linha): AvaliacaoResposta => ({ turno: linha.turno, nota: linha.nota as NotaResposta }));
  }, Effect.orDie);

  const registrarAnexo = Effect.fn("Historico.registrarAnexo")(function* (pasta: string, nome: string) {
    const data = yield* agora;
    yield* sql`
      INSERT INTO anexos_pasta (pasta, nome, anexado_em) VALUES (${pasta}, ${nome}, ${data})
      ON CONFLICT (pasta, nome) DO UPDATE SET anexado_em = excluded.anexado_em
    `;
  }, Effect.orDie);

  const anexos = Effect.fn("Historico.anexos")(function* (pasta: string) {
    const linhas = yield* sql<{ readonly nome: string }>`SELECT nome FROM anexos_pasta WHERE pasta = ${pasta}`;
    return new Set(linhas.map((linha) => linha.nome)) as ReadonlySet<string>;
  }, Effect.orDie);

  const registrarRelato = Effect.fn("Historico.registrarRelato")(function* (relato: NovoRelato) {
    const data = yield* agora;
    const linhas = yield* sql<{ readonly id: number }>`
      INSERT INTO relatos (conversa_id, turno, via, titulo, corpo, arquivo, criado_em)
      VALUES (${relato.conversa}, ${relato.turno}, ${relato.via}, ${relato.titulo}, ${relato.corpo}, ${relato.arquivo}, ${data})
      RETURNING id
    `;
    return linhas[0]!.id;
  }, Effect.orDie);

  const relatos = Effect.fn("Historico.relatos")(function* (conversa: string) {
    const linhas = yield* sql<{
      readonly id: number;
      readonly turno: number;
      readonly via: string;
      readonly titulo: string;
      readonly corpo: string;
      readonly arquivo: string | null;
    }>`SELECT id, turno, via, titulo, corpo, arquivo FROM relatos WHERE conversa_id = ${conversa} ORDER BY id`;
    return linhas.map((linha) => ({ ...linha, conversa, via: linha.via as NovoRelato["via"] }));
  }, Effect.orDie);

  return Historico.of({
    criar,
    buscar,
    listar,
    alterar,
    gravar,
    itens,
    abertas,
    apagar,
    apagamentosPendentes,
    concluirApagamento,
    registrarTentativaApagamento,
    previa,
    avaliar,
    avaliacoes,
    registrarAnexo,
    anexos,
    registrarRelato,
    relatos,
  });
});

/** Pede o `SqlClient` do banco das conversas (`Banco.layerArquivo` ou `Banco.layerMemoria`). */
export const layer = Layer.effect(Historico, make);
