// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono das normas e de stubs.yaml, usado pelos scripts e pela compilação do banco
/**
 * Registro de IDs conhecidos: normas da base (front matter dos Markdown de `normas/`), normas-stub e
 * referências externas (`normas/stubs.yaml`). É o universo contra o qual o resolvedor confere e
 * completa citações.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import { parse } from "yaml";
import { CAMINHOS, noCheckout } from "../caminhos.ts";
import { compararTexto } from "../texto.ts";
import { listarNormas } from "./estrutura.ts";
import { UrlOficial } from "./fonte.ts";
import { ehIdDispositivo, ehIdExterno, ehIdNorma, partesIdNorma } from "./ids.ts";

export type Situacao = "base" | "stub" | "externo";

export interface EntradaRegistro {
  id: string;
  title: string;
  situacao: Situacao;
  /** Data do ato (assinatura), `AAAA-MM-DD`. */
  assinada_em?: string | undefined;
  /** Publicação oficial (DOU, Boletim de Serviço), `AAAA-MM-DD`, só quando registrada com evidência. */
  publicada_em?: string | undefined;
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

const dataIso = (campo: string) =>
  Schema.String.check(Schema.isPattern(RE_DATA, { message: `${campo} deve ser AAAA-MM-DD` }));

const esquemaStub = Schema.Struct({
  id: textoQue(ehIdNorma, "id de norma fora do formato canônico"),
  title: textoNaoVazio,
  /** Data do ato (assinatura; no parecer, a aprovação no colegiado). */
  assinada_em: Schema.optionalKey(dataIso("assinada_em")),
  /** Publicação oficial (DOU, Boletim de Serviço; no parecer, a do despacho de homologação). */
  publicada_em: Schema.optionalKey(dataIso("publicada_em")),
  /** De onde vieram as datas: a fonte conferida e o trecho literal. Obrigatório com qualquer data. */
  datas_fonte: Schema.optionalKey(textoNaoVazio),
  ementa: textoNaoVazio,
  status_vigencia: Schema.Literals(STATUS_STUB),
  status_fonte: Schema.optionalKey(
    textoQue((valor) => {
      const [norma, dispositivo] = valor.split("#");
      return ehIdNorma(norma!) && (dispositivo === undefined || ehIdDispositivo(`#${dispositivo}`));
    }, "status_fonte deve ser ID de norma com dispositivo opcional"),
  ),
  aliases: Schema.optionalKey(Schema.Array(textoNaoVazio)),
  fonte_url: Schema.optionalKey(UrlOficial),
  fonte_referencia: Schema.optionalKey(textoNaoVazio),
  observacoes: Schema.optionalKey(Schema.String),
  curadoria: CURADORIA,
});

