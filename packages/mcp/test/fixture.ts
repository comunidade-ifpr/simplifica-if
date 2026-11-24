// @effect-diagnostics nodeBuiltinImport:off -- fixture de teste: grava o banco num diretório temporário pelo node:sqlite
/**
 * Banco de teste: o DDL do `kb` com poucas linhas, num diretório temporário. Não depende do
 * `tmp/kb.sqlite`, que não está no git.
 */
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DDL, VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";

export const FONTES_SHA256 = "ab12cd34".padEnd(64, "0");

export const CONTAGENS = { campi: 3, cursos: 2, ppcs: 1, secoes: 3 };

export interface OpcoesFixture {
  /** Linhas da `meta` a trocar (`null` remove a chave). */
  meta?: Record<string, string | null>;
}

const temporarios: string[] = [];

export function diretorioTemporario(prefixo = "simplifica-mcp-"): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefixo));
  temporarios.push(dir);
  return dir;
}

export function limparTemporarios(): void {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
}

/**
 * Um Markdown sintético para a tabela `documentos`: um front matter nas linhas 1 a 3 e, em cada linha
 * dada, o texto dela; as outras ficam em branco. Assim as linhas das âncoras (dispositivos, seções)
 * são as do texto, como na base real.
 */
export function markdownSintetico(id: string, linhas: ReadonlyMap<number, string>): string {
  const total = Math.max(4, ...linhas.keys()) + 1;
  const saida = Array.from({ length: total }, (_, i) => linhas.get(i + 1) ?? "");
  saida.splice(0, 3, "---", `id: ${id}`, "---");
  return saida.join("\n");
}

/** O PPC de Enfermagem da fixture: lacunas fora das seções, uma tabela, um link externo e HTML cru (que não pode virar HTML). */
const LINHAS_PPC_ENFERMAGEM = new Map<number, string>([
  [5, "# Projeto Pedagógico do Curso Técnico em Enfermagem"],
  [7, "Campus Curitiba · Forma subsequente"],
  [9, "| Item | Valor |"],
  [10, "| --- | --- |"],
  [11, "| Carga horária | 1.600 horas |"],
  [13, "Mais informações no [site do IFPR](https://ifpr.edu.br/curitiba)."],
  [15, '<script>window.__invasao = true</script><img src="x" onerror="window.__invasao = true">'],
]);

export function criarBancoFixture(opcoes: OpcoesFixture = {}, dir = diretorioTemporario()): string {
  const caminho = NodePath.join(dir, "kb.sqlite");
  const db = new NodeSqlite.DatabaseSync(caminho);
  db.exec(DDL);
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
    inserirCampus.run(`campus:${campus}`, campus, nome, `base-conhecimento/institucional/ifpr/campi/${campus}.json`);
  }

  db.prepare(
    `INSERT INTO ppcs (id, chave, chave_curso, versao, vigente, campus_id, campus_nome, curso_slug, curso_nome, nivel, tipo_oferta, path, linhas, caracteres, proveniencia_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "ppc:curitiba/tecnico-em-enfermagem/2023",
    "curitiba/tecnico-em-enfermagem/2023",
    "curitiba/tecnico-em-enfermagem",
    "2023",
    1,
    "curitiba",
    "Curitiba",
    "tecnico-em-enfermagem",
    "Técnico em Enfermagem",
    "médio",
    "subsequente",
    "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md",
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
    "base-conhecimento/institucional/ifpr/cursos/curitiba/tecnico-em-enfermagem.json",
  );
  inserirCurso.run(
    "curso:foz-do-iguacu/licenciatura-em-fisica",
    "foz-do-iguacu",
    "licenciatura-em-fisica",
    "Licenciatura em Física",
    "superior",
    "base-conhecimento/institucional/ifpr/cursos/foz-do-iguacu/licenciatura-em-fisica.json",
  );

  const inserirSecao = db.prepare(
    `INSERT INTO secoes (id, ppc_id, tipo, titulo, path, linha_inicio, linha_fim, linha_texto, texto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const md = "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem/2023.md";
  for (const [secao, tipo, inicio] of [
    ["estagio-1", "estagio_praticas", 200],
    ["avaliacao-1", "avaliacao", 120],
    ["estagio-2", "estagio_praticas", 220],
  ] as const) {
    LINHAS_PPC_ENFERMAGEM.set(inicio, `## ${secao}`);
    LINHAS_PPC_ENFERMAGEM.set(inicio + 2, `Texto da seção ${secao}.`);
    inserirSecao.run(
      `curitiba/tecnico-em-enfermagem/2023#${secao}`,
      "ppc:curitiba/tecnico-em-enfermagem/2023",
      tipo,
      secao,
      md,
      inicio,
      inicio + 10,
      inicio + 1,
      `Texto da seção ${secao}.`,
    );
  }
  db.prepare("INSERT INTO documentos (path, texto) VALUES (?, ?)").run(
    md,
    markdownSintetico("ppc:curitiba/tecnico-em-enfermagem/2023", LINHAS_PPC_ENFERMAGEM),
  );
  db.close();
  return caminho;
}
