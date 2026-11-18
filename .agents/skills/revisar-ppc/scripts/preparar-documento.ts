// @effect-diagnostics nodeBuiltinImport:off -- preparação síncrona da rodada, sobre arquivos locais
/**
 * Cria a rodada de análise e o `PPC.md` canônico.
 *
 * Entrada `.md`: o Markdown é normalizado. Entrada `.docx`: a conversão em artefatos é a de
 * `@simplifica-if/ppc` (leitor OOXML próprio, sem Word), feita em memória antes de a rodada existir; a
 * leitura do DOCX, a gravação dos artefatos, a normalização do Markdown, a identificação e os
 * arquivos da rodada são feitos aqui.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { corpoPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { type Dicionario, verdadeiro } from "@simplifica-if/kb/primitivas/valores";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import {
  artefatosDaConversao,
  conferirArquivoDocx,
  type Conversao,
  converterPpc,
} from "@simplifica-if/ppc/conversao-docx/conversao";
import {
  extrairIdentificacao,
  extrairIdentificacaoDaConversao,
  type FontesIdentificacao,
  type Identificacao,
  type IdentificacaoComFontes,
  type ReferenciasIdentificacao,
  valorIdentificacaoPreenchido,
} from "./identificacao.ts";
import { normalizarMarkdown } from "@simplifica-if/ppc/normalizador-markdown";
import {
  agoraIso,
  atualizarManifestoBase,
  caminhoRelativoSeguro,
  type CaminhosRodada,
  caminhosRodada,
  escreverJsonDaRodada,
  escreverTextoDaRodada,
  lerJsonDaRodada,
  lerTexto,
  type Relogio,
  resolverCaminho,
  timestampSlug,
} from "./rodada.ts";

export type OpcoesPreparacao = {
  /** Campi e eixos reconhecidos na identificação do curso (`lerReferenciasIdentificacao`). */
  referencias: ReferenciasIdentificacao;
  saidaBase?: string;
  relogio: Relogio;
  caminhos?: CaminhosAnalise;
};

/** Caminhos dos artefatos da conversão gravados na rodada; `null` para o que o PPC não tem. */
export type ArtefatosDocx = {
  output_dir: string;
  markdown: string;
  markdown_bruto: string;
  dados: string;
  matriz_curricular: string | null;
  ementario: string | null;
};

/** Nome do arquivo sem a última extensão. */
function radical(arquivo: string): string {
  const nome = NodePath.basename(arquivo);
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(0, ponto) : nome;
}

/** Última extensão do nome do arquivo, com o ponto; vazia quando não há. */
function extensao(arquivo: string): string {
  const nome = NodePath.basename(arquivo);
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(ponto) : "";
}

function criarRodada(saidaBase: string, nomeBase: string, relogio: Relogio): string {
  const base = resolverCaminho(saidaBase);
  let rodada = NodePath.join(base, `${timestampSlug(relogio)}-${nomeBase}`);
  let sufixo = 2;
  while (NodeFS.existsSync(rodada)) {
    rodada = NodePath.join(base, `${timestampSlug(relogio)}-${nomeBase}-${sufixo}`);
    sufixo += 1;
  }
  NodeFS.mkdirSync(rodada, { recursive: true });
  return rodada;
}

/**
 * Normaliza o Markdown e grava o `PPC.md` canônico. O front matter de proveniência dos PPCs da base
 * (`---` … `---` no início) fica fora: não é texto do PPC.
 */
function prepararMarkdown(
  arquivo: string,
  caminhos: CaminhosRodada,
  referencias: ReferenciasIdentificacao,
): IdentificacaoComFontes {
  const texto = corpoPpc(lerTexto(arquivo));
  escreverTextoDaRodada(caminhos.ppc, normalizarMarkdown(texto).markdownNormalizado);
  return extrairIdentificacao(texto, referencias, radical(arquivo));
}

/** Valores preenchidos de `preferencial` sobrescrevem os de `base`. */
export function mesclarIdentificacaoPreferindoPreenchidos(
  base: Record<string, string>,
  preferencial: Record<string, string>,
): Record<string, string> {
  const mesclada = { ...base };
  for (const [chave, valor] of Object.entries(preferencial)) {
    if (valorIdentificacaoPreenchido(valor)) mesclada[chave] = valor;
  }
  return mesclada;
}

/** Copia conteúdo e datas de modificação e de acesso. */
function copiarArquivo(origem: string, destino: string): void {
  NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
  NodeFS.copyFileSync(origem, destino);
  const info = NodeFS.statSync(origem);
  NodeFS.utimesSync(destino, info.atime, info.mtime);
}

/** Lê o `.docx`, com a extensão e o tamanho conferidos antes da leitura. */
function lerArquivoDocx(arquivo: string): Uint8Array {
  conferirArquivoDocx(arquivo, NodeFS.statSync(arquivo).size);
  return NodeFS.readFileSync(arquivo);
}

/** Grava em `saida` os artefatos da conversão, com o nome do DOCX como base. */
function gravarArtefatos(conversao: Conversao, arquivoDocx: string, saida: string): ArtefatosDocx {
  const destino = NodePath.resolve(saida);
  const { arquivos, nomes } = artefatosDaConversao(conversao, NodePath.basename(arquivoDocx));
  for (const { caminho, conteudo } of arquivos) {
    const alvo = NodePath.join(destino, caminho);
    NodeFS.mkdirSync(NodePath.dirname(alvo), { recursive: true });
    NodeFS.writeFileSync(alvo, conteudo);
  }
  const em = (nome: string) => NodePath.join(destino, nome);
  return {
    output_dir: destino,
    markdown: em(nomes.markdown),
    markdown_bruto: em(nomes.markdown_bruto),
    dados: em(nomes.dados),
    matriz_curricular: nomes.matriz_curricular && em(nomes.matriz_curricular),
    ementario: nomes.ementario && em(nomes.ementario),
  };
}

