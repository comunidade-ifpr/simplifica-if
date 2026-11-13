/**
 * Índices globais dos PPCs convertidos para Markdown (index.json e secoes/*.jsonl), versão 2.
 *
 * Cada seção traz um preview (500 caracteres do texto limpo), as linhas de início e fim no arquivo
 * `.md` (contadas com o front matter) e o tipo pela taxonomia do nível do curso (`@simplifica-if/kb/ppcs/secoes`). Cada PPC traz a
 * proveniência lida do front matter (`@simplifica-if/kb/ppcs/front-matter`).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type CaminhosBase, listarDiretorio, naBase, relativo } from "./caminhos.ts";
import {
  ehInteiro,
  ehObjeto,
  itensDe,
  jsonCompacto,
  jsonIndentado,
  type ObjetoJson,
  textoDe,
} from "@simplifica-if/kb/json";
import { analisarPpc } from "@simplifica-if/kb/ppcs/front-matter";
import {
  LIMITE_PREVIEW_SECAO,
  MINIMO_CARACTERES_SECAO,
  palavrasDeCampi,
  previewSecao,
  segmentarPpc,
  TAXONOMIAS,
  taxonomiaDoNivel,
  TIPOS_NAO_INDEXADOS,
} from "@simplifica-if/kb/ppcs/secoes";
import type { IndicePpcsJson, SecaoPpcJson } from "./tipos-schemas.ts";
import { compararTexto, contarCaracteres, lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";

export { limparTexto, limparTitulo, removerAcentos, segmentarPpc, tituloDaLinha } from "@simplifica-if/kb/ppcs/secoes";

export const VERSAO_INDICE = 2;
/** Tipos com arquivo em `secoes/`: todos os das duas taxonomias, menos `pretextual` e `outros`. */
export const TIPOS_SECAO_INDEXADOS = ordenarTextos(
  new Set(
    Object.values(TAXONOMIAS)
      .flatMap((taxonomia) => taxonomia.tipos.map((definicao) => definicao.tipo))
      .filter((tipo) => !TIPOS_NAO_INDEXADOS.has(tipo)),
  ),
);

/** Item de ppcs/index.json, no formato de schemas/ppcs_index.schema.json. */
export type ItemPpc = IndicePpcsJson["items"][number];
/** Linha de secoes/<tipo>.jsonl, no formato de schemas/ppcs_secao.schema.json. */
export type ItemSecao = SecaoPpcJson;

function valorMetadado(ppc: ObjetoJson, chave: string, chaveInterna: string): unknown {
  const metadados = ppc.metadados;
  if (!ehObjeto(metadados)) return null;
  const valor = metadados[chave];
  if (!ehObjeto(valor)) return null;
  return valor[chaveInterna];
}

function textoPreenchido(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * Item do índice para o PPC convertido `caminhoMarkdown` de um curso, ou
 * `null` se faltar algum campo textual obrigatório no campus JSON.
 * `markdown` é o texto do PPC, de onde sai a proveniência (front matter).
 */
export function montarItemPpc(
  campus: ObjetoJson,
  curso: ObjetoJson,
  ppc: ObjetoJson,
  caminhoMarkdown: string,
  markdown: string,
): ItemPpc | null {
  const campusId = textoPreenchido(campus.id);
  const campusNome = textoPreenchido(campus.nome);
  const cursoSlug = textoPreenchido(curso.curso_slug);
  const cursoNome = textoPreenchido(curso.nome);
  const nivel = textoPreenchido(curso.nivel);
  const tipoOferta = textoPreenchido(curso.tipo_oferta);
  const cursoUrl = textoPreenchido(curso.url);
  const fontePdf = textoPreenchido(ppc.url);
  if (!campusId || !campusNome || !cursoSlug || !cursoNome || !nivel || !tipoOferta || !cursoUrl || !fontePdf) {
    return null;
  }
  const { proveniencia } = analisarPpc(markdown, caminhoMarkdown);
  const item: ItemPpc = {
    id: `${campusId}/${cursoSlug}`,
    campus_id: campusId,
    campus_nome: campusNome,
    curso_slug: cursoSlug,
    curso_nome: cursoNome,
    nivel,
    taxonomia: taxonomiaDoNivel(nivel),
    tipo_oferta: tipoOferta,
    curso_url: cursoUrl,
    fonte_pdf: fontePdf,
    path: caminhoMarkdown,
    proveniencia: {
      situacao: proveniencia.proveniencia,
      fonte_url: proveniencia.fonte_url,
      fonte_sha256: proveniencia.fonte_sha256,
      convertido_em: proveniencia.convertido_em,
      conversor: proveniencia.conversor,
    },
  };
  const modalidade = textoPreenchido(curso.modalidade);
  if (modalidade) item.modalidade = modalidade;
  const situacao = textoPreenchido(curso.situacao);
  if (situacao) item.situacao = situacao;
  // Um booleano só aparece em campus JSON inválido; ele segue como está e o validador o acusa.
  const ano = valorMetadado(ppc, "ano_documento", "ano");
  if (ehInteiro(ano)) item.ano_documento = ano as number;
  const vagas = valorMetadado(ppc, "vagas", "quantidade");
  if (ehInteiro(vagas)) item.vagas = vagas as number;
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
      const markdown = lerTexto(naBase(caminhos, caminhoMarkdown), { ignorarErros: true });
      const item = montarItemPpc(campus, curso, ppc, caminhoMarkdown, markdown);
      if (item) itens.push(item);
    }
  }
  return itens.sort((a, b) => compararTexto(a.campus_id, b.campus_id) || compararTexto(a.curso_nome, b.curso_nome));
}

