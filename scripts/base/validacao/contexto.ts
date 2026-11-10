/** Contexto e utilitários comuns aos módulos de validação da base. */
import { existsSync } from "node:fs";
import path from "node:path";
import { type CaminhosBase, listarDiretorio, relativo } from "../caminhos.ts";
import { ehObjeto, type ObjetoJson, representar } from "../json.ts";
import { ehUrlAbsoluta, validarJsonSchema } from "../schema.ts";
import { lerTexto, ordenarTextos } from "../texto.ts";
import type {
  CampusJson,
  CursoCnctJson,
  IndiceCampiJson,
  IndiceCnctJson,
  IndicePpcpsJson,
  IndicePpcsJson,
  IndiceProcessosSeletivosJson,
  ManifestCatalogosJson,
  ManifestCnctJson,
  ManifestInstitucionalJson,
  ProcessoSeletivoJson,
} from "../tipos-schemas.ts";

/** Resultado de uma leitura que pode falhar com mensagens de erro. */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: string[] };

/** Formato de cada schema de `CaminhosBase["schemas"]`, gerado do próprio schema. */
export type FormatosSchemas = {
  manifestInstitucional: ManifestInstitucionalJson;
  manifestCatalogos: ManifestCatalogosJson;
  indiceCampi: IndiceCampiJson;
  campus: CampusJson;
  indiceProcessosSeletivos: IndiceProcessosSeletivosJson;
  processoSeletivo: ProcessoSeletivoJson;
  manifestCnct: ManifestCnctJson;
  indiceCnct: IndiceCnctJson;
  cursoCnct: CursoCnctJson;
  indicePpcs: IndicePpcsJson;
  indicePpcps: IndicePpcpsJson;
};
export type NomeSchema = keyof CaminhosBase["schemas"] & keyof FormatosSchemas;

/**
 * Objeto JSON lido que deve seguir o formato `T`, mas ainda pode estar fora
 * do schema: só os nomes dos campos são conferidos pelo compilador. As regras
 * da base rodam também sobre arquivos que falham no schema, para relatar
 * todos os problemas de uma vez, e por isso conferem os valores que usam.
 */
export type Recebido<T> = { readonly [K in keyof T]?: unknown };

/** `ehObjeto` para um objeto que deve seguir o formato `T` (ver `Recebido`). */
export function ehRecebido<T>(valor: unknown): valor is Recebido<T> {
  return ehObjeto(valor);
}

/** Mensagens da conferência com o schema e, se não houver nenhuma, os dados no formato do schema. */
export type Conferencia<T> = { erros: string[]; validos: T | null };

export const PADROES_LOCAIS = ["/" + "Users/", "Down" + "loads/", "file" + "://"];
export const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function mesmosElementos<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/** Conjunto de textos em ordem de code point, na notação das mensagens (`['a', 'b']`). */
export function listaOrdenada(textos: Iterable<string>): string {
  return representar(ordenarTextos(textos));
}

/** Caminhos da base com as operações de leitura usadas por todas as validações. */
export class Contexto {
  constructor(readonly c: CaminhosBase) {}

  /** Caminho relativo a `base-conhecimento/`, usado nas mensagens. */
  rel(caminho: string): string {
    return relativo(this.c, caminho);
  }

  carregarJson(caminho: string, rotulo: string): Resultado<unknown> {
    let texto: string;
    try {
      texto = lerTexto(caminho);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, erros: [`${rotulo} não encontrado: ${this.rel(caminho)}`] };
      }
      return { ok: false, erros: [`${rotulo} inválido: ${(erro as Error).message}`] };
    }
    try {
      return { ok: true, valor: JSON.parse(texto) };
    } catch (erro) {
      return { ok: false, erros: [`${rotulo} inválido: ${(erro as Error).message}`] };
    }
  }

  /** Confere `dados` com o schema `nome`; os dados só saem tipados quando o schema os aceita. */
  conferirSchema<N extends NomeSchema>(dados: unknown, nome: N, rotulo: string): Conferencia<FormatosSchemas[N]> {
    const caminhoSchema = this.c.schemas[nome];
    const rSchema = this.rel(caminhoSchema);
    const schema = this.carregarJson(caminhoSchema, `schema ${rSchema}`);
    if (!schema.ok) return { erros: schema.erros, validos: null };
    if (!ehObjeto(schema.valor)) return { erros: [`schema ${rSchema} deve conter um objeto JSON`], validos: null };
    const erros = validarJsonSchema(dados, schema.valor, rotulo);
    return { erros, validos: erros.length ? null : (dados as FormatosSchemas[N]) };
  }

  /** Links Markdown relativos devem apontar para arquivos existentes. */
  validarLinks(caminho: string, texto: string): string[] {
    const erros: string[] = [];
    for (const casamento of texto.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const alvo = casamento[1]!;
      if (["http://", "https://", "#", "mailto:"].some((prefixo) => alvo.startsWith(prefixo))) continue;
      if (alvo.startsWith("/")) {
        erros.push(`${this.rel(caminho)}: link absoluto local ou de raiz: ${alvo}`);
        continue;
      }
      const limpo = alvo.split("#", 1)[0]!;
      if (limpo && !existsSync(path.resolve(path.dirname(caminho), limpo))) {
        erros.push(`${this.rel(caminho)}: link interno inexistente: ${alvo}`);
      }
    }
    return erros;
  }

  validarUrlHttps(valor: unknown, campo: string): string[] {
    if (typeof valor !== "string" || !valor) return [`${campo} deve ser URL textual não vazia`];
    if (!ehUrlAbsoluta(valor, "https")) return [`${campo} deve ser URL HTTPS absoluta válida`];
    return [];
  }

  /**
   * Item `id` da lista `chaveLista` de um manifesto: `undefined` se o manifesto
   * não tem a lista, `null` se a lista não tem o item.
   */
  colecao(manifest: unknown, chaveLista: string, id: string): ObjetoJson | null | undefined {
    if (!ehObjeto(manifest)) return undefined;
    const lista = manifest[chaveLista];
    if (!Array.isArray(lista)) return undefined;
    return lista.find((item): item is ObjetoJson => ehObjeto(item) && item.id === id) ?? null;
  }

  arquivosCampi(): string[] {
    return listarDiretorio(this.c.campi, ".json").filter((caminho) => path.basename(caminho) !== "index.json");
  }
}
