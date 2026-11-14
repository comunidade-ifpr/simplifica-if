import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ehObjeto, type ObjetoJson } from "@simplifica-if/kb/json";
import { validarJson } from "./esquema.ts";

export const RAIZ_PROJETO = path.resolve(import.meta.dirname, "..");
export const RAIZ_BASE = path.join(RAIZ_PROJETO, "base-conhecimento");

const CAMINHO_CONFIG_NOTION = path.join(RAIZ_BASE, "config", "notion.json");
const CAMPOS_BASE = ["id", "data_source_id", "title"] as const;

/**
 * Bases que continuam no Notion. Campi, cursos, processos seletivos, editais e ofertas têm como
 * fonte os arquivos de `dados/institucional/`; as bases antigas foram arquivadas (veja
 * `bases_arquivadas` em `config/notion.json`).
 */
export const BASES_NOTION = ["movimentacoes_cursos"] as const;
export type BaseNotion = (typeof BASES_NOTION)[number];
export type DataSources = Record<BaseNotion, string>;

export function validarConfigNotion(config: unknown): string[] {
  const dados: ObjetoJson = ehObjeto(config) ? config : {};
  const erros: string[] = [];
  if (typeof dados.parent_page_id !== "string" || !dados.parent_page_id.trim()) {
    erros.push("config/notion.json: parent_page_id ausente");
  }
  const bases = dados.databases;
  if (!ehObjeto(bases)) {
    return ["config/notion.json: databases deve ser objeto"];
  }
  for (const chave of BASES_NOTION) {
    const base = bases[chave];
    if (!ehObjeto(base)) {
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

/**
 * Parte de `config/notion.json` que o código consome. A conferência campo a campo, com mensagens
 * próprias, fica em `validarConfigNotion`; o schema só dá o tipo ao que ela já garantiu.
 */
const esquemaBaseNotion = z.looseObject({ data_source_id: z.string() });
export const esquemaConfigNotion = z.looseObject({
  databases: z.looseObject({
    movimentacoes_cursos: esquemaBaseNotion,
  }),
});

export function carregarDataSources(): DataSources {
  const config: unknown = JSON.parse(readFileSync(CAMINHO_CONFIG_NOTION, "utf-8"));
  const erros = validarConfigNotion(config);
  if (erros.length) {
    throw new Error(`Configuração Notion inválida:\n- ${erros.join("\n- ")}`);
  }
  const { databases: bases } = validarJson(esquemaConfigNotion, config, CAMINHO_CONFIG_NOTION);
  return { movimentacoes_cursos: bases.movimentacoes_cursos.data_source_id };
}