function prepararDocx(
  arquivo: string,
  caminhos: CaminhosRodada,
  referencias: ReferenciasIdentificacao,
  convertido: Conversao,
): { identificacao: IdentificacaoComFontes; conversao: ArtefatosDocx } {
  const artefatos = gravarArtefatos(convertido, arquivo, caminhos.artefatosConversaoDir);
  const normalizado = normalizarMarkdown(lerTexto(artefatos.markdown)).markdownNormalizado;
  escreverTextoDaRodada(artefatos.markdown, normalizado);
  escreverTextoDaRodada(caminhos.ppc, normalizado);
  copiarArquivo(artefatos.markdown_bruto, caminhos.ppcBruto);
  // O PPC.md da conversão traz as tabelas de identificação em Markdown, então a extração do
  // Markdown vem primeiro; os dados da conversão (validados pelos mesmos critérios) só preenchem
  // o que faltar, e o nome do arquivo fica por último.
  const { fontes, ...doMarkdown } = extrairIdentificacao(lerTexto(caminhos.ppc), referencias);
  let identificacao = doMarkdown as Identificacao;
  const daConversao = extrairIdentificacaoDaConversao(lerJsonDaRodada(artefatos.dados), referencias);
  for (const [chave, valor] of Object.entries(daConversao) as Array<[keyof Identificacao, string]>) {
    if (valorIdentificacaoPreenchido(identificacao[chave]) || !valorIdentificacaoPreenchido(valor)) continue;
    identificacao[chave] = valor;
    const fonte = chave === "modalidade" ? null : (chave as keyof FontesIdentificacao);
    if (fonte) fontes[fonte] = "conversao";
  }
  if (!valorIdentificacaoPreenchido(identificacao.curso)) {
    identificacao = { ...identificacao, curso: radical(arquivo) };
    fontes.curso = "nome_arquivo";
  }
  escreverJsonDaRodada(caminhos.preparacaoDocx, artefatos);
  return { identificacao: { ...identificacao, fontes }, conversao: artefatos };
}

export type ResultadoPreparacao = {
  rodadaDir: string;
  metadata: string;
  manifesto: string;
  ppc: string;
  resumo: Dicionario;
};

/** Cria a rodada, o `PPC.md`, `metadata.json` e `manifesto-rodada.json`. */
export function prepararDocumento(arquivoEntrada: string, opcoes: OpcoesPreparacao): ResultadoPreparacao {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const relogio = opcoes.relogio;
  const arquivo = resolverCaminho(arquivoEntrada);
  if (!NodeFS.existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
  const tipo = extensao(arquivo).toLowerCase();
  if (tipo !== ".md" && tipo !== ".docx") throw new Error("A entrada deve ser um arquivo .md ou .docx.");

  // O `.docx` é convertido em memória antes de qualquer pasta ser criada: um arquivo que não é
  // DOCX, está protegido por senha ou corrompido falha aqui, sem deixar uma rodada pela metade.
  const convertido =
    tipo === ".docx" ? converterPpc(lerArquivoDocx(arquivo), NodePath.basename(arquivo), { agora: relogio() }) : null;

  const rodada = criarRodada(
    opcoes.saidaBase || skill.outputDir,
    radical(arquivo).toLowerCase().replaceAll(" ", "-"),
    relogio,
  );
  const caminhos = caminhosRodada(rodada);
  NodeFS.mkdirSync(caminhos.suporteDir, { recursive: true });

  let identificacao: IdentificacaoComFontes;
  let conversao: ArtefatosDocx | undefined;
  if (convertido) ({ identificacao, conversao } = prepararDocx(arquivo, caminhos, opcoes.referencias, convertido));
  else identificacao = prepararMarkdown(arquivo, caminhos, opcoes.referencias);

  const metadata: Dicionario = {
    curso: identificacao.curso,
    campus: identificacao.campus,
    modalidade: identificacao.modalidade,
    arquivo_origem: arquivo,
    ppc_markdown: NodePath.relative(rodada, caminhos.ppc),
    rodada_dir: resolverCaminho(rodada),
    suporte_dir: resolverCaminho(caminhos.suporteDir),
    criado_em: agoraIso(relogio),
  };
  for (const chave of ["forma_oferta", "modalidade_ensino", "eixo_tecnologico"] as const) {
    if (verdadeiro(identificacao[chave])) metadata[chave] = identificacao[chave];
  }
  metadata.identificacao_fontes = { ...identificacao.fontes };
  if (conversao) metadata.artefatos_conversao_docx = conversao;

  escreverJsonDaRodada(caminhos.metadata, metadata);
  const manifesto = atualizarManifestoBase(rodada, { caminhos: skill, relogio });
  return {
    rodadaDir: rodada,
    metadata: caminhos.metadata,
    manifesto: caminhos.manifesto,
    ppc: caminhos.ppc,
    resumo: {
      rodada_dir: caminhoRelativoSeguro(rodada, process.cwd()),
      curso: metadata.curso,
      campus: metadata.campus,
      modalidade: metadata.modalidade,
      ppc_sha256: manifesto.ppc_sha256,
    },
  };
}
