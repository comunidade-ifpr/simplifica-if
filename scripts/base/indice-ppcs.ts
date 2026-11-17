// @effect-diagnostics nodeBuiltinImport:off -- gera e grava os índices de PPCs com node:fs síncrono, num script de execução única (gerar_indice_ppcs)
/**
 * Índices globais dos PPCs convertidos para Markdown (index.json e secoes/*.jsonl), versão 2.
 *
 * Cada seção traz um preview (500 caracteres do texto limpo), as linhas de início e fim no arquivo
 * `.md` (contadas com o front matter) e o tipo pela taxonomia do nível do curso (`@simplifica-if/kb/ppcs/secoes`). Cada PPC traz a
 * proveniência lida do front matter (`@simplifica-if/kb/ppcs/front-matter`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { type CaminhosBase, listarDiretorio, naBase, relativo } from "./caminhos.ts";
import {
  ehObjeto,
  jsonCompacto,
  jsonIndentado,
  textoDe,
} from "@simplifica-if/kb/json";
import { analisarPpc } from "@simplifica-if/kb/ppcs/front-matter";
import {
  LIMITE_PREVIEW_SECAO,
  MINIMO_CARACTERES_SECAO,
  palavrasDeCampi,
  previewSecao,
  secoesIndexadas,
  TAXONOMIAS,
  taxonomiaDoNivel,
  TIPOS_NAO_INDEXADOS,
} from "@simplifica-if/kb/ppcs/secoes";
import type { IndicePpcsJson, SecaoPpcJson } from "./tipos-schemas.ts";
import { carregarDadosInstitucionais, type CampusLocal, type CursoLocal } from "../dados/institucional.ts";
import { interpretarVagasPpc } from "../dominio/curso.ts";
import { compararTexto, lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";

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

function textoPreenchido(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

/**
 * Item do índice para o PPC convertido `caminhoMarkdown` de um curso, ou
 * `null` se faltar algum campo textual obrigatório no registro do curso.
 * `markdown` é o texto do PPC, de onde sai a proveniência (front matter).
 */
export function montarItemPpc(
  campus: CampusLocal,
  curso: CursoLocal,
  caminhoMarkdown: string,
  markdown: string,
): ItemPpc | null {
  const campusId = textoPreenchido(campus.campus_id);
  const campusNome = textoPreenchido(campus.nome);
  const cursoSlug = textoPreenchido(curso.curso_slug);
  const cursoNome = textoPreenchido(curso.nome);
  const nivel = textoPreenchido(curso.nivel);
  const tipoOferta = textoPreenchido(curso.forma_oferta);
  const cursoUrl = textoPreenchido(curso.pagina_oficial);
  const fontePdf = textoPreenchido(curso.ppc?.url);
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
  const ano = curso.ppc?.ano_documento;
  if (ano !== undefined) item.ano_documento = ano;
  // As vagas do PPC só valem com o trecho do documento que as sustenta.
  const vagas = curso.ppc?.trecho_vagas ? interpretarVagasPpc(curso.ppc.vagas ?? "") : null;
  if (vagas) item.vagas = vagas.quantidade;
  return item;
}

/** Itens do índice: os cursos de `institucional/ifpr/cursos/` com PPC convertido presente na base. */
export function coletarItensPpc(caminhos: CaminhosBase): ItemPpc[] {
  // Registro inválido fica de fora; o validar_base o acusa.
  const { dados } = carregarDadosInstitucionais(NodePath.join(caminhos.institucional, "ifpr"));
  const campi = new Map(dados.campi.map((campus) => [campus.campus_id, campus]));
  const itens: ItemPpc[] = [];
  for (const curso of dados.cursos) {
    const campus = campi.get(curso.campus_id);
    const caminhoMarkdown = curso.ppc?.markdown_path;
    if (!campus || !curso.ppc?.url || !caminhoMarkdown || !NodeFS.existsSync(naBase(caminhos, caminhoMarkdown))) {
      continue;
    }
    const markdown = lerTexto(naBase(caminhos, caminhoMarkdown), { ignorarErros: true });
    const item = montarItemPpc(campus, curso, caminhoMarkdown, markdown);
    if (item) itens.push(item);
  }
  return itens.sort(
    (a, b) =>
      compararTexto(a.campus_id, b.campus_id) ||
      compararTexto(a.curso_nome, b.curso_nome) ||
      compararTexto(a.curso_slug, b.curso_slug),
  );
}

/** Seções indexadas de todos os PPCs, na ordem dos PPCs e, dentro de cada um, na ordem do texto. */
export function montarItensSecao(caminhos: CaminhosBase, itensPpc: ItemPpc[]): ItemSecao[] {
  const palavras = palavrasDeCampi(itensPpc.map((item) => item.campus_nome));
  const secoes: ItemSecao[] = [];
  for (const itemPpc of itensPpc) {
    const markdown = lerTexto(naBase(caminhos, itemPpc.path), { ignorarErros: true });
    for (const secao of secoesIndexadas(markdown, itemPpc.taxonomia, palavras)) {
      const item: ItemSecao = {
        id: `${itemPpc.id}#${secao.chave}`,
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
  return NodePath.join(caminhos.secoesPpcs, `${tipo}.jsonl`);
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
  if (!NodeFS.existsSync(caminhos.indicePpcs)) return hoje;
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
  const atual = (caminho: string) => (NodeFS.existsSync(caminho) ? lerTexto(caminho) : null);
  if (atual(caminhos.indicePpcs) !== indices.indice) {
    erros.push(`${relativo(caminhos, caminhos.indicePpcs)} está desatualizado`);
  }
  for (const [tipo, esperado] of indices.secoes) {
    const caminho = caminhoSecao(caminhos, tipo);
    if (atual(caminho) !== esperado) erros.push(`${relativo(caminhos, caminho)} está desatualizado`);
  }
  if (NodeFS.existsSync(caminhos.secoesPpcs)) {
    const esperados = new Set([...indices.secoes.keys()].map((tipo) => `${tipo}.jsonl`));
    const extras = listarDiretorio(caminhos.secoesPpcs, ".jsonl")
      .map((caminho) => NodePath.basename(caminho))
      .filter((nome) => !esperados.has(nome));
    for (const nome of ordenarTextos(new Set(extras))) {
      erros.push(`${relativo(caminhos, NodePath.join(caminhos.secoesPpcs, nome))} não é mais gerado`);
    }
  }
  return erros;
}

export function gravarIndices(caminhos: CaminhosBase, indices: IndicesPpcs): void {
  NodeFS.writeFileSync(caminhos.indicePpcs, indices.indice, "utf-8");
  NodeFS.rmSync(NodePath.join(NodePath.dirname(caminhos.secoesPpcs), "secoes.jsonl"), { force: true });
  NodeFS.mkdirSync(caminhos.secoesPpcs, { recursive: true });
  for (const caminho of listarDiretorio(caminhos.secoesPpcs, ".jsonl")) NodeFS.rmSync(caminho);
  for (const [tipo, texto] of indices.secoes) NodeFS.writeFileSync(caminhoSecao(caminhos, tipo), texto, "utf-8");
}
