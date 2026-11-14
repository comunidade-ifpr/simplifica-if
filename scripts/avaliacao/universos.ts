/**
 * Universos de itens reconhecíveis numa resposta (campi, cursos/PPCs e normas) e a detecção
 * determinística desses itens no texto. A precisão de uma pergunta de conjunto é medida sobre os
 * itens do universo encontrados na resposta.
 *
 * Os IDs seguem o formato do plano (fase 2): `campus:<id>`, `curso:<campus_id>/<curso_slug>` e,
 * para normas, um ID provisório derivado do ato (`br/cne-cp/res/2021/1`).
 */
import { compararTexto, compilarPadrao, escaparRegex, linhasNormalizadas, normalizarTexto } from "./normalizar.ts";
import type { ItemCampus, ItemCurso, ItemNorma, NomeUniverso, Universos } from "./esquema.ts";

/* ------------------------------------------------------------------ campi */

/** Apelidos usados na prática para campi de nome composto. */
const APELIDOS_CAMPUS: Readonly<Record<string, readonly string[]>> = {
  "assis-chateaubriand": ["assis"],
  "telemaco-borba": ["telemaco"],
};

function padraoPalavra(termo: string): string {
  return `(?<![a-z0-9])${escaparRegex(termo)}(?![a-z0-9])`;
}

export function itemCampus(campusId: string, nome: string): ItemCampus {
  const termos = [normalizarTexto(nome), ...(APELIDOS_CAMPUS[campusId] ?? [])];
  return { id: `campus:${campusId}`, rotulo: nome, padroes: [...new Set(termos)].map(padraoPalavra) };
}

/* ------------------------------------------------------------------ cursos */

const PREFIXOS_CURSO =
  /^(?:curso\s+)?(?:superior\s+de\s+)?(?:tecnico|tecnologia|licenciatura|bacharelado|especializacao|mestrado(?:\s+profissional)?|engenharia)(?:\s+(?:em|de|da|do|na|no))?\s+/u;
const SUFIXOS_CURSO =
  /\s+(?:integrad[oa]\s+(?:ao|a)\s+ensino\s+medio|integrad[oa]|subsequente|concomitante|proeja|a\s+distancia|ead)$/u;

/** Núcleo do nome do curso: sem nível, forma de oferta e pontuação ("informatica para internet"). */
export function nucleoCurso(nome: string): string {
  let nucleo = normalizarTexto(nome)
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
  for (let anterior = ""; anterior !== nucleo;) {
    anterior = nucleo;
    nucleo = nucleo.replace(PREFIXOS_CURSO, "").replace(SUFIXOS_CURSO, "").trim();
  }
  return nucleo === "" ? normalizarTexto(nome) : nucleo;
}

const TERMOS_FORMA: Readonly<Record<string, readonly string[]>> = {
  integrado: ["tecnico", "integrado"],
  subsequente: ["tecnico", "subsequente"],
  concomitante: ["tecnico", "concomitante"],
  "graduação tecnológica": ["tecnologia", "tecnologo", "superior"],
  licenciatura: ["licenciatura"],
  bacharelado: ["bacharelado", "engenharia"],
  especialização: ["especializacao", "pos"],
  mestrado: ["mestrado"],
  FIC: ["fic", "formacao inicial"],
};

export function itemCurso(curso: {
  campus_id: string;
  curso_slug: string;
  nome: string;
  forma_oferta?: string | undefined;
}): ItemCurso {
  const forma = [...(TERMOS_FORMA[curso.forma_oferta ?? ""] ?? [])];
  if (/proeja/u.test(curso.curso_slug) || /proeja/iu.test(curso.nome)) forma.push("proeja", "eja");
  return {
    id: `curso:${curso.campus_id}/${curso.curso_slug}`,
    rotulo: curso.nome,
    campus: `campus:${curso.campus_id}`,
    nucleo: nucleoCurso(curso.nome),
    forma,
  };
}

/* ------------------------------------------------------------------ normas */

export interface EntradaManifesto {
  title: string;
  tipo_documento: string;
  numero: string | number;
  ano: number;
  orgao: string;
  jurisdicao: string;
  aliases?: readonly string[] | undefined;
  path: string;
}

const SIGLA_TIPO: Readonly<Record<string, string>> = {
  Resolução: "res",
  Lei: "lei",
  Compilação: "lei",
  Portaria: "portaria",
  "Nota Técnica": "nt",
};

