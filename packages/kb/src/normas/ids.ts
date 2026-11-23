/**
 * IDs canônicos de normas, de dispositivos e de referências fora da base.
 *
 * O ID é derivado do ato, nunca do nome do arquivo (`docs/plans/arquitetura-base.md`, "IDs canônicos"):
 *
 * - norma com órgão: `<jurisdição>/<órgão>/<tipo>/<ano>/<número>`, como `br/cne-cp/res/2026/2`,
 *   `ifpr/consup/res/2024/190` e `ifpr/proens/nt/2025/1`;
 * - ato da Presidência (lei, decreto, lei complementar...): `br/<tipo>/<ano>/<número>`, como
 *   `br/lei/1996/9394` e `br/decreto/2004/5154`;
 * - referência fora da base: `externo:<segmentos>`, como `externo:cft/res/2019/89`,
 *   `externo:abnt/nbr/6023` e `externo:campus/regulamento-estagio`;
 * - dispositivo: sufixo `#...` do ID da norma, como `#art28-xvi`, `#art28-par1-iv`,
 *   `#art71-parunico`, `#art36A` e `#art5-al-a`;
 * - catálogo: `cnct:catalogo` (o CNCT como um todo) e `cnct:<slug>` (um curso do CNCT, com o `id` de
 *   `catalogos/cnct/index.json`, como `cnct:tecnico-em-enfermagem`).
 */

/** Reduz a ASCII sem diacríticos (NFKD, descartando o que não for ASCII) e em minúsculas. */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase();
}

/** Tipos de ato da Presidência, sem segmento de órgão no ID. */
export const TIPOS_SEM_ORGAO = ["lei", "lc", "decreto", "decreto-lei", "mp", "ec"] as const;
/** Tipos de ato emitidos por órgão (conselho, ministério, pró-reitoria). */
const TIPOS_COM_ORGAO = ["res", "portaria", "nt", "parecer", "in", "deliberacao"] as const;

export type TipoAto = (typeof TIPOS_SEM_ORGAO)[number] | (typeof TIPOS_COM_ORGAO)[number];

const SLUG = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`;
/** O ID de uma norma: um ato, um arquivo. É o que uma citação (ficha, marco, relação) referencia. */
export const RE_ID_NORMA = new RegExp(
  String.raw`^(?:br/(?:${TIPOS_SEM_ORGAO.join("|")})|(?:br|ifpr)/${SLUG}/(?:${TIPOS_COM_ORGAO.join("|")}))/(\d{4})/([1-9]\d*)$`,
);
const RE_ID_EXTERNO = /^externo:[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$/;
const RE_ID_CNCT = /^cnct:[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * Dispositivo: artigo (com letra maiúscula colada), parágrafo, inciso (com letra: `-ivA`), alínea e
 * item; artigo de anexo (`#anexo1-art5`); anexo e item de anexo; seção de norma sem artigos
 * (`#secao1`, nota técnica). Regras em `estrutura.ts`.
 */
const RE_DISPOSITIVO =
  /^#(?:(?:anexo\d+-)?art[1-9]\d*[A-Z]*(?:-par(?:[1-9]\d*[A-Z]*|unico))?(?:-[ivxlc]+[A-Z]?)?(?:-al-[a-z])?(?:-item\d+)?|anexo\d+(?:-item\d+)?|secao\d+)$/;

export function ehIdNorma(id: string): boolean {
  return RE_ID_NORMA.test(id);
}

export function ehIdExterno(id: string): boolean {
  return RE_ID_EXTERNO.test(id);
}

export function ehIdDispositivo(dispositivo: string): boolean {
  return RE_DISPOSITIVO.test(dispositivo);
}

/** `cnct:catalogo` ou `cnct:<slug do curso>`. */
export function ehIdCnct(id: string): boolean {
  return RE_ID_CNCT.test(id);
}

/**
 * Regex de uma referência citável (norma, `externo:` ou `cnct:`), para contratos que
 * precisam do padrão como dado (zod → JSON Schema).
 */
