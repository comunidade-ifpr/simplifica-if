/**
 * Leitura de `dados/institucional/` pelo núcleo `packages/kb` (compilação do `kb.sqlite`).
 *
 * O contrato estrito desses arquivos é o de `scripts/dados/institucional.ts`, conferido por
 * `node scripts/validar_base.ts`; aqui os esquemas são frouxos (`looseObject`) e só exigem os
 * campos que o banco usa, para que a dependência continue num sentido só (scripts → kb).
 * Cada registro vem com o caminho do arquivo, relativo à raiz do repositório.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { compararTexto } from "../texto.ts";

const texto = z.string().optional();
const inteiro = z.number().int().optional();

export const esquemaCampus = z.looseObject({ campus_id: z.string(), nome: z.string(), site: texto });

export const esquemaCurso = z.looseObject({
  campus_id: z.string(),
  curso_slug: z.string(),
  nome: z.string(),
  nivel: texto,
  forma_oferta: texto,
  modalidade: texto,
  situacao: texto,
  pagina_oficial: texto,
  cnct_id: texto,
  cnct_ausencia: texto,
  suap: z
    .looseObject({
      id: inteiro,
      codigo: texto,
      vagas: inteiro,
      matrizes: z
        .looseObject({
          resumo: texto,
          urls: z.array(z.string()).optional(),
          carga_horaria_comum_h: inteiro,
          situacao: texto,
          coletado_em: texto,
        })
        .optional(),
    })
    .optional(),
  ppc: z
    .looseObject({
      url: texto,
      markdown_path: texto,
      ano_documento: inteiro,
      curadoria_ano: texto,
      data_curadoria_ano: texto,
      vagas: texto,
      observacoes: texto,
    })
    .optional(),
});

export const esquemaProcesso = z.looseObject({
  processo_seletivo_id: z.string(),
  nome: z.string(),
  ano_ingresso: inteiro,
  status_curadoria: texto,
});

export const esquemaEdital = z.looseObject({
  edital_id: z.string(),
  titulo: z.string(),
  url: z.string(),
  numero: texto,
  ano: inteiro,
  tipo: texto,
  processos: z.array(z.string()),
});

export const esquemaOferta = z.looseObject({
  oferta_id: z.string(),
  processos: z.array(z.string()),
  curso_nome: z.string(),
  tipo_oferta: z.string(),
  vagas: inteiro,
  url_fonte: z.string(),
  pagina_fonte: inteiro,
  trecho_fonte: texto,
  status_curadoria: texto,
  modalidade: texto,
  turno: texto,
  turno_padronizado: texto,
  turno_nota: texto,
  campi: z.array(z.string()).optional(),
  cursos: z.array(z.string()).optional(),
  editais: z.array(z.string()).optional(),
  campus_id_original: texto,
  curso_slug_original: texto,
});

export type Registro<T> = { arquivo: string; conteudo: string; dados: T };

export interface DadosInstitucionaisKb {
  campi: Registro<z.output<typeof esquemaCampus>>[];
  cursos: Registro<z.output<typeof esquemaCurso>>[];
  processos: Registro<z.output<typeof esquemaProcesso>>[];
  editais: Registro<z.output<typeof esquemaEdital>>[];
  ofertas: Registro<z.output<typeof esquemaOferta>>[];
}

function arquivosJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entrada) => {
      const caminho = path.join(dir, entrada.name);
      if (entrada.isDirectory()) return arquivosJson(caminho);
      return entrada.name.endsWith(".json") ? [caminho] : [];
    })
    .sort(compararTexto);
}

function colecao<T>(raiz: string, subdir: string, esquema: z.ZodType<T>): Registro<T>[] {
  return arquivosJson(path.join(raiz, "dados", "institucional", subdir)).map((arquivo) => {
    const conteudo = readFileSync(arquivo, "utf-8");
    const relativo = path.relative(raiz, arquivo).split(path.sep).join("/");
    const resultado = esquema.safeParse(JSON.parse(conteudo));
    if (!resultado.success) throw new Error(`${relativo}: ${resultado.error.message}`);
    return { arquivo: relativo, conteudo, dados: resultado.data };
  });
}

export function carregarDadosInstitucionaisKb(raiz: string): DadosInstitucionaisKb {
  return {
    campi: colecao(raiz, "campi", esquemaCampus),
    cursos: colecao(raiz, "cursos", esquemaCurso),
    processos: colecao(raiz, "processos-seletivos", esquemaProcesso),
    editais: colecao(raiz, "editais", esquemaEdital),
    ofertas: colecao(raiz, "ofertas", esquemaOferta),
  };
}

/** Linha (desde 1) da primeira ocorrência da chave JSON `"chave":` no texto do arquivo, ou 1. */
export function linhaDaChave(conteudo: string, chave: string): number {
  const indice = conteudo.indexOf(`"${chave}":`);
  if (indice < 0) return 1;
  let linha = 1;
  for (let i = 0; i < indice; i += 1) if (conteudo.charCodeAt(i) === 10) linha += 1;
  return linha;
}

/* -------------------------------------------------------------------- SUAP */

export interface MatrizSuap {
  ordem: number;
  matriz_id: number;
  descricao: string;
  ano: number | null;
  ch_exibida_h: number;
  estagio_exigido: boolean;
  ch_estagio_h: number | null;
  /** Linha do resumo, literal. */
  trecho: string;
}

const RE_MATRIZ =
  /^(\d+) — (.+?) — CH exibida: (\d+) h; estágio exigido: (Sim|Não); CH mínima de estágio \(separada\): (?:(\d+)(?: h)?|-)$/;

/** Matrizes do `suap.matrizes.resumo` (uma por linha). Linha fora do formato gera erro. */
export function matrizesDoResumo(resumo: string): MatrizSuap[] {
  return resumo
    .split("\n")
    .filter((linha) => linha.trim())
    .map((linha, ordem) => {
      const m = RE_MATRIZ.exec(linha.trim());
      if (!m) throw new Error(`linha de matriz SUAP fora do formato: ${linha}`);
      const ano = /\s-\s(\d{4})\b/.exec(m[2]!);
      return {
        ordem,
        matriz_id: Number(m[1]),
        descricao: m[2]!,
        ano: ano ? Number(ano[1]) : null,
        ch_exibida_h: Number(m[3]),
        estagio_exigido: m[4] === "Sim",
        ch_estagio_h: m[5] === undefined ? null : Number(m[5]),
        trecho: linha.trim(),
      };
    });
}
