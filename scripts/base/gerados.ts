/**
 * Arquivos gerados da base: o front matter derivado das normas (relações e vigência) e os índices de
 * PPCs. `arquivosGeradosDaBase` monta o texto esperado de cada arquivo (`ArquivoGerado`), e
 * `aplicarGerados` grava o que difere do disco (`gerar_base`) ou só confere (`validar_base`).
 *
 * As divergências são as mesmas nos dois modos: arquivo ausente, desatualizado ou que sobra numa
 * pasta inteiramente gerada (`extrasEm`). Gravando, o ausente e o desatualizado são escritos e o que
 * sobra é apagado; conferindo, nada muda no disco.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { compararTexto } from "@simplifica-if/kb/texto";
import type { CaminhosBase } from "./caminhos.ts";
import { arquivosIndices, gerarIndices } from "./indice-ppcs.ts";

export interface ArquivoGerado {
  /** Caminho absoluto. */
  readonly caminho: string;
  readonly texto: string;
}

/** Pasta cujos arquivos com `sufixo` são todos gerados: o que não estiver na lista sobra. */
export interface PastaGerada {
  readonly pasta: string;
  readonly sufixo: string;
}

export interface OpcoesGerados {
  readonly modo: "gravar" | "verificar";
  /** Raiz dos caminhos nas divergências (em geral, `base-conhecimento/`). */
  readonly raiz: string;
  readonly extrasEm?: ReadonlyArray<PastaGerada>;
}

export interface Divergencia {
  /** Caminho relativo à `raiz`, com `/`. */
  readonly arquivo: string;
  readonly situacao: "ausente" | "desatualizado" | "extra";
}

const lerSeExiste = Effect.fn("gerados.lerSeExiste")(function* (caminho: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(caminho)) ? yield* fs.readFileString(caminho) : undefined;
});

/**
 * Arquivos com `sufixo` em `pasta` que a lista de gerados não tem, ordenados por nome. `gerados` traz
 * caminhos já passados por `path.resolve`, e a comparação também: um `./` ou `..` no caminho de um
 * gerado não o faz parecer sobra e ser apagado logo depois de gravado.
 */
const extrasDe = Effect.fn("gerados.extrasDe")(function* (pastaGerada: PastaGerada, gerados: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fs.exists(pastaGerada.pasta))) return [];
  const nomes = yield* fs.readDirectory(pastaGerada.pasta);
  return nomes
    .filter((nome) => nome.endsWith(pastaGerada.sufixo))
    .sort(compararTexto)
    .map((nome) => path.join(pastaGerada.pasta, nome))
    .filter((caminho) => !gerados.has(path.resolve(caminho)));
});

/**
 * Compara os `arquivos` com o disco e devolve as divergências, na ordem da lista e depois as sobras.
 * No modo `gravar`, também as corrige: grava o ausente e o desatualizado (criando a pasta) e apaga o
 * que sobra.
 */
export const aplicarGerados = Effect.fn("gerados.aplicar")(function* (
  arquivos: ReadonlyArray<ArquivoGerado>,
  opcoes: OpcoesGerados,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relativo = (caminho: string) => path.relative(opcoes.raiz, caminho).split(path.sep).join("/");
  const gravar = opcoes.modo === "gravar";
  const divergencias: Array<Divergencia> = [];

  for (const arquivo of arquivos) {
    const atual = yield* lerSeExiste(arquivo.caminho);
    if (atual === arquivo.texto) continue;
    divergencias.push({
      arquivo: relativo(arquivo.caminho),
      situacao: atual === undefined ? "ausente" : "desatualizado",
    });
    if (gravar) {
      yield* fs.makeDirectory(path.dirname(arquivo.caminho), { recursive: true });
      yield* fs.writeFileString(arquivo.caminho, arquivo.texto);
    }
  }

  const gerados = new Set(arquivos.map((arquivo) => path.resolve(arquivo.caminho)));
  const sobras: Array<string> = [];
  for (const pasta of opcoes.extrasEm ?? []) sobras.push(...(yield* extrasDe(pasta, gerados)));
  for (const caminho of sobras) {
    divergencias.push({ arquivo: relativo(caminho), situacao: "extra" });
    if (gravar) yield* fs.remove(caminho);
  }
  return divergencias;
});

const SITUACOES: Record<Divergencia["situacao"], string> = {
  ausente: "ausente",
  desatualizado: "está desatualizado",
  extra: "não é mais gerado",
};

/** As mensagens da conferência: `<arquivo> está desatualizado; rode <comando>`. */
export function mensagensDivergencias(divergencias: ReadonlyArray<Divergencia>, comando: string): Array<string> {
  return divergencias.map(({ arquivo, situacao }) => `${arquivo} ${SITUACOES[situacao]}; rode ${comando}`);
}

/**
 * Todos os arquivos gerados da base, com o que o `aplicarGerados` precisa (`extrasEm`) e os números
 * do resumo. Lança se um PPC tem o front matter fora do contrato (o `validar_base` diz qual).
 */
export function arquivosGeradosDaBase(caminhos: CaminhosBase) {
  const normas = normasComCamposGerados(caminhos.raizProjeto);
  const indices = gerarIndices(caminhos);
  const { arquivos, extrasEm } = arquivosIndices(caminhos, indices);
  return {
    arquivos: [...normas.map((norma) => ({ caminho: norma.arquivo, texto: norma.esperado })), ...arquivos],
    extrasEm,
    indices,
    totais: { normas: normas.length, ppcs: indices.itensPpc.length, secoes: indices.itensSecao.length },
  };
}
