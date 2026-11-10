/** Validação das normas (Markdown com front matter), do manifest.json e do README.md. */
import { existsSync } from "node:fs";
import path from "node:path";
import { ehArquivo, listarDiretorio, listarRecursivo, naBase } from "../caminhos.ts";
import {
  analisarFrontMatter,
  CAMPOS_MANIFEST,
  CAMPOS_OBRIGATORIOS,
  DIRETORIOS_POR_TIPO,
  ErroFrontMatter,
  type FrontMatter,
} from "../front-matter.ts";
import { ehObjeto, type ObjetoJson, representar, textoDe, valoresIguais } from "../json.ts";
import { apararInicio, ErroDecodificacao, lerTexto, ordenarTextos } from "../texto.ts";
import { type Contexto, listaOrdenada, mesmosElementos, PADROES_LOCAIS, type Resultado } from "./contexto.ts";

const DIRETORIOS_IGNORADOS_PADROES_LOCAIS = new Set([".git", ".venv", "skills"]);
const RE_DATA_NO_INICIO = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}_/u;
const RE_ALIAS_COM_ANO = /[_-]\p{Nd}{4}[^\n]*\.md(?=\n?$)/u;

function aliasPareceNomeAntigo(alias: unknown): boolean {
  if (typeof alias !== "string" || !alias.endsWith(".md")) return false;
  return RE_DATA_NO_INICIO.test(alias) || RE_ALIAS_COM_ANO.test(alias);
}

/** `ano` é comparado como texto: o front matter tem número e o manifest pode ter texto. */
function comparavel(campo: string, valor: unknown): unknown {
  if (campo === "ano" && valor !== null && valor !== undefined) return textoDe(valor);
  return valor;
}

/** Nenhum arquivo de texto da base pode conter caminhos locais. */
export function validarPadroesLocais(ctx: Contexto): string[] {
  const erros: string[] = [];
  for (const caminho of listarRecursivo(ctx.c.raiz)) {
    const partes = ctx.rel(caminho).split(path.sep);
    if (partes.some((parte) => DIRETORIOS_IGNORADOS_PADROES_LOCAIS.has(parte)) || !ehArquivo(caminho)) continue;
    let texto: string;
    try {
      texto = lerTexto(caminho);
    } catch (erro) {
      if (erro instanceof ErroDecodificacao) continue;
      throw erro;
    }
    for (const padrao of PADROES_LOCAIS) {
      if (texto.includes(padrao)) erros.push(`${ctx.rel(caminho)} contém padrão local proibido: ${padrao}`);
    }
  }
  return erros;
}

export function carregarManifest(ctx: Contexto): Resultado<unknown[]> {
  let dados: unknown;
  try {
    dados = JSON.parse(lerTexto(ctx.c.manifest));
  } catch (erro) {
    return { ok: false, erros: [`manifest.json inválido: ${(erro as Error).message}`] };
  }
  if (!Array.isArray(dados)) return { ok: false, erros: ["manifest.json deve conter uma lista"] };
  return { ok: true, valor: dados };
}

/** Normas fora de normas/ e cobertura do manifest.json sobre os Markdown publicados. */
export function validarCoberturaManifest(ctx: Contexto, manifest: unknown[]): string[] {
  const erros: string[] = [];
  const markdownsNaRaiz = listarDiretorio(ctx.c.raiz, ".md")
    .map((caminho) => path.basename(caminho))
    .filter((nome) => nome !== "AGENTS.md" && nome !== "README.md");
  if (markdownsNaRaiz.length) {
    erros.push(`normas não devem ficar na raiz do repositório: ${listaOrdenada(markdownsNaRaiz)}`);
  }

  const pathsManifest = new Set<unknown>(manifest.filter(ehObjeto).map((item) => item.path ?? null));
  const markdowns = listarRecursivo(ctx.c.normas, ".md").map((caminho) => ctx.rel(caminho));
  if (!mesmosElementos(pathsManifest, new Set<unknown>(markdowns))) {
    erros.push(
      `manifest.json não cobre exatamente as normas publicadas: manifest=${listaOrdenada([...pathsManifest].map(textoDe))} markdown=${listaOrdenada(markdowns)}`,
    );
  }
  return erros;
}

