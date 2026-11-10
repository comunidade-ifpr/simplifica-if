import { readFileSync } from "node:fs";
import path from "node:path";

export const RAIZ_PROJETO = path.resolve(import.meta.dir, "..");
export const RAIZ_BASE = path.join(RAIZ_PROJETO, "base-conhecimento");

const CAMINHO_CONFIG_NOTION = path.join(RAIZ_BASE, "config", "notion.json");
const CAMPOS_BASE = ["id", "data_source_id", "title"] as const;

export const BASES_NOTION = [
  "campi",
  "cursos",
  "editais_ingresso",
  "movimentacoes_cursos",
  "ofertas_ingresso",
  "processos_seletivos",
  "tarefas",
] as const;
export type BaseNotion = (typeof BASES_NOTION)[number];
export type DataSources = Record<BaseNotion, string>;

export function validarConfigNotion(config: unknown): string[] {
  const dados = (config ?? {}) as { parent_page_id?: unknown; databases?: unknown };
  const erros: string[] = [];
  if (typeof dados.parent_page_id !== "string" || !dados.parent_page_id.trim()) {
    erros.push("config/notion.json: parent_page_id ausente");
  }
  if (typeof dados.databases !== "object" || dados.databases === null || Array.isArray(dados.databases)) {
    return ["config/notion.json: databases deve ser objeto"];
  }
  const bases = dados.databases as Record<string, Record<string, unknown> | undefined>;
  for (const chave of BASES_NOTION) {
    const base = bases[chave];
    if (typeof base !== "object" || base === null) {
      erros.push(`config/notion.json: base ausente: ${chave}`);
      continue;
    }
    for (const campo of CAMPOS_BASE) {
      const valor = base[campo];
      if (typeof valor !== "string" || !valor.trim()) {
        erros.push(`config/notion.json: databases.${chave}.${campo} ausente`);
      }
    }
  }
  return erros;
}

export function carregarDataSources(): DataSources {
  const config = JSON.parse(readFileSync(CAMINHO_CONFIG_NOTION, "utf-8")) as {
    databases: Record<BaseNotion, { data_source_id: string }>;
  };
  const erros = validarConfigNotion(config);
  if (erros.length) {
    throw new Error(`Configuração Notion inválida:\n- ${erros.join("\n- ")}`);
  }
  return Object.fromEntries(
    BASES_NOTION.map((chave) => [chave, config.databases[chave].data_source_id]),
  ) as DataSources;
}
