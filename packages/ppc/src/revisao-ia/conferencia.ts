/**
 * Revisão com IA (M1.11, etapa 4): a conferência em código de toda resposta da IA.
 *
 * Nenhuma resposta entra no resultado sem passar por aqui:
 * - o JSON pelo contrato (Effect Schema `ResultadoIa`), com os estados da ficha (`estados_permitidos`);
 * - um resultado para cada ficha do bloco, nenhum de fora;
 * - cada `trecho` citado existe literalmente no PPC (ignorando espaços e marcação; com reticências,
 *   cada pedaço existe);
 * - cada fonte citada estava no contexto entregue ao bloco (`fontesPermitidas`);
 * - ATENDE com ao menos uma evidência; o tema J com o `resumo`.
 *
 * A conferência é por ficha: uma ficha com problema não derruba as boas do mesmo bloco. O servidor
 * pede uma nova tentativa com os problemas; se falhar de novo, a ficha sai "a conferir", com o motivo
 * (`resultadoAConferir`), nunca com um fato que a conferência recusou.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { dobrar, type Bloco, type FichaIa } from "./plano.ts";

export const EstadoIa = Schema.Literals(["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"]);
export type EstadoIa = typeof EstadoIa.Type;

const Texto = Schema.String;

/** Um resultado de ficha, no contrato da `revisar-ppc` reduzido ao que o app usa. */
export const ResultadoIa = Schema.Struct({
  ficha_id: Texto,
  estado: EstadoIa,
  confianca: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  justificativa: Texto.check(Schema.isMinLength(1)),
  evidencias: Schema.Array(Schema.Struct({ trecho: Texto })),
  lacunas: Schema.Array(Texto),
  o_que_fazer: Schema.optionalKey(Texto),
  fontes: Schema.optionalKey(Schema.Array(Texto)),
  revisao_humana_obrigatoria: Schema.Boolean,
});
export type ResultadoIa = typeof ResultadoIa.Type;

const Casca = Schema.Struct({
  bloco: Schema.optionalKey(Texto),
  resultados: Schema.Array(Schema.Unknown),
  resumo: Schema.optionalKey(Texto),
});

const decodificarCasca = Schema.decodeUnknownResult(Casca);
const decodificarResultado = Schema.decodeUnknownResult(ResultadoIa);

/** O objeto JSON da resposta: do primeiro `{` ao último `}` (com ou sem cerca de código). */
export function extrairJson(texto: string): unknown {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) throw new Error("a resposta não tem objeto JSON");
  return JSON.parse(texto.slice(inicio, fim + 1));
}

/** Normalização para a comparação literal: a de `dobrar`, mais aspas tipográficas. */
const normalizar = (s: string) => dobrar(s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));

/** O PPC preparado para a conferência dos trechos (normalize uma vez por revisão). */
export const alvoDosTrechos = (ppc: string) => normalizar(ppc);

/** O trecho existe no PPC (com reticências, cada pedaço de 3+ caracteres existe). */
export function trechoExiste(trecho: string, alvo: string): boolean {
  const pedacos = trecho
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/)
    .map(normalizar)
    .filter((p) => p.length >= 3);
  return pedacos.length > 0 && pedacos.every((p) => alvo.includes(p));
}

export type Conferencia = {
  /** As fichas aprovadas na conferência, com o resultado. */
  validos: Map<string, ResultadoIa>;
  /** Os problemas de cada ficha recusada (ou `*` para a resposta inteira). */
  problemas: Map<string, string[]>;
  resumo: string | null;
};

const adicionar = (mapa: Map<string, string[]>, chave: string, problema: string) =>
  mapa.set(chave, [...(mapa.get(chave) ?? []), problema]);

