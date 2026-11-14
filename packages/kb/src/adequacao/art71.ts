// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona de dados/institucional/cursos/, usada pela CLI e pelos scripts
/**
 * Adequação ao art. 71 da Res. CNE/CP nº 2/2026: cursos técnicos autorizados e em oferta têm até
 * dois anos para se adequar às novas DCN da EPT. O artigo alcança todos esses cursos, não só os que
 * citam a norma de 2021.
 *
 * A lista sai de `dados/institucional/cursos/` (nível `médio`, situação `ativo` ou `em_oferta`;
 * com `incluirTecnologia`, também os cursos superiores de tecnologia). O indicador de defasagem vem
 * das citações resolvidas do PPC convertido do curso (`ppc.markdown_path`): a DCN mais recente que
 * o PPC cita. Tudo derivado dos arquivos, sem relógio.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { idDoAto } from "../normas/ids.ts";
import { raizRepositorio, type Registro } from "../normas/registro.ts";
import { registroPadrao } from "../normas/resolver.ts";
import { citacoesDoArquivo } from "../ppcs/citacoes.ts";
import { compararTexto } from "../texto.ts";

/** DCN da educação profissional técnica, da mais recente à mais antiga, com o indicador de cada uma. */
export const DCN_EPT = [
  { id: "br/cne-cp/res/2026/2", indicador: "cita-cne-cp-2-2026", rotulo: "cita a Res. CNE/CP nº 2/2026" },
  { id: "br/cne-cp/res/2021/1", indicador: "cita-cne-cp-1-2021", rotulo: "cita a Res. CNE/CP nº 1/2021" },
  { id: "br/cne-ceb/res/2012/6", indicador: "cita-cne-ceb-6-2012", rotulo: "cita a Res. CNE/CEB nº 6/2012" },
  { id: "br/cne-ceb/res/1999/4", indicador: "cita-cne-ceb-4-1999", rotulo: "cita só a Res. CNE/CEB nº 4/1999" },
] as const;

export const INDICADORES = [...DCN_EPT.map((dcn) => dcn.indicador), "nao-cita-dcn", "sem-ppc-convertido"] as const;
export type Indicador = (typeof INDICADORES)[number];

export const ROTULOS_INDICADOR: Readonly<Record<Indicador, string>> = {
  ...(Object.fromEntries(DCN_EPT.map((dcn) => [dcn.indicador, dcn.rotulo])) as Record<string, string>),
  "nao-cita-dcn": "não cita DCN da EPT",
  "sem-ppc-convertido": "sem PPC convertido na base",
} as Record<Indicador, string>;

/** Situações que contam como "autorizado e em oferta" (as mesmas dos gabaritos da avaliação). */
export const SITUACOES_EM_OFERTA = ["ativo", "em_oferta"] as const;

const resto = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const esquemaCurso = Schema.StructWithRest(
  Schema.Struct({
    campus_id: Schema.String,
    curso_slug: Schema.String,
    nome: Schema.String,
    nivel: Schema.optionalKey(Schema.String),
    forma_oferta: Schema.optionalKey(Schema.String),
    situacao: Schema.optionalKey(Schema.String),
    ppc: Schema.optionalKey(
      Schema.StructWithRest(
        Schema.Struct({
          markdown_path: Schema.optionalKey(Schema.String),
          ano_documento: Schema.optionalKey(Schema.Int),
        }),
        resto,
      ),
    ),
  }),
  resto,
);
type Curso = typeof esquemaCurso.Type;
const decodificarCurso = Schema.decodeUnknownSync(esquemaCurso);

export interface CursoAdequacao {
  curso: string;
  nome: string;
  forma_oferta: string | null;
  situacao: string;
  ppc: string | null;
  ppc_ano: number | null;
  indicador: Indicador;
  /** DCN citadas, com as linhas e as regras do resolvedor (para conferência). */
  dcn_citadas: { id: string; linhas: number[]; regras: string[] }[];
}

export interface RelatorioAdequacao {
  criterio: string;
  total: number;
  totais: Record<Indicador, number>;
  cursos: CursoAdequacao[];
}

/** Curso como a adequação o lê (de `dados/institucional/cursos/` ou da tabela `cursos` do `kb.sqlite`). */
export interface CursoParaAdequacao {
  campus_id: string;
  curso_slug: string;
  nome: string;
  nivel?: string | undefined;
  forma_oferta?: string | undefined;
  situacao?: string | undefined;
  ppc?: { markdown_path?: string | undefined; ano_documento?: number | undefined } | undefined;
}

/**
 * O que a adequação lê: os cursos e as citações resolvidas do PPC convertido de cada um. Duas
 * implementações: os arquivos (`fonteAdequacaoArquivos`) e o `kb.sqlite` (carregada pelo serviço
 * `Cursos`); a regra (`adequacaoArt71Em`) é uma só.
 */
