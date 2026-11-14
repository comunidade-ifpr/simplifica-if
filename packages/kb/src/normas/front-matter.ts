/**
 * Front matter das normas: YAML lido com o pacote `yaml` no schema `failsafe` (todo escalar é
 * texto) e contratos Effect Schema.
 *
 * O `failsafe` mantém `numero: 9394` como texto, como no parser antigo; só `ano` é convertido em
 * inteiro, pela coerção de `esquemaValoresFrontMatter` (inclusive com dígitos Unicode, como o
 * `int()` do Python que gerou os manifestos). Assim o `manifest.json` não muda de tipo.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { parse, YAMLParseError } from "yaml";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import { ehIdNorma, idDoAto, VARIANTES, varianteDoId } from "./ids.ts";

export type ValorFrontMatter = string | number | string[];
export type FrontMatter = Record<string, ValorFrontMatter>;

/** Erro de front matter: o rótulo do arquivo e o problema; a mensagem é `<rotulo>: <detalhe>`. */
export class ErroFrontMatter extends Schema.TaggedError<ErroFrontMatter>()("ErroFrontMatter", {
  rotulo: Schema.String,
  detalhe: Schema.String,
}) {
  override get message(): string {
    return `${this.rotulo}: ${this.detalhe}`;
  }
}
export const ehErroFrontMatter = Schema.is(ErroFrontMatter);

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
export function anoDoTexto(valor: string): string | number {
  return RE_DIGITOS_UNICODE.test(valor) ? inteiroDecimal(valor) : valor;
}

/** `ano` só de dígitos vira inteiro; qualquer outro texto fica como está, para o validador acusar. */
export const esquemaAno = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Union([Schema.String, Schema.Number]),
    SchemaTransformation.transform({ decode: anoDoTexto, encode: String }),
  ),
);

const ehFrontMatter = (valor: unknown): valor is FrontMatter => typeof valor === "object" && valor !== null;

/** Estrutura aceita no front matter: campos de texto ou listas de texto, sem mapas aninhados. */
export const esquemaValoresFrontMatter = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
).pipe(
  Schema.decodeTo(
    Schema.declare(ehFrontMatter),
    SchemaTransformation.transform({
      decode: (meta): FrontMatter => {
        const saida: FrontMatter = Object.create(null);
        for (const [campo, valor] of Object.entries(meta)) {
          saida[campo] = typeof valor === "string" ? (campo === "ano" ? anoDoTexto(valor) : valor) : [...valor];
        }
        return saida;
      },
      encode: (meta) => {
        const saida: Record<string, string | ReadonlyArray<string>> = {};
        for (const [campo, valor] of Object.entries(meta))
          saida[campo] = typeof valor === "number" ? String(valor) : valor;
        return saida;
      },
    }),
  ),
);
const decodificarValoresFrontMatter = Schema.decodeUnknownResult(esquemaValoresFrontMatter);

/** Texto que satisfaz `predicado`, com a mensagem dada quando não satisfaz. */
const textoQue = (predicado: (valor: string) => boolean, mensagem: string) =>
  Schema.String.check(Schema.makeFilter((valor: string) => predicado(valor), { message: mensagem }));
const texto = Schema.String.check(Schema.isMinLength(1));
const listaTexto = Schema.Array(Schema.String);
const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Data ISO ou "a confirmar" (dado que a base ainda não prova; nunca inventar). */
const dataOuAConfirmar = Schema.Union([
  Schema.String.check(Schema.isPattern(RE_DATA_ISO)),
  Schema.Literal("a confirmar"),
]);

/**
 * Contrato semântico do front matter de uma norma da base (depois da coerção). Os campos
 * obrigatórios e as relações são conferidos com mensagens próprias em `validar_base.ts`; aqui ficam
 * as regras de formato do `id`, da `variante` e dos tipos. Campos fora da lista ficam na saída.
 */
