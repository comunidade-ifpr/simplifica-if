/**
 * Front matter de proveniência dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/`).
 *
 * A base guarda só o PPC vigente de cada curso; versões anteriores ficam no histórico do git. Por
 * isso o ID do PPC é `ppc:<campus_id>/<curso_slug>`, sem versão. O front matter registra de onde
 * veio o texto: URL do arquivo-fonte, hash SHA-256 dos bytes baixados, data e versão do conversor.
 *
 * - `proveniencia: registrada`: gravada pelo conversor no momento da conversão
 *   (`scripts/converter_ppcs_markdown.py`); hash e conversor são conhecidos.
 * - `proveniencia: reconstruida`: preenchida depois, a partir do histórico do git, para PPCs
 *   convertidos antes do front matter existir. O que não é verificável fica `desconhecido`, com o
 *   motivo em `nota_proveniencia`.
 *
 * O YAML é lido pelo mesmo parser das normas (`yaml` em schema `failsafe`): todo valor é texto ou
 * lista de texto.
 */
import { parse } from "yaml";
import { z } from "zod";
import { analisarFrontMatter, ErroFrontMatter } from "../normas/front-matter.ts";

export { ErroFrontMatter };

export const DESCONHECIDO = "desconhecido";
const RE_SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const RE_ID_PPC = new RegExp(`^ppc:${RE_SLUG}/${RE_SLUG}$`);
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_COMMIT = /^[0-9a-f]{40}$/;

/** Ordem dos campos no arquivo (e na serialização). */
export const CAMPOS_PROVENIENCIA = [
  "id",
  "fonte_url",
  "fonte_sha256",
  "convertido_em",
  "conversor",
  "proveniencia",
  "conversao_commit",
  "pos_processamento_commits",
  "nota_proveniencia",
] as const;

export const esquemaProvenienciaPpc = z
  .strictObject({
    id: z.string().regex(RE_ID_PPC, "id deve ser ppc:<campus_id>/<curso_slug>"),
    fonte_url: z.string().regex(/^https:\/\/\S+$/, "fonte_url deve ser URL https"),
    fonte_sha256: z.union([
      z.string().regex(RE_SHA256, "fonte_sha256 deve ter 64 hexadecimais"),
      z.literal(DESCONHECIDO),
    ]),
    convertido_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "convertido_em deve ser AAAA-MM-DD"),
    conversor: z.string().min(1),
    proveniencia: z.enum(["registrada", "reconstruida"]),
    /** Commit em que o texto convertido entrou no git (só na proveniência reconstruída). */
    conversao_commit: z.string().regex(RE_COMMIT, "conversao_commit deve ter 40 hexadecimais").optional(),
    /** Commits que alteraram o texto depois da conversão (limpeza de ruído, remoção de sumário). */
    pos_processamento_commits: z.array(z.string().regex(RE_COMMIT)).min(1).optional(),
    nota_proveniencia: z.string().min(1).optional(),
  })
  .superRefine((meta, ctx) => {
    if (meta.proveniencia === "registrada") {
      if (meta.fonte_sha256 === DESCONHECIDO) {
        ctx.addIssue({ code: "custom", path: ["fonte_sha256"], message: "proveniência registrada exige o hash" });
      }
      if (meta.conversor === DESCONHECIDO) {
        ctx.addIssue({ code: "custom", path: ["conversor"], message: "proveniência registrada exige o conversor" });
      }
    } else if (!meta.nota_proveniencia) {
      ctx.addIssue({
        code: "custom",
        path: ["nota_proveniencia"],
        message: "proveniência reconstruída exige nota_proveniencia",
      });
    }
  });
export type ProvenienciaPpc = z.output<typeof esquemaProvenienciaPpc>;

export function idPpc(campusId: string, cursoSlug: string): string {
  return `ppc:${campusId}/${cursoSlug}`;
}

const CAMPOS_CONHECIDOS = new Set<string>(CAMPOS_PROVENIENCIA);

/**
 * Se o YAML entre os `---` é o front matter de proveniência de PPC: um mapa só com campos de
 * `CAMPOS_PROVENIENCIA`, com `id` e `fonte_url`. Um Markdown que abre com régua horizontal (`---`)
 * ou com outro YAML não tem esse bloco, e o texto entre as réguas é do documento.
 */
