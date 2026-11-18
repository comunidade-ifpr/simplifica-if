/**
 * Front matter de proveniência dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/`).
 *
 * A base guarda só o PPC vigente de cada curso; versões anteriores ficam no histórico do git. Por
 * isso o ID do PPC é `ppc:<campus_id>/<curso_slug>`, sem versão. O front matter registra de onde
 * veio o texto: o endereço publicado (`fonte_url`), o hash SHA-256 dos bytes desse endereço
 * (`fonte_sha256`), o arquivo que de fato foi convertido (`arquivo_convertido` e
 * `arquivo_convertido_sha256`), a data e a versão do conversor.
 *
 * `fonte_sha256` só vale para os bytes de `fonte_url`: quem baixa a URL e calcula o hash deve achar o
 * mesmo valor. Quando o texto vem de outro arquivo (o DOCX que a coordenação envia, com `fonte_url`
 * apontando para o PDF publicado), `fonte_sha256` fica `desconhecido` e o hash do arquivo convertido
 * vai em `arquivo_convertido_sha256`.
 *
 * - `proveniencia: registrada`: gravada no momento da conversão; o conversor e o hash do que foi
 *   convertido (`fonte_sha256` ou `arquivo_convertido_sha256`) são conhecidos.
 * - `proveniencia: reconstruida`: preenchida depois, a partir do histórico do git, para PPCs
 *   convertidos antes do front matter existir. O que não é verificável fica `desconhecido`, com o
 *   motivo em `nota_proveniencia`.
 *
 * O YAML é lido pelo mesmo parser das normas (`yaml` em schema `failsafe`): todo valor é texto ou
 * lista de texto, sem mapa aninhado; por isso o arquivo convertido são dois campos. O índice
 * `ppcs/index.json` os publica juntos, como `arquivo_convertido: { tipo, sha256 }`.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parse } from "yaml";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import { analisarFrontMatter, ErroFrontMatter } from "../normas/front-matter.ts";

export { ErroFrontMatter };

export const DESCONHECIDO = "desconhecido";
const RE_SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const RE_ID_PPC = new RegExp(`^ppc:${RE_SLUG}/${RE_SLUG}$`);
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_COMMIT = /^[0-9a-f]{40}$/;

/** Ordem dos campos no arquivo (e na serialização). */
const CAMPOS_PROVENIENCIA = [
  "id",
  "fonte_url",
  "fonte_sha256",
  "convertido_em",
  "conversor",
  "arquivo_convertido",
  "arquivo_convertido_sha256",
  "proveniencia",
  "conversao_commit",
  "pos_processamento_commits",
  "nota_proveniencia",
] as const;

const padrao = (re: RegExp, mensagem: string) => Schema.String.check(Schema.isPattern(re, { message: mensagem }));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));

/** Contrato do front matter de proveniência (decodificado sem chaves extras). */
export const esquemaProvenienciaPpc = Schema.Struct({
  id: padrao(RE_ID_PPC, "id deve ser ppc:<campus_id>/<curso_slug>"),
  fonte_url: padrao(/^https:\/\/\S+$/, "fonte_url deve ser URL https"),
  fonte_sha256: Schema.Union([
    padrao(RE_SHA256, "fonte_sha256 deve ter 64 hexadecimais"),
    Schema.Literal(DESCONHECIDO),
  ]),
  convertido_em: padrao(/^\d{4}-\d{2}-\d{2}$/, "convertido_em deve ser AAAA-MM-DD"),
  conversor: textoNaoVazio,
  /** Tipo do arquivo convertido quando ele não é o de `fonte_url` (o DOCX da coordenação do curso). */
  arquivo_convertido: Schema.optionalKey(Schema.Literal("docx")),
  /** SHA-256 dos bytes desse arquivo. */
  arquivo_convertido_sha256: Schema.optionalKey(
    padrao(RE_SHA256, "arquivo_convertido_sha256 deve ter 64 hexadecimais"),
  ),
  proveniencia: Schema.Literals(["registrada", "reconstruida"]),
  /** Commit em que o texto convertido entrou no git (só na proveniência reconstruída). */
  conversao_commit: Schema.optionalKey(padrao(RE_COMMIT, "conversao_commit deve ter 40 hexadecimais")),
  /** Commits que alteraram o texto depois da conversão (limpeza de ruído, remoção de sumário). */
  pos_processamento_commits: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isPattern(RE_COMMIT))).check(Schema.isMinLength(1)),
  ),
  nota_proveniencia: Schema.optionalKey(textoNaoVazio),
}).check(
  Schema.makeFilter((meta) => {
    const achados: Schema.FilterIssue[] = [];
    if ((meta.arquivo_convertido === undefined) !== (meta.arquivo_convertido_sha256 === undefined)) {
      achados.push({
        path: ["arquivo_convertido"],
        issue: "arquivo_convertido e arquivo_convertido_sha256 vêm juntos",
      });
    }
    if (meta.proveniencia === "registrada") {
      if (meta.fonte_sha256 === DESCONHECIDO && !meta.arquivo_convertido_sha256) {
        achados.push({
          path: ["fonte_sha256"],
          issue: "proveniência registrada exige o hash (fonte_sha256 ou arquivo_convertido_sha256)",
        });
      }
      if (meta.conversor === DESCONHECIDO) {
        achados.push({ path: ["conversor"], issue: "proveniência registrada exige o conversor" });
      }
    } else if (!meta.nota_proveniencia) {
      achados.push({ path: ["nota_proveniencia"], issue: "proveniência reconstruída exige nota_proveniencia" });
    }
    return achados;
  }),
);
export type ProvenienciaPpc = typeof esquemaProvenienciaPpc.Type;
const opcoesProveniencia = { onExcessProperty: "error", errors: "all" } as const;
const decodificarProveniencia = Schema.decodeUnknownResult(esquemaProvenienciaPpc, opcoesProveniencia);
const validarProveniencia = Schema.decodeUnknownSync(esquemaProvenienciaPpc, opcoesProveniencia);

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
  const resultado = decodificarProveniencia(meta);
  if (Result.isFailure(resultado)) {
    const linhas = problemas(resultado.failure.issue).map(
      (p) => `${p.caminho.length ? `${caminhoTexto(p.caminho)}: ` : ""}${p.mensagem}`,
    );
    throw new ErroFrontMatter({ rotulo, detalhe: `front matter de PPC inválido: ${linhas.join("; ")}` });
  }
  return { proveniencia: resultado.success, corpo };
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

const RE_ESCALAR_SIMPLES = /^[\p{L}\p{N}][\p{L}\p{N}_./:@%?=&+-]*$/u;

function escalar(valor: string): string {
  // `failsafe` lê tudo como texto; aspas só quando o YAML simples poderia mudar o valor.
  return RE_ESCALAR_SIMPLES.test(valor) && !valor.includes(": ") ? valor : JSON.stringify(valor);
}

/** Front matter em YAML, na ordem de `CAMPOS_PROVENIENCIA`, terminado em `---\n`. */
export function serializarFrontMatterPpc(proveniencia: ProvenienciaPpc): string {
  const valido = validarProveniencia(proveniencia);
  const linhas = ["---"];
  for (const campo of CAMPOS_PROVENIENCIA) {
    const valor = valido[campo];
    if (valor === undefined) continue;
    if (typeof valor === "string") {
      linhas.push(`${campo}: ${escalar(valor)}`);
    } else {
      linhas.push(`${campo}:`);
      for (const item of valor) linhas.push(`  - ${escalar(item)}`);
    }
  }
  linhas.push("---");
  return `${linhas.join("\n")}\n`;
}
