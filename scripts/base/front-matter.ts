/** Front matter das normas e geração de `manifest.json`. */
import { type CaminhosBase, listarRecursivo, relativo } from "./caminhos.ts";
import { jsonIndentado, textoDe } from "./json.ts";
import { aparar, compararTexto, dividirLinhas, lerTexto, ordenarCaminhos } from "./texto.ts";

export const CAMPOS_OBRIGATORIOS = [
  "title",
  "tipo_documento",
  "numero",
  "ano",
  "data_publicacao",
  "ementa",
  "status_vigencia",
  "keywords",
] as const;

export const CAMPOS_MANIFEST = [
  "title",
  "tipo_documento",
  "numero",
  "ano",
  "data_publicacao",
  "orgao",
  "jurisdicao",
  "ementa",
  "status_vigencia",
  "keywords",
  "aliases",
  "fonte",
] as const;

/** Diretório esperado por `jurisdicao|tipo_documento`. */
export const DIRETORIOS_POR_TIPO: Record<string, string> = {
  "BR|Lei": "normas/br/leis",
  "BR|Portaria": "normas/br/portarias",
  "BR|Resolução": "normas/br/resolucoes",
  "BR|Compilação": "normas/br/compilacoes",
  "IFPR|Resolução": "normas/ifpr/resolucoes",
  "IFPR|Portaria": "normas/ifpr/portarias",
  "IFPR|Nota Técnica": "normas/ifpr/notas-tecnicas",
};

export type ValorFrontMatter = string | number | ValorFrontMatter[];
export type FrontMatter = Record<string, ValorFrontMatter>;
export type ItemManifest = Record<string, ValorFrontMatter>;

/** Erro de front matter (equivale ao `ValueError` capturado pelo validador). */
export class ErroFrontMatter extends Error {}

/** Interpreta um valor escalar do subconjunto de YAML usado nas normas. */
export function valorYaml(bruto: string, chave?: string): ValorFrontMatter {
  const valor = aparar(bruto);
  if (!valor) return "";
  if (valor.startsWith('"') && valor.endsWith('"')) {
    try {
      return JSON.parse(valor) as ValorFrontMatter;
    } catch (erro) {
      throw new ErroFrontMatter(`valor JSON inválido no front matter: ${valor} (${(erro as Error).message})`);
    }
  }
  if (valor.startsWith("[") && valor.endsWith("]")) {
    return valor
      .slice(1, -1)
      .split(",")
      .map(aparar)
      .filter(Boolean)
      .map((item) => valorYaml(item));
  }
  if (chave === "ano" && /^\p{Nd}+$/u.test(valor)) return inteiroDecimal(valor);
  return valor;
}

const RE_DIGITO = /\p{Nd}/u;

/**
 * `int(valor)` para dígitos decimais Unicode (ex.: `２０１２`), como no Python.
 * Os dígitos `Nd` vêm em blocos contíguos de 0 a 9, então o valor de cada um é
 * a posição dentro do seu bloco.
 */
function inteiroDecimal(valor: string): number {
  let total = 0;
  for (const caractere of valor) {
    let codigo = caractere.codePointAt(0)!;
    let posicao = 0;
    while (RE_DIGITO.test(String.fromCodePoint(codigo - 1))) {
      codigo -= 1;
      posicao += 1;
    }
    total = total * 10 + (posicao % 10);
  }
  return total;
}

function valorComRotulo(valor: string, rotulo: string, chave?: string): ValorFrontMatter {
  try {
    return valorYaml(valor, chave);
  } catch (erro) {
    if (erro instanceof ErroFrontMatter) throw new ErroFrontMatter(`${rotulo}: ${erro.message}`);
    throw erro;
  }
}

/** Separa front matter e corpo de um texto Markdown. `rotulo` prefixa as mensagens de erro. */
export function analisarFrontMatter(texto: string, rotulo: string): { meta: FrontMatter; corpo: string } {
  if (!texto.startsWith("---\n")) throw new ErroFrontMatter(`${rotulo}: arquivo sem front matter`);
  const fim = texto.indexOf("\n---", 4);
  if (fim === -1) throw new ErroFrontMatter(`${rotulo}: front matter sem fechamento`);

  const meta: FrontMatter = Object.create(null);
  let atual: string | null = null;
  for (const linha of dividirLinhas(aparar(texto.slice(4, fim)))) {
    if (!aparar(linha)) continue;
    if (linha.startsWith("  - ")) {
      if (atual === null) throw new ErroFrontMatter(`${rotulo}: item de lista sem campo`);
      if (!(atual in meta)) meta[atual] = [];
      const lista = meta[atual];
      if (!Array.isArray(lista)) throw new ErroFrontMatter(`${rotulo}: campo ${atual} mistura escalar e lista`);
      lista.push(valorComRotulo(linha.slice(4), rotulo));
      continue;
    }
    const separador = linha.indexOf(":");
    if (separador === -1) throw new ErroFrontMatter(`${rotulo}: linha inválida no front matter: ${linha}`);
    atual = aparar(linha.slice(0, separador));
    const valor = linha.slice(separador + 1);
    meta[atual] = aparar(valor) ? valorComRotulo(valor, rotulo, atual) : [];
  }

  const inicioCorpo = texto.indexOf("\n", fim + 4);
  return { meta, corpo: inicioCorpo !== -1 ? texto.slice(inicioCorpo + 1) : "" };
}

export function lerFrontMatter(caminhos: CaminhosBase, caminho: string) {
  return analisarFrontMatter(lerTexto(caminho), relativo(caminhos, caminho));
}

export function itemManifest(caminhos: CaminhosBase, caminho: string): ItemManifest {
  const { meta } = lerFrontMatter(caminhos, caminho);
  const ausentes = CAMPOS_MANIFEST.filter((campo) => !(campo in meta));
  if (ausentes.length) {
    throw new ErroFrontMatter(
      `${relativo(caminhos, caminho)}: campos ausentes para manifest.json: ${ausentes.join(", ")}`,
    );
  }
  const item: ItemManifest = {};
  for (const campo of CAMPOS_MANIFEST) item[campo] = meta[campo]!;
  item.path = relativo(caminhos, caminho);
  return item;
}

export function arquivosNormas(caminhos: CaminhosBase): string[] {
  return ordenarCaminhos(listarRecursivo(caminhos.normas, ".md"));
}

export function montarManifest(caminhos: CaminhosBase): ItemManifest[] {
  const manifest = arquivosNormas(caminhos).map((caminho) => itemManifest(caminhos, caminho));
  return manifest.sort(
    (a, b) =>
      compararTexto(textoDe(a.data_publicacao), textoDe(b.data_publicacao)) ||
      compararTexto(textoDe(a.title), textoDe(b.title)),
  );
}

export function manifestJson(manifest: ItemManifest[]): string {
  return jsonIndentado(manifest);
}
