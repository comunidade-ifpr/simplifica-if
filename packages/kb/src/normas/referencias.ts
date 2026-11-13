/**
 * Casamento de citações normativas com as normas do `manifest.json` da base.
 *
 * Semente do resolvedor de citações (fase 2 do plano de arquitetura). As
 * regras reproduzem o casamento que o validador da `analise-ppc` fazia em
 * Python; por isso o texto é reduzido a ASCII (NFKD sem diacríticos) antes de
 * aplicar as expressões, e os espaços seguem o conjunto `ESPACOS`.
 */
import { preenchido, textoDe, textoOuVazio } from "../json.ts";
import { aparar, ESPACOS } from "../texto.ts";

/** Norma do manifesto, como lida de `base-conhecimento/manifest.json`. */
export type NormaManifesto = { [campo: string]: unknown };

/** Tipo, número e ano de uma citação (por exemplo `["resolucao", "1", "2021"]`). */
export type ChaveNorma = readonly [tipo: string, numero: string, ano: string];

/** Órgãos genéricos que não distinguem a norma (leis da Presidência, colegiado do IFPR). */
const TOKENS_ORGAO_GENERICOS = new Set(["consup", "presidencia", "da", "republica"]);
const TIPOS_NORMA = ["resolucao", "lei", "portaria", "decreto", "nota tecnica", "parecer", "instrucao normativa"];

const S = `[${ESPACOS}]`;
const RE_RES = new RegExp(`\\bres\\.${S}*`, "g");
const RE_MARCADOR_NUMERO = new RegExp(`\\bn${S}*[o.]*${S}*(?=[0-9])`, "g");
const RE_PONTO_MILHAR = /(?<=[0-9])\.(?=[0-9]{3}\b)/g;
const RE_DATA_EXTENSO = new RegExp(`([0-9]+),?${S}+de${S}+[0-9]{1,2}o?${S}+de${S}+[a-z]+${S}+de${S}+([0-9]{4})`, "g");
const RE_ZEROS_ESQUERDA = /\b0+([0-9])/g;
const RE_ESPACOS = new RegExp(`${S}+`, "g");
const RE_NUMERO_ANO = new RegExp(`([0-9]+)${S}*/${S}*([0-9]{4})\\b`);
const RE_SEPARADOR_ORGAO = new RegExp(`[/${ESPACOS}]+`);
const RE_SEPARADOR_REFERENCIA = new RegExp(`[/${ESPACOS},;()]+`);

/** Reduz a ASCII sem diacríticos (NFKD, descartando o que não for ASCII) e em minúsculas. */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase();
}

/**
 * Normaliza grafias equivalentes de uma citação normativa para comparação.
 *
 * Remove acentos e caixa, expande "res.", tira o marcador "nº"/"n°"/"n." antes
 * do número, remove pontos de milhar, reduz "nº 1, de 5 de janeiro de 2021" a
 * "1/2021" e tira zeros à esquerda.
 */
export function normalizarReferencia(texto: string): string {
  let s = semAcento(texto);
  s = s.replace(RE_RES, "resolucao ");
  s = s.replace(RE_MARCADOR_NUMERO, "");
  s = s.replace(RE_PONTO_MILHAR, "");
  s = s.replace(RE_DATA_EXTENSO, "$1/$2");
  s = s.replace(RE_ZEROS_ESQUERDA, "$1");
  return aparar(s.replace(RE_ESPACOS, " "));
}

/** Extrai (tipo, número, ano) de uma citação, ou `null` se não houver tipo conhecido e padrão N/AAAA. */
export function chaveEstruturada(texto: string): ChaveNorma | null {
  const s = normalizarReferencia(texto);
  const tipo = TIPOS_NORMA.find((t) => s.startsWith(t));
  const numeroAno = RE_NUMERO_ANO.exec(s);
  if (!tipo || !numeroAno) return null;
  return [tipo, numeroAno[1]!, numeroAno[2]!];
}

/** Texto único de uma chave, para usar como chave de `Map`. */
export function textoDaChave(chave: ChaveNorma): string {
  return chave.join("\u0000");
}

/** Tokens distintivos do órgão (sem os genéricos), já normalizados. */
export function tokensOrgao(orgao: string): Set<string> {
  const tokens = normalizarReferencia(orgao)
    .split(RE_SEPARADOR_ORGAO)
    .filter((token) => token && !TOKENS_ORGAO_GENERICOS.has(token));
  return new Set(tokens);
}

function ehAlfanumericoAscii(caractere: string): boolean {
  return /^[A-Za-z0-9]$/.test(caractere);
}

/**
 * Associa uma citação à norma do manifesto.
 *
 * Primeiro por (tipo, número, ano), exigindo que os tokens distintivos do
 * órgão (ex.: "cne" e "cp", "ifpr") apareçam na citação; depois, como reserva,
 * pelo título ou alias com número que inicia a citação (o mais longo vence).
 * Siglas sem número (ex.: "DCNEPT") não são usadas para casar, porque são
 * ambíguas entre versões da norma.
 */
export function normaDaReferencia<T extends NormaManifesto>(referencia: string, manifest: readonly T[]): T | null {
  const texto = normalizarReferencia(referencia);
  const chave = chaveEstruturada(referencia);
  if (chave) {
    const tokensReferencia = new Set(texto.split(RE_SEPARADOR_REFERENCIA));
    for (const norma of manifest) {
      const tipo = norma.tipo_documento === undefined ? "" : textoDe(norma.tipo_documento);
      const numero = norma.numero === undefined ? "" : textoDe(norma.numero);
      const ano = norma.ano === undefined ? "" : textoDe(norma.ano);
      const chaveNorma = chaveEstruturada(`${tipo} ${numero}/${ano}`);
      if (!chaveNorma || textoDaChave(chaveNorma) !== textoDaChave(chave)) continue;
      const orgao = tokensOrgao(textoOuVazio(norma.orgao));
      if ([...orgao].every((token) => tokensReferencia.has(token))) return norma;
    }
  }
  let melhor: { tamanho: number; norma: T } | null = null;
  for (const norma of manifest) {
    const aliases = preenchido(norma.aliases) && Array.isArray(norma.aliases) ? norma.aliases : [];
    for (const chaveTexto of [norma.title, ...aliases]) {
      const alvo = normalizarReferencia(textoOuVazio(chaveTexto));
      if (!alvo || !/[0-9]/.test(alvo) || !texto.startsWith(alvo)) continue;
      if (texto.length > alvo.length && ehAlfanumericoAscii(texto[alvo.length]!)) continue;
      if (melhor === null || alvo.length > melhor.tamanho) melhor = { tamanho: alvo.length, norma };
    }
  }
  return melhor ? melhor.norma : null;
}
