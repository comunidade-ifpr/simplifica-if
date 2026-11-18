/**
 * Cria a rodada de análise e o `PPC.md` canônico.
 *
 * Entrada `.md`: o Markdown é normalizado. Entrada `.docx`: a conversão em artefatos é a de
 * `@simplifica-if/ppc` (leitor OOXML próprio, sem Word), feita em memória antes de a rodada existir; a
 * leitura do DOCX, a gravação dos artefatos, a normalização do Markdown, a identificação e os
 * arquivos da rodada são feitos aqui, pelo serviço `Rodada`.
 */
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ErroDocx } from "@simplifica-if/docx/erro";
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
import * as Rodada from "./rodada.ts";
import { agoraIso, type CaminhosRodada, caminhosRodada, type Relogio, timestampSlug } from "./rodada.ts";

/** A entrada de `preparar-documento` não existe ou não é `.md` nem `.docx`. */
export class EntradaDaRodadaInvalida extends Schema.TaggedError<EntradaDaRodadaInvalida>()("EntradaDaRodadaInvalida", {
  arquivo: Schema.String,
  motivo: Schema.Literals(["ausente", "extensao"]),
}) {
  override get message(): string {
    return this.motivo === "ausente"
      ? `Arquivo não encontrado: ${this.arquivo}`
      : "A entrada deve ser um arquivo .md ou .docx.";
  }
}

/**
 * O `.docx` não pôde ser convertido: não é DOCX, está protegido, corrompido ou passa dos limites. A
 * mensagem é a do `ErroDocx` da conversão, escrita em português para quem enviou o arquivo, sem
 * texto do documento; enquanto o `ErroDocx` não tem um motivo estruturado (unidade D7 da revisão de
 * arquitetura), ela vem dele em `motivo`.
 */
export class DocxInvalido extends Schema.TaggedError<DocxInvalido>()("DocxInvalido", {
  arquivo: Schema.String,
  motivo: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.motivo;
  }
}

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
function radical(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(0, ponto) : nome;
}

/** Última extensão do nome do arquivo, com o ponto; vazia quando não há. */
function extensao(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 && ponto < nome.length - 1 ? nome.slice(ponto) : "";
}

const criarRodada = Effect.fn("preparar_documento.criarRodada")(function* (
  saidaBase: string,
  nomeBase: string,
  relogio: Relogio,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const base = yield* rodada.resolverCaminho(saidaBase);
  let dir = path.join(base, `${timestampSlug(relogio)}-${nomeBase}`);
  let sufixo = 2;
  while (yield* rodada.existe(dir)) {
    dir = path.join(base, `${timestampSlug(relogio)}-${nomeBase}-${sufixo}`);
    sufixo += 1;
  }
  yield* rodada.criarDiretorio(dir);
  return dir;
});

/**
 * Normaliza o Markdown e grava o `PPC.md` canônico. O front matter de proveniência dos PPCs da base
 * (`---` … `---` no início) fica fora: não é texto do PPC.
 */
const prepararMarkdown = Effect.fn("preparar_documento.prepararMarkdown")(function* (
  arquivo: string,
  caminhos: CaminhosRodada,
  referencias: ReferenciasIdentificacao,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const texto = corpoPpc(yield* rodada.lerTexto(arquivo));
  yield* rodada.escreverTexto(caminhos.ppc, normalizarMarkdown(texto).markdownNormalizado);
  const identificacao: IdentificacaoComFontes = extrairIdentificacao(
    texto,
    referencias,
    radical(path.basename(arquivo)),
  );
  return identificacao;
});

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

/**
 * Roda um passo síncrono da conversão: o `ErroDocx` dele vira `DocxInvalido`; outra exceção é
 * defeito.
 */
const passoDocx = <A>(arquivo: string, passo: () => A): Effect.Effect<A, DocxInvalido> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(passo());
    } catch (cause) {
      if (cause instanceof ErroDocx) return Effect.fail(new DocxInvalido({ arquivo, motivo: cause.message, cause }));
      throw cause;
    }
  });

/** Lê o `.docx`, com a extensão e o tamanho conferidos antes da leitura, e o converte em memória. */
const lerEConverterDocx = Effect.fn("preparar_documento.lerEConverterDocx")(function* (
  arquivo: string,
  relogio: Relogio,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const tamanho = yield* rodada.tamanho(arquivo);
  yield* passoDocx(arquivo, () => conferirArquivoDocx(arquivo, tamanho));
  const bytes = yield* rodada.lerBytes(arquivo);
  return yield* passoDocx(arquivo, () => converterPpc(bytes, path.basename(arquivo), { agora: relogio() }));
});

/** Grava em `saida` os artefatos da conversão, com o nome do DOCX como base. */
const gravarArtefatos = Effect.fn("preparar_documento.gravarArtefatos")(function* (
  conversao: Conversao,
  arquivoDocx: string,
  saida: string,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const destino = path.resolve(saida);
  const { arquivos, nomes } = artefatosDaConversao(conversao, path.basename(arquivoDocx));
  for (const { caminho, conteudo } of arquivos) yield* rodada.escreverArquivo(path.join(destino, caminho), conteudo);
  const em = (nome: string) => path.join(destino, nome);
  const artefatos: ArtefatosDocx = {
    output_dir: destino,
    markdown: em(nomes.markdown),
    markdown_bruto: em(nomes.markdown_bruto),
    dados: em(nomes.dados),
    matriz_curricular: nomes.matriz_curricular && em(nomes.matriz_curricular),
    ementario: nomes.ementario && em(nomes.ementario),
  };
  return artefatos;
});

