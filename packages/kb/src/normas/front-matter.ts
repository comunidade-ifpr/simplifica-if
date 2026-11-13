/**
 * Front matter das normas: YAML lido com o pacote `yaml` no schema `failsafe` (todo escalar é
 * texto) e contratos zod.
 *
 * O `failsafe` mantém `numero: 9394` como texto, como no parser antigo; só `ano` é convertido em
 * inteiro, pela coerção de `esquemaValoresFrontMatter` (inclusive com dígitos Unicode, como o
 * `int()` do Python que gerou os manifestos). Assim o `manifest.json` não muda de tipo.
 */
import { parse, YAMLParseError } from "yaml";
import { z } from "zod";
import { ehIdNorma, idDoAto, VARIANTES, varianteDoId } from "./ids.ts";

export type ValorFrontMatter = string | number | string[];
export type FrontMatter = Record<string, ValorFrontMatter>;

/** Erro de front matter (mensagem já prefixada com o rótulo do arquivo). */
export class ErroFrontMatter extends Error {}

const RE_DIGITOS_UNICODE = /^\p{Nd}+$/u;
const RE_DIGITO = /\p{Nd}/u;

/**
 * `int(valor)` para dígitos decimais Unicode (ex.: `２０１２`), como no Python. Os dígitos `Nd` vêm
 * em blocos contíguos de 0 a 9, então o valor de cada um é a posição dentro do seu bloco.
 */
export function inteiroDecimal(valor: string): number {
  let total = 0;
  for (const caractere of valor) {
    let codigo = caractere.codePointAt(0)!;
    let posicao = 0;
    while (RE_DIGITO.test(String.fromCodePoint(codigo - 1))) {
      codigo -= 1;
      posicao += 1;
    }
    total = total * 10 + (posicao % 10);
  }
  return total;
}

/** `ano` só de dígitos vira inteiro; qualquer outro texto fica como está, para o validador acusar. */
export const esquemaAno = z
  .string()
  .transform((valor): string | number => (RE_DIGITOS_UNICODE.test(valor) ? inteiroDecimal(valor) : valor));

/** Estrutura aceita no front matter: campos de texto ou listas de texto, sem mapas aninhados. */
export const esquemaValoresFrontMatter = z
  .record(z.string(), z.union([z.string(), z.array(z.string())]))
  .transform((meta): FrontMatter => {
    const saida: FrontMatter = Object.create(null);
    for (const [campo, valor] of Object.entries(meta)) {
      saida[campo] = campo === "ano" && typeof valor === "string" ? esquemaAno.parse(valor) : valor;
    }
    return saida;
  });

const texto = z.string().min(1);
const listaTexto = z.array(z.string());

/**
 * Contrato semântico do front matter de uma norma da base (depois da coerção). Os campos
 * obrigatórios e as relações são conferidos com mensagens próprias em `validar_base.ts`; aqui ficam
 * as regras de formato do `id`, da `variante` e dos tipos.
 */
export const esquemaNorma = z
  .looseObject({
    id: z.string().refine(ehIdNorma, { message: "id fora do formato canônico" }),
    variante: z.enum(VARIANTES).optional(),
    title: texto,
    tipo_documento: texto,
    numero: texto,
    ano: z.number().int(),
    data_publicacao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data_publicacao deve ser AAAA-MM-DD"),
    orgao: texto,
    jurisdicao: texto,
    ementa: texto,
    status_vigencia: texto,
    keywords: listaTexto.min(1),
    aliases: listaTexto.optional(),
    fonte: z.string().optional(),
  })
  .superRefine((norma, ctx) => {
    const variante = varianteDoId(norma.id);
    if ((norma.variante ?? null) !== variante) {
      ctx.addIssue({
        code: "custom",
        path: ["variante"],
        message: `variante (${norma.variante ?? "ausente"}) não corresponde ao sufixo do id (${variante ?? "sem sufixo"})`,
      });
    }
    if (variante !== null && idDoAto(norma.id) === norma.id) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "id de variante sem o ID do ato" });
    }
  });
export type Norma = z.output<typeof esquemaNorma>;

/** Separa front matter e corpo de um texto Markdown. `rotulo` prefixa as mensagens de erro. */
export function analisarFrontMatter(texto: string, rotulo: string): { meta: FrontMatter; corpo: string } {
  if (!texto.startsWith("---\n")) throw new ErroFrontMatter(`${rotulo}: arquivo sem front matter`);
  const fim = texto.indexOf("\n---", 4);
  if (fim === -1) throw new ErroFrontMatter(`${rotulo}: front matter sem fechamento`);

  let bruto: unknown;
  try {
    bruto = parse(texto.slice(4, fim + 1), { schema: "failsafe", uniqueKeys: true, prettyErrors: false });
  } catch (erro) {
    if (erro instanceof YAMLParseError) {
      throw new ErroFrontMatter(`${rotulo}: YAML inválido no front matter: ${erro.message.split("\n")[0]}`);
    }
    throw erro;
  }
  if (bruto === null || bruto === undefined) bruto = {};
  const resultado = esquemaValoresFrontMatter.safeParse(bruto);
  if (!resultado.success) {
    const problema = resultado.error.issues[0]!;
    const campo = problema.path.length ? `campo ${problema.path.join(".")}: ` : "";
    throw new ErroFrontMatter(
      `${rotulo}: front matter deve ter só texto ou listas de texto: ${campo}${problema.message}`,
    );
  }

  const inicioCorpo = texto.indexOf("\n", fim + 4);
  return { meta: resultado.data, corpo: inicioCorpo !== -1 ? texto.slice(inicioCorpo + 1) : "" };
}
