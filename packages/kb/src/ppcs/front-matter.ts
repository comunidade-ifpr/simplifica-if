/**
 * Front matter de proveniência dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/`).
 *
 * Todo PPC que entra na base fica nela, com ID permanente `ppc:<campus_id>/<curso_slug>/<versao>`
 * (`./ids.ts`); o PPC novo de um curso é versão nova, e o anterior fica. O front matter registra de onde
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
 * O ano do documento é obrigatório e vem com a evidência: `ano_documento` (AAAA), `ano_evidencia`
 * (o trecho literal que traz o ano) e `ano_fonte` (`texto` quando o trecho está no corpo do PPC, ou a
 * URL https da fonte, como `<fonte_url>#page=1`). A versão do ID começa pelo ano. PPC sem esses dados
 * não entra na base: fica em `curadoria/pendencias/ppcs/`, com o mesmo front matter sem `id`, sem os
 * campos que faltam e com a lista `pendencias` (`esquemaPpcPendente`).
 *
 * O YAML é lido pelo mesmo parser das normas (`yaml` em schema `failsafe`): todo valor é texto ou
 * lista de texto, sem mapa aninhado; por isso o arquivo convertido são dois campos. O índice
 * `ppcs/index.json` os publica juntos, como `arquivo_convertido: { tipo, sha256 }`.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import { parse } from "yaml";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import { RE_URL_HTTPS } from "../normas/fonte.ts";
import { analisarFrontMatter, ErroFrontMatter } from "../normas/front-matter.ts";
import { RE_SLUG_PPC, RE_VERSAO_PPC } from "./ids.ts";

export { ErroFrontMatter };
export { idPpc } from "./ids.ts";

export const DESCONHECIDO = "desconhecido";
const RE_ID_PPC = new RegExp(`^ppc:${RE_SLUG_PPC}/${RE_SLUG_PPC}/${RE_VERSAO_PPC}$`);
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_COMMIT = /^[0-9a-f]{40}$/;
const RE_ANO = /^[0-9]{4}$/;

/** `ano_fonte` quando a evidência está no corpo do PPC. */
export const FONTE_TEXTO = "texto";

/** Campos do ano do documento, obrigatórios na base. Na pendência, faltar algum é a pendência `ano`. */
export const CAMPOS_ANO = ["ano_documento", "ano_evidencia", "ano_fonte"] as const;

/** Grupos de campos obrigatórios que uma pendência pode deixar em aberto (`<grupo>: <motivo>`). */
export const GRUPOS_PENDENTES = { ano: CAMPOS_ANO } as const;
export type GrupoPendente = keyof typeof GRUPOS_PENDENTES;

/** Ordem dos campos no arquivo (e na serialização). */
const CAMPOS_PROVENIENCIA = [
  "id",
  ...CAMPOS_ANO,
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
  "pendencias",
] as const;

const padrao = (re: RegExp, mensagem: string) => Schema.String.check(Schema.isPattern(re, { message: mensagem }));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));

const campoAno = padrao(RE_ANO, "ano_documento deve ser AAAA");
const campoFonteAno = Schema.Union([
  Schema.Literal(FONTE_TEXTO),
  padrao(RE_URL_HTTPS, "ano_fonte deve ser texto ou URL https"),
]);

const camposComuns = {
  fonte_url: padrao(RE_URL_HTTPS, "fonte_url deve ser URL https"),
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
};

type MetaComum = {
  readonly arquivo_convertido?: string | undefined;
  readonly arquivo_convertido_sha256?: string | undefined;
  readonly proveniencia: "registrada" | "reconstruida";
  readonly fonte_sha256: string;
  readonly conversor: string;
  readonly nota_proveniencia?: string | undefined;
};

function achadosProveniencia(meta: MetaComum): Schema.FilterIssue[] {
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
}

function achadosAno(meta: {
  readonly ano_documento?: string | undefined;
  readonly ano_evidencia?: string | undefined;
}) {
  const achados: Schema.FilterIssue[] = [];
  if (meta.ano_documento && meta.ano_evidencia !== undefined && !meta.ano_evidencia.includes(meta.ano_documento)) {
    achados.push({ path: ["ano_evidencia"], issue: `ano_evidencia deve conter o ano ${meta.ano_documento}` });
  }
  return achados;
}