/** Confere a resposta de um bloco. Nunca lança: o que falha vira problema. */
export function conferirResposta(
  texto: string,
  bloco: Bloco,
  fichas: readonly FichaIa[],
  entrada: { alvo: string; fontes: ReadonlySet<string> },
): Conferencia {
  const validos = new Map<string, ResultadoIa>();
  const problemas = new Map<string, string[]>();
  let bruto: unknown;
  try {
    bruto = extrairJson(texto);
  } catch (erro) {
    adicionar(problemas, "*", `JSON inválido: ${erro instanceof Error ? erro.message : String(erro)}`);
    return { validos, problemas, resumo: null };
  }
  const casca = decodificarCasca(bruto);
  if (Result.isFailure(casca)) {
    adicionar(problemas, "*", `fora do contrato: ${String(casca.failure.message).slice(0, 300)}`);
    return { validos, problemas, resumo: null };
  }
  const resumo = casca.success.resumo?.trim() || null;
  if (bloco.tipo === "J" && !resumo) adicionar(problemas, "*", "falta o `resumo` do tema");
  const porId = new Map(fichas.map((f) => [f.id, f]));
  for (const item of casca.success.resultados) {
    const id = (item as { ficha_id?: unknown } | null)?.ficha_id;
    const fichaId = typeof id === "string" ? id : "?";
    const ficha = porId.get(fichaId);
    if (!ficha) {
      adicionar(problemas, "*", `critério fora do bloco: ${fichaId}`);
      continue;
    }
    if (validos.has(fichaId) || problemas.has(fichaId)) {
      adicionar(problemas, fichaId, "resultado repetido");
      validos.delete(fichaId);
      continue;
    }
    const decodificado = decodificarResultado(item);
    if (Result.isFailure(decodificado)) {
      adicionar(problemas, fichaId, `fora do contrato: ${String(decodificado.failure.message).slice(0, 300)}`);
      continue;
    }
    const r = decodificado.success;
    const erros: string[] = [];
    if (!ficha.estados_permitidos.includes(r.estado)) erros.push(`estado ${r.estado} não é permitido para a ficha`);
    for (const e of r.evidencias)
      if (e.trecho.trim() && !trechoExiste(e.trecho, entrada.alvo))
        erros.push(`trecho que não está no PPC: "${e.trecho.slice(0, 120)}"`);
    for (const fonte of r.fontes ?? [])
      if (!entrada.fontes.has(fonte) && !entrada.fontes.has(fonte.split("#")[0]!) && !fonte.startsWith("cnct"))
        erros.push(`fonte fora do contexto entregue: ${fonte}`);
    if (r.estado === "ATENDE" && !r.evidencias.some((e) => e.trecho.trim()))
      erros.push("ATENDE sem trecho do PPC");
    if (erros.length) problemas.set(fichaId, erros);
    else validos.set(fichaId, r);
  }
  for (const f of fichas)
    if (!validos.has(f.id) && !problemas.has(f.id)) adicionar(problemas, f.id, "sem resultado na resposta");
  return { validos, problemas, resumo };
}

/** A mensagem de nova tentativa: só os problemas, para a IA corrigir na mesma sessão. */
export function pedidoDeCorrecao(conferencia: Conferencia): string {
  const linhas = [...conferencia.problemas].map(([ficha, erros]) => `- ${ficha === "*" ? "resposta" : ficha}: ${erros.join("; ")}`);
  return [
    "A resposta não passou na conferência automática:",
    ...linhas,
    "Responda de novo só com o JSON completo e corrigido (todos os critérios do bloco). Trechos têm de ser cópia literal do PPC; fontes, só as do contexto.",
  ].join("\n");
}

/** O motivo, para a pessoa, de uma ficha que ficou "a conferir" por falhar na conferência. */
export function motivoLegivel(erros: readonly string[]): string {
  if (erros.some((e) => e.startsWith("trecho"))) return "a IA citou um trecho que não está no documento";
  if (erros.some((e) => e.startsWith("fonte"))) return "a IA citou uma norma que não estava entre as consultadas";
  if (erros.some((e) => e.startsWith("ATENDE"))) return "a IA disse que atende sem mostrar o trecho";
  return "a resposta da IA veio fora do formato esperado";
}
