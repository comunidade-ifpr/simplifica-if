// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de manifest.json e stubs.yaml, usado pelos scripts e pela compilação do banco
/**
 * Registro de IDs conhecidos: normas da base (`manifest.json`), normas-stub e referências externas
 * (`normas/stubs.yaml`). É o universo contra o qual o resolvedor confere e completa citações.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { compararTexto } from "../texto.ts";
import { ehIdDispositivo, ehIdExterno, ehIdNorma, idDoAto, partesIdNorma } from "./ids.ts";

export type Situacao = "base" | "stub" | "externo";

export interface EntradaRegistro {
  id: string;
  title: string;
  situacao: Situacao;
  /** Data do ato (assinatura). Nos stubs, a `data_publicacao` registrada, tomada como data do ato. */
  assinada_em?: string | undefined;
  data_publicacao?: string | undefined;
  status_vigencia?: string | undefined;
  /** Stub com status provado na base: ID (com dispositivo) do ato que o determina. */
  status_fonte?: string | undefined;
  aliases: string[];
  /** Caminho do Markdown, relativo a `base-conhecimento/` (só normas da base). */
  path?: string | undefined;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_STUB = ["vigente", "alterada", "revogada", "parcialmente revogada", "a confirmar"] as const;

/** Texto que satisfaz `predicado`, com a mensagem dada quando não satisfaz. */
const textoQue = (predicado: (valor: string) => boolean, mensagem: string) =>
  Schema.String.check(Schema.makeFilter((valor: string) => predicado(valor), { message: mensagem }));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));
const CURADORIA = Schema.Literals(["rascunho", "conferido"]);

const esquemaStub = Schema.Struct({
  id: textoQue(ehIdNorma, "id de norma fora do formato canônico"),
  title: textoNaoVazio,
  data_publicacao: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(RE_DATA, { message: "data_publicacao deve ser AAAA-MM-DD" })),
  ),
  ementa: textoNaoVazio,
  status_vigencia: Schema.Literals(STATUS_STUB),
  status_fonte: Schema.optionalKey(
    textoQue((valor) => {
      const [norma, dispositivo] = valor.split("#");
      return ehIdNorma(norma!) && (dispositivo === undefined || ehIdDispositivo(`#${dispositivo}`));
    }, "status_fonte deve ser ID de norma com dispositivo opcional"),
  ),
  aliases: Schema.optionalKey(Schema.Array(textoNaoVazio)),
  fonte: Schema.optionalKey(Schema.String),
  observacoes: Schema.optionalKey(Schema.String),
  curadoria: CURADORIA,
});

const esquemaExterno = Schema.Struct({
  id: textoQue(ehIdExterno, "id externo fora do formato externo:<segmentos>"),
  title: textoNaoVazio,
  descricao: textoNaoVazio,
  aliases: Schema.optionalKey(Schema.Array(textoNaoVazio)),
  fonte: Schema.optionalKey(Schema.String),
  curadoria: CURADORIA,
});

/** Contrato de `base-conhecimento/normas/stubs.yaml` (decodificado sem chaves extras). */
export const esquemaRegistroStubs = Schema.Struct({
  normas: Schema.Array(esquemaStub),
  externos: Schema.Array(esquemaExterno),
}).check(
  Schema.makeFilter((registro) => {
    const problemas: Schema.FilterIssue[] = [];
    const vistos = new Set<string>();
    for (const [lista, itens] of [
      ["normas", registro.normas],
      ["externos", registro.externos],
    ] as const) {
      itens.forEach((item, indice) => {
        if (vistos.has(item.id)) problemas.push({ path: [lista, indice, "id"], issue: `id duplicado: ${item.id}` });
        vistos.add(item.id);
      });
    }
    registro.normas.forEach((stub, indice) => {
      if (stub.status_vigencia !== "a confirmar" && !stub.status_fonte) {
        problemas.push({
          path: ["normas", indice, "status_fonte"],
          issue: "status diferente de 'a confirmar' exige status_fonte",
        });
      }
      const partes = partesIdNorma(stub.id);
      if (partes?.variante) problemas.push({ path: ["normas", indice, "id"], issue: "stub não tem variante" });
      if (partes && stub.data_publicacao && !stub.data_publicacao.startsWith(String(partes.ano))) {
        problemas.push({
          path: ["normas", indice, "data_publicacao"],
          issue: `data_publicacao fora do ano do id (${partes.ano})`,
        });
      }
    });
    return problemas;
  }),
);
export type RegistroStubs = typeof esquemaRegistroStubs.Type;

const decodificarRegistroStubs = Schema.decodeUnknownSync(esquemaRegistroStubs, {
  onExcessProperty: "error",
  errors: "all",
});

/**
 * Valida o texto de `stubs.yaml` (YAML `failsafe`: todo escalar é texto). Fora do contrato, lança o
 * `Schema.SchemaError` (texto em português por `esquema/mensagens.ts`).
 */
export function registroStubsDoYaml(texto: string): RegistroStubs {
  return decodificarRegistroStubs(parse(texto, { schema: "failsafe", uniqueKeys: true }));
}

/** Lê e valida `stubs.yaml`. */
export function lerRegistroStubs(caminho: string): RegistroStubs {
  return registroStubsDoYaml(NodeFS.readFileSync(caminho, "utf-8"));
}

const esquemaItemManifest = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    data_publicacao: Schema.String,
    assinada_em: Schema.optionalKey(Schema.String),
    status_vigencia: Schema.String,
    aliases: Schema.optionalKey(Schema.Array(Schema.String)),
    path: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