/** Contrato do front matter de um PPC da base (decodificado sem chaves extras). */
export const esquemaProvenienciaPpc = Schema.Struct({
  id: padrao(RE_ID_PPC, "id deve ser ppc:<campus_id>/<curso_slug>/<versao>"),
  ano_documento: campoAno,
  ano_evidencia: textoNaoVazio,
  ano_fonte: campoFonteAno,
  ...camposComuns,
}).check(
  Schema.makeFilter((meta) => {
    const achados = [...achadosProveniencia(meta), ...achadosAno(meta)];
    const versao = meta.id.split("/").at(-1) ?? "";
    if (!versao.startsWith(meta.ano_documento)) {
      achados.push({
        path: ["id"],
        issue: `a versão do id (${versao}) deve começar pelo ano_documento ${meta.ano_documento}`,
      });
    }
    return achados;
  }),
);
export type ProvenienciaPpc = typeof esquemaProvenienciaPpc.Type;

/** Grupo de uma pendência (`ano: o PDF não traz data`) e se o motivo foi escrito. */
export function grupoDaPendencia(pendencia: string): string {
  return pendencia.split(":", 1)[0]!.trim();
}

/** Grupos de campos obrigatórios incompletos no front matter. */
export function gruposIncompletos(meta: Readonly<Record<string, unknown>>): GrupoPendente[] {
  return (Object.keys(GRUPOS_PENDENTES) as GrupoPendente[]).filter((grupo) =>
    GRUPOS_PENDENTES[grupo].some((campo) => meta[campo] === undefined),
  );
}

/**
 * Contrato do front matter de um PPC pendente (fora da base, em `curadoria/pendencias/ppcs/`): sem
 * `id`, com os campos obrigatórios que faltam ausentes e uma pendência `<grupo>: <motivo>` para cada
 * grupo incompleto, e nenhuma para grupo completo.
 */
export const esquemaPpcPendente = Schema.Struct({
  ano_documento: Schema.optionalKey(campoAno),
  ano_evidencia: Schema.optionalKey(textoNaoVazio),
  ano_fonte: Schema.optionalKey(campoFonteAno),
  ...camposComuns,
  pendencias: Schema.Array(textoNaoVazio).check(Schema.isMinLength(1)),
}).check(
  Schema.makeFilter((meta) => {
    const achados = [...achadosProveniencia(meta), ...achadosAno(meta)];
    const incompletos = new Set<string>(gruposIncompletos(meta));
    const declarados = new Set<string>();
    for (const pendencia of meta.pendencias) {
      const grupo = grupoDaPendencia(pendencia);
      const motivo = pendencia.slice(pendencia.indexOf(":") + 1).trim();
      if (!pendencia.includes(":") || !motivo) {
        achados.push({ path: ["pendencias"], issue: `pendência deve ser "<campo>: <motivo>": ${pendencia}` });
      } else if (!(grupo in GRUPOS_PENDENTES)) {
        achados.push({
          path: ["pendencias"],
          issue: `pendência de campo desconhecido "${grupo}" (use ${Object.keys(GRUPOS_PENDENTES).join(", ")})`,
        });
      } else if (!incompletos.has(grupo)) {
        achados.push({ path: ["pendencias"], issue: `pendência "${grupo}" com os campos já preenchidos` });
      }
      declarados.add(grupo);
    }
    for (const grupo of incompletos) {
      if (!declarados.has(grupo)) {
        achados.push({
          path: ["pendencias"],
          issue: `falta a pendência "${grupo}" (campos ${GRUPOS_PENDENTES[grupo as GrupoPendente].join(", ")})`,
        });
      }
    }
    return achados;
  }),
);
export type PpcPendente = typeof esquemaPpcPendente.Type;

const opcoesProveniencia = { onExcessProperty: "error", errors: "all" } as const;
const decodificarProveniencia = Schema.decodeUnknownResult(esquemaProvenienciaPpc, opcoesProveniencia);
const validarProveniencia = Schema.decodeUnknownSync(esquemaProvenienciaPpc, opcoesProveniencia);
const decodificarPendente = Schema.decodeUnknownResult(esquemaPpcPendente, opcoesProveniencia);
const validarPendente = Schema.decodeUnknownSync(esquemaPpcPendente, opcoesProveniencia);

const CAMPOS_CONHECIDOS = new Set<string>(CAMPOS_PROVENIENCIA);

/**
 * Se o YAML entre os `---` é o front matter de PPC: um mapa só com campos de `CAMPOS_PROVENIENCIA`,
 * com `fonte_url` e `id` (PPC da base) ou `pendencias` (PPC pendente). Um Markdown que abre com régua
 * horizontal (`---`) ou com outro YAML não tem esse bloco, e o texto entre as réguas é do documento.
 */
