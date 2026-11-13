/**
 * Referências normativas estruturadas: `{ ref, dispositivo?, papel, nota? }`, como nas fichas da
 * `analise-ppc` (fase 2 do plano de arquitetura), e o texto legível renderizado a partir delas.
 *
 * - `ref`: ID canônico de ato sem variante (`br/cne-cp/res/2026/2`), de stub, `externo:...` ou
 *   `cnct:...` (`cnct:catalogo` para o CNCT inteiro, `cnct:<slug>` para um curso do catálogo);
 * - `dispositivo`: um único dispositivo (`#art28-vii`). Uma citação de vários dispositivos da mesma
 *   norma vira várias entradas consecutivas, que o texto legível junta de novo ("arts. 29, 30 e 37,
 *   § 3º"); sem `dispositivo`, a referência é ao ato inteiro;
 * - `papel`: `fundamento` (a ficha aplica a regra da referência para decidir o estado) ou
 *   `complementar` (a ficha só remete a ela: contexto, fonte local a consultar, parâmetro técnico ou
 *   norma referida por outra);
 * - `nota`: detalhe da citação que não cabe nos campos anteriores (número SEI, recorte do catálogo).
 *
 * O texto legível usa o título canônico (`manifest.json`, `stubs.yaml` ou o catálogo) e o
 * dispositivo por extenso: "Resolução CNE/CP nº 2/2026, art. 28, VII".
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ehIdAto, ehIdCnct, ehIdExterno, RE_ID_DISPOSITIVO, RE_REFERENCIA } from "./ids.ts";
import { carregarRegistro, raizRepositorio, type Registro, type Situacao } from "./registro.ts";
import { textoDispositivos } from "./texto-dispositivos.ts";

export const PAPEIS_REFERENCIA = ["fundamento", "complementar"] as const;
export type PapelReferencia = (typeof PAPEIS_REFERENCIA)[number];

export const esquemaReferenciaNormativa = z.strictObject({
  ref: z
    .string()
    .regex(RE_REFERENCIA)
    .describe("ID canônico: ato sem variante (br/..., ifpr/...), stub, externo:... ou cnct:..."),
  dispositivo: z
    .string()
    .regex(RE_ID_DISPOSITIVO)
    .optional()
    .describe("Um dispositivo do ato, como #art28-vii, #art28-par1-iv ou #art24-parunico"),
  papel: z
    .enum(PAPEIS_REFERENCIA)
    .describe("fundamento: a ficha aplica a regra; complementar: a ficha só remete à referência"),
  nota: z.string().min(1).optional().describe("Detalhe da citação que não cabe em ref e dispositivo"),
});
export type ReferenciaNormativa = z.output<typeof esquemaReferenciaNormativa>;

/** O que se sabe de um ID citável. */
export interface FonteReferencia {
  id: string;
  title: string;
  situacao: Situacao | "catalogo";
  status_vigencia?: string | undefined;
  status_fonte?: string | undefined;
  /** Arquivo na base, relativo a `base-conhecimento/` (normas da base e catálogo). */
  path?: string | undefined;
}

const CNCT_CATALOGO: FonteReferencia = {
  id: "cnct:catalogo",
  title: "Catálogo Nacional de Cursos Técnicos (CNCT)",
  situacao: "catalogo",
  path: "catalogos/cnct/manifest.json",
};

/** Universo de IDs citáveis: registro de normas (manifesto + stubs) e cursos do CNCT. */
export class UniversoReferencias {
  constructor(
    readonly registro: Registro,
    private readonly cursosCnct: ReadonlyMap<string, string> = new Map(),
  ) {}

  /** Fonte do ID, ou `undefined` se ele não existe na base. */
  fonte(ref: string): FonteReferencia | undefined {
    if (ref === CNCT_CATALOGO.id) return CNCT_CATALOGO;
    if (ehIdCnct(ref)) {
      const slug = ref.slice("cnct:".length);
      const denominacao = this.cursosCnct.get(slug);
      return denominacao === undefined
        ? undefined
        : { id: ref, title: `${denominacao} (CNCT)`, situacao: "catalogo", path: `catalogos/cnct/cursos/${slug}.json` };
    }
    // Só o ID exato do ato: a variante de arquivo (`~compilacao`) não é referência citável.
    if (!ehIdAto(ref) && !ehIdExterno(ref)) return undefined;
    const entrada = this.registro.obter(ref);
    if (entrada === undefined || entrada.id !== ref) return undefined;
    return {
      id: entrada.id,
      title: entrada.title,
      situacao: entrada.situacao,
      status_vigencia: entrada.status_vigencia,
      status_fonte: entrada.status_fonte,
      path: entrada.path,
    };
  }

