/**
 * Banco de teste: o DDL do `kb` com poucas linhas, num diretório temporário. Não depende do
 * `tmp/kb.sqlite`, que não está no git.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DDL, VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";

export const FONTES_SHA256 = "ab12cd34".padEnd(64, "0");

export const CONTAGENS = { campi: 3, cursos: 2, ppcs: 1, secoes: 3 };

export interface OpcoesFixture {
  /** Linhas da `meta` a trocar (`null` remove a chave). */
  meta?: Record<string, string | null>;
}

const temporarios: string[] = [];

export function diretorioTemporario(prefixo = "simplifica-mcp-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefixo));
  temporarios.push(dir);
  return dir;
}

export function limparTemporarios(): void {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function criarBancoFixture(opcoes: OpcoesFixture = {}, dir = diretorioTemporario()): string {
  const caminho = path.join(dir, "kb.sqlite");
  const db = new Database(caminho, { create: true, strict: true });
  db.run(DDL);
  const meta: Record<string, string | null> = {
    versao_esquema: String(VERSAO_ESQUEMA),
    data_referencia: "2026-11-13",
    fontes_sha256: FONTES_SHA256,
    fontes_lista_sha256: "f".repeat(64),
    fontes_total: "3",
    contagens_json: JSON.stringify(CONTAGENS),
    ...opcoes.meta,
  };
  const inserirMeta = db.prepare("INSERT INTO meta (chave, valor) VALUES (?, ?)");
  for (const [chave, valor] of Object.entries(meta)) if (valor !== null) inserirMeta.run(chave, valor);

  // Fora de ordem de propósito: a ferramenta ordena.
  const inserirCampus = db.prepare("INSERT INTO campi (id, campus_id, nome, path) VALUES (?, ?, ?, ?)");
  for (const [campus, nome] of [
    ["curitiba", "Curitiba"],
    ["assis-chateaubriand", "Assis Chateaubriand"],
    ["foz-do-iguacu", "Foz do Iguaçu"],
  ] as const) {
    inserirCampus.run(`campus:${campus}`, campus, nome, `dados/institucional/campi/${campus}.json`);
  }

  db.prepare(
    `INSERT INTO ppcs (id, chave, campus_id, campus_nome, curso_slug, curso_nome, nivel, tipo_oferta, path, linhas, caracteres, proveniencia_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "ppc:curitiba/tecnico-em-enfermagem",
    "curitiba/tecnico-em-enfermagem",
    "curitiba",
    "Curitiba",
    "tecnico-em-enfermagem",
    "Técnico em Enfermagem",
    "médio",
    "subsequente",
    "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md",
    300,
    12000,
    "{}",
  );

  const inserirCurso = db.prepare(
    "INSERT INTO cursos (id, campus_id, curso_slug, nome, nivel, path) VALUES (?, ?, ?, ?, ?, ?)",
  );
  inserirCurso.run(
    "curso:curitiba/tecnico-em-enfermagem",
    "curitiba",
    "tecnico-em-enfermagem",
    "Técnico em Enfermagem",
    "médio",
    "dados/institucional/cursos/curitiba/tecnico-em-enfermagem.json",
  );
  inserirCurso.run(
    "curso:foz-do-iguacu/licenciatura-em-fisica",
    "foz-do-iguacu",
    "licenciatura-em-fisica",
    "Licenciatura em Física",
    "superior",
    "dados/institucional/cursos/foz-do-iguacu/licenciatura-em-fisica.json",
  );

  const inserirSecao = db.prepare(
    `INSERT INTO secoes (id, ppc_id, tipo, titulo, path, linha_inicio, linha_fim, linha_texto, texto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const md = "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md";
  for (const [secao, tipo, inicio] of [
    ["estagio-1", "estagio_praticas", 200],
    ["avaliacao-1", "avaliacao", 120],
    ["estagio-2", "estagio_praticas", 220],
  ] as const) {
    inserirSecao.run(
      `curitiba/tecnico-em-enfermagem#${secao}`,
      "ppc:curitiba/tecnico-em-enfermagem",
      tipo,
      secao,
      md,
      inicio,
      inicio + 10,
      inicio + 1,
      `Texto da seção ${secao}.`,
    );
  }
  db.close();
  return caminho;
}
