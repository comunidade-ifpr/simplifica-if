/**
 * Peças comuns às ferramentas de PPCs e cursos (T3): a norma pedida pela IA, as regras de transição,
 * os fatos de PPC, a leitura dos IDs de PPC e de curso escritos pela IA e os avisos. `NormaResumo` e
 * `Relacao` ficam em `tipos-comuns.ts`. Só formato: as regras ficam em `@simplifica-if/kb/db/modo-banco`.
 */
import type { Database } from "bun:sqlite";
import { type fatosDosPpcs, REGRAS_BAIXA_CONFIANCA, type vigenciaBanco } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { type Aviso, ErroEntrada, esquemaFonte, esquemaLink, type Fonte } from "../envelope.ts";
import { linkNorma, linkPpc, lerLink } from "../links.ts";
import { blocoItem, comLink } from "../texto.ts";
import { cortar } from "../orcamento.ts";
import { type NormaResumo, normaResumo } from "./tipos-comuns.ts";

/* ------------------------------------------------------------------ IDs */

const SEGMENTO = /^[A-Za-z0-9._~-]+$/;

function campusCurso(valor: string, prefixo: "ppc" | "curso", campo: string): string {
  let id = valor.trim();
  const link = id.startsWith("ifpr://") ? lerLink(id) : null;
  if (link) {
    if (link.tipo !== "ppc" && link.tipo !== "curso") {
      throw new ErroEntrada(`${campo}: esperava um link ifpr://${prefixo}/campus/curso, veio "${valor}"`);
    }
    id = link.caminho;
  } else {
    for (const p of ["ppc:", "curso:"]) if (id.startsWith(p)) id = id.slice(p.length);
  }
  const partes = id.split("/");
  if (partes.length !== 2 || !partes.every((p) => SEGMENTO.test(p))) {
    throw new ErroEntrada(`${campo}: esperava "campus/curso" (como "curitiba/tecnico-em-enfermagem"), veio "${valor}"`);
  }
  return id;
}

/** PPC escrito pela IA (`campus/curso`, `ppc:campus/curso` ou `ifpr://ppc/campus/curso`) → `campus/curso`. */
export function chavePpc(valor: string, campo = "ppc"): string {
  return campusCurso(valor, "ppc", campo);
}

/** Curso escrito pela IA (`campus/curso`, `curso:campus/curso` ou `ifpr://curso/campus/curso`) → `campus/curso`. */
export function chaveCurso(valor: string, campo = "curso"): string {
  return campusCurso(valor, "curso", campo);
}