export const esquemaNorma = Schema.StructWithRest(
  Schema.Struct({
    id: textoQue(ehIdNorma, "id fora do formato canônico"),
    variante: Schema.optionalKey(Schema.Literals(VARIANTES)),
    title: texto,
    tipo_documento: texto,
    numero: texto,
    ano: Schema.Int,
    data_publicacao: Schema.String.check(
      Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "data_publicacao deve ser AAAA-MM-DD" }),
    ),
    orgao: texto,
    jurisdicao: texto,
    ementa: texto,
    status_vigencia: texto,
    keywords: listaTexto.check(Schema.isMinLength(1)),
    aliases: Schema.optionalKey(listaTexto),
    fonte: Schema.optionalKey(Schema.String),
    /** Data do ato (assinatura). */
    assinada_em: Schema.String.check(Schema.isPattern(RE_DATA_ISO, { message: "assinada_em deve ser AAAA-MM-DD" })),
    /** Publicação oficial (DOU, Boletim de Serviço) ou "a confirmar". */
    publicada_em: dataOuAConfirmar,
    /** Início dos efeitos (vigência) ou "a confirmar". */
    vigente_de: dataOuAConfirmar,
    /** De onde vieram as datas (dispositivo, nota de publicação, fonte oficial). */
    datas_fonte: texto,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
).check(
  Schema.makeFilter((norma) => {
    const achados: Schema.FilterIssue[] = [];
    const variante = varianteDoId(norma.id);
    if ((norma.variante ?? null) !== variante) {
      achados.push({
        path: ["variante"],
        issue: `variante (${norma.variante ?? "ausente"}) não corresponde ao sufixo do id (${variante ?? "sem sufixo"})`,
      });
    }
    if (variante !== null && idDoAto(norma.id) === norma.id) {
      achados.push({ path: ["id"], issue: "id de variante sem o ID do ato" });
    }
    if (RE_DATA_ISO.test(norma.publicada_em) && norma.publicada_em < norma.assinada_em) {
      achados.push({ path: ["publicada_em"], issue: "publicada_em anterior a assinada_em" });
    }
    if (RE_DATA_ISO.test(norma.vigente_de) && norma.vigente_de < norma.assinada_em) {
      achados.push({ path: ["vigente_de"], issue: "vigente_de anterior a assinada_em" });
    }
    return achados;
  }),
);
export type Norma = typeof esquemaNorma.Type;

/** Separa front matter e corpo de um texto Markdown. `rotulo` prefixa as mensagens de erro. */
export function analisarFrontMatter(texto: string, rotulo: string): { meta: FrontMatter; corpo: string } {
  if (!texto.startsWith("---\n")) throw new ErroFrontMatter({ rotulo, detalhe: "arquivo sem front matter" });
  const fim = texto.indexOf("\n---", 4);
  if (fim === -1) throw new ErroFrontMatter({ rotulo, detalhe: "front matter sem fechamento" });

  let bruto: unknown;
  try {
    bruto = parse(texto.slice(4, fim + 1), { schema: "failsafe", uniqueKeys: true, prettyErrors: false });
  } catch (erro) {
    if (erro instanceof YAMLParseError) {
      throw new ErroFrontMatter({
        rotulo,
        detalhe: `YAML inválido no front matter: ${erro.message.split("\n")[0]}`,
      });
    }
    throw erro;
  }
  if (bruto === null || bruto === undefined) bruto = {};
  const resultado = decodificarValoresFrontMatter(bruto);
  if (Result.isFailure(resultado)) {
    const problema = problemas(resultado.failure.issue)[0]!;
    const campo = problema.caminho.length ? `campo ${caminhoTexto(problema.caminho)}: ` : "";
    throw new ErroFrontMatter({
      rotulo,
      detalhe: `front matter deve ter só texto ou listas de texto: ${campo}${problema.mensagem}`,
    });
  }

  const inicioCorpo = texto.indexOf("\n", fim + 4);
  return { meta: resultado.success, corpo: inicioCorpo !== -1 ? texto.slice(inicioCorpo + 1) : "" };
}