  /** Título canônico do ID; o próprio ID quando ele não existe na base. */
  titulo(ref: string): string {
    return this.fonte(ref)?.title ?? ref;
  }
}

/** Cursos de `catalogos/cnct/index.json` (`id` → denominação); vazio se o índice não existe. */
export function carregarCursosCnct(raiz: string = raizRepositorio()): Map<string, string> {
  const arquivo = path.join(raiz, "base-conhecimento", "catalogos", "cnct", "index.json");
  const cursos = new Map<string, string>();
  if (!existsSync(arquivo)) return cursos;
  const indice = z
    .object({ items: z.array(z.looseObject({ id: z.string(), denominacao: z.string() })) })
    .parse(JSON.parse(readFileSync(arquivo, "utf-8")));
  for (const item of indice.items) cursos.set(item.id, item.denominacao);
  return cursos;
}

/** Universo do checkout em `raiz` (que contém `base-conhecimento/`). */
export function carregarUniversoReferencias(raiz: string = raizRepositorio()): UniversoReferencias {
  return new UniversoReferencias(carregarRegistro(raiz), carregarCursosCnct(raiz));
}

/** Citação legível: entradas consecutivas da mesma norma e do mesmo papel, juntas. */
export interface ReferenciaLegivel {
  /** "Resolução CNE/CP nº 2/2026, arts. 29, 30 e 37, § 3º". */
  texto: string;
  ref: string;
  papel: PapelReferencia;
  dispositivos: string[];
  /** Arquivo na base, relativo a `base-conhecimento/`, quando houver. */
  path?: string;
}

interface Grupo {
  ref: string;
  papel: PapelReferencia;
  dispositivos: string[];
  notas: string[];
}

/**
 * Junta entradas consecutivas com o mesmo `ref` e `papel` que citam dispositivos (uma citação
 * "arts. 29 e 30" vira duas entradas e volta a ser uma). Referência ao ato inteiro fica sozinha.
 */
export function agruparReferencias(referencias: readonly ReferenciaNormativa[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const referencia of referencias) {
    const anterior = grupos.at(-1);
    const junta =
      anterior !== undefined &&
      anterior.ref === referencia.ref &&
      anterior.papel === referencia.papel &&
      anterior.dispositivos.length > 0 &&
      referencia.dispositivo !== undefined;
    const grupo = junta ? anterior : { ref: referencia.ref, papel: referencia.papel, dispositivos: [], notas: [] };
    if (!junta) grupos.push(grupo);
    if (referencia.dispositivo !== undefined) grupo.dispositivos.push(referencia.dispositivo);
    if (referencia.nota !== undefined && !grupo.notas.includes(referencia.nota)) grupo.notas.push(referencia.nota);
  }
  return grupos;
}

/** Texto legível de um grupo: título canônico, dispositivos por extenso e notas depois de " — ". */
export function textoGrupo(grupo: Grupo, universo: UniversoReferencias): string {
  let texto = universo.titulo(grupo.ref);
  if (grupo.dispositivos.length) texto += `, ${textoDispositivos(grupo.dispositivos)}`;
  if (grupo.notas.length) texto += ` — ${grupo.notas.join("; ")}`;
  return texto;
}

/** Citações legíveis de uma lista de referências estruturadas, na ordem da lista. */
export function referenciasLegiveis(
  referencias: readonly ReferenciaNormativa[],
  universo: UniversoReferencias,
): ReferenciaLegivel[] {
  return agruparReferencias(referencias).map((grupo) => {
    const legivel: ReferenciaLegivel = {
      texto: textoGrupo(grupo, universo),
      ref: grupo.ref,
      papel: grupo.papel,
      dispositivos: grupo.dispositivos,
    };
    const caminho = universo.fonte(grupo.ref)?.path;
    if (caminho !== undefined) legivel.path = caminho;
    return legivel;
  });
}

/** Texto legível de um ID com dispositivo opcional (`br/cne-ceb/res/2025/3#art6-iii`). */
export function textoIdComDispositivo(id: string, universo: UniversoReferencias): string {
  const [ref, dispositivo] = id.split("#") as [string, string | undefined];
  const titulo = universo.titulo(ref);
  return dispositivo === undefined ? titulo : `${titulo}, ${textoDispositivos([`#${dispositivo}`])}`;
}