function ehFrontMatterDePpc(yaml: string): boolean {
  const chaves = chavesDoMapaYaml(yaml);
  if (!chaves) return false;
  return (
    (chaves.includes("id") || chaves.includes("pendencias")) &&
    chaves.includes("fonte_url") &&
    chaves.every((chave) => CAMPOS_CONHECIDOS.has(chave))
  );
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

function falhaDoFrontMatter(rotulo: string, issue: SchemaIssue.Issue, tipo: string): ErroFrontMatter {
  const linhas = problemas(issue).map((p) => `${p.caminho.length ? `${caminhoTexto(p.caminho)}: ` : ""}${p.mensagem}`);
  return new ErroFrontMatter({ rotulo, detalhe: `front matter de ${tipo} inválido: ${linhas.join("; ")}` });
}

/** Proveniência e corpo de um PPC da base; erro se o front matter faltar ou sair do contrato. */
export function analisarPpc(texto: string, rotulo: string): { proveniencia: ProvenienciaPpc; corpo: string } {
  const { meta, corpo } = analisarFrontMatter(texto, rotulo);
  const resultado = decodificarProveniencia(meta);
  if (Result.isFailure(resultado)) throw falhaDoFrontMatter(rotulo, resultado.failure.issue, "PPC");
  return { proveniencia: resultado.success, corpo };
}

/** Front matter e corpo de um PPC pendente; erro se o front matter faltar ou sair do contrato. */
export function analisarPpcPendente(texto: string, rotulo: string): { pendente: PpcPendente; corpo: string } {
  const { meta, corpo } = analisarFrontMatter(texto, rotulo);
  const resultado = decodificarPendente(meta);
  if (Result.isFailure(resultado)) throw falhaDoFrontMatter(rotulo, resultado.failure.issue, "PPC pendente");
  return { pendente: resultado.success, corpo };
}

/**
 * O texto para comparar a evidência do ano: sem a marcação de título e de negrito (a limpeza do
 * Markdown convertido a muda, e ela não é texto do documento) e com espaços simples.
 */
const juntarEspacos = (texto: string) =>
  texto
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Se a evidência do ano confere com o corpo: com `ano_fonte: texto`, `ano_evidencia` aparece no corpo
 * (com os espaços e quebras de linha juntados). `null` se confere; senão, o motivo.
 */
export function conferirEvidenciaAno(
  meta: { readonly ano_evidencia?: string | undefined; readonly ano_fonte?: string | undefined },
  corpo: string,
): string | null {
  if (meta.ano_fonte !== FONTE_TEXTO || meta.ano_evidencia === undefined) return null;
  return juntarEspacos(corpo).includes(juntarEspacos(meta.ano_evidencia))
    ? null
    : `ano_evidencia não aparece no texto do PPC (ano_fonte: texto): "${meta.ano_evidencia}"`;
}

/**
 * Linha (1-based, no arquivo inteiro) onde começa a evidência do ano: com `ano_fonte: texto`, a do
 * trecho no corpo; senão, ou se o trecho não for achado, a da chave `ano_evidencia` no front matter.
 */
export function linhaDaEvidenciaAno(texto: string, evidencia: string, fonte: string): number {
  const linhas = texto.split("\n");
  const doFrontMatter = Math.max(1, linhas.findIndex((linha) => linha.startsWith("ano_evidencia:")) + 1);
  if (fonte !== FONTE_TEXTO) return doFrontMatter;
  const alvo = juntarEspacos(evidencia);
  const inicio = linhasFrontMatter(texto);
  // Texto juntado do corpo, com o deslocamento em que cada linha começa nele.
  let juntado = "";
  const inicios: number[] = [];
  for (let i = inicio; i < linhas.length; i += 1) {
    const linha = juntarEspacos(linhas[i]!);
    if (!linha) continue;
    if (juntado) juntado += " ";
    inicios.push(juntado.length, i);
    juntado += linha;
  }
  const posicao = juntado.indexOf(alvo);
  if (posicao === -1) return doFrontMatter;
  let linhaAchada = inicio;
  for (let k = 0; k < inicios.length; k += 2) {
    if (inicios[k]! > posicao) break;
    linhaAchada = inicios[k + 1]!;
  }
  return linhaAchada + 1;
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

function serializar(valido: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>): string {
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

/** Front matter em YAML, na ordem de `CAMPOS_PROVENIENCIA`, terminado em `---\n`. */
export function serializarFrontMatterPpc(proveniencia: ProvenienciaPpc): string {
  return serializar(validarProveniencia(proveniencia));
}

/** Front matter de PPC pendente, na mesma ordem. */
export function serializarFrontMatterPendente(pendente: PpcPendente): string {
  return serializar(validarPendente(pendente));
}
