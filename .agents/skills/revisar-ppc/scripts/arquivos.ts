/** Leitura e escrita dos arquivos da base de análise. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";

/** Lê um JSON em UTF-8 estrito. */
export function lerJson(caminho: string): unknown {
  return JSON.parse(lerTexto(caminho));
}

/** Arquivos de `diretorio` cujo nome termina em `sufixo`, ordenados por nome (code point); diretório ausente dá lista vazia. */
export function listarArquivos(diretorio: string, sufixo: string): string[] {
  if (!NodeFS.existsSync(diretorio) || !NodeFS.statSync(diretorio).isDirectory()) return [];
  const nomes = NodeFS.readdirSync(diretorio).filter((nome) => nome.endsWith(sufixo));
  return ordenarTextos(nomes).map((nome) => NodePath.join(diretorio, nome));
}

/** Grava texto em UTF-8, criando o diretório quando preciso. */
export function escreverTexto(caminho: string, texto: string): void {
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, texto, "utf-8");
}

/** Data e hora UTC sem frações, no formato `2026-11-13T12:00:00+00:00` usado nos arquivos gerados. */
export function agoraUtc(data: Date = new Date()): string {
  return data.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
