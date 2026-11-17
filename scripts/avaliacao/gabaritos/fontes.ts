// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona das fontes do checkout pelo gerador de gabaritos, de execução única
/**
 * Leitura das fontes locais usadas pelos geradores de gabarito: manifesto de normas, dados
 * institucionais, CNCT e PPCs convertidos. Tudo é lido do checkout; nada depende do relógio.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { mascararFrontMatter } from "@simplifica-if/kb/ppcs/front-matter";
import * as Schema from "effect/Schema";
import { carregarDadosInstitucionais, type DadosInstitucionais } from "../../dados/institucional.ts";
import { solto, TODOS_OS_ERROS, validarJson } from "../../esquema.ts";
import { RAIZ_REPOSITORIO } from "../carregar.ts";
import { compararTexto, normalizarTexto } from "../normalizar.ts";
import type { EntradaManifesto } from "../universos.ts";

export { RAIZ_REPOSITORIO };

const esquemaEntradaManifesto = solto({
  title: Schema.String,
  tipo_documento: Schema.String,
  numero: Schema.Union([Schema.String, Schema.Finite]),
  ano: Schema.Int,
  data_publicacao: Schema.String,
  orgao: Schema.String,
  jurisdicao: Schema.String,
  status_vigencia: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  path: Schema.String,
});
export type EntradaNorma = typeof esquemaEntradaManifesto.Type & EntradaManifesto;

const esquemaItemCnct = solto({
  id: Schema.String,
  denominacao: Schema.String,
  denominacao_normalizada: Schema.String,
  eixo_tecnologico: Schema.String,
  area_tecnologica: Schema.String,
  carga_horaria_minima_horas: Schema.Finite,
});
export type ItemCnct = typeof esquemaItemCnct.Type;

const esquemaItemPpc = solto({
  id: Schema.String,
  campus_id: Schema.String,
  curso_slug: Schema.String,
  curso_nome: Schema.String,
  nivel: Schema.String,
  tipo_oferta: Schema.String,
  path: Schema.String,
  ano_documento: Schema.optional(Schema.Int),
});
export type ItemPpc = typeof esquemaItemPpc.Type;

const esquemaManifesto = Schema.Array(esquemaEntradaManifesto);
/** Índices com `items`; as demais chaves do arquivo são descartadas (`TODOS_OS_ERROS`). */
const esquemaIndiceCnct = Schema.Struct({ items: Schema.Array(esquemaItemCnct) });
const esquemaIndicePpcs = Schema.Struct({ items: Schema.Array(esquemaItemPpc) });

export interface Fontes {
  raiz: string;
  normas: readonly EntradaNorma[];
  dados: DadosInstitucionais;
  cnct: readonly ItemCnct[];
  ppcs: readonly ItemPpc[];
  /** Texto do PPC convertido, por id `campus_id/curso_slug`, com o front matter em branco. */
  lerPpc(id: string): string;
}

function lerJson(caminho: string): unknown {
  return JSON.parse(NodeFS.readFileSync(caminho, "utf-8"));
}

export function carregarFontes(raiz: string = RAIZ_REPOSITORIO): Fontes {
  const base = NodePath.join(raiz, "base-conhecimento");
  const caminhoManifesto = NodePath.join(base, "manifest.json");
  const normas = validarJson(esquemaManifesto, lerJson(caminhoManifesto), caminhoManifesto, TODOS_OS_ERROS);
  const { dados, erros } = carregarDadosInstitucionais(NodePath.join(base, "institucional", "ifpr"));
  if (erros.length > 0) throw new Error(`institucional/ifpr/ inválido:\n${erros.join("\n")}`);
  const caminhoCnct = NodePath.join(base, "catalogos", "cnct", "index.json");
  const cnct = validarJson(esquemaIndiceCnct, lerJson(caminhoCnct), caminhoCnct, TODOS_OS_ERROS).items;
  const caminhoPpcs = NodePath.join(base, "institucional", "ifpr", "ppcs", "index.json");
  const ppcs = validarJson(esquemaIndicePpcs, lerJson(caminhoPpcs), caminhoPpcs, TODOS_OS_ERROS).items;
  const cache = new Map<string, string>();
  const caminhoPpc = new Map(ppcs.map((ppc) => [ppc.id, NodePath.join(base, ppc.path)]));
  return {
    raiz,
    normas: normas as readonly EntradaNorma[],
    dados,
    cnct,
    ppcs: [...ppcs].sort((a, b) => compararTexto(a.id, b.id)),
    lerPpc(id) {
      const emCache = cache.get(id);
      if (emCache !== undefined) return emCache;
      const caminho = caminhoPpc.get(id);
      if (!caminho || !NodeFS.existsSync(caminho)) throw new Error(`PPC sem arquivo: ${id}`);
      const texto = mascararFrontMatter(NodeFS.readFileSync(caminho, "utf-8"));
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

/** Habilitação do CNCT registrada no curso (`cnct_id`), ou `undefined` sem vínculo. */
export function cnctDoCadastro(
  curso: { cnct_id?: string | undefined },
  cnct: readonly ItemCnct[],
): ItemCnct | undefined {
  return curso.cnct_id ? cnct.find((item) => `cnct:${item.id}` === curso.cnct_id) : undefined;
}

/**
 * Habilitação do CNCT proposta pelo nome do curso: tira "PROEJA", "integrado ao ensino médio" e
 * prefixa "técnico em" quando falta. Serviu para propor o `cnct_id` dos cursos (fase 3) e serve
 * para propor o de cursos novos; os gabaritos usam o `cnct_id` cadastrado (`cnctDoCadastro`).
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