const decodificarManifest = Schema.decodeUnknownSync(Schema.Array(esquemaItemManifest));

/** Universo de IDs conhecidos, com buscas usadas pelo resolvedor. */
export class Registro {
  readonly entradas: readonly EntradaRegistro[];
  private readonly porId = new Map<string, EntradaRegistro>();

  constructor(entradas: Iterable<EntradaRegistro>) {
    const lista = [...entradas].sort((a, b) => compararTexto(a.id, b.id));
    this.entradas = lista;
    for (const entrada of lista) if (!this.porId.has(entrada.id)) this.porId.set(entrada.id, entrada);
  }

  /** Entrada do ID (a variante de arquivo cai no ato: `~compilacao` → ato). */
  obter(id: string): EntradaRegistro | undefined {
    return this.porId.get(id) ?? this.porId.get(idDoAto(id));
  }

  situacao(id: string): Situacao | "nao-registrada" {
    return this.obter(id)?.situacao ?? "nao-registrada";
  }

  /** Normas (base e stub, sem variantes) com o mesmo tipo, ano e número, de qualquer órgão. */
  normasPorChave(tipo: string, ano: number, numero: string, jurisdicao?: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      if (entrada.situacao === "externo" || idDoAto(entrada.id) !== entrada.id) return false;
      const partes = partesIdNorma(entrada.id);
      return (
        partes !== null &&
        partes.tipo === tipo &&
        partes.ano === ano &&
        partes.numero === numero &&
        (jurisdicao === undefined || partes.jurisdicao === jurisdicao)
      );
    });
  }

  /**
   * Normas (base e stub) de um tipo e número com a data informada. A data citada é a do ato
   * ("Resolução nº 3, de 8 de abril de 2025": `assinada_em`); só sem ato nessa data vale a data de
   * publicação no DOU, que alguns textos citam no lugar da do ato.
   */
  normasPorData(tipo: string, numero: string, data: string): EntradaRegistro[] {
    const candidatos = this.entradas.filter((entrada) => {
      const partes = partesIdNorma(entrada.id);
      return partes !== null && partes.variante === null && partes.tipo === tipo && partes.numero === numero;
    });
    const doAto = candidatos.filter((entrada) => entrada.assinada_em === data);
    return doAto.length > 0 ? doAto : candidatos.filter((entrada) => entrada.data_publicacao === data);
  }

  /** Atos sem órgão (lei, decreto...) pelo número, quando a citação não traz o ano. */
  atosPorNumero(tipo: string, numero: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      const partes = partesIdNorma(entrada.id);
      return partes !== null && partes.variante === null && partes.tipo === tipo && partes.numero === numero;
    });
  }
}

/** Datas conhecidas do ato: a do ato e a de publicação (vazio quando nenhuma está registrada). */
export function datasDoAto(entrada: EntradaRegistro | undefined): string[] {
  if (!entrada) return [];
  return [
    ...new Set([entrada.assinada_em, entrada.data_publicacao].filter((d): d is string => !!d && RE_DATA.test(d))),
  ];
}

/** Raiz do repositório, a partir deste arquivo (`packages/kb/src/normas/`). */
export function raizRepositorio(): string {
  return NodePath.resolve(import.meta.dirname, "..", "..", "..", "..");
}

export function caminhoStubs(raiz: string = raizRepositorio()): string {
  return NodePath.join(raiz, "base-conhecimento", "normas", "stubs.yaml");
}

/**
 * Monta o registro com o texto de `base-conhecimento/manifest.json` e, se existir, o de
 * `base-conhecimento/normas/stubs.yaml`.
 */
export function montarRegistro(manifestJson: string, stubsYaml: string | null): Registro {
  const manifest = decodificarManifest(JSON.parse(manifestJson));
  const entradas: EntradaRegistro[] = manifest.map((item) => ({
    id: item.id,
    title: item.title,
    situacao: "base",
    assinada_em: item.assinada_em && RE_DATA.test(item.assinada_em) ? item.assinada_em : undefined,
    data_publicacao: item.data_publicacao,
    status_vigencia: item.status_vigencia,
    aliases: [...(item.aliases ?? [])],
    path: item.path,
  }));
  if (stubsYaml !== null) {
    const stubs = registroStubsDoYaml(stubsYaml);
    for (const stub of stubs.normas) {
      entradas.push({
        id: stub.id,
        title: stub.title,
        situacao: "stub",
        assinada_em: stub.data_publicacao,
        data_publicacao: stub.data_publicacao,
        status_vigencia: stub.status_vigencia,
        status_fonte: stub.status_fonte,
        aliases: [...(stub.aliases ?? [])],
      });
    }
    for (const externo of stubs.externos) {
      entradas.push({
        id: externo.id,
        title: externo.title,
        situacao: "externo",
        aliases: [...(externo.aliases ?? [])],
      });
    }
  }
  return new Registro(entradas);
}

/** Monta o registro com `manifest.json` e `stubs.yaml` do checkout. */
export function carregarRegistro(raiz: string = raizRepositorio()): Registro {
  const manifest = NodeFS.readFileSync(NodePath.join(raiz, "base-conhecimento", "manifest.json"), "utf-8");
  const arquivoStubs = caminhoStubs(raiz);
  return montarRegistro(manifest, NodeFS.existsSync(arquivoStubs) ? NodeFS.readFileSync(arquivoStubs, "utf-8") : null);
}
