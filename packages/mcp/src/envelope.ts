// @effect-diagnostics nodeBuiltinImport:off -- sha256 síncrono da impressão da consulta no cursor (o mesmo hash do servidor anterior)
/**
 * Envelope comum das respostas (especificação M0.1, "Envelope"): a `base` a partir da `meta` do
 * banco, a resposta com avisos e paginação, e o cursor opaco. Os schemas ficam em `contratos.ts`.
 * O serviço `Leitura` monta as respostas com estas funções.
 */
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { MetaBase } from "@simplifica-if/kb/BaseKb";
import type { Canal } from "@simplifica-if/kb/canal";
import { type Aviso, type Base, EntradaInvalida, type Pagina, type Resposta } from "./contratos.ts";

/**
 * A `base` do envelope. `versao`, `commit` e `canal` vêm da tabela `meta` quando o banco os tem
 * (passo T0); sem eles, a versão é `dev-` e os 8 primeiros caracteres de `fontes_sha256`, o commit
 * fica `null` e o canal é o da linha de comando.
 */
export function montarBase(meta: MetaEnvelope, canal: Canal): Base {
  return {
    versao: meta.versao ?? `dev-${meta.fontes_sha256.slice(0, 8)}`,
    commit: meta.commit,
    data_referencia: meta.data_referencia,
    canal: meta.canal ?? canal,
  };
}

/** O que o envelope usa da `meta` do banco (`BaseKb`), com o canal entre os do simplifica-mcp. */
export type MetaEnvelope = Pick<MetaBase, "versao" | "commit" | "data_referencia" | "fontes_sha256" | "canal">;

export function responder<T>(
  base: Base,
  dados: T,
  extras: { readonly avisos?: ReadonlyArray<Aviso>; readonly pagina?: Pagina | undefined } = {},
): Resposta<T> {
  const resposta: { base: Base; dados: T; avisos: ReadonlyArray<Aviso>; pagina?: Pagina } = {
    base,
    dados,
    avisos: extras.avisos ?? [],
  };
  if (extras.pagina) resposta.pagina = extras.pagina;
  return resposta;
}

/* ------------------------------------------------------------------ paginação */

/**
 * Cursor opaco: o deslocamento e uma impressão da consulta (os filtros, sem o cursor, e a versão da
 * base). Um cursor só vale para a mesma consulta na mesma base; trocar o filtro no meio da paginação
 * dá erro em vez de pular ou repetir itens.
 */
const EstadoCursor = Schema.fromJsonString(
  Schema.Struct({ d: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), c: Schema.String }),
);
const decodificarEstado = Schema.decodeUnknownEffect(EstadoCursor);

function serializarOrdenado(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(serializarOrdenado).join(",")}]`;
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${serializarOrdenado(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor) ?? "null";
}

export function impressaoConsulta(consulta: unknown): string {
  return NodeCrypto.createHash("sha256").update(serializarOrdenado(consulta)).digest("hex").slice(0, 12);
}

export function codificarCursor(deslocamento: number, consulta: unknown): string {
  return Buffer.from(JSON.stringify({ d: deslocamento, c: impressaoConsulta(consulta) })).toString("base64url");
}

const CURSOR_INVALIDO = "cursor inválido: use o cursor devolvido pela chamada anterior, sem alterá-lo";

/** Deslocamento guardado no cursor (0 sem cursor). */
export const lerCursor = Effect.fn("envelope.lerCursor")(function* (cursor: string | undefined, consulta: unknown) {
  if (cursor === undefined) return 0;
  const estado = yield* decodificarEstado(Buffer.from(cursor, "base64url").toString("utf8")).pipe(
    Effect.catchTags({ SchemaError: () => Effect.fail(new EntradaInvalida({ mensagem: CURSOR_INVALIDO })) }),
  );
  if (estado.c !== impressaoConsulta(consulta)) {
    return yield* new EntradaInvalida({
      mensagem: "o cursor é de outra consulta: repita a chamada com os mesmos filtros, ou sem cursor",
    });
  }
  return estado.d;
});

const CURSOR_ALEM_DO_FIM = "cursor além do fim da lista: repita a chamada sem cursor";

/** Recorta uma lista já ordenada em páginas de `limite` itens. */
export const paginar = Effect.fn("envelope.paginar")(function* <T>(
  itens: ReadonlyArray<T>,
  opcoes: { readonly limite: number; readonly cursor?: string | undefined; readonly consulta: unknown },
) {
  const inicio = yield* lerCursor(opcoes.cursor, opcoes.consulta);
  if (inicio > itens.length) return yield* new EntradaInvalida({ mensagem: CURSOR_ALEM_DO_FIM });
  const pagina = itens.slice(inicio, inicio + opcoes.limite);
  const fim = inicio + pagina.length;
  const dadosPagina: Pagina = {
    total: itens.length,
    devolvidos: pagina.length,
    ...(fim < itens.length ? { cursor: codificarCursor(fim, opcoes.consulta) } : {}),
  };
  return { itens: pagina, pagina: dadosPagina };
});

/**
 * Página de uma lista já ordenada: até `limite` itens a partir do cursor, enquanto a soma de
 * `medir(item)` (o tamanho do bloco do item no texto, com o separador) couber em `orcamento`. O
 * primeiro item da página entra sempre; a ferramenta corta o texto dele se for maior que o orçamento.
 */
export const paginarNoTeto = Effect.fn("envelope.paginarNoTeto")(function* <T>(
  itens: ReadonlyArray<T>,
  opcoes: {
    readonly limite: number;
    readonly cursor?: string | undefined;
    readonly consulta: unknown;
    readonly orcamento: number;
    readonly medir: (item: T) => number;
  },
) {
  const inicio = yield* lerCursor(opcoes.cursor, opcoes.consulta);
  if (inicio > itens.length) return yield* new EntradaInvalida({ mensagem: CURSOR_ALEM_DO_FIM });
  const pagina: T[] = [];
  let usado = 0;
  for (let i = inicio; i < itens.length && pagina.length < opcoes.limite; i += 1) {
    const tamanho = opcoes.medir(itens[i]!);
    if (pagina.length > 0 && usado + tamanho > opcoes.orcamento) break;
    pagina.push(itens[i]!);
    usado += tamanho;
  }
  const fim = inicio + pagina.length;
  const dadosPagina: Pagina = {
    total: itens.length,
    devolvidos: pagina.length,
    ...(fim < itens.length ? { cursor: codificarCursor(fim, opcoes.consulta) } : {}),
  };
  return { itens: pagina, inicio, pagina: dadosPagina };
});
