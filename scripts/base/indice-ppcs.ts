/** Índices globais dos PPCs convertidos para Markdown (index.json e secoes/*.jsonl). */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type CaminhosBase, listarDiretorio, naBase, relativo } from "./caminhos.ts";
import { ehInteiro, ehObjeto, itensDe, jsonCompacto, jsonIndentado, type ObjetoJson, textoDe } from "./json.ts";
import {
  aparar,
  apararCaracteres,
  compararTexto,
  contarCaracteres,
  dividirLinhas,
  ESPACOS,
  lerTexto,
  ordenarTextos,
  prefixo,
} from "./texto.ts";

export const LIMITE_PREVIEW_SECAO = 500;
export const TIPOS_SECAO = new Set([
  "identificacao",
  "justificativa",
  "objetivos",
  "perfil_egresso",
  "concepcao_pedagogica",
  "organizacao_curricular",
  "matriz_curricular",
  "ementas",
  "avaliacao",
  "estagio_praticas",
  "infraestrutura",
  "corpo_docente",
  "referencias",
  "outros",
]);
export const TIPOS_SECAO_INDEXADOS = ordenarTextos([...TIPOS_SECAO].filter((tipo) => tipo !== "outros"));

const RE_ESPACOS = new RegExp(`[${ESPACOS}]+`, "g");
const RE_NUMERACAO = new RegExp(`^\\p{Nd}+(?:\\.\\p{Nd}+)*[${ESPACOS}]*[-–.]?[${ESPACOS}]*`, "u");
const RE_TITULO_MARKDOWN = new RegExp(`^#{2,6}[${ESPACOS}]+([^\\n]+?)[${ESPACOS}]*#*$`);
const RE_TITULO_NEGRITO = /^\*\*([^\n]+?)\*\*$/;
const MARCADORES_TITULO_NEGRITO = [
  "identificacao",
  "justificativa",
  "objetivo",
  "perfil",
  "organizacao",
  "matriz",
  "ementa",
  "avaliacao",
  "infraestrutura",
  "referencia",
  "projeto pedagogico",
];

/** Remove acentos (NFKD sem marcas combinantes), como `unicodedata` no Python. */
export function removerAcentos(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{Mn}/gu, "");
}