export interface FonteAdequacao {
  cursos(): CursoParaAdequacao[];
  /** Citações do PPC (`markdown_path`, relativo a `base-conhecimento/`), ou `null` se ele não está na base. */
  citacoesDoPpc(markdown: string): { id: string | null; linha: number; regra: string }[] | null;
}

export function fonteAdequacaoArquivos(
  raiz: string = raizRepositorio(),
  registro: Registro = registroPadrao(),
): FonteAdequacao {
  return {
    cursos: () => lerCursos(raiz),
    citacoesDoPpc: (markdown) =>
      NodeFS.existsSync(NodePath.join(raiz, "base-conhecimento", markdown))
        ? citacoesDoArquivo(markdown, registro, raiz)
        : null,
  };
}

function lerCursos(raiz: string): Curso[] {
  const dir = NodePath.join(raiz, "dados", "institucional", "cursos");
  const cursos: Curso[] = [];
  for (const campus of NodeFS.readdirSync(dir).sort(compararTexto)) {
    const dirCampus = NodePath.join(dir, campus);
    for (const arquivo of NodeFS.readdirSync(dirCampus).sort(compararTexto)) {
      if (!arquivo.endsWith(".json")) continue;
      cursos.push(decodificarCurso(JSON.parse(NodeFS.readFileSync(NodePath.join(dirCampus, arquivo), "utf-8"))));
    }
  }
  return cursos;
}

export function adequacaoArt71(
  opcoes: { raiz?: string; registro?: Registro; incluirTecnologia?: boolean } = {},
): RelatorioAdequacao {
  return adequacaoArt71Em(fonteAdequacaoArquivos(opcoes.raiz ?? raizRepositorio(), opcoes.registro), opcoes);
}

/** Adequação ao art. 71 sobre uma fonte de dados (arquivos ou `kb.sqlite`). */
export function adequacaoArt71Em(
  fonte: FonteAdequacao,
  opcoes: { incluirTecnologia?: boolean } = {},
): RelatorioAdequacao {
  const situacoes = new Set<string>(SITUACOES_EM_OFERTA);
  const alcancados = fonte
    .cursos()
    .filter(
      (curso) =>
        situacoes.has(curso.situacao ?? "") &&
        (curso.nivel === "médio" || (opcoes.incluirTecnologia && curso.forma_oferta === "graduação tecnológica")),
    );

  const cursos: CursoAdequacao[] = alcancados.map((curso) => {
    const markdown = curso.ppc?.markdown_path ?? null;
    const base = {
      curso: `curso:${curso.campus_id}/${curso.curso_slug}`,
      nome: curso.nome,
      forma_oferta: curso.forma_oferta ?? null,
      situacao: curso.situacao ?? "",
      ppc: markdown,
      ppc_ano: curso.ppc?.ano_documento ?? null,
    };
    const citacoes = markdown ? fonte.citacoesDoPpc(markdown) : null;
    if (!citacoes) {
      return { ...base, ppc: null, indicador: "sem-ppc-convertido" as const, dcn_citadas: [] };
    }
    const dcnCitadas = DCN_EPT.flatMap((dcn) => {
      const daDcn = citacoes.filter((citacao) => citacao.id !== null && idDoAto(citacao.id) === dcn.id);
      if (daDcn.length === 0) return [];
      return [
        {
          id: dcn.id,
          linhas: [...new Set(daDcn.map((citacao) => citacao.linha))].sort((a, b) => a - b),
          regras: [...new Set(daDcn.map((citacao) => citacao.regra))].sort(compararTexto),
        },
      ];
    });
    const maisRecente = DCN_EPT.find((dcn) => dcnCitadas.some((citada) => citada.id === dcn.id));
    return { ...base, indicador: maisRecente?.indicador ?? "nao-cita-dcn", dcn_citadas: dcnCitadas };
  });
  cursos.sort((a, b) => compararTexto(a.curso, b.curso));

  const totais = Object.fromEntries(INDICADORES.map((indicador) => [indicador, 0])) as Record<Indicador, number>;
  for (const curso of cursos) totais[curso.indicador] += 1;
  return {
    criterio:
      "Cursos de dados/institucional/cursos/ com nível 'médio'" +
      (opcoes.incluirTecnologia ? " ou forma de oferta 'graduação tecnológica'" : "") +
      ` e situação ${SITUACOES_EM_OFERTA.join(" ou ")}. Indicador: a DCN da EPT mais recente citada no PPC convertido ` +
      "(citações resolvidas por resolverCitacao, inclusive a DCN de 2021 com órgão trocado).",
    total: cursos.length,
    totais,
    cursos,
  };
}
