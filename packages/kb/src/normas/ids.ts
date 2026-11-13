/**
 * IDs canônicos de normas, de dispositivos e de referências fora da base.
 *
 * O ID é derivado do ato, nunca do nome do arquivo (plano de arquitetura, "Arquitetura alvo"):
 *
 * - norma com órgão: `<jurisdição>/<órgão>/<tipo>/<ano>/<número>`, como `br/cne-cp/res/2026/2`,
 *   `ifpr/consup/res/2024/190` e `ifpr/proens/nt/2025/1`;
 * - ato da Presidência (lei, decreto, lei complementar...): `br/<tipo>/<ano>/<número>`, como
 *   `br/lei/1996/9394` e `br/decreto/2004/5154`;
 * - variante de arquivo do mesmo ato: `<id do ato>~<variante>`. Hoje só existe `~compilacao`,
 *   usada pela compilação de trechos da LDB (`br/lei/1996/9394~compilacao`). A variante tem ID
 *   próprio, para que o ID continue único por arquivo, mas a citação resolve para o ato;
 * - referência fora da base: `externo:<segmentos>`, como `externo:cft/res/2019/89`,
 *   `externo:abnt/nbr/6023` e `externo:campus/regulamento-estagio`;
 * - dispositivo: sufixo `#...` do ID da norma, como `#art28-xvi`, `#art28-par1-iv`,
 *   `#art71-parunico`, `#art36A` e `#art5-al-a`.
 */
import { semAcento } from "./referencias.ts";

/** Tipos de ato da Presidência, sem segmento de órgão no ID. */
export const TIPOS_SEM_ORGAO = ["lei", "lc", "decreto", "decreto-lei", "mp", "ec"] as const;
/** Tipos de ato emitidos por órgão (conselho, ministério, pró-reitoria). */
export const TIPOS_COM_ORGAO = ["res", "portaria", "nt", "parecer", "in", "deliberacao"] as const;
export const VARIANTES = ["compilacao"] as const;

export type TipoAto = (typeof TIPOS_SEM_ORGAO)[number] | (typeof TIPOS_COM_ORGAO)[number];
export type Variante = (typeof VARIANTES)[number];

