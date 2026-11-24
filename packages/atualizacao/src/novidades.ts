// @effect-diagnostics nodeBuiltinImport:off -- fábrica: lê dois kb.sqlite com node:sqlite para propor novidades
/**
 * `base-conhecimento/novidades.yaml`: o registro, só de acréscimos, do que mudou em cada versão da
 * base (plano, "Atualização: três ritmos", Novidades). A curadoria escreve o texto; a fábrica
 *
 * - **propõe** entradas pela diferença entre dois `kb.sqlite` (`proporNovidades`): norma nova ou
 *   retirada, mudança de `status_vigencia`, PPC novo (cada versão tem ID próprio: o PPC novo de um
 *   curso entra como `ppc-novo`), substituído (deixou de ser o vigente do curso), atualizado (a mesma
 *   versão com ano do documento ou tamanho diferente) ou retirado, curso novo ou retirado. A proposta sai como YAML para revisar e colar, nunca gravada;
 * - **confere** que o arquivo só ganhou entradas (`soAcrescimos`) e leva ao manifesto as da versão
 *   publicada (`novidadesDaVersao`).
 */
import * as NodeSqlite from "node:sqlite";
import * as Schema from "effect/Schema";
import { parse, stringify } from "yaml";

export const TIPOS_NOVIDADE = [
  "norma-nova",
  "norma-retirada",
  "revogacao",
  "vigencia",
  "ppc-novo",
  "ppc-atualizado",
  "ppc-substituido",
  "ppc-retirado",
  "curso-novo",
  "curso-retirado",
  "outro",
] as const;

