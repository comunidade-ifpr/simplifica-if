// @effect-diagnostics nodeBuiltinImport:off -- caminhos e listagens síncronas de base-conhecimento/ para o lado de leitura do pipeline da base (carregadores e validações), chamado de dentro dos programas Effect
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { RAIZ_PROJETO } from "../config.ts";
import { compararTexto } from "@simplifica-if/kb/texto";

/**
 * Caminhos da base pública. Os `path` dos manifestos continuam relativos a
 * `base-conhecimento/` para preservar URLs como normas/... e institucional/...
 */
export function criarCaminhos(raizProjeto: string = RAIZ_PROJETO) {
  const raiz = NodePath.join(raizProjeto, "base-conhecimento");
  const institucional = NodePath.join(raiz, "institucional");
  const ppcs = NodePath.join(institucional, "ifpr", "ppcs");
  const ppcps = NodePath.join(institucional, "ifpr", "ppcps");
  const catalogos = NodePath.join(raiz, "catalogos");
  const schemas = NodePath.join(raiz, "schemas");
  const schema = (nome: string) => NodePath.join(schemas, `${nome}.schema.json`);
  return {
    raizProjeto,
    raiz,
    normas: NodePath.join(raiz, "normas"),
    institucional,
    ppcs,
    indicePpcs: NodePath.join(ppcs, "index.json"),
    secoesPpcs: NodePath.join(ppcs, "secoes"),
    ppcps,
    indicePpcps: NodePath.join(ppcps, "index.json"),
    catalogos,
    manifestInstitucional: NodePath.join(raiz, "institucional_manifest.json"),
    manifestCatalogos: NodePath.join(raiz, "catalogos_manifest.json"),
    manifestCnct: NodePath.join(catalogos, "cnct", "manifest.json"),
    indiceCnct: NodePath.join(catalogos, "cnct", "index.json"),
    cursosCnct: NodePath.join(catalogos, "cnct", "cursos"),
    schemas: {
      manifestInstitucional: schema("institucional_manifest"),
      manifestCatalogos: schema("catalogos_manifest"),
      manifestCnct: schema("cnct_manifest"),
      indiceCnct: schema("cnct_index"),
      cursoCnct: schema("cnct_curso"),
      indicePpcs: schema("ppcs_index"),
      secaoPpc: schema("ppcs_secao"),
      indicePpcps: schema("ppcps_index"),
    },
    manifest: NodePath.join(raiz, "manifest.json"),
    readme: NodePath.join(raiz, "README.md"),
  };
}

export type CaminhosBase = ReturnType<typeof criarCaminhos>;

/**
 * Normalização léxica: remove barras repetidas e segmentos `.`,
 * mas preserva `..` (ao contrário de `path.normalize`/`path.resolve`).
 */
function partesLexicas(caminho: string): string[] {
  return caminho.split(NodePath.sep).filter((parte, i) => (i === 0 || parte !== "") && parte !== ".");
}

/**
 * Caminho relativo a `base-conhecimento/`, por comparação léxica de
 * componentes. Assim `naBase("../README.md")` vira `../README.md`; um caminho
 * fora da raiz (ex.: absoluto) lança erro.
 */
export function relativo(caminhos: CaminhosBase, caminho: string): string {
  const partes = partesLexicas(caminho);
  const raiz = partesLexicas(caminhos.raiz);
  if (partes.length < raiz.length || raiz.some((parte, i) => parte !== partes[i])) {
    throw new Error(`'${caminho}' is not in the subpath of '${caminhos.raiz}'`);
  }
  return partes.slice(raiz.length).join(NodePath.sep) || ".";
}

/**
 * Junta `valor` à raiz da base: caminho absoluto em `valor` substitui a raiz e
 * `..` é preservado (sem normalização), para que mensagens e `relativo()`
 * mostrem o `path` como está, mesmo malformado nos índices.
 */
export function naBase(caminhos: CaminhosBase, valor: string): string {
  const base = NodePath.isAbsolute(valor) ? valor : `${caminhos.raiz}${NodePath.sep}${valor}`;
  return partesLexicas(base).join(NodePath.sep) || NodePath.sep;
}

export function ehDiretorio(caminho: string): boolean {
  try {
    return NodeFS.statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

export function ehArquivo(caminho: string): boolean {
  try {
    return NodeFS.statSync(caminho).isFile();
  } catch {
    return false;
  }
}

/**
 * Entradas de `diretorio` (arquivos, subdiretórios e ocultos) cujo nome termina
 * em `sufixo`, ordenadas por code point. Diretório inexistente dá lista vazia.
 */
export function listarDiretorio(diretorio: string, sufixo = ""): string[] {
  if (!ehDiretorio(diretorio)) return [];
  return NodeFS.readdirSync(diretorio)
    .filter((nome) => nome.endsWith(sufixo))
    .sort(compararTexto)
    .map((nome) => NodePath.join(diretorio, nome));
}

/**
 * Todas as entradas sob `diretorio` cujo nome termina em `sufixo`, em pré-ordem
 * com irmãos ordenados por code point (a ordem de `ordenarCaminhos`). Não entra
 * em links simbólicos para diretórios.
 */
export function listarRecursivo(diretorio: string, sufixo = ""): string[] {
  const resultado: string[] = [];
  const visitar = (atual: string) => {
    const entradas = NodeFS.readdirSync(atual, { withFileTypes: true }).sort((a, b) => compararTexto(a.name, b.name));
    for (const entrada of entradas) {
      const caminho = NodePath.join(atual, entrada.name);
      if (entrada.name.endsWith(sufixo)) resultado.push(caminho);
      if (entrada.isDirectory()) visitar(caminho);
    }
  };
  if (ehDiretorio(diretorio)) visitar(diretorio);
  return resultado;
}
