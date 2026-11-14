/**
 * Fontes do `kb.sqlite` e a impressão digital delas, para a CLI decidir quando recompilar.
 *
 * Fontes = os arquivos do git de onde o banco sai (normas, stubs, PPCs e índice de seções, CNCT,
 * `dados/institucional/`, fichas, tópicos e marcos da `analise-ppc`, léxico de sinônimos, e os
 * arquivos da fase 5: `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`)
 * mais o
 * código que compila (`packages/kb/src/` menos testes, CLI e consultas). Mudou qualquer um, o banco
 * fica velho.
 *
 * Decisão de frescor (`estadoDoBanco`), do mais barato ao mais caro:
 * 1. banco ausente, de outra versão de esquema ou com lista de fontes diferente (arquivo novo ou
 *    removido) → recompila;
 * 2. nenhuma fonte com mtime posterior ao do banco → fresco;
 * 3. alguma fonte mais nova: calcula o SHA-256 do conteúdo das fontes; igual ao gravado no banco
 *    (um `git checkout` que só tocou mtimes) → fresco, e o mtime do banco é atualizado; diferente →
 *    recompila.
 * O hash gravado depende só do conteúdo e dos caminhos, nunca de mtime ou relógio, e por isso não
 * quebra o determinismo do banco.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { compararTexto } from "../texto.ts";
import { ARQUIVOS_FONTES_NORMATIVAS } from "./fontes-normativas.ts";

/** Diretórios e arquivos de dados (relativos à raiz), com o filtro de extensão. */
const FONTES_DADOS: readonly { caminho: string; extensoes: readonly string[] }[] = [
  { caminho: "base-conhecimento/manifest.json", extensoes: [] },
  { caminho: "base-conhecimento/normas", extensoes: [".md", ".yaml"] },
  { caminho: "base-conhecimento/institucional/ifpr/ppcs", extensoes: [".md", ".json", ".jsonl"] },
  { caminho: "base-conhecimento/catalogos/cnct", extensoes: [".json"] },
  { caminho: "dados/institucional", extensoes: [".json"] },
  { caminho: ".agents/skills/analise-ppc/base-analise/fichas", extensoes: [".json"] },
  { caminho: ".agents/skills/analise-ppc/base-analise/topicos-fichas.json", extensoes: [] },
  { caminho: ".agents/skills/analise-ppc/base-analise/marcos-normativos.json", extensoes: [] },
  { caminho: "packages/kb/dados", extensoes: [".yaml"] },
  ...ARQUIVOS_FONTES_NORMATIVAS.map((caminho) => ({ caminho, extensoes: [] })),
];

/** Código do núcleo que entra na compilação (o resto, como CLI e consultas, não muda o banco). */
const CODIGO = "packages/kb/src";
const CODIGO_FORA = [
  /\.test\.ts$/,
  /^packages\/kb\/src\/(cli|python\/|avaliacao\/)/,
  /^packages\/kb\/src\/db\/(consultas|consultas-normas|comandos|banco|pacote-contexto)\.ts$/,
  /^packages\/kb\/src\/normas\/(comandos|impacto)\.ts$/,
];

function listar(raiz: string, relativo: string, extensoes: readonly string[]): string[] {
  const absoluto = path.join(raiz, relativo);
  if (!existsSync(absoluto)) return [];
  const info = statSync(absoluto);
  if (info.isFile()) return [relativo];
  const saida: string[] = [];
  for (const entrada of readdirSync(absoluto, { withFileTypes: true })) {
    const filho = `${relativo}/${entrada.name}`;
    if (entrada.isDirectory()) saida.push(...listar(raiz, filho, extensoes));
    else if (extensoes.length === 0 || extensoes.some((e) => entrada.name.endsWith(e))) saida.push(filho);
  }
  return saida;
}

/** Caminhos das fontes (relativos à raiz, com `/`), em ordem de code point. */
export function arquivosFonte(raiz: string): string[] {
  const dados = FONTES_DADOS.flatMap((fonte) => listar(raiz, fonte.caminho, fonte.extensoes));
  const codigo = listar(raiz, CODIGO, [".ts"]).filter((c) => !CODIGO_FORA.some((re) => re.test(c)));
  return [...new Set([...dados, ...codigo])].sort(compararTexto);
}

export function hashLista(arquivos: readonly string[]): string {
  return createHash("sha256").update(arquivos.join("\n")).digest("hex");
}

/** SHA-256 de (caminho, SHA-256 do conteúdo) de cada fonte, em ordem. */
export function hashConteudo(raiz: string, arquivos: readonly string[]): string {
  const total = createHash("sha256");
  for (const arquivo of arquivos) {
    const conteudo = createHash("sha256")
      .update(readFileSync(path.join(raiz, arquivo)))
      .digest("hex");
    total.update(`${arquivo}\0${conteudo}\n`);
  }
  return total.digest("hex");
}

export function mtimeMaisRecente(raiz: string, arquivos: readonly string[]): number {
  let maximo = 0;
  for (const arquivo of arquivos) maximo = Math.max(maximo, statSync(path.join(raiz, arquivo)).mtimeMs);
  return maximo;
}
