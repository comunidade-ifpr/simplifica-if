/**
 * Registro de IDs conhecidos: normas da base (`manifest.json`), normas-stub e referências externas
 * (`normas/stubs.yaml`). É o universo contra o qual o resolvedor confere e completa citações.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { compararTexto } from "../texto.ts";
import { ehIdDispositivo, ehIdExterno, ehIdNorma, idDoAto, partesIdNorma } from "./ids.ts";

export type Situacao = "base" | "stub" | "externo";

export interface EntradaRegistro {
  id: string;
  title: string;
  situacao: Situacao;
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

const esquemaStub = z.strictObject({
  id: z.string().refine(ehIdNorma, "id de norma fora do formato canônico"),
  title: z.string().min(1),
  data_publicacao: z.string().regex(RE_DATA, "data_publicacao deve ser AAAA-MM-DD").optional(),
  ementa: z.string().min(1),
  status_vigencia: z.enum(STATUS_STUB),
  status_fonte: z
    .string()
    .refine((valor) => {
      const [norma, dispositivo] = valor.split("#");
      return ehIdNorma(norma!) && (dispositivo === undefined || ehIdDispositivo(`#${dispositivo}`));
    }, "status_fonte deve ser ID de norma com dispositivo opcional")
    .optional(),
  aliases: z.array(z.string().min(1)).optional(),
  fonte: z.string().optional(),
  observacoes: z.string().optional(),
  curadoria: z.enum(["rascunho", "conferido"]),
});

const esquemaExterno = z.strictObject({
  id: z.string().refine(ehIdExterno, "id externo fora do formato externo:<segmentos>"),
  title: z.string().min(1),
  descricao: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  fonte: z.string().optional(),
  curadoria: z.enum(["rascunho", "conferido"]),
});

/** Contrato de `base-conhecimento/normas/stubs.yaml`. */
export const esquemaRegistroStubs = z
  .strictObject({ normas: z.array(esquemaStub), externos: z.array(esquemaExterno) })
  .superRefine((registro, ctx) => {
    const vistos = new Set<string>();
    for (const [lista, itens] of [
      ["normas", registro.normas],
      ["externos", registro.externos],
    ] as const) {
      itens.forEach((item, indice) => {
        if (vistos.has(item.id)) {
          ctx.addIssue({ code: "custom", path: [lista, indice, "id"], message: `id duplicado: ${item.id}` });
        }
        vistos.add(item.id);
      });
    }
    registro.normas.forEach((stub, indice) => {
      if (stub.status_vigencia !== "a confirmar" && !stub.status_fonte) {
        ctx.addIssue({
          code: "custom",
          path: ["normas", indice, "status_fonte"],
          message: "status diferente de 'a confirmar' exige status_fonte",
        });
      }
      const partes = partesIdNorma(stub.id);
      if (partes?.variante) {
        ctx.addIssue({ code: "custom", path: ["normas", indice, "id"], message: "stub não tem variante" });
      }
      if (partes && stub.data_publicacao && !stub.data_publicacao.startsWith(String(partes.ano))) {
        ctx.addIssue({
          code: "custom",
          path: ["normas", indice, "data_publicacao"],
          message: `data_publicacao fora do ano do id (${partes.ano})`,
        });
      }
    });
  });
export type RegistroStubs = z.output<typeof esquemaRegistroStubs>;

/** Lê e valida `stubs.yaml` (YAML `failsafe`: todo escalar é texto). */
export function lerRegistroStubs(caminho: string): RegistroStubs {
  const bruto = parse(readFileSync(caminho, "utf-8"), { schema: "failsafe", uniqueKeys: true });
  return esquemaRegistroStubs.parse(bruto);
}

const esquemaItemManifest = z.looseObject({
  id: z.string(),
  title: z.string(),
  data_publicacao: z.string(),
  status_vigencia: z.string(),
  aliases: z.array(z.string()).optional(),
  path: z.string(),
});

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

  /** Normas (base e stub) de um tipo e número com a data informada. */
  normasPorData(tipo: string, numero: string, data: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      const partes = partesIdNorma(entrada.id);
      return (
        partes !== null &&
        partes.variante === null &&
        partes.tipo === tipo &&
        partes.numero === numero &&
        entrada.data_publicacao === data
      );
    });
  }

  /** Atos sem órgão (lei, decreto...) pelo número, quando a citação não traz o ano. */
  atosPorNumero(tipo: string, numero: string): EntradaRegistro[] {
    return this.entradas.filter((entrada) => {
      const partes = partesIdNorma(entrada.id);
      return partes !== null && partes.variante === null && partes.tipo === tipo && partes.numero === numero;
    });
  }
}

/** Raiz do repositório, a partir deste arquivo (`packages/kb/src/normas/`). */
export function raizRepositorio(): string {
  return path.resolve(import.meta.dir, "..", "..", "..", "..");
}

export function caminhoStubs(raiz: string = raizRepositorio()): string {
  return path.join(raiz, "base-conhecimento", "normas", "stubs.yaml");
}

/** Monta o registro com `manifest.json` e `stubs.yaml` do checkout. */
export function carregarRegistro(raiz: string = raizRepositorio()): Registro {
  const base = path.join(raiz, "base-conhecimento");
  const manifest = z
    .array(esquemaItemManifest)
    .parse(JSON.parse(readFileSync(path.join(base, "manifest.json"), "utf-8")));
  const entradas: EntradaRegistro[] = manifest.map((item) => ({
    id: item.id,
    title: item.title,
    situacao: "base",
    data_publicacao: item.data_publicacao,
    status_vigencia: item.status_vigencia,
    aliases: item.aliases ?? [],
    path: item.path,
  }));
  const arquivoStubs = caminhoStubs(raiz);
  if (existsSync(arquivoStubs)) {
    const stubs = lerRegistroStubs(arquivoStubs);
    for (const stub of stubs.normas) {
      entradas.push({
        id: stub.id,
        title: stub.title,
        situacao: "stub",
        data_publicacao: stub.data_publicacao,
        status_vigencia: stub.status_vigencia,
        status_fonte: stub.status_fonte,
        aliases: stub.aliases ?? [],
      });
    }
    for (const externo of stubs.externos) {
      entradas.push({ id: externo.id, title: externo.title, situacao: "externo", aliases: externo.aliases ?? [] });
    }
  }
  return new Registro(entradas);
}