/** Seções indexadas de todos os PPCs, na ordem dos PPCs e, dentro de cada um, na ordem do texto. */
export function montarItensSecao(caminhos: CaminhosBase, itensPpc: ItemPpc[]): ItemSecao[] {
  const palavras = palavrasDeCampi(itensPpc.map((item) => item.campus_nome));
  const secoes: ItemSecao[] = [];
  for (const itemPpc of itensPpc) {
    const markdown = lerTexto(naBase(caminhos, itemPpc.path), { ignorarErros: true });
    const contadores = new Map<string, number>();
    for (const secao of segmentarPpc(markdown, itemPpc.taxonomia, palavras)) {
      if (TIPOS_NAO_INDEXADOS.has(secao.tipo)) continue;
      if (contarCaracteres(secao.textoLimpo) < MINIMO_CARACTERES_SECAO) continue;
      const contador = (contadores.get(secao.tipo) ?? 0) + 1;
      contadores.set(secao.tipo, contador);
      const item: ItemSecao = {
        id: `${itemPpc.id}#${secao.tipo}-${contador}`,
        ppc_id: itemPpc.id,
        campus_id: itemPpc.campus_id,
        curso_slug: itemPpc.curso_slug,
        curso_nome: itemPpc.curso_nome,
        nivel: itemPpc.nivel,
        taxonomia: itemPpc.taxonomia,
        section_kind: secao.tipo as ItemSecao["section_kind"],
        origem_tipo: secao.origem as ItemSecao["origem_tipo"],
        heading: secao.titulo,
        ...(secao.numeracao ? { numeracao: secao.numeracao } : {}),
        path: itemPpc.path,
        linha_inicio: secao.linhaInicio,
        linha_fim: secao.linhaFim,
        preview: previewSecao(secao),
      };
      secoes.push(item);
    }
  }
  return secoes;
}

export function caminhoSecao(caminhos: CaminhosBase, tipo: string): string {
  return path.join(caminhos.secoesPpcs, `${tipo}.jsonl`);
}

/** Caminho de cada `secoes/<tipo>.jsonl`; o schema fixa um caminho por tipo indexado. */
export function caminhosSecoes(caminhos: CaminhosBase): IndicePpcsJson["secoes"]["paths"] {
  return Object.fromEntries(
    TIPOS_SECAO_INDEXADOS.map((tipo) => [tipo, relativo(caminhos, caminhoSecao(caminhos, tipo))]),
  ) as IndicePpcsJson["secoes"]["paths"];
}

type TipoPublicado = IndicePpcsJson["secoes"]["taxonomias"]["tecnico"]["tipos"][number]["tipo"];

/** Taxonomias publicadas no índice, para quem consulta saber o que cada tipo cobre. */
export function taxonomiasPublicadas(): IndicePpcsJson["secoes"]["taxonomias"] {
  const publicar = (nome: keyof typeof TAXONOMIAS) => ({
    descricao: TAXONOMIAS[nome].descricao,
    niveis: TAXONOMIAS[nome].niveis,
    tipos: TAXONOMIAS[nome].tipos.map((definicao) => ({
      tipo: definicao.tipo as TipoPublicado,
      rotulo: definicao.rotulo,
      indexado: !TIPOS_NAO_INDEXADOS.has(definicao.tipo),
      ...(definicao.art28 ? { art28: definicao.art28 } : {}),
    })),
  });
  return { tecnico: publicar("tecnico"), geral: publicar("geral") };
}

export function montarIndice(caminhos: CaminhosBase, itens: ItemPpc[], atualizadoEm: string): IndicePpcsJson {
  return {
    title: "Projetos Pedagógicos de Curso do IFPR",
    tipo: "indice_ppcs",
    versao: VERSAO_INDICE,
    atualizado_em: atualizadoEm,
    total_itens: itens.length,
    secoes: {
      preview_limite: LIMITE_PREVIEW_SECAO,
      minimo_caracteres: MINIMO_CARACTERES_SECAO,
      paths: caminhosSecoes(caminhos),
      taxonomias: taxonomiasPublicadas(),
    },
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