/** Aliases sem número que não identificam um único ato (ou que aparecem em textos de outras normas). */
const ALIASES_AMBIGUOS = new Set(
  [
    "Diretrizes Curriculares Nacionais para a Educação Profissional e Tecnológica",
    "Educação Integral em Tempo Integral",
    "LDB - trechos relevantes",
  ].map(normalizarTexto),
);

function segmentoOrgao(entrada: EntradaManifesto): string {
  if (entrada.tipo_documento === "Lei" || entrada.tipo_documento === "Compilação") return "lei";
  return normalizarTexto(entrada.orgao.split("/")[0] === "CNE" ? entrada.orgao : (entrada.orgao.split("/")[0] ?? ""))
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/**
 * ID provisório no formato da fase 2: `br/lei/1996/9394`, `br/cne-cp/res/2026/2`,
 * `ifpr/consup/res/2024/190`, `ifpr/proens/portaria/2024/121`. A compilação de trechos usa o ID do ato.
 */
export function idNorma(entrada: EntradaManifesto): string {
  const jurisdicao = entrada.jurisdicao.toLowerCase();
  const orgao = segmentoOrgao(entrada);
  const numero = String(entrada.numero);
  if (orgao === "lei") return `${jurisdicao}/lei/${entrada.ano}/${numero}`;
  const tipo = SIGLA_TIPO[entrada.tipo_documento] ?? normalizarTexto(entrada.tipo_documento).replace(/\s+/gu, "-");
  return `${jurisdicao}/${orgao}/${tipo}/${entrada.ano}/${numero}`;
}

const N = String.raw`(?:(?:numero|n\.?\s?o?)\.?\s*)?`;
const DATA_POR_EXTENSO = String.raw`,?\s*de\s+\d{1,2}o?\s+de\s*[a-z]+\s+de\s+`;

function numeroComMilhar(numero: string): string {
  if (numero.length <= 3) return `0*${numero}`;
  return `${numero.slice(0, -3)}\\.?${numero.slice(-3)}`;
}

/** Padrões (regex sobre texto normalizado) que reconhecem a citação de uma norma. */
export function padroesNorma(entrada: EntradaManifesto): string[] {
  const numero = numeroComMilhar(String(entrada.numero));
  const ano = String(entrada.ano);
  const comAno = String.raw`(?:\s*/\s*|${DATA_POR_EXTENSO})${ano}(?!\d)`;
  const padroes: string[] = [];
  switch (segmentoOrgao(entrada)) {
    case "lei":
      padroes.push(String.raw`lei(?:\s+federal)?\W{0,3}${N}${numero}(?!\d)`);
      break;
    case "cne-cp":
    case "cne-ceb": {
      const sigla = segmentoOrgao(entrada).split("-")[1] ?? "";
      padroes.push(String.raw`cne\s*/\s*${sigla}\W{0,3}${N}${numero}${comAno}`);
      break;
    }
    case "consup":
      padroes.push(String.raw`(?:consup|ifpr)(?:\s*/\s*(?:ifpr|consup))?\W{0,3}${N}${numero}${comAno}`);
      break;
    case "proens":
      if (entrada.tipo_documento === "Nota Técnica") {
        padroes.push(
          String.raw`(?:nota\s+tecnica|\bnt)(?:\s+(?:proens|ifpr)(?:\s*/\s*(?:proens|ifpr))?)?\W{0,3}${N}${numero}${comAno}`,
        );
      } else {
        padroes.push(String.raw`(?:proens|portaria)(?:\s*/\s*(?:ifpr|proens))?\W{0,3}${N}${numero}${comAno}`);
      }
      break;
    default:
      padroes.push(
        String.raw`(?:${escaparRegex(normalizarTexto(entrada.orgao))}|portaria)\W{0,3}${N}${numero}${comAno}`,
      );
  }
  for (const alias of entrada.aliases ?? []) {
    const normalizado = normalizarTexto(alias);
    if (/\d/u.test(alias) || ALIASES_AMBIGUOS.has(normalizado)) continue;
    padroes.push(padraoPalavra(normalizado));
  }
  return padroes;
}

/** Itens de norma do manifesto, um por ato (a compilação de trechos se funde ao ato). */
export function itensNorma(manifesto: readonly EntradaManifesto[]): ItemNorma[] {
  const porId = new Map<string, ItemNorma>();
  for (const entrada of manifesto) {
    const id = idNorma(entrada);
    const existente = porId.get(id);
    const padroes = padroesNorma(entrada);
    if (existente) {
      porId.set(id, { ...existente, padroes: [...new Set([...existente.padroes, ...padroes])] });
      continue;
    }
    porId.set(id, { id, rotulo: entrada.title, path: `base-conhecimento/${entrada.path}`, padroes });
  }
  return [...porId.values()].sort((a, b) => compararTexto(a.id, b.id));
}

/* ---------------------------------------------------------------- detecção */

function casaAlgum(padroes: readonly string[], texto: string): boolean {
  return padroes.some((fonte) => compilarPadrao(fonte).test(texto));
}

function contemPalavra(texto: string, termo: string): boolean {
  return compilarPadrao(padraoPalavra(termo)).test(texto);
}

export function detectarCampi(resposta: string, campi: readonly ItemCampus[]): Set<string> {
  const texto = normalizarTexto(resposta);
  return new Set(campi.filter((campus) => casaAlgum(campus.padroes, texto)).map((campus) => campus.id));
}

export function detectarNormas(resposta: string, normas: readonly ItemNorma[]): Set<string> {
  const texto = normalizarTexto(resposta);
  return new Set(normas.filter((norma) => casaAlgum(norma.padroes, texto)).map((norma) => norma.id));
}

/**
 * Cursos citados: pela chave literal (`curitiba/tecnico-em-enfermagem`, comum em caminhos de PPC)
 * ou por linha que traga o campus e o núcleo do nome. Uma linha sem campus herda o último campus
 * citado (listas aninhadas sob um campus); um título Markdown sem campus encerra essa herança.
 */
export function detectarCursos(
  resposta: string,
  cursos: readonly ItemCurso[],
  campi: readonly ItemCampus[],
): Set<string> {
  const encontrados = new Set<string>();
  const bruto = resposta.toLowerCase();
  for (const curso of cursos) {
    if (bruto.includes(curso.id.slice("curso:".length))) encontrados.add(curso.id);
  }
  const cursosPorCampus = new Map<string, ItemCurso[]>();
  for (const curso of cursos) {
    const lista = cursosPorCampus.get(curso.campus) ?? [];
    lista.push(curso);
    cursosPorCampus.set(curso.campus, lista);
  }
  let contexto: string[] = [];
  for (const linha of linhasNormalizadas(resposta)) {
    const citados = campi.filter((campus) => casaAlgum(campus.padroes, linha)).map((campus) => campus.id);
    if (citados.length > 0) contexto = citados;
    else if (linha.startsWith("#") || /^-{3,}$/u.test(linha)) contexto = [];
    for (const campus of contexto) {
      for (const curso of escolherCursosDaLinha(linha, cursosPorCampus.get(campus) ?? [])) encontrados.add(curso.id);
    }
  }
  return encontrados;
}

function escolherCursosDaLinha(linha: string, candidatos: readonly ItemCurso[]): ItemCurso[] {
  const casados = candidatos.filter((curso) => contemPalavra(linha, curso.nucleo));
  // "informatica" não conta quando "informatica para internet" também casou na mesma linha.
  const especificos = casados.filter(
    (curso) => !casados.some((outro) => outro.nucleo !== curso.nucleo && outro.nucleo.includes(curso.nucleo)),
  );
  const porNucleo = new Map<string, ItemCurso[]>();
  for (const curso of especificos) porNucleo.set(curso.nucleo, [...(porNucleo.get(curso.nucleo) ?? []), curso]);
  const escolhidos: ItemCurso[] = [];
  for (const grupo of porNucleo.values()) {
    if (grupo.length === 1) {
      escolhidos.push(...grupo);
      continue;
    }
    const pontos = grupo.map((curso) => curso.forma.filter((termo) => contemPalavra(linha, termo)).length);
    const maximo = Math.max(...pontos);
    escolhidos.push(...grupo.filter((_, indice) => pontos[indice] === maximo));
  }
  return escolhidos;
}

export function detectarItens(resposta: string, universo: NomeUniverso, universos: Universos): Set<string> {
  switch (universo) {
    case "campus":
      return detectarCampi(resposta, universos.campus);
    case "curso":
      return detectarCursos(resposta, universos.curso, universos.campus);
    case "norma":
      return detectarNormas(resposta, universos.norma);
  }
}