const esquemaExterno = Schema.Struct({
  id: textoQue(ehIdExterno, "id externo fora do formato externo:<segmentos>"),
  title: textoNaoVazio,
  descricao: textoNaoVazio,
  aliases: Schema.optionalKey(Schema.Array(textoNaoVazio)),
  fonte_url: Schema.optionalKey(UrlOficial),
  fonte_referencia: Schema.optionalKey(textoNaoVazio),
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
      if (partes && stub.assinada_em && !stub.assinada_em.startsWith(String(partes.ano))) {
        problemas.push({
          path: ["normas", indice, "assinada_em"],
          issue: `assinada_em fora do ano do id (${partes.ano})`,
        });
      }
      if (stub.assinada_em && stub.publicada_em && stub.publicada_em < stub.assinada_em) {
        problemas.push({ path: ["normas", indice, "publicada_em"], issue: "publicada_em anterior a assinada_em" });
      }
      if (!stub.fonte_url && !stub.fonte_referencia) {
        problemas.push({
          path: ["normas", indice, "fonte_url"],
          issue: "stub sem fonte oficial: fonte_url ou fonte_referencia",
        });
      }
      if ((stub.assinada_em || stub.publicada_em) && !stub.datas_fonte) {
        problemas.push({ path: ["normas", indice, "datas_fonte"], issue: "data sem datas_fonte (a evidência)" });
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

/** Universo de IDs conhecidos, com buscas usadas pelo resolvedor. */
export class Registro {
  readonly entradas: readonly EntradaRegistro[];
  private readonly porId = new Map<string, EntradaRegistro>();

  constructor(entradas: Iterable<EntradaRegistro>) {
    const lista = [...entradas].sort((a, b) => compararTexto(a.id, b.id));
    this.entradas = lista;
    for (const entrada of lista) if (!this.porId.has(entrada.id)) this.porId.set(entrada.id, entrada);
  }

  /** Entrada do ID. */
  obter(id: string): EntradaRegistro | undefined {
    return this.porId.get(id);
  }

  situacao(id: string): Situacao | "nao-registrada" {
    return this.obter(id)?.situacao ?? "nao-registrada";
  }

  /** Normas (base e stub) com o mesmo tipo, ano e número, de qualquer órgão. */
  normasPorChave(tipo: string, ano: number, numero: string, jurisdicao?: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      if (entrada.situacao === "externo") return false;
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
      return partes !== null && partes.tipo === tipo && partes.numero === numero;
    });
    const doAto = candidatos.filter((entrada) => entrada.assinada_em === data);
    return doAto.length > 0 ? doAto : candidatos.filter((entrada) => entrada.publicada_em === data);
  }

  /** Atos sem órgão (lei, decreto...) pelo número, quando a citação não traz o ano. */
  atosPorNumero(tipo: string, numero: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      const partes = partesIdNorma(entrada.id);
      return partes !== null && partes.tipo === tipo && partes.numero === numero;
    });
  }
}

/** Datas conhecidas do ato: a do ato e a de publicação (vazio quando nenhuma está registrada). */
export function datasDoAto(entrada: EntradaRegistro | undefined): string[] {
  if (!entrada) return [];
  return [...new Set([entrada.assinada_em, entrada.publicada_em].filter((d): d is string => !!d && RE_DATA.test(d)))];
}

export function caminhoStubs(raiz: string): string {
  return noCheckout(raiz, CAMINHOS.stubs);
}

/** Norma da base como o registro a lê: o front matter e o caminho relativo a `base-conhecimento/`. */
export interface NormaDaBase {
  readonly path: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

const campoTexto = (meta: Readonly<Record<string, unknown>>, campo: string) => {
  const valor = meta[campo];
  return typeof valor === "string" ? valor : undefined;
};

/**
 * Monta o registro com o front matter das normas da base e, se existir, o texto de
 * `base-conhecimento/normas/stubs.yaml`. O front matter é lido como está: o contrato dele
 * (`esquemaNorma`) é conferido pelo `validar_base` e pela compilação do banco.
 */
export function montarRegistro(normas: readonly NormaDaBase[], stubsYaml: string | null): Registro {
  const entradas: EntradaRegistro[] = normas.map(({ path, meta }) => {
    const assinada = campoTexto(meta, "assinada_em");
    const publicada = campoTexto(meta, "publicada_em");
    const aliases = meta["aliases"];
    return {
      id: String(meta["id"]),
      title: campoTexto(meta, "title") ?? String(meta["id"]),
      situacao: "base",
      assinada_em: assinada && RE_DATA.test(assinada) ? assinada : undefined,
      publicada_em: publicada && RE_DATA.test(publicada) ? publicada : undefined,
      status_vigencia: campoTexto(meta, "status_vigencia"),
      aliases: Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : [],
      path,
    };
  });
  if (stubsYaml !== null) {
    const stubs = registroStubsDoYaml(stubsYaml);
    for (const stub of stubs.normas) {
      entradas.push({
        id: stub.id,
        title: stub.title,
        situacao: "stub",
        assinada_em: stub.assinada_em,
        publicada_em: stub.publicada_em,
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

/** Monta o registro com as normas e o `stubs.yaml` do checkout. */
export function carregarRegistro(raiz: string): Registro {
  const arquivoStubs = caminhoStubs(raiz);
  return montarRegistro(
    listarNormas(raiz),
    NodeFS.existsSync(arquivoStubs) ? NodeFS.readFileSync(arquivoStubs, "utf-8") : null,
  );
}