/** ID canônico de norma, com dispositivo opcional (`br/cne-cp/res/2021/1#art20`, `externo:abnt/nbr/6023`). */
export const idNorma = (descricao: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(
      /^[A-Za-z0-9._~:-]+(?:\/[A-Za-z0-9._~:-]+)*(?:#[A-Za-z0-9._~-]+)?$/,
      'esperava um ID canônico de norma, como "br/cne-cp/res/2021/1" ou "br/cne-cp/res/2021/1#art20"; para uma citação em texto livre, use resolver_citacoes',
    )
    .describe(descricao);

/** Texto de filtro: sem espaços nas pontas, até 200 caracteres. */
export const filtroTexto = (descricao: string) => z.string().trim().min(1).max(200).describe(descricao);

/* ------------------------------------------------------------------ normas */

/** A norma pedida pela IA; ID desconhecido é erro de entrada, com a dica de onde achar o ID. */
export function normaPedida(db: Database, id: string): NormaResumo {
  const norma = normaResumo(db, id);
  if (!norma) {
    throw new ErroEntrada(
      `norma não encontrada na base: "${id}". Use o ID canônico (como "br/cne-cp/res/2021/1"), vindo de buscar_norma ou de resolver_citacoes`,
    );
  }
  return norma;
}

export function avisoVigencia(norma: NormaResumo): Aviso[] {
  return norma.vigencia_a_confirmar
    ? [
        {
          tipo: "vigencia-a-confirmar",
          mensagem: `a vigência de ${norma.titulo} está a confirmar (status publicado: ${norma.status_vigencia ?? "sem status"}); diga isso ao usuário`,
          ref: norma.id,
        },
      ]
    : [];
}

/* ------------------------------------------------------------------ transições */

export const esquemaTransicaoResumo = z.strictObject({
  id: z.string(),
  regra: z.string(),
  /** `a-iniciar`, `em-curso`, `encerrada` ou `a confirmar`, na data de referência. */
  situacao_na_data: z.string(),
  /** Dispositivo que estabelece a regra. */
  link: esquemaLink,
});
export type TransicaoResumo = z.infer<typeof esquemaTransicaoResumo>;

type SituacaoTransicao = ReturnType<typeof vigenciaBanco>["transicoes"][number];

export function transicaoResumo(t: SituacaoTransicao): TransicaoResumo {
  return { id: t.id, regra: t.regra, situacao_na_data: t.situacao, link: linkNorma(t.norma, t.dispositivo.slice(1)) };
}

export function linhaTransicao(t: TransicaoResumo): string {
  return `- ${comLink(t.id, t.link)} (${t.situacao_na_data}): ${t.regra}`;
}

/* ------------------------------------------------------------------ citações */

/** Aviso de citação de baixa confiança, se alguma das regras entregues estiver entre elas. */
export function avisoBaixaConfianca(regras: Iterable<string>): Aviso[] {
  const baixas = [...new Set([...regras].filter((r) => REGRAS_BAIXA_CONFIANCA.has(r)))].sort();
  if (baixas.length === 0) return [];
  return [
    {
      tipo: "citacao-baixa-confianca",
      mensagem: `há citações identificadas por regra de baixa confiança (${baixas.join(", ")}): confira o trecho no PPC antes de afirmar que ele cita a norma`,
    },
  ];
}

/* ------------------------------------------------------------------ fatos de PPC */

export const esquemaFatosPpc = z.strictObject({
  ppc: z.string(),
  curso: z.string().nullable(),
  nome: z.string(),
  campus: z.string(),
  nivel: z.string(),
  forma: z.string(),
  link: esquemaLink,
  fatos: z.array(
    z.strictObject({
      fato: z.string(),
      valor: z.string(),
      valor_num: z.number().nullable(),
      unidade: z.string().nullable(),
      /** `extraido`: por regra, sem revisão humana. */
      status_curadoria: z.string(),
      regra: z.string(),
      trecho_fonte: z.string(),
      fonte: esquemaFonte,
    }),
  ),
  suap: z
    .strictObject({
      situacao: z.string().nullable(),
      carga_horaria_comum_h: z.number().nullable(),
      matrizes: z.array(
        z.strictObject({
          matriz_id: z.number().int(),
          ano: z.number().int().nullable(),
          ch_exibida_h: z.number().nullable(),
          ch_estagio_h: z.number().nullable(),
          trecho: z.string(),
        }),
      ),
    })
    .nullable(),
  cruzamento: z.array(
    z.strictObject({
      aspecto: z.string(),
      resultado: z.string(),
      valor_ppc: z.string().nullable(),
      valor_suap: z.string().nullable(),
      explicacao: z.string(),
    }),
  ),
});
export type FatosPpc = z.infer<typeof esquemaFatosPpc>;

type FatosDoPpc = ReturnType<typeof fatosDosPpcs>[number];

function fonteLinha(path: string, linha: number): Fonte {
  return { path, linha_inicio: linha, linha_fim: linha };
}

/** Os fatos do kb no formato da ferramenta. `suap` é `null` quando o PPC não tem curso ligado. */
export function paraFatosPpc(f: FatosDoPpc): FatosPpc {
  return {
    ppc: f.ppc,
    curso: f.curso,
    nome: f.nome,
    campus: f.campus,
    nivel: f.nivel,
    forma: f.forma,
    link: linkPpc(f.ppc),
    fatos: f.fatos.map((x) => ({
      fato: x.fato,
      valor: x.valor,
      valor_num: x.valor_num,
      unidade: x.unidade,
      status_curadoria: x.status_curadoria,
      regra: x.regra,
      trecho_fonte: x.trecho_fonte,
      fonte: fonteLinha(x.path, x.linha),
    })),
    suap:
      f.curso === null
        ? null
        : {
            situacao: f.suap.situacao,
            carga_horaria_comum_h: f.suap.carga_horaria_comum_h,
            matrizes: f.suap.matrizes.map((m) => ({
              matriz_id: m.matriz_id,
              ano: m.ano,
              ch_exibida_h: m.ch_exibida_h,
              ch_estagio_h: m.ch_estagio_h,
              trecho: m.trecho,
            })),
          },
    cruzamento: f.cruzamento.map((c) => ({ ...c })),
  };
}

export const AVISO_FATO_EXTRAIDO: Aviso = {
  tipo: "fato-extraido",
  mensagem:
    "os fatos de PPC com status `extraido` foram extraídos por regra, sem revisão humana: confira o trecho de origem antes de afirmar um valor ou uma divergência",
};

/** Limite do trecho de origem de cada fato no texto. */
const MAX_TRECHO_FATO = 400;

/** Os fatos de um PPC em texto: cada fato com o status, o trecho literal e a fonte; SUAP e cruzamento. */
export function textoFatosPpc(f: FatosPpc, opcoes: { cabecalho?: boolean } = {}): string {
  const partes: string[] = [];
  if (opcoes.cabecalho ?? true) partes.push(`### ${comLink(`${f.nome} (${f.campus})`, f.link)} — \`${f.ppc}\``);
  if (f.fatos.length === 0) partes.push("Nenhum fato extraído deste PPC.");
  for (const x of f.fatos) {
    partes.push(
      blocoItem({
        titulo: `${x.fato} = ${x.valor}${x.unidade ? ` ${x.unidade}` : ""}`,
        detalhe: `status \`${x.status_curadoria}\`, regra \`${x.regra}\``,
        literal: cortar(x.trecho_fonte, MAX_TRECHO_FATO),
        fonte: x.fonte,
      }),
    );
  }
  if (f.suap) {
    const linhas = [`SUAP (${f.suap.situacao ?? "sem situação"}):`];
    for (const m of f.suap.matrizes) linhas.push(`- ${m.trecho}`);
    if (f.suap.matrizes.length === 0) linhas.push("- nenhuma matriz publicada na base");
    partes.push(linhas.join("\n"));
  } else {
    partes.push("SUAP: o PPC não está ligado a um curso de dados/institucional.");
  }
  if (f.cruzamento.length > 0) {
    partes.push(
      ["PPC × SUAP:", ...f.cruzamento.map((c) => `- ${c.aspecto}: **${c.resultado}** — ${c.explicacao}`)].join("\n"),
    );
  }
  return partes.join("\n\n");
}
