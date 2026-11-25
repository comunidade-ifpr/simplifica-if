/**
 * Front matter das normas: YAML lido com o pacote `yaml` no schema `failsafe` (todo escalar é
 * texto) e contratos Effect Schema.
 *
 * O `failsafe` mantém `numero: 9394` como texto; só `ano` é convertido em inteiro, pela coerção de
 * `esquemaValoresFrontMatter` (inclusive com dígitos Unicode).
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { parse, YAMLParseError } from "yaml";
import { caminhoTexto, problemas } from "../esquema/mensagens.ts";
import { UrlOficial } from "./fonte.ts";
import { ehIdNorma } from "./ids.ts";

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
 * Inteiro de um texto de dígitos decimais Unicode (ex.: `２０１２`). Os dígitos `Nd` vêm
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
/** Lista de itens de texto: pelo menos um, nenhum vazio. */
const listaItens = Schema.Array(texto).check(Schema.isMinLength(1));

/** Uma lista de textos do front matter lido (`pontos_chave`, `notas_da_fonte`); vazia se o campo não é lista. */
export function listaDeTextos(meta: Readonly<Record<string, unknown>> | null, campo: string): string[] {
  const valor = meta?.[campo];
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string") : [];
}
const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataIso = Schema.String.check(Schema.isPattern(RE_DATA_ISO));
/** Data ISO, "a confirmar" (dado que a base ainda não prova; nunca inventar) ou "aguardando publicação". */
const dataDaPublicacao = Schema.Union([dataIso, Schema.Literals(["a confirmar", "aguardando publicação"])]);
/**
 * Data ISO ou "aguardando publicação" (ato assinado e ainda não publicado, que não está em vigor): a
 * vigência é calculada, nunca presumida, e a norma sem ela não entra na base.
 */
const dataDaVigencia = Schema.Union([dataIso, Schema.Literal("aguardando publicação")]);

/**
 * Contrato do front matter de uma norma da base (depois da coerção): campos obrigatórios, formato
 * do `id`, tipos, datas e fonte oficial. O `validar_base.ts` acusa todos os erros dele, e a
 * compilação do banco recusa a norma fora dele. Campos fora da lista (os gerados, por exemplo)
 * ficam na saída.
 */
export const esquemaNorma = Schema.StructWithRest(
  Schema.Struct({
    id: textoQue(ehIdNorma, "id fora do formato canônico"),
    title: texto,
    tipo_documento: texto,
    numero: texto,
    ano: Schema.Int,
    orgao: texto,
    jurisdicao: texto,
    ementa: texto,
    status_vigencia: texto,
    keywords: listaTexto.check(Schema.isMinLength(1)),
    aliases: Schema.optionalKey(listaTexto),
    /** Endereço público do texto oficial. Toda norma tem este campo, `fonte_referencia` ou os dois. */
    fonte_url: Schema.optionalKey(UrlOficial),
    /** Referência da fonte sem link (número do SEI, Boletim de Serviço, PDF assinado). */
    fonte_referencia: Schema.optionalKey(texto),
    /** Data do ato (assinatura). */
    assinada_em: Schema.String.check(Schema.isPattern(RE_DATA_ISO, { message: "assinada_em deve ser AAAA-MM-DD" })),
    /** Publicação oficial (DOU, Boletim de Serviço), "a confirmar" ou "aguardando publicação". */
    publicada_em: dataDaPublicacao,
    /** Início dos efeitos (vigência) ou "aguardando publicação". */
    vigente_de: dataDaVigencia,
    /** De onde vieram as datas (dispositivo, nota de publicação, fonte oficial). */
    datas_fonte: texto,
    /**
     * Metadados editoriais: o corpo do arquivo é só o texto da norma, e o que a curadoria escreve
     * sobre ela fica aqui, cada campo com a sua função. Nenhum deles é fundamento: quem cita, cita
     * o dispositivo. Orientação para PPC não entra aqui: o lugar dela é a ficha da revisão de PPC
     * (`base-conhecimento/revisao-ppc/fichas/`).
     */
    /** O que a norma dispõe, em pontos, cada um com o dispositivo que o sustenta: "(art. 29)". */
    pontos_chave: Schema.optionalKey(listaItens),
    /** Como o texto foi obtido e consolidado (fonte, republicação, o que ficou de fora e por quê). */
    notas_da_fonte: Schema.optionalKey(listaItens),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
).check(
  Schema.makeFilter((norma) => {
    const achados: Schema.FilterIssue[] = [];
    // `data_publicacao` guardava a data do ato com nome de publicação: as datas são as três abaixo
    if ("data_publicacao" in norma) {
      achados.push({
        path: ["data_publicacao"],
        issue: "campo extinto: a data do ato é assinada_em, a publicação é publicada_em",
      });
    }
    if (!norma.assinada_em.startsWith(String(norma.ano))) {
      achados.push({ path: ["assinada_em"], issue: `assinada_em fora do ano da norma (${norma.ano})` });
    }
    if (norma.fonte_url === undefined && norma.fonte_referencia === undefined) {
      achados.push({ path: ["fonte_url"], issue: "norma sem fonte oficial: fonte_url ou fonte_referencia" });
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

const decodificarNorma = Schema.decodeUnknownResult(esquemaNorma, { errors: "all" });

/** O front matter `meta` decodificado por `esquemaNorma`; fora do contrato, lança `ErroFrontMatter` com todos os problemas. */
export function normaDoFrontMatter(meta: FrontMatter, rotulo: string): Norma {
  const resultado = decodificarNorma(meta);
  if (Result.isSuccess(resultado)) return resultado.success;
  const detalhe = problemas(resultado.failure.issue)
    .map((problema) => `${caminhoTexto(problema.caminho)}: ${problema.mensagem}`)
    .join("; ");
  throw new ErroFrontMatter({ rotulo, detalhe: `front matter fora do contrato da norma: ${detalhe}` });
}

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
