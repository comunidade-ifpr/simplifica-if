// @effect-diagnostics nodeBuiltinImport:off -- percorre e hasheia milhares de fontes a cada comando da CLI; a versão síncrona é a mais rápida
/**
 * Fontes do `kb.sqlite` e a impressão digital delas, para a CLI decidir quando recompilar.
 *
 * Fontes = os arquivos do git de onde o banco sai (normas, stubs, PPCs e índice de seções, CNCT,
 * registros institucionais, fichas, tópicos e marcos da revisão de PPC, léxico de sinônimos, e os
 * arquivos normativos: `relacoes.yaml`, `transicoes.yaml`, `correspondencias/`, `config/vigencia.yaml`)
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
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { CAMINHOS } from "../caminhos.ts";
import { compararTexto } from "../texto.ts";
import { VERSAO_ESQUEMA } from "./esquema.ts";
import { ARQUIVOS_FONTES_NORMATIVAS } from "./fontes-normativas.ts";

/** Diretórios e arquivos de dados (relativos à raiz), com o filtro de extensão. */
const FONTES_DADOS: readonly { caminho: string; extensoes: readonly string[] }[] = [
  { caminho: CAMINHOS.normas, extensoes: [".md", ".yaml"] },
  { caminho: CAMINHOS.ppcs, extensoes: [".md", ".json", ".jsonl"] },
  { caminho: CAMINHOS.cnct, extensoes: [".json"] },
  ...["campi", "cursos", "processos-seletivos", "editais", "ofertas", "conselhos"].map((colecao) => ({
    caminho: `${CAMINHOS.institucional}/${colecao}`,
    extensoes: [".json"],
  })),
  { caminho: CAMINHOS.fichas, extensoes: [".json"] },
  { caminho: CAMINHOS.topicosFichas, extensoes: [] },
  { caminho: CAMINHOS.marcos, extensoes: [] },
  { caminho: CAMINHOS.dadosKb, extensoes: [".yaml"] },
  ...ARQUIVOS_FONTES_NORMATIVAS.map((caminho) => ({ caminho, extensoes: [] })),
];

/** Código do núcleo que entra na compilação (o resto, como CLI e consultas, não muda o banco). */
const CODIGO = CAMINHOS.codigoKb;
const CODIGO_FORA = [
  /\.test\.ts$/,
  /^packages\/kb\/src\/(cli|primitivas|avaliacao|esquema|testes)\//,
  /^packages\/kb\/src\/db\/(consultas-[a-z]+|pacote-contexto|sql|conexao|nodeSqliteClient)\.ts$/,
  // serviços Effect e layers: consultam o banco, não o compilam
  /^packages\/kb\/src\/([A-Z][A-Za-z]*|layers)\.ts$/,
  /^packages\/kb\/src\/normas\/impacto\.ts$/,
];

function listar(raiz: string, relativo: string, extensoes: readonly string[]): string[] {
  const absoluto = NodePath.join(raiz, relativo);
  if (!NodeFS.existsSync(absoluto)) return [];
  const info = NodeFS.statSync(absoluto);
  if (info.isFile()) return [relativo];
  const saida: string[] = [];
  for (const entrada of NodeFS.readdirSync(absoluto, { withFileTypes: true })) {
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
  return NodeCrypto.createHash("sha256").update(arquivos.join("\n")).digest("hex");
}

/** SHA-256 de (caminho, SHA-256 do conteúdo) de cada fonte, em ordem. */
export function hashConteudo(raiz: string, arquivos: readonly string[]): string {
  const total = NodeCrypto.createHash("sha256");
  for (const arquivo of arquivos) {
    const conteudo = NodeCrypto.createHash("sha256")
      .update(NodeFS.readFileSync(NodePath.join(raiz, arquivo)))
      .digest("hex");
    total.update(`${arquivo}\0${conteudo}\n`);
  }
  return total.digest("hex");
}

export function mtimeMaisRecente(raiz: string, arquivos: readonly string[]): number {
  let maximo = 0;
  for (const arquivo of arquivos) maximo = Math.max(maximo, NodeFS.statSync(NodePath.join(raiz, arquivo)).mtimeMs);
  return maximo;
}

/** Situação do banco diante das fontes do checkout. */
export type Estado =
  | { estado: "fresco"; motivo: "mtime" | "conteudo-igual" }
  | { estado: "velho"; motivo: "ausente" | "esquema" | "lista-de-fontes" | "conteudo" };

function lerMeta(caminho: string): Map<string, string> | null {
  try {
    const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
    try {
      const linhas = db.prepare("SELECT chave, valor FROM meta").all();
      return new Map(linhas.map((m) => [String(m["chave"]), String(m["valor"])]));
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Decide se o banco em `caminho` corresponde às fontes do checkout em `raiz`. */
export function estadoDoBanco(raiz: string, caminho: string): Estado {
  if (!NodeFS.existsSync(caminho)) return { estado: "velho", motivo: "ausente" };
  const meta = lerMeta(caminho);
  if (!meta || meta.get("versao_esquema") !== String(VERSAO_ESQUEMA)) return { estado: "velho", motivo: "esquema" };
  const arquivos = arquivosFonte(raiz);
  if (meta.get("fontes_lista_sha256") !== hashLista(arquivos)) return { estado: "velho", motivo: "lista-de-fontes" };
  const mtimeBanco = NodeFS.statSync(caminho).mtimeMs;
  const mtimeFontes = mtimeMaisRecente(raiz, arquivos);
  if (mtimeFontes <= mtimeBanco) return { estado: "fresco", motivo: "mtime" };
  if (meta.get("fontes_sha256") === hashConteudo(raiz, arquivos)) {
    // o banco avança até o mtime das fontes lido antes do hash, não até agora: uma fonte editada
    // durante o hash fica mais nova que o banco e é conferida na próxima abertura
    const instante = mtimeFontes / 1000;
    NodeFS.utimesSync(caminho, instante, instante);
    return { estado: "fresco", motivo: "conteudo-igual" };
  }
  return { estado: "velho", motivo: "conteudo" };
}