const SLUG = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`;
const RE_ID_NORMA = new RegExp(
  String.raw`^(?:br/(?:${TIPOS_SEM_ORGAO.join("|")})|(?:br|ifpr)/${SLUG}/(?:${TIPOS_COM_ORGAO.join("|")}))/(\d{4})/([1-9]\d*)(?:~(${VARIANTES.join("|")}))?$`,
);
const RE_ID_EXTERNO = /^externo:[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$/;
/** Dispositivo: artigo (com letra maiúscula colada), parágrafo, inciso, alínea; ou item de anexo. */
const RE_DISPOSITIVO =
  /^#(?:art[1-9]\d*[A-Z]*(?:-par(?:[1-9]\d*[A-Z]*|unico))?(?:-[ivxlc]+)?(?:-al-[a-z])?|anexo\d+(?:-item\d+)?)$/;

export function ehIdNorma(id: string): boolean {
  return RE_ID_NORMA.test(id);
}

export function ehIdExterno(id: string): boolean {
  return RE_ID_EXTERNO.test(id);
}

export function ehIdDispositivo(dispositivo: string): boolean {
  return RE_DISPOSITIVO.test(dispositivo);
}

/** ID do ato, sem a variante de arquivo (`br/lei/1996/9394~compilacao` → `br/lei/1996/9394`). */
export function idDoAto(id: string): string {
  const til = id.indexOf("~");
  return til === -1 ? id : id.slice(0, til);
}

export function varianteDoId(id: string): string | null {
  const til = id.indexOf("~");
  return til === -1 ? null : id.slice(til + 1);
}

/** Partes de um ID de norma (`null` se o formato for inválido). */
export function partesIdNorma(id: string): {
  jurisdicao: string;
  orgao: string | null;
  tipo: string;
  ano: number;
  numero: string;
  variante: string | null;
} | null {
  if (!RE_ID_NORMA.test(id)) return null;
  const [ato, variante] = id.split("~");
  const segmentos = ato!.split("/");
  if (segmentos.length === 4) {
    const [jurisdicao, tipo, ano, numero] = segmentos as [string, string, string, string];
    return { jurisdicao, orgao: null, tipo, ano: Number(ano), numero, variante: variante ?? null };
  }
  const [jurisdicao, orgao, tipo, ano, numero] = segmentos as [string, string, string, string, string];
  return { jurisdicao, orgao, tipo, ano: Number(ano), numero, variante: variante ?? null };
}

/** Monta o ID de um ato a partir das partes já canônicas. */
export function montarIdNorma(partes: {
  jurisdicao: string;
  orgao: string | null;
  tipo: string;
  ano: number | string;
  numero: number | string;
}): string {
  const numero = String(partes.numero).replace(/^0+(?=\d)/, "");
  if (partes.orgao === null) return `${partes.jurisdicao}/${partes.tipo}/${partes.ano}/${numero}`;
  return `${partes.jurisdicao}/${partes.orgao}/${partes.tipo}/${partes.ano}/${numero}`;
}

/** `tipo_documento` do front matter → segmento de tipo do ID. */
const TIPO_POR_DOCUMENTO: Readonly<Record<string, TipoAto>> = {
  lei: "lei",
  "lei complementar": "lc",
  decreto: "decreto",
  "decreto-lei": "decreto-lei",
  "medida provisoria": "mp",
  "emenda constitucional": "ec",
  resolucao: "res",
  portaria: "portaria",
  "nota tecnica": "nt",
  parecer: "parecer",
  "instrucao normativa": "in",
  deliberacao: "deliberacao",
};

/** Órgãos que emitem atos sem segmento de órgão (a Presidência da República). */
const ORGAOS_PRESIDENCIA = new Set(["presidencia da republica", "presidencia"]);

/** Segmento de órgão do ID: `CNE/CP` → `cne-cp`, `CONSUP/IFPR` → `consup`, `MEC` → `mec`. */
export function segmentoOrgao(orgao: string): string {
  return semAcento(orgao)
    .replace(/\/\s*ifpr\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * ID esperado para uma norma da base, a partir do front matter.
 *
 * Uma compilação (`tipo_documento: Compilação`) reproduz dispositivos de outro ato: o ID é o do ato
 * de origem (o tipo vem de `tipo_ato`, ou é `lei` quando o órgão é a Presidência) com o sufixo
 * `~compilacao`. Devolve `null` quando o tipo ou o órgão não têm regra.
 */
export function idEsperadoDaNorma(meta: {
  tipo_documento: string;
  orgao: string;
  jurisdicao: string;
  numero: string | number;
  ano: string | number;
  tipo_ato?: string | undefined;
}): string | null {
  const compilacao = semAcento(meta.tipo_documento) === "compilacao";
  const orgaoNormalizado = semAcento(meta.orgao).trim();
  const presidencia = ORGAOS_PRESIDENCIA.has(orgaoNormalizado);
  const tipoDocumento = compilacao ? (meta.tipo_ato ?? (presidencia ? "Lei" : "")) : meta.tipo_documento;
  const tipo = TIPO_POR_DOCUMENTO[semAcento(tipoDocumento).trim()];
  if (!tipo) return null;
  const semOrgao = (TIPOS_SEM_ORGAO as readonly string[]).includes(tipo);
  if (semOrgao !== presidencia) return null;
  const id = montarIdNorma({
    jurisdicao: semAcento(meta.jurisdicao).trim(),
    orgao: semOrgao ? null : segmentoOrgao(meta.orgao),
    tipo,
    ano: meta.ano,
    numero: meta.numero,
  });
  return compilacao ? `${id}~compilacao` : id;
}
