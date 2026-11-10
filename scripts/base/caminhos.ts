import path from "node:path";
import { RAIZ_PROJETO } from "../config.ts";

/**
 * Caminhos da base pública. Os `path` dos manifestos continuam relativos a
 * `base-conhecimento/` para preservar URLs como normas/... e institucional/...
 */
export function criarCaminhos(raizProjeto: string = RAIZ_PROJETO) {
  const raiz = path.join(raizProjeto, "base-conhecimento");
  const institucional = path.join(raiz, "institucional");
  const ppcs = path.join(institucional, "ifpr", "ppcs");
  const ppcps = path.join(institucional, "ifpr", "ppcps");
  const catalogos = path.join(raiz, "catalogos");
  const processos = path.join(institucional, "ifpr", "processos-seletivos");
  const schemas = path.join(raiz, "schemas");
  const schema = (nome: string) => path.join(schemas, `${nome}.schema.json`);
  return {
    raizProjeto,
    raiz,
    site: path.join(raizProjeto, "site"),
    normas: path.join(raiz, "normas"),
    institucional,
    campi: path.join(institucional, "ifpr", "campi"),
    ppcs,
    indicePpcs: path.join(ppcs, "index.json"),
    secoesPpcs: path.join(ppcs, "secoes"),
    ppcps,
    indicePpcps: path.join(ppcps, "index.json"),
    catalogos,
    manifestInstitucional: path.join(raiz, "institucional_manifest.json"),
    manifestCatalogos: path.join(raiz, "catalogos_manifest.json"),
    indiceCampi: path.join(institucional, "ifpr", "campi", "index.json"),
    processosSeletivos: processos,
    indiceProcessosSeletivos: path.join(processos, "index.json"),
    manifestCnct: path.join(catalogos, "cnct", "manifest.json"),
    indiceCnct: path.join(catalogos, "cnct", "index.json"),
    cursosCnct: path.join(catalogos, "cnct", "cursos"),
    schemas: {
      manifestInstitucional: schema("institucional_manifest"),
      manifestCatalogos: schema("catalogos_manifest"),
      indiceCampi: schema("campi_index"),
      campus: schema("campus"),
      indiceProcessosSeletivos: schema("processos_seletivos_index"),
      processoSeletivo: schema("processo_seletivo"),
      manifestCnct: schema("cnct_manifest"),
      indiceCnct: schema("cnct_index"),
      cursoCnct: schema("cnct_curso"),
      indicePpcs: schema("ppcs_index"),
      indicePpcps: schema("ppcps_index"),
    },
    manifest: path.join(raiz, "manifest.json"),
    readme: path.join(raiz, "README.md"),
  };
}

export type CaminhosBase = ReturnType<typeof criarCaminhos>;

/**
 * Normalização léxica do pathlib: remove barras repetidas e segmentos `.`,
 * mas preserva `..` (ao contrário de `path.normalize`/`path.resolve`).
 */
function partesLexicas(caminho: string): string[] {
  return caminho.split(path.sep).filter((parte, i) => (i === 0 || parte !== "") && parte !== ".");
}

/**
 * Caminho relativo a `base-conhecimento/` (equivalente a `relative()` do Python,
 * que usa `Path.relative_to`: comparação léxica por componentes). Assim
 * `naBase("../README.md")` vira `../README.md`, como no Python; um caminho fora
 * da raiz (ex.: absoluto) lança erro, como o `ValueError` do pathlib.
 */
export function relativo(caminhos: CaminhosBase, caminho: string): string {
  const partes = partesLexicas(caminho);
  const raiz = partesLexicas(caminhos.raiz);
  if (partes.length < raiz.length || raiz.some((parte, i) => parte !== partes[i])) {
    throw new Error(`'${caminho}' is not in the subpath of '${caminhos.raiz}'`);
  }
  return partes.slice(raiz.length).join(path.sep) || ".";
}

/**
 * `ROOT / valor` do pathlib: caminho absoluto em `valor` substitui a raiz e
 * `..` é preservado (sem normalização), para que mensagens e `relativo()`
 * reproduzam o Python mesmo com `path` malformado nos índices.
 */
export function naBase(caminhos: CaminhosBase, valor: string): string {
  const base = path.isAbsolute(valor) ? valor : `${caminhos.raiz}${path.sep}${valor}`;
  return partesLexicas(base).join(path.sep) || path.sep;
}