export function validarReadme(ctx: Contexto): string[] {
  const erros: string[] = [];
  const texto = lerTexto(ctx.c.readme);
  for (const padrao of PADROES_LOCAIS) {
    if (texto.includes(padrao)) erros.push(`README.md contém padrão local proibido: ${padrao}`);
  }
  erros.push(...ctx.validarLinks(ctx.c.readme, texto));
  return erros;
}

export function validarMarkdown(ctx: Contexto, caminho: string): string[] {
  const r = ctx.rel(caminho);
  const erros: string[] = [];
  const texto = lerTexto(caminho);
  for (const padrao of PADROES_LOCAIS) {
    if (texto.includes(padrao)) erros.push(`${r}: contém padrão local proibido: ${padrao}`);
  }

  let meta: FrontMatter;
  let corpo: string;
  try {
    ({ meta, corpo } = analisarFrontMatter(texto, r));
  } catch (erro) {
    if (erro instanceof ErroFrontMatter) return [erro.message];
    throw erro;
  }

  const ausentes = ordenarTextos(CAMPOS_OBRIGATORIOS.filter((campo) => !(campo in meta)));
  if (ausentes.length) erros.push(`${r}: campos obrigatórios ausentes: ${ausentes.join(", ")}`);
  if (!apararInicio(corpo).startsWith("## Resumo")) erros.push(`${r}: corpo não começa com ## Resumo`);
  const keywords = meta.keywords;
  if (!Array.isArray(keywords) || !keywords.length) erros.push(`${r}: keywords deve ser lista não vazia`);
  const aliases = "aliases" in meta ? meta.aliases : [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (aliasPareceNomeAntigo(alias)) erros.push(`${r}: alias parece nome antigo de arquivo: ${textoDe(alias)}`);
  }

  erros.push(...ctx.validarLinks(caminho, texto));
  return erros;
}

/** Item do manifest.json: campos obrigatórios, local do arquivo e coerência com o front matter. */
export function validarItemManifest(ctx: Contexto, item: ObjetoJson): string[] {
  const erros: string[] = [];
  for (const campo of [...CAMPOS_MANIFEST, "path"]) {
    if (!Object.hasOwn(item, campo)) erros.push(`manifest.json: item sem campo ${campo}: ${representar(item)}`);
  }

  const valorPath = item.path;
  if (typeof valorPath !== "string") return [...erros, "manifest.json: item sem path textual"];

  const caminho = naBase(ctx.c, valorPath);
  if (!existsSync(caminho)) return [...erros, `manifest.json aponta para arquivo inexistente: ${valorPath}`];

  if (RE_DATA_NO_INICIO.test(path.basename(caminho))) {
    erros.push(`${valorPath}: nome do arquivo não deve começar com data`);
  }

  const jurisdicao = textoDe(item.jurisdicao);
  const tipo = textoDe(item.tipo_documento);
  const diretorioEsperado = DIRETORIOS_POR_TIPO[`${jurisdicao}|${tipo}`];
  if (diretorioEsperado === undefined) {
    erros.push(
      `manifest.json: item com jurisdição/tipo sem diretório configurado: (${representar(jurisdicao)}, ${representar(tipo)})`,
    );
  } else if (ctx.rel(path.dirname(caminho)) !== diretorioEsperado) {
    erros.push(`${valorPath}: deveria estar em ${diretorioEsperado}`);
  }

  let meta: FrontMatter;
  try {
    ({ meta } = analisarFrontMatter(lerTexto(caminho), ctx.rel(caminho)));
  } catch (erro) {
    if (!(erro instanceof ErroFrontMatter)) throw erro;
    erros.push(erro.message);
    return erros;
  }

  for (const campo of CAMPOS_MANIFEST) {
    const valorMeta = campo in meta ? meta[campo] : null;
    if (!valoresIguais(comparavel(campo, item[campo]), comparavel(campo, valorMeta))) {
      erros.push(`${valorPath}: manifest.json diverge do front matter no campo ${campo}`);
    }
  }
  return erros;
}
