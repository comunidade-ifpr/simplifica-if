/**
 * Envelope comum das respostas (especificação M0.1, "Envelope"): a versão da base, os dados da
 * ferramenta, os avisos e a paginação. Os schemas zod são a fonte dos tipos e viram o
 * `outputSchema` de cada ferramenta.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MetaBase } from "./banco.ts";

export type { Link } from "./links.ts";

export const CANAIS = ["dev", "beta", "estavel"] as const;
export type Canal = (typeof CANAIS)[number];

export const TIPOS_AVISO = [
  "vigencia-a-confirmar",
  "correspondencia-rascunho",
  "fato-extraido",
  "citacao-baixa-confianca",
  "stub-sem-texto",
  "resultado-resumido",
  "nao-encontrado",
] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export const esquemaLink = z.templateLiteral(["ifpr://", z.string().min(1)]);

export const esquemaBase = z.strictObject({
  /** `AAAA.MM.DD` quando o pacote for publicado (T0); `dev-<8 hex de fontes_sha256>` antes disso. */
  versao: z.string(),
  /** Commit de origem do pacote; `null` enquanto o banco não o registra (T0). */
  commit: z.string().nullable(),
  data_referencia: z.string(),
  canal: z.enum(CANAIS),
});
export type Base = z.infer<typeof esquemaBase>;

export const esquemaAviso = z.strictObject({
  tipo: z.enum(TIPOS_AVISO),
  mensagem: z.string(),
  ref: z.string().optional(),
});
export type Aviso = z.infer<typeof esquemaAviso>;

/** Proveniência: caminho no repositório de origem e linhas, desde 1. */
export const esquemaFonte = z.strictObject({
  path: z.string(),
  linha_inicio: z.number().int().min(1),
  linha_fim: z.number().int().min(1),
});
export type Fonte = z.infer<typeof esquemaFonte>;

export const esquemaPagina = z.strictObject({
  total: z.number().int().min(0),
  devolvidos: z.number().int().min(0),
  /** Cursor opaco da próxima página; ausente na última. */
  cursor: z.string().optional(),
});
export type Pagina = z.infer<typeof esquemaPagina>;

export function esquemaResposta<D extends z.ZodType>(dados: D) {
  return z.strictObject({
    base: esquemaBase,
    dados,
    avisos: z.array(esquemaAviso),
    pagina: esquemaPagina.optional(),
  });
}

export type Resposta<T> = {
  base: Base;
  dados: T;
  avisos: Aviso[];
  pagina?: Pagina;
};

/** Erro causado pela entrada (filtro, cursor): a mensagem vai para a IA, que pode corrigir a chamada. */
export class ErroEntrada extends Error {
  override name = "ErroEntrada";
}

/**
 * A `base` do envelope. `versao`, `commit` e `canal` vêm da tabela `meta` quando o banco os tem
 * (passo T0); sem eles, a versão é `dev-` e os 8 primeiros caracteres de `fontes_sha256`, o commit
 * fica `null` e o canal é o da linha de comando.
 */
export function montarBase(meta: MetaBase, canal: Canal): Base {
  return {
    versao: meta.versao ?? `dev-${meta.fontes_sha256.slice(0, 8)}`,
    commit: meta.commit,
    data_referencia: meta.data_referencia,
    canal: meta.canal ?? canal,
  };
}

export function responder<T>(
  base: Base,
  dados: T,
  extras: { avisos?: Aviso[]; pagina?: Pagina | undefined } = {},
): Resposta<T> {
  const resposta: Resposta<T> = { base, dados, avisos: extras.avisos ?? [] };
  if (extras.pagina) resposta.pagina = extras.pagina;
  return resposta;
}

/* ------------------------------------------------------------------ paginação */

/**
 * Cursor opaco: o deslocamento e uma impressão da consulta (os filtros, sem o cursor, e a versão da
 * base). Um cursor só vale para a mesma consulta na mesma base; trocar o filtro no meio da paginação
 * dá erro em vez de pular ou repetir itens.
 */
const esquemaCursor = z.strictObject({ d: z.number().int().min(0), c: z.string() });

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
  return createHash("sha256").update(serializarOrdenado(consulta)).digest("hex").slice(0, 12);
}

export function codificarCursor(deslocamento: number, consulta: unknown): string {
  return Buffer.from(JSON.stringify({ d: deslocamento, c: impressaoConsulta(consulta) })).toString("base64url");
}

/** Deslocamento guardado no cursor (0 sem cursor). */
export function lerCursor(cursor: string | undefined, consulta: unknown): number {
  if (cursor === undefined) return 0;
  let estado: z.infer<typeof esquemaCursor>;
  try {
    estado = esquemaCursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ErroEntrada("cursor inválido: use o cursor devolvido pela chamada anterior, sem alterá-lo");
  }
  if (estado.c !== impressaoConsulta(consulta)) {
    throw new ErroEntrada("o cursor é de outra consulta: repita a chamada com os mesmos filtros, ou sem cursor");
  }
  return estado.d;
}

/** Recorta uma lista já ordenada em páginas de `limite` itens. */
export function paginar<T>(
  itens: readonly T[],
  opcoes: { limite: number; cursor?: string | undefined; consulta: unknown },
): { itens: T[]; pagina: Pagina } {
  const inicio = lerCursor(opcoes.cursor, opcoes.consulta);
  if (inicio > itens.length) throw new ErroEntrada("cursor além do fim da lista: repita a chamada sem cursor");
  const pagina = itens.slice(inicio, inicio + opcoes.limite);
  const fim = inicio + pagina.length;
  return {
    itens: pagina,
    pagina: {
      total: itens.length,
      devolvidos: pagina.length,
      ...(fim < itens.length ? { cursor: codificarCursor(fim, opcoes.consulta) } : {}),
    },
  };
}