export function limparTexto(texto: string): string {
  const limpo = texto
    .replaceAll("\x00", "")
    .replace(new RegExp(`<br[${ESPACOS}]*/?>`, "g"), " ")
    .replace(/[*#>`_]+/g, "")
    .replace(/\|+/g, " ");
  return aparar(limpo.replace(RE_ESPACOS, " "));
}

export function limparTitulo(texto: string): string {
  const limpo = limparTexto(texto).replace(RE_NUMERACAO, (trecho) => `${aparar(trecho)} `);
  return apararCaracteres(limpo.replace(RE_ESPACOS, " "), " -");
}

/** Título de seção reconhecido numa linha do PPC, ou `null`. */
export function tituloDaLinha(linha: string): string | null {
  const limpa = aparar(linha);
  if (!limpa) return null;

  const markdown = RE_TITULO_MARKDOWN.exec(limpa);
  if (markdown) return limparTitulo(markdown[1]!);

  const negrito = RE_TITULO_NEGRITO.exec(limpa);
  if (negrito) {
    const candidato = limparTitulo(negrito[1]!);
    const normalizado = removerAcentos(candidato).toLowerCase();
    if (
      contarCaracteres(candidato) <= 180 &&
      MARCADORES_TITULO_NEGRITO.some((marcador) => normalizado.includes(marcador))
    ) {
      return candidato;
    }
  }
  return null;
}

export function tipoSecao(titulo: string): string {
  const n = removerAcentos(titulo).toLowerCase().replace(RE_ESPACOS, " ");
  const tem = (...termos: string[]) => termos.some((termo) => n.includes(termo));

  if (tem("identificacao", "caracteristicas do curso")) return "identificacao";
  if (tem("justificativa")) return "justificativa";
  if (tem("objetivo")) return "objetivos";
  if (tem("perfil") && tem("egresso", "conclusao", "profissional")) return "perfil_egresso";
  if (tem("concepcao", "pressupostos pedagogicos", "orientacao metodologica")) return "concepcao_pedagogica";
  if (tem("organizacao curricular")) return "organizacao_curricular";
  if (tem("matriz curricular")) return "matriz_curricular";
  if (tem("ementa")) return "ementas";
  if (tem("avaliacao")) return "avaliacao";
  if (tem("estagio", "pratica profissional", "praticas profissionais")) return "estagio_praticas";
  if (tem("infraestrutura")) return "infraestrutura";
  if (tem("corpo docente", "pessoal docente", "perfil do pessoal")) return "corpo_docente";
  if (tem("referencia")) return "referencias";
  return "outros";
}

/** Divide o Markdown em pares (título, texto limpo), descartando seções com menos de 40 caracteres. */
export function dividirSecoes(markdown: string): Array<[string, string]> {
  const secoes: Array<[string, string]> = [];
  let tituloAtual: string | null = null;
  let linhasAtuais: string[] = [];
  const fechar = () => {
    if (tituloAtual === null) return;
    const texto = limparTexto(linhasAtuais.join("\n"));
    if (contarCaracteres(texto) >= 40) secoes.push([tituloAtual, texto]);
  };

  for (const linha of dividirLinhas(markdown)) {
    const titulo = tituloDaLinha(linha);
    if (titulo) {
      fechar();
      tituloAtual = titulo;
      linhasAtuais = [];
      continue;
    }
    if (tituloAtual !== null) linhasAtuais.push(linha);
  }
  fechar();
  return secoes;
}

export type ItemPpc = Record<string, unknown> & {
  id: string;
  campus_id: string;
  curso_slug: string;
  curso_nome: string;
  path: string;
};
export type ItemSecao = Record<string, unknown> & { section_kind: string };

function valorMetadado(ppc: ObjetoJson, chave: string, chaveInterna: string): unknown {
  const metadados = ppc.metadados;
  if (!ehObjeto(metadados)) return null;
  const valor = metadados[chave];
  if (!ehObjeto(valor)) return null;
  return valor[chaveInterna];
}

export function montarItemPpc(campus: ObjetoJson, curso: ObjetoJson, ppc: ObjetoJson): ItemPpc {
  const campusId = textoDe(campus.id);
  const cursoSlug = textoDe(curso.curso_slug);
  const item: ItemPpc = {
    id: `${campusId}/${cursoSlug}`,
    campus_id: campusId,
    campus_nome: campus.nome,
    curso_slug: cursoSlug,
    curso_nome: curso.nome as string,
    nivel: curso.nivel,
    tipo_oferta: curso.tipo_oferta,
    curso_url: curso.url,
    fonte_pdf: ppc.url,
    path: ppc.markdown_path as string,
  };
  for (const chave of ["modalidade", "situacao"]) {
    const valor = curso[chave];
    if (typeof valor === "string" && valor) item[chave] = valor;
  }
  const ano = valorMetadado(ppc, "ano_documento", "ano");
  if (ehInteiro(ano)) item.ano_documento = ano;
  const vagas = valorMetadado(ppc, "vagas", "quantidade");
  if (ehInteiro(vagas)) item.vagas = vagas;
  return item;
}

export function arquivosCampi(caminhos: CaminhosBase): string[] {
  return listarDiretorio(caminhos.campi, ".json").filter((caminho) => path.basename(caminho) !== "index.json");
}

export function coletarItensPpc(caminhos: CaminhosBase): ItemPpc[] {
  const itens: ItemPpc[] = [];
  for (const caminhoCampus of arquivosCampi(caminhos)) {
    const campus: unknown = JSON.parse(lerTexto(caminhoCampus));
    if (!ehObjeto(campus)) continue;
    for (const curso of itensDe(campus.cursos)) {
      if (!ehObjeto(curso) || !ehObjeto(curso.ppc)) continue;
      const ppc = curso.ppc;
      const caminhoMarkdown = ppc.markdown_path;
      if (
        !ehObjeto(ppc.conversao) ||
        ppc.conversao.status !== "convertido" ||
        typeof caminhoMarkdown !== "string" ||
        !existsSync(naBase(caminhos, caminhoMarkdown))
      ) {
        continue;
      }
      const obrigatorios = [
        campus.id,
        campus.nome,
        curso.curso_slug,
        curso.nome,
        curso.nivel,
        curso.tipo_oferta,
        curso.url,
        ppc.url,
      ];
      if (!obrigatorios.every((valor) => typeof valor === "string" && valor)) continue;
      itens.push(montarItemPpc(campus, curso, ppc));
    }
  }
  return itens.sort((a, b) => compararTexto(a.campus_id, b.campus_id) || compararTexto(a.curso_nome, b.curso_nome));
}

export function montarItensSecao(caminhos: CaminhosBase, itensPpc: ItemPpc[]): ItemSecao[] {
  const secoes: ItemSecao[] = [];
  for (const itemPpc of itensPpc) {
    const markdown = lerTexto(naBase(caminhos, itemPpc.path), { ignorarErros: true });
    const contadores = new Map<string, number>();
    for (const [titulo, texto] of dividirSecoes(markdown)) {
      let tipo = tipoSecao(titulo);
      if (!TIPOS_SECAO.has(tipo)) tipo = "outros";
      if (!TIPOS_SECAO_INDEXADOS.includes(tipo)) continue;
      const contador = (contadores.get(tipo) ?? 0) + 1;
      contadores.set(tipo, contador);
      secoes.push({
        id: `${itemPpc.id}#${tipo}-${contador}`,
        ppc_id: itemPpc.id,
        campus_id: itemPpc.campus_id,
        curso_slug: itemPpc.curso_slug,
        curso_nome: itemPpc.curso_nome,
        section_kind: tipo,
        heading: titulo,
        path: itemPpc.path,
        preview: prefixo(texto, LIMITE_PREVIEW_SECAO),
      });
    }
  }
  return secoes;
}

export function caminhoSecao(caminhos: CaminhosBase, tipo: string): string {
  return path.join(caminhos.secoesPpcs, `${tipo}.jsonl`);
}

export function caminhosSecoes(caminhos: CaminhosBase): Record<string, string> {
  return Object.fromEntries(
    TIPOS_SECAO_INDEXADOS.map((tipo) => [tipo, relativo(caminhos, caminhoSecao(caminhos, tipo))]),
  );
}

export function montarIndice(caminhos: CaminhosBase, itens: ItemPpc[], atualizadoEm: string) {
  return {
    title: "Projetos Pedagógicos de Curso do IFPR",
    tipo: "indice_ppcs",
    versao: 1,
    atualizado_em: atualizadoEm,
    total_itens: itens.length,
    secoes: { preview_limite: LIMITE_PREVIEW_SECAO, paths: caminhosSecoes(caminhos) },
    items: itens,
  };
}

export function secoesJsonl(itens: ItemSecao[]): string {
  return itens.map((item) => `${jsonCompacto(item)}\n`).join("");
}

export function agruparPorTipo(itens: ItemSecao[]): Map<string, ItemSecao[]> {
  const grupos = new Map<string, ItemSecao[]>(TIPOS_SECAO_INDEXADOS.map((tipo) => [tipo, []]));
  for (const item of itens) {
    const tipo = textoDe(item.section_kind);
    if (!grupos.has(tipo)) grupos.set(tipo, []);
    grupos.get(tipo)!.push(item);
  }
  return grupos;
}

/** Data `atualizado_em` do índice atual, ou `hoje` se ausente/ilegível. */
export function dataIndiceAtual(caminhos: CaminhosBase, hoje: string): string {
  if (!existsSync(caminhos.indicePpcs)) return hoje;
  let dados: unknown;
  try {
    dados = JSON.parse(lerTexto(caminhos.indicePpcs));
  } catch {
    return hoje;
  }
  if (ehObjeto(dados) && typeof dados.atualizado_em === "string") return dados.atualizado_em;
  return hoje;
}

export type IndicesPpcs = {
  itensPpc: ItemPpc[];
  itensSecao: ItemSecao[];
  indice: string;
  secoes: Map<string, string>;
};

export function gerarIndices(caminhos: CaminhosBase, atualizadoEm: string): IndicesPpcs {
  const itensPpc = coletarItensPpc(caminhos);
  const itensSecao = montarItensSecao(caminhos, itensPpc);
  const secoes = new Map([...agruparPorTipo(itensSecao)].map(([tipo, itens]) => [tipo, secoesJsonl(itens)] as const));
  return { itensPpc, itensSecao, indice: jsonIndentado(montarIndice(caminhos, itensPpc, atualizadoEm)), secoes };
}

export function verificarIndices(caminhos: CaminhosBase, indices: IndicesPpcs): string[] {
  const erros: string[] = [];
  const atual = (caminho: string) => (existsSync(caminho) ? lerTexto(caminho) : null);
  if (atual(caminhos.indicePpcs) !== indices.indice) {
    erros.push(`${relativo(caminhos, caminhos.indicePpcs)} está desatualizado`);
  }
  for (const [tipo, esperado] of indices.secoes) {
    const caminho = caminhoSecao(caminhos, tipo);
    if (atual(caminho) !== esperado) erros.push(`${relativo(caminhos, caminho)} está desatualizado`);
  }
  if (existsSync(caminhos.secoesPpcs)) {
    const esperados = new Set([...indices.secoes.keys()].map((tipo) => `${tipo}.jsonl`));
    const extras = listarDiretorio(caminhos.secoesPpcs, ".jsonl")
      .map((caminho) => path.basename(caminho))
      .filter((nome) => !esperados.has(nome));
    for (const nome of ordenarTextos(new Set(extras))) {
      erros.push(`${relativo(caminhos, path.join(caminhos.secoesPpcs, nome))} não é mais gerado`);
    }
  }
  return erros;
}

export function gravarIndices(caminhos: CaminhosBase, indices: IndicesPpcs): void {
  writeFileSync(caminhos.indicePpcs, indices.indice, "utf-8");
  rmSync(path.join(path.dirname(caminhos.secoesPpcs), "secoes.jsonl"), { force: true });
  mkdirSync(caminhos.secoesPpcs, { recursive: true });
  for (const caminho of listarDiretorio(caminhos.secoesPpcs, ".jsonl")) rmSync(caminho);
  for (const [tipo, texto] of indices.secoes) writeFileSync(caminhoSecao(caminhos, tipo), texto, "utf-8");
}