const prepararDocx = Effect.fn("preparar_documento.prepararDocx")(function* (
  arquivo: string,
  caminhos: CaminhosRodada,
  referencias: ReferenciasIdentificacao,
  convertido: Conversao,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const artefatos = yield* gravarArtefatos(convertido, arquivo, caminhos.artefatosConversaoDir);
  const normalizado = normalizarMarkdown(yield* rodada.lerTexto(artefatos.markdown)).markdownNormalizado;
  yield* rodada.escreverTexto(artefatos.markdown, normalizado);
  yield* rodada.escreverTexto(caminhos.ppc, normalizado);
  yield* rodada.copiarArquivo(artefatos.markdown_bruto, caminhos.ppcBruto, { preservarDatas: true });
  // O PPC.md da conversão traz as tabelas de identificação em Markdown, então a extração do
  // Markdown vem primeiro; os dados da conversão (validados pelos mesmos critérios) só preenchem
  // o que faltar, e o nome do arquivo fica por último.
  const { fontes, ...doMarkdown } = extrairIdentificacao(yield* rodada.lerTexto(caminhos.ppc), referencias);
  let identificacao = doMarkdown as Identificacao;
  const daConversao = extrairIdentificacaoDaConversao(yield* rodada.lerJson(artefatos.dados), referencias);
  for (const [chave, valor] of Object.entries(daConversao) as Array<[keyof Identificacao, string]>) {
    if (valorIdentificacaoPreenchido(identificacao[chave]) || !valorIdentificacaoPreenchido(valor)) continue;
    identificacao[chave] = valor;
    const fonte = chave === "modalidade" ? null : (chave as keyof FontesIdentificacao);
    if (fonte) fontes[fonte] = "conversao";
  }
  if (!valorIdentificacaoPreenchido(identificacao.curso)) {
    identificacao = { ...identificacao, curso: radical(path.basename(arquivo)) };
    fontes.curso = "nome_arquivo";
  }
  yield* rodada.escreverJson(caminhos.preparacaoDocx, artefatos);
  const preparado: { identificacao: IdentificacaoComFontes; conversao: ArtefatosDocx } = {
    identificacao: { ...identificacao, fontes },
    conversao: artefatos,
  };
  return preparado;
});

export type ResultadoPreparacao = {
  rodadaDir: string;
  metadata: string;
  manifesto: string;
  ppc: string;
  resumo: Dicionario;
};

/**
 * Cria a rodada, o `PPC.md`, `metadata.json` e `manifesto-rodada.json`. O `rodada_dir` do resumo é
 * relativo ao diretório atual (`.`, que o `Path` resolve) quando a rodada está dentro dele.
 */
export const prepararDocumento = Effect.fn("preparar_documento.prepararDocumento")(function* (
  arquivoEntrada: string,
  opcoes: OpcoesPreparacao,
) {
  const rodada = yield* Rodada.Rodada;
  const path = yield* Path.Path;
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const relogio = opcoes.relogio;
  const arquivo = yield* rodada.resolverCaminho(arquivoEntrada);
  if (!(yield* rodada.existe(arquivo))) return yield* new EntradaDaRodadaInvalida({ arquivo, motivo: "ausente" });
  const tipo = extensao(path.basename(arquivo)).toLowerCase();
  if (tipo !== ".md" && tipo !== ".docx") return yield* new EntradaDaRodadaInvalida({ arquivo, motivo: "extensao" });

  // O `.docx` é convertido em memória antes de qualquer pasta ser criada: um arquivo que não é
  // DOCX, está protegido por senha ou corrompido falha aqui, sem deixar uma rodada pela metade.
  const convertido = tipo === ".docx" ? yield* lerEConverterDocx(arquivo, relogio) : null;

  const rodadaDir = yield* criarRodada(
    opcoes.saidaBase || skill.outputDir,
    radical(path.basename(arquivo)).toLowerCase().replaceAll(" ", "-"),
    relogio,
  );
  const caminhos = caminhosRodada(rodadaDir);
  yield* rodada.criarDiretorio(caminhos.suporteDir);

  let identificacao: IdentificacaoComFontes;
  let conversao: ArtefatosDocx | undefined;
  if (convertido) {
    ({ identificacao, conversao } = yield* prepararDocx(arquivo, caminhos, opcoes.referencias, convertido));
  } else identificacao = yield* prepararMarkdown(arquivo, caminhos, opcoes.referencias);

  const metadata: Dicionario = {
    curso: identificacao.curso,
    campus: identificacao.campus,
    modalidade: identificacao.modalidade,
    arquivo_origem: arquivo,
    ppc_markdown: path.relative(rodadaDir, caminhos.ppc),
    rodada_dir: yield* rodada.resolverCaminho(rodadaDir),
    suporte_dir: yield* rodada.resolverCaminho(caminhos.suporteDir),
    criado_em: agoraIso(relogio),
  };
  for (const chave of ["forma_oferta", "modalidade_ensino", "eixo_tecnologico"] as const) {
    if (verdadeiro(identificacao[chave])) metadata[chave] = identificacao[chave];
  }
  metadata.identificacao_fontes = { ...identificacao.fontes };
  if (conversao) metadata.artefatos_conversao_docx = conversao;

  yield* rodada.escreverJson(caminhos.metadata, metadata);
  const manifesto = yield* Rodada.atualizarManifestoBase(rodadaDir, { caminhos: skill, relogio });
  const resultado: ResultadoPreparacao = {
    rodadaDir,
    metadata: caminhos.metadata,
    manifesto: caminhos.manifesto,
    ppc: caminhos.ppc,
    resumo: {
      rodada_dir: yield* Rodada.caminhoRelativoSeguro(rodadaDir, "."),
      curso: metadata.curso,
      campus: metadata.campus,
      modalidade: metadata.modalidade,
      ppc_sha256: manifesto.ppc_sha256,
    },
  };
  return resultado;
});