export const RE_REFERENCIA = new RegExp(
  `^(?:${[RE_ID_NORMA, RE_ID_EXTERNO, RE_ID_CNCT].map((re) => re.source.slice(1, -1)).join("|")})$`,
);
export const RE_ID_DISPOSITIVO = RE_DISPOSITIVO;
/** Norma com dispositivo: `br/cne-ceb/res/2025/3#art6-iii`. */
export const RE_ID_ATO_COM_DISPOSITIVO = new RegExp(
  `${RE_ID_NORMA.source.slice(0, -1)}${RE_DISPOSITIVO.source.slice(1)}`,
);

/** Partes de um ID de norma (`null` se o formato for inválido). */
export function partesIdNorma(id: string): {
  jurisdicao: string;
  orgao: string | null;
  tipo: string;
  ano: number;
  numero: string;
} | null {
  if (!RE_ID_NORMA.test(id)) return null;
  const segmentos = id.split("/");
  if (segmentos.length === 4) {
    const [jurisdicao, tipo, ano, numero] = segmentos as [string, string, string, string];
    return { jurisdicao, orgao: null, tipo, ano: Number(ano), numero };
  }
  const [jurisdicao, orgao, tipo, ano, numero] = segmentos as [string, string, string, string, string];
  return { jurisdicao, orgao, tipo, ano: Number(ano), numero };
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
 * ID esperado para uma norma da base, a partir do front matter. Devolve `null` quando o tipo ou o
 * órgão não têm regra.
 */
export function idEsperadoDaNorma(meta: {
  tipo_documento: string;
  orgao: string;
  jurisdicao: string;
  numero: string | number;
  ano: string | number;
}): string | null {
  const orgaoNormalizado = semAcento(meta.orgao).trim();
  const presidencia = ORGAOS_PRESIDENCIA.has(orgaoNormalizado);
  const tipo = TIPO_POR_DOCUMENTO[semAcento(meta.tipo_documento).trim()];
  if (!tipo) return null;
  const semOrgao = (TIPOS_SEM_ORGAO as readonly string[]).includes(tipo);
  if (semOrgao !== presidencia) return null;
  return montarIdNorma({
    jurisdicao: semAcento(meta.jurisdicao).trim(),
    orgao: semOrgao ? null : segmentoOrgao(meta.orgao),
    tipo,
    ano: meta.ano,
    numero: meta.numero,
  });
}

/** Segmento de tipo do ID → `tipo_documento`, como o front matter o escreve. */
const DOCUMENTO_POR_TIPO: Readonly<Record<TipoAto, string>> = {
  lei: "Lei",
  lc: "Lei Complementar",
  decreto: "Decreto",
  "decreto-lei": "Decreto-Lei",
  mp: "Medida Provisória",
  ec: "Emenda Constitucional",
  res: "Resolução",
  portaria: "Portaria",
  nt: "Nota Técnica",
  parecer: "Parecer",
  in: "Instrução Normativa",
  deliberacao: "Deliberação",
};

/** Órgãos cujo nome não é sigla: o segmento do ID não volta ao nome só com maiúsculas. */
const ORGAO_POR_SEGMENTO: Readonly<Record<string, string>> = { reitoria: "Reitoria" };

/**
 * Os metadados que o ID de um ato carrega, como o front matter os escreve: o inverso de
 * `idEsperadoDaNorma`. Serve às normas sem texto na base (`stubs.yaml`), que não registram tipo, órgão,
 * número nem ano à parte. `null` para ID que não é de norma (`externo:`).
 */
export function metadadosDoIdNorma(id: string): {
  tipo_documento: string;
  orgao: string;
  jurisdicao: string;
  numero: string;
  ano: number;
} | null {
  const partes = ehIdNorma(id) ? partesIdNorma(id) : null;
  if (partes === null) return null;
  const sigla = (segmento: string) => ORGAO_POR_SEGMENTO[segmento] ?? segmento.toUpperCase().replaceAll("-", "/");
  const orgao =
    partes.orgao === null
      ? "Presidência da República"
      : partes.jurisdicao === "ifpr"
        ? `${sigla(partes.orgao)}/IFPR`
        : sigla(partes.orgao);
  return {
    tipo_documento: DOCUMENTO_POR_TIPO[partes.tipo as TipoAto],
    orgao,
    jurisdicao: partes.jurisdicao.toUpperCase(),
    numero: partes.numero,
    ano: partes.ano,
  };
}
