/** Contexto e utilitários comuns aos módulos de validação da base. */
import { existsSync } from "node:fs";
import path from "node:path";
import { type CaminhosBase, listarDiretorio, relativo } from "../caminhos.ts";
import { ehObjeto, type ObjetoJson, representar } from "../json.ts";
import { ehUrlAbsoluta, validarJsonSchema } from "../schema.ts";
import { lerTexto, ordenarTextos } from "../texto.ts";

/** Resultado de uma leitura que pode falhar com mensagens de erro. */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: string[] };

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

  validarComSchema(dados: unknown, caminhoSchema: string, rotulo: string): string[] {
    const rSchema = this.rel(caminhoSchema);
    const schema = this.carregarJson(caminhoSchema, `schema ${rSchema}`);
    if (!schema.ok) return schema.erros;
    if (!ehObjeto(schema.valor)) return [`schema ${rSchema} deve conter um objeto JSON`];
    return validarJsonSchema(dados, schema.valor, rotulo);
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
