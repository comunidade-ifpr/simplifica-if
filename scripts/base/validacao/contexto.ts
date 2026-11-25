// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base), lê os JSONs com node:fs
/** Contexto e utilitários comuns aos módulos de validação da base. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type CaminhosBase, relativo } from "../caminhos.ts";
import { analisarFrontMatter, ehErroFrontMatter, type FrontMatter } from "../front-matter.ts";
import { representar } from "@simplifica-if/kb/json";
import { lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";
import { carregarDadosInstitucionais } from "../../dados/institucional.ts";

/** Resultado de uma leitura que pode falhar com mensagens de erro. */
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: string[] };

/** Conteúdo e front matter analisado de uma norma, cacheados por caminho no `Contexto`. */
export type NormaLida =
  | { ok: true; texto: string; meta: FrontMatter; corpo: string }
  | { ok: false; texto: string; erro: string };

/** Retorno de `carregarDadosInstitucionais`, cacheado no `Contexto` para evitar releitura. */
export type CarregamentoInstitucional = ReturnType<typeof carregarDadosInstitucionais>;

// oxlint-disable-next-line eslint/no-useless-concat -- partidos de propósito: a validação procura estes textos na base e não pode achá-los neste arquivo
export const PADROES_LOCAIS = ["/" + "Users/", "Down" + "loads/", "file" + "://"];

export function mesmosElementos<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/** Conjunto de textos em ordem de code point, na notação das mensagens (`['a', 'b']`). */
export function listaOrdenada(textos: Iterable<string>): string {
  return representar(ordenarTextos(textos));
}

/** Caminhos da base com as operações de leitura usadas por todas as validações. */
export class Contexto {
  readonly c: CaminhosBase;
  private _dadosInstitucionais: CarregamentoInstitucional | undefined;
  private readonly _textosNormas = new Map<string, string>();
  private readonly _normas = new Map<string, NormaLida>();

  constructor(c: CaminhosBase) {
    this.c = c;
  }

  /** Caminho relativo a `base-conhecimento/`, usado nas mensagens. */
  rel(caminho: string): string {
    return relativo(this.c, caminho);
  }

  /** Dados institucionais de `institucional/ifpr/`, carregados uma única vez por execução. */
  dadosInstitucionais(): CarregamentoInstitucional {
    this._dadosInstitucionais ??= carregarDadosInstitucionais(NodePath.join(this.c.institucional, "ifpr"));
    return this._dadosInstitucionais;
  }

  /** Registra o texto já lido de uma norma (ex.: na varredura de padrões locais) para evitar releitura. */
  registrarTextoNorma(caminho: string, texto: string): void {
    this._textosNormas.set(caminho, texto);
  }

  /** Lê e analisa o front matter de uma norma uma única vez por execução. */
  lerNorma(caminho: string): NormaLida {
    const cacheado = this._normas.get(caminho);
    if (cacheado !== undefined) return cacheado;
    const texto = this._textosNormas.get(caminho) ?? lerTexto(caminho);
    let resultado: NormaLida;
    try {
      const { meta, corpo } = analisarFrontMatter(texto, this.rel(caminho));
      resultado = { ok: true, texto, meta, corpo };
    } catch (erro) {
      if (ehErroFrontMatter(erro)) {
        resultado = { ok: false, texto, erro: erro.message };
      } else {
        throw erro;
      }
    }
    this._normas.set(caminho, resultado);
    return resultado;
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
      if (limpo && !NodeFS.existsSync(NodePath.resolve(NodePath.dirname(caminho), limpo))) {
        erros.push(`${this.rel(caminho)}: link interno inexistente: ${alvo}`);
      }
    }
    return erros;
  }
}