export const ItemNovidade = Schema.Struct({
  tipo: Schema.Literals(TIPOS_NOVIDADE),
  titulo: Schema.String,
  detalhe: Schema.optionalKey(Schema.String),
  /** IDs da base (norma, PPC, curso) a que a entrada se refere. */
  refs: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Quem a mudança afeta (cursos, campi), calculado pela fábrica quando houver. */
  afeta: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type ItemNovidade = typeof ItemNovidade.Type;

export const VersaoNovidades = Schema.Struct({
  versao: Schema.String,
  data: Schema.String,
  itens: Schema.Array(ItemNovidade),
});

export const ArquivoNovidades = Schema.Struct({ versoes: Schema.Array(VersaoNovidades) });
export type ArquivoNovidades = typeof ArquivoNovidades.Type;

const decodificar = Schema.decodeUnknownSync(ArquivoNovidades);

export function lerNovidades(texto: string): ArquivoNovidades {
  const lido: unknown = parse(texto, { schema: "core" });
  return decodificar(lido ?? { versoes: [] });
}

/** As entradas da versão, no formato do manifesto (sem `refs`). */
export function novidadesDaVersao(arquivo: ArquivoNovidades, versao: string) {
  return (arquivo.versoes.find((entrada) => entrada.versao === versao)?.itens ?? []).map((item) => ({
    tipo: item.tipo,
    titulo: item.titulo,
    ...(item.detalhe === undefined ? {} : { detalhe: item.detalhe }),
    ...(item.afeta === undefined ? {} : { afeta: item.afeta }),
  }));
}

/** O arquivo novo só acrescenta: cada versão antiga continua igual, na mesma ordem. Devolve os problemas. */
export function soAcrescimos(antes: ArquivoNovidades, depois: ArquivoNovidades): ReadonlyArray<string> {
  const problemas: string[] = [];
  antes.versoes.forEach((entrada, indice) => {
    const atual = depois.versoes[indice];
    if (atual === undefined) problemas.push(`a versão ${entrada.versao} saiu do registro`);
    else if (JSON.stringify(atual) !== JSON.stringify(entrada))
      problemas.push(`a versão ${entrada.versao} foi alterada`);
  });
  return problemas;
}

/* ------------------------------------------------------------------ proposta pela diferença */

type Linha = Record<string, unknown>;

function tabela(caminho: string, sql: string): Map<string, Linha> {
  const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
  try {
    return new Map(
      db
        .prepare(sql)
        .all()
        .map((linha) => [String(linha["id"]), linha as Linha]),
    );
  } finally {
    db.close();
  }
}

/** Se a tabela tem a coluna (bancos de esquema anterior não têm as colunas de versão do PPC). */
function temColuna(caminho: string, tabelaSql: string, coluna: string): boolean {
  const db = new NodeSqlite.DatabaseSync(caminho, { readOnly: true });
  try {
    return db
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(tabelaSql)
      .some((linha) => linha["name"] === coluna);
  } finally {
    db.close();
  }
}

const texto = (valor: unknown) => (valor === null || valor === undefined ? "" : String(valor));

/** Entradas propostas da diferença entre a base `de` e a base `para`. */
export function proporNovidades(de: string, para: string): ReadonlyArray<ItemNovidade> {
  const itens: ItemNovidade[] = [];
  const sqlNormas = "SELECT id, titulo, status_vigencia FROM normas";
  const [normasDe, normasPara] = [tabela(de, sqlNormas), tabela(para, sqlNormas)];
  for (const [id, norma] of normasPara) {
    const antes = normasDe.get(id);
    if (antes === undefined) {
      itens.push({ tipo: "norma-nova", titulo: `${texto(norma["titulo"])} entrou na base`, refs: [id] });
    } else if (texto(antes["status_vigencia"]) !== texto(norma["status_vigencia"])) {
      const status = texto(norma["status_vigencia"]);
      itens.push({
        tipo: status === "revogada" ? "revogacao" : "vigencia",
        titulo: `${texto(norma["titulo"])}: ${texto(antes["status_vigencia"]) || "sem status"} → ${status || "sem status"}`,
        refs: [id],
      });
    }
  }
  for (const [id, norma] of normasDe) {
    if (!normasPara.has(id))
      itens.push({ tipo: "norma-retirada", titulo: `${texto(norma["titulo"])} saiu da base`, refs: [id] });
  }

  // Banco de esquema anterior, sem versões: cada PPC era o vigente do curso.
  const sqlPpcs = (caminho: string) =>
    `SELECT id, curso_nome, campus_nome, ano_documento, caracteres, ${
      temColuna(caminho, "ppcs", "vigente") ? "vigente, substituido_por" : "1 AS vigente, NULL AS substituido_por"
    } FROM ppcs`;
  const [ppcsDe, ppcsPara] = [tabela(de, sqlPpcs(de)), tabela(para, sqlPpcs(para))];
  const nomePpc = (ppc: Linha) => `PPC de ${texto(ppc["curso_nome"])} (${texto(ppc["campus_nome"])})`;
  for (const [id, ppc] of ppcsPara) {
    const antes = ppcsDe.get(id);
    if (antes === undefined) {
      itens.push({ tipo: "ppc-novo", titulo: `${nomePpc(ppc)} entrou na base`, refs: [id] });
      continue;
    }
    if (texto(antes["vigente"]) === "1" && texto(ppc["vigente"]) === "0") {
      const seguinte = texto(ppc["substituido_por"]);
      itens.push({
        tipo: "ppc-substituido",
        titulo: `${nomePpc(ppc)}${ppc["ano_documento"] == null ? "" : ` de ${texto(ppc["ano_documento"])}`} substituído por versão nova`,
        refs: seguinte ? [id, seguinte] : [id],
      });
    }
    if (
      texto(antes["ano_documento"]) !== texto(ppc["ano_documento"]) ||
      texto(antes["caracteres"]) !== texto(ppc["caracteres"])
    ) {
      itens.push({
        tipo: "ppc-atualizado",
        titulo: `${nomePpc(ppc)} atualizado`,
        ...(texto(antes["ano_documento"]) !== texto(ppc["ano_documento"])
          ? { detalhe: `documento de ${texto(antes["ano_documento"])} → ${texto(ppc["ano_documento"])}` }
          : {}),
        refs: [id],
      });
    }
  }
  for (const [id, ppc] of ppcsDe) {
    if (!ppcsPara.has(id)) itens.push({ tipo: "ppc-retirado", titulo: `${nomePpc(ppc)} saiu da base`, refs: [id] });
  }

  const sqlCursos = "SELECT id, nome, campus_id FROM cursos";
  const [cursosDe, cursosPara] = [tabela(de, sqlCursos), tabela(para, sqlCursos)];
  for (const [id, curso] of cursosPara) {
    if (!cursosDe.has(id))
      itens.push({ tipo: "curso-novo", titulo: `${texto(curso["nome"])} (${texto(curso["campus_id"])})`, refs: [id] });
  }
  for (const [id, curso] of cursosDe) {
    if (!cursosPara.has(id)) {
      itens.push({
        tipo: "curso-retirado",
        titulo: `${texto(curso["nome"])} (${texto(curso["campus_id"])}) saiu da base`,
        refs: [id],
      });
    }
  }
  return itens;
}

/** A proposta como um bloco YAML para colar no fim de `novidades.yaml`. */
export function proposta(versao: string, data: string, itens: ReadonlyArray<ItemNovidade>): string {
  return stringify([{ versao, data, itens }], { lineWidth: 0 });
}
