/**
 * Links `ifpr://`: o contrato entre a resposta da IA e a interface do app (esquema em
 * `docs/plans/app-simplifica-if.md`, "Esquema `ifpr://`"). Derivados dos IDs canônicos do banco:
 *
 * | ID no banco                                   | Link                                            |
 * |-----------------------------------------------|-------------------------------------------------|
 * | `br/cne-cp/res/2026/2` (+ `#art28-xviii`)     | `ifpr://norma/br/cne-cp/res/2026/2#art28-xviii` |
 * | `curso:curitiba/tecnico-em-enfermagem`        | `ifpr://curso/curitiba/tecnico-em-enfermagem`   |
 * | `ppc:curitiba/tecnico-em-enfermagem`          | `ifpr://ppc/curitiba/tecnico-em-enfermagem`     |
 * | seção `curitiba/tecnico-em-enfermagem#avaliacao-1` | `ifpr://ppc/curitiba/tecnico-em-enfermagem#avaliacao-1` |
 * | `cnct:tecnico-em-enfermagem`                  | `ifpr://cnct/tecnico-em-enfermagem`             |
 * | `campus:curitiba`                             | `ifpr://campus/curitiba`                        |
 * | ficha `CT-CURR-12`                            | `ifpr://ficha/CT-CURR-12`                       |
 *
 * Os IDs do banco já são seguros para URI (ASCII, sem espaço), então nada é codificado: um ID fora
 * desse formato é erro de programa e falha aqui. Pode migrar para `packages/kb` quando o app e o
 * site também gerarem links.
 */

export type Link = `ifpr://${string}`;

export const TIPOS_LINK = ["norma", "curso", "ppc", "cnct", "campus", "ficha"] as const;
export type TipoLink = (typeof TIPOS_LINK)[number];

const SEGMENTO = String.raw`[A-Za-z0-9._~:-]+`;
const RE_CAMINHO = new RegExp(String.raw`^${SEGMENTO}(?:/${SEGMENTO})*$`);
const RE_FRAGMENTO = /^[A-Za-z0-9._~-]+$/;

function semPrefixo(prefixo: string, id: string): string {
  return id.startsWith(prefixo) ? id.slice(prefixo.length) : id;
}

/** Separa `caminho#fragmento`; o fragmento explícito não pode repetir um que já esteja no ID. */
function separar(id: string, fragmento: string | undefined): [string, string | undefined] {
  const i = id.indexOf("#");
  if (i === -1) return [id, fragmento];
  if (fragmento !== undefined) throw new Error(`link ifpr://: "${id}" já traz o fragmento; não passe outro`);
  return [id.slice(0, i), id.slice(i + 1)];
}

function montar(tipo: TipoLink, caminho: string, fragmento: string | undefined, segmentos?: number): Link {
  if (!RE_CAMINHO.test(caminho)) throw new Error(`link ifpr://${tipo}: ID inválido "${caminho}"`);
  if (segmentos !== undefined && caminho.split("/").length !== segmentos) {
    throw new Error(
      `link ifpr://${tipo}: esperava ${segmentos === 2 ? '"campus/curso"' : "um segmento"}, veio "${caminho}"`,
    );
  }
  if (fragmento !== undefined && !RE_FRAGMENTO.test(fragmento)) {
    throw new Error(`link ifpr://${tipo}: fragmento inválido "${fragmento}"`);
  }
  return `ifpr://${tipo}/${caminho}${fragmento === undefined ? "" : `#${fragmento}`}`;
}

/** Norma (`br/lei/1996/9394`, `externo:abnt/nbr/6023`) ou dispositivo (`br/lei/1996/9394#art36`). */
export function linkNorma(id: string, dispositivo?: string): Link {
  const [norma, fragmento] = separar(id, dispositivo);
  return montar("norma", norma, fragmento);
}

/** Curso: `curso:campus/curso` ou `campus/curso`. */
export function linkCurso(id: string): Link {
  return montar("curso", semPrefixo("curso:", id), undefined, 2);
}

/** PPC (`ppc:campus/curso` ou `campus/curso`) ou seção (`campus/curso#secao`, o ID da tabela `secoes`). */
export function linkPpc(id: string, secao?: string): Link {
  const [ppc, fragmento] = separar(semPrefixo("ppc:", id), secao);
  return montar("ppc", ppc, fragmento, 2);
}

/** Curso do CNCT: `cnct:tecnico-em-enfermagem` ou `tecnico-em-enfermagem`. */
export function linkCnct(id: string): Link {
  return montar("cnct", semPrefixo("cnct:", id), undefined, 1);
}

/** Campus: `campus:curitiba` ou `curitiba`. */
export function linkCampus(id: string): Link {
  return montar("campus", semPrefixo("campus:", id), undefined, 1);
}

/** Ficha da `revisar-ppc`: `CT-CURR-12` (como na tabela `fichas`) ou `ficha:CT-CURR-12`. */
export function linkFicha(id: string): Link {
  return montar("ficha", semPrefixo("ficha:", id), undefined, 1);
}

/** Link de qualquer ID canônico com prefixo (`curso:`, `ppc:`, `cnct:`, `campus:`, `ficha:`); sem prefixo, norma. */
export function linkDe(id: string): Link {
  if (id.startsWith("curso:")) return linkCurso(id);
  if (id.startsWith("ppc:")) return linkPpc(id);
  if (id.startsWith("cnct:")) return linkCnct(id);
  if (id.startsWith("campus:")) return linkCampus(id);
  if (id.startsWith("ficha:")) return linkFicha(id);
  return linkNorma(id);
}

export interface LinkLido {
  tipo: TipoLink;
  /** O que vem depois de `ifpr://<tipo>/`, sem o fragmento. */
  caminho: string;
  fragmento: string | null;
}

/** Desmonta um link `ifpr://`; devolve `null` se não for um link válido. */
export function lerLink(link: string): LinkLido | null {
  const m = /^ifpr:\/\/([a-z]+)\/([^#]+)(?:#(.+))?$/.exec(link);
  if (!m) return null;
  const tipo = TIPOS_LINK.find((t) => t === m[1]);
  const caminho = m[2]!;
  const fragmento = m[3] ?? null;
  if (!tipo || !RE_CAMINHO.test(caminho) || (fragmento !== null && !RE_FRAGMENTO.test(fragmento))) return null;
  return { tipo, caminho, fragmento };
}