function ehFrontMatterDePpc(yaml: string): boolean {
  const chaves = chavesDoMapaYaml(yaml);
  if (!chaves) return false;
  return chaves.includes("id") && chaves.includes("fonte_url") && chaves.every((chave) => CAMPOS_CONHECIDOS.has(chave));
}

/** Chaves do YAML (schema `failsafe`), se ele for um mapa válido; `null` se não for. */
export function chavesDoMapaYaml(yaml: string): string[] | null {
  let bruto: unknown;
  try {
    bruto = parse(yaml, { schema: "failsafe", uniqueKeys: true, prettyErrors: false });
  } catch {
    return null;
  }
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  return Object.keys(bruto);
}

/**
 * Número de linhas do front matter de proveniência (do `---` de abertura ao de fechamento), ou 0
 * se não houver. Um bloco `---` … `---` que não seja esse front matter não conta (`ehFrontMatterDePpc`).
 */
export function linhasFrontMatter(texto: string): number {
  if (!texto.startsWith("---\n")) return 0;
  const fim = texto.indexOf("\n---", 3);
  if (fim === -1) return 0;
  if (!ehFrontMatterDePpc(texto.slice(4, fim + 1))) return 0;
  const depois = texto.indexOf("\n", fim + 4);
  const bloco = depois === -1 ? texto : texto.slice(0, depois);
  return bloco.split("\n").length;
}

/** Proveniência e corpo de um PPC; erro se o front matter faltar ou sair do contrato. */
export function analisarPpc(texto: string, rotulo: string): { proveniencia: ProvenienciaPpc; corpo: string } {
  const { meta, corpo } = analisarFrontMatter(texto, rotulo);
  const resultado = esquemaProvenienciaPpc.safeParse(meta);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((p) => `${p.path.length ? `${p.path.join(".")}: ` : ""}${p.message}`);
    throw new ErroFrontMatter(`${rotulo}: front matter de PPC inválido: ${problemas.join("; ")}`);
  }
  return { proveniencia: resultado.data, corpo };
}

/** Texto sem o front matter (o corpo começa na linha seguinte ao `---` de fechamento). */
export function corpoPpc(texto: string): string {
  const linhas = linhasFrontMatter(texto);
  if (!linhas) return texto;
  return texto.split("\n").slice(linhas).join("\n");
}

/**
 * Texto com as linhas do front matter em branco: os números de linha continuam os do arquivo, e o
 * YAML (URL, nota) não entra em buscas e extrações de citação.
 */
export function mascararFrontMatter(texto: string): string {
  const linhas = linhasFrontMatter(texto);
  if (!linhas) return texto;
  const partes = texto.split("\n");
  for (let i = 0; i < linhas; i += 1) partes[i] = "";
  return partes.join("\n");
}

const RE_ESCALAR_SIMPLES = /^[\p{L}\p{N}][\p{L}\p{N}_.\/:@%?=&+-]*$/u;

function escalar(valor: string): string {
  // `failsafe` lê tudo como texto; aspas só quando o YAML simples poderia mudar o valor.
  return RE_ESCALAR_SIMPLES.test(valor) && !valor.includes(": ") ? valor : JSON.stringify(valor);
}

/** Front matter em YAML, na ordem de `CAMPOS_PROVENIENCIA`, terminado em `---\n`. */
export function serializarFrontMatterPpc(proveniencia: ProvenienciaPpc): string {
  const valido = esquemaProvenienciaPpc.parse(proveniencia);
  const linhas = ["---"];
  for (const campo of CAMPOS_PROVENIENCIA) {
    const valor = valido[campo];
    if (valor === undefined) continue;
    if (Array.isArray(valor)) {
      linhas.push(`${campo}:`);
      for (const item of valor) linhas.push(`  - ${escalar(item)}`);
    } else {
      linhas.push(`${campo}: ${escalar(valor)}`);
    }
  }
  linhas.push("---");
  return `${linhas.join("\n")}\n`;
}
