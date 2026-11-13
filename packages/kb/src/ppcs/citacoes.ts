/**
 * Citações normativas extraídas dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/`),
 * pelo resolvedor de `normas/resolver.ts`. Tudo é derivado dos arquivos do checkout, sem relógio e
 * com ordem estável (PPC por id, citação por posição).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { idDoAto } from "../normas/ids.ts";
import { raizRepositorio, type Registro } from "../normas/registro.ts";
import { type Citacao, extrairCitacoes, registroPadrao } from "../normas/resolver.ts";
import { compararTexto } from "../texto.ts";
import { mascararFrontMatter } from "./front-matter.ts";
import { textoDaSecao } from "./secoes.ts";

const esquemaItemPpc = z.looseObject({
  id: z.string(),
  campus_id: z.string(),
  campus_nome: z.string(),
  curso_slug: z.string(),
  curso_nome: z.string(),
  nivel: z.string(),
  tipo_oferta: z.string(),
  path: z.string(),
  ano_documento: z.number().int().optional(),
});
export type ItemPpc = z.output<typeof esquemaItemPpc>;

export function caminhoBase(raiz: string = raizRepositorio()): string {
  return path.join(raiz, "base-conhecimento");
}

/**
 * Texto integral de uma seção do índice (`secoes/<tipo>.jsonl`): lê o PPC em `caminhoRelativo`
 * (o `path` da seção, relativo a `base-conhecimento/`) e devolve as linhas `linha_inicio`–`linha_fim`.
 * O git guarda só preview e linhas; o texto integral vem do próprio Markdown.
 */
export function lerTextoSecao(
  secao: { path: string; linha_inicio: number; linha_fim: number },
  opcoes: { incluirTitulo?: boolean; raiz?: string; cache?: Map<string, string> } = {},
): string {
  // `cache` (caminho → texto) evita reler o mesmo PPC a cada seção, como na compilação do kb.sqlite.
  let texto = opcoes.cache?.get(secao.path);
  if (texto === undefined) {
    texto = readFileSync(path.join(caminhoBase(opcoes.raiz), secao.path), "utf-8").replace(/\r\n?/g, "\n");
    opcoes.cache?.set(secao.path, texto);
  }
  return textoDaSecao(texto, secao.linha_inicio, secao.linha_fim, { incluirTitulo: opcoes.incluirTitulo ?? false });
}

/** Itens de `ppcs/index.json`, ordenados por id. */
export function carregarIndicePpcs(raiz: string = raizRepositorio()): ItemPpc[] {
  const arquivo = path.join(caminhoBase(raiz), "institucional", "ifpr", "ppcs", "index.json");
  const indice = z.object({ items: z.array(esquemaItemPpc) }).parse(JSON.parse(readFileSync(arquivo, "utf-8")));
  return [...indice.items].sort((a, b) => compararTexto(a.id, b.id));
}

/**
 * Citações de um PPC pelo caminho relativo a `base-conhecimento/` (como `ppc.markdown_path`). O front
 * matter de proveniência fica em branco: não gera citação, e as linhas continuam as do arquivo.
 */
export function citacoesDoArquivo(
  caminhoRelativo: string,
  registro: Registro = registroPadrao(),
  raiz: string = raizRepositorio(),
): Citacao[] {
  const bruto = readFileSync(path.join(caminhoBase(raiz), caminhoRelativo), "utf-8").replace(/\r\n?/g, "\n");
  const texto = mascararFrontMatter(bruto);
  return extrairCitacoes(texto, registro);
}

export interface Ocorrencia {
  linha: number;
  trecho: string;
  regra: string;
  confianca: number;
  dispositivoId?: string;
  dispositivos?: string[];
}

export interface PpcCitante {
  ppc: string;
  campus: string;
  curso: string;
  nivel: string;
  tipo_oferta: string;
  path: string;
  ocorrencias: Ocorrencia[];
}

/** Uma linha de trecho legível: espaços colapsados. */
function trechoLimpo(trecho: string): string {
  return trecho
    .replace(/<br\s*\/?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ocorrencia(citacao: Citacao): Ocorrencia {
  return {
    linha: citacao.linha,
    trecho: trechoLimpo(citacao.trecho),
    regra: citacao.regra,
    confianca: citacao.confianca,
    ...(citacao.dispositivoId ? { dispositivoId: citacao.dispositivoId } : {}),
    ...(citacao.dispositivos ? { dispositivos: citacao.dispositivos } : {}),
  };
}

/**
 * PPCs que citam a norma `id` (o ato: variantes e dispositivos do argumento são ignorados na
 * comparação; com `dispositivo`, só as citações daquele dispositivo ou de seus filhos).
 */
export function ppcsQueCitam(
  idConsultado: string,
  opcoes: { registro?: Registro; raiz?: string; confiancaMinima?: number } = {},
): PpcCitante[] {
  const registro = opcoes.registro ?? registroPadrao();
  const raiz = opcoes.raiz ?? raizRepositorio();
  const [idNorma, dispositivo] = idConsultado.split("#") as [string, string | undefined];
  const ato = idDoAto(idNorma);
  const minimo = opcoes.confiancaMinima ?? 0;
  const saida: PpcCitante[] = [];
  for (const ppc of carregarIndicePpcs(raiz)) {
    const ocorrencias = citacoesDoArquivo(ppc.path, registro, raiz)
      .filter((citacao) => citacao.id !== null && idDoAto(citacao.id) === ato && citacao.confianca >= minimo)
      .filter((citacao) => {
        if (!dispositivo) return true;
        const alvo = `#${dispositivo}`;
        const lista = citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : []);
        return lista.some((d) => d === alvo || d.startsWith(`${alvo}-`));
      })
      .map(ocorrencia);
    if (ocorrencias.length === 0) continue;
    saida.push({
      ppc: ppc.id,
      campus: ppc.campus_nome,
      curso: ppc.curso_nome,
      nivel: ppc.nivel,
      tipo_oferta: ppc.tipo_oferta,
      path: ppc.path,
      ocorrencias,
    });
  }
  return saida;
}
