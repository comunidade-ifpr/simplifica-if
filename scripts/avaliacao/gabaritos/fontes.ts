/**
 * Leitura das fontes locais usadas pelos geradores de gabarito: manifesto de normas, dados
 * institucionais, CNCT e PPCs convertidos. Tudo é lido do checkout; nada depende do relógio.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { mascararFrontMatter } from "@simplifica-if/kb/ppcs/front-matter";
import { z } from "zod";
import { carregarDadosInstitucionais, type DadosInstitucionais } from "../../dados/institucional.ts";
import { RAIZ_REPOSITORIO } from "../carregar.ts";
import { compararTexto, normalizarTexto } from "../normalizar.ts";
import type { EntradaManifesto } from "../universos.ts";

export { RAIZ_REPOSITORIO };

const esquemaEntradaManifesto = z.looseObject({
  title: z.string(),
  tipo_documento: z.string(),
  numero: z.union([z.string(), z.number()]),
  ano: z.number().int(),
  data_publicacao: z.string(),
  orgao: z.string(),
  jurisdicao: z.string(),
  status_vigencia: z.string(),
  aliases: z.array(z.string()).optional(),
  path: z.string(),
});
export type EntradaNorma = z.output<typeof esquemaEntradaManifesto> & EntradaManifesto;

const esquemaItemCnct = z.looseObject({
  id: z.string(),
  denominacao: z.string(),
  denominacao_normalizada: z.string(),
  eixo_tecnologico: z.string(),
  area_tecnologica: z.string(),
  carga_horaria_minima_horas: z.number(),
});
export type ItemCnct = z.output<typeof esquemaItemCnct>;

const esquemaItemPpc = z.looseObject({
  id: z.string(),
  campus_id: z.string(),
  curso_slug: z.string(),
  curso_nome: z.string(),
  nivel: z.string(),
  tipo_oferta: z.string(),
  path: z.string(),
  ano_documento: z.number().int().optional(),
});
export type ItemPpc = z.output<typeof esquemaItemPpc>;

export interface Fontes {
  raiz: string;
  normas: EntradaNorma[];
  dados: DadosInstitucionais;
  cnct: ItemCnct[];
  ppcs: ItemPpc[];
  /** Texto do PPC convertido, por id `campus_id/curso_slug`, com o front matter em branco. */
  lerPpc(id: string): string;
}

function lerJson(caminho: string): unknown {
  return JSON.parse(readFileSync(caminho, "utf-8"));
}

export function carregarFontes(raiz: string = RAIZ_REPOSITORIO): Fontes {
  const base = path.join(raiz, "base-conhecimento");
  const normas = z.array(esquemaEntradaManifesto).parse(lerJson(path.join(base, "manifest.json")));
  const { dados, erros } = carregarDadosInstitucionais(path.join(raiz, "dados", "institucional"));
  if (erros.length > 0) throw new Error(`dados/institucional inválido:\n${erros.join("\n")}`);
  const cnct = z
    .object({ items: z.array(esquemaItemCnct) })
    .parse(lerJson(path.join(base, "catalogos", "cnct", "index.json"))).items;
  const ppcs = z
    .object({ items: z.array(esquemaItemPpc) })
    .parse(lerJson(path.join(base, "institucional", "ifpr", "ppcs", "index.json"))).items;
  const cache = new Map<string, string>();
  const caminhoPpc = new Map(ppcs.map((ppc) => [ppc.id, path.join(base, ppc.path)]));
  return {
    raiz,
    normas: normas as EntradaNorma[],
    dados,
    cnct,
    ppcs: [...ppcs].sort((a, b) => compararTexto(a.id, b.id)),
    lerPpc(id) {
      const emCache = cache.get(id);
      if (emCache !== undefined) return emCache;
      const caminho = caminhoPpc.get(id);
      if (!caminho || !existsSync(caminho)) throw new Error(`PPC sem arquivo: ${id}`);
      const texto = mascararFrontMatter(readFileSync(caminho, "utf-8"));
      cache.set(id, texto);
      return texto;
    },
  };
}

/* ---------------------------------------------------------- CNCT do curso */

/** Normalização do CNCT (`denominacao_normalizada`): sem acentos, só letras e números. */
function normalizarDenominacao(nome: string): string {
  return normalizarTexto(nome)
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/**
 * Habilitação do CNCT pelo nome do curso. Heurística provisória até existir `cnct_id` no curso
 * (fase 3): tira "PROEJA", "integrado ao ensino médio" e prefixa "técnico em" quando falta.
 */
export function cnctDoCurso(nome: string, cnct: readonly ItemCnct[]): ItemCnct | undefined {
  let chave = normalizarDenominacao(nome)
    .replace(/\b(?:proeja|integrado ao ensino medio|integrado|subsequente|ead)\b/gu, " ")
    .replace(/^curso tecnico (?:de|em) /u, "tecnico em ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!chave.startsWith("tecnico")) chave = `tecnico em ${chave}`;
  return cnct.find((item) => item.denominacao_normalizada === chave);
}

/** Texto do PPC normalizado numa linha só, para casar citações quebradas por `<br>` ou por linha. */
export function textoCorrido(texto: string): string {
  return normalizarTexto(texto).replace(/\n+/gu, " ");
}
