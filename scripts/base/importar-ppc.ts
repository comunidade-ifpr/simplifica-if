// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off -- importação síncrona de um DOCX local para a base, com node:fs e node:crypto, como o resto do pipeline da base; a recusa é erro síncrono que a casca do script imprime
/**
 * Entrada de um PPC na base a partir do DOCX que a coordenação do curso envia: converte com
 * `converterPpc` (`packages/ppc`), tira dados pessoais e URLs internas, grava o Markdown com o front
 * matter de proveniência `registrada` em `ppc.markdown_path` e atualiza o registro do curso
 * (`ppc.url` = `fonte_url`, que o `validar_base` exige iguais).
 *
 * Não regenera índices nem o site: quem chama roda o pipeline da base depois de conferir o texto.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ErroDocx } from "@simplifica-if/docx/erro";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { aplicarOmissao, type Contagem } from "@simplifica-if/kb/ppcs/dados-pessoais";
import { idPpc, serializarFrontMatterPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { converterPpc, lerArquivoDocx } from "@simplifica-if/ppc/conversao-docx/conversao";
import { esquemaCursoLocal, gravarRegistro, type CursoLocal } from "../dados/institucional.ts";
import { ehUrlAssinada, RE_PLANILHA_GOOGLE, semAssinatura, semPlanilhasGoogle, semSessaoSei } from "../dados/urls.ts";
import { dataLocalIso } from "../datas.ts";
import { ESTRITO } from "../esquema.ts";
import type { CaminhosBase } from "./caminhos.ts";

/** Recusa da importação: a mensagem vai para o usuário como está, sem dado do documento. */
export class ErroImportacao extends Error {
  override readonly name = "ErroImportacao";
}

export type OpcoesImportacao = {
  caminhos: CaminhosBase;
  /** Chave do curso, `<campus_id>/<curso_slug>`. */
  curso: string;
  arquivoDocx: string;
  /** Endereço publicado do PPC (vira `fonte_url` e `ppc.url`). */
  fonteUrl: string;
  /** Sem ele, um PPC já gravado em `ppc.markdown_path` não é sobrescrito. */
  substituir: boolean;
  agora: Date;
  /** Conversor e versão (`conversorAtual` na linha de comando). */
  conversor: string;
};

export type ResultadoImportacao = {
  /** Relativos a `base-conhecimento/`. */
  markdownPath: string;
  registroPath: string;
  substituiu: boolean;
  ppcUrlAnterior: string | null;
  omitidos: Contagem;
  urlsLimpas: { planilhas: number; sessoesSei: number; assinadas: number };
  /** Campos de curadoria (`ano`, `vagas`) reabertos como "Precisa de revisão". */
  curadoriaReaberta: string[];
  /** Método da representação gráfica, quando o PPC tem a seção. */
  representacaoGrafica: string | null;
};

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_URL = /https?:\/\/[^\s"'<>)\]]+/gi;
const RE_SESSAO_SEI = /infra_hash\s?=\s?[0-9a-f]{8}/gi;
export const STATUS_REABERTO = "Precisa de revisão";

const decodificarCurso = Schema.decodeUnknownResult(esquemaCursoLocal, ESTRITO);

const AVISO_FIGURA =
  "**Aviso da conversão:** a representação gráfica desta seção é uma figura do documento original, " +
  "que a base não publica. Consulte-a no PPC em `fonte_url`.";

const NOTA_DOCX =
  "Convertido do DOCX enviado pela coordenação do curso. fonte_sha256 é o hash desse DOCX; fonte_url é o endereço publicado do PPC (ppc.url), que pode ser um PDF gerado do mesmo documento.";

function contar(texto: string, re: RegExp): number {
  return texto.match(re)?.length ?? 0;
}

function lerCurso(
  caminhos: CaminhosBase,
  campusId: string,
  cursoSlug: string,
): { registro: CursoLocal; relativo: string } {
  const relativo = NodePath.join("cursos", campusId, `${cursoSlug}.json`);
  const arquivo = NodePath.join(caminhos.institucional, "ifpr", relativo);
  if (!NodeFS.existsSync(arquivo)) {
    throw new ErroImportacao(
      `Curso inexistente: ${campusId}/${cursoSlug} (institucional/ifpr/${relativo} não existe). ` +
        "Crie antes o registro do curso, conforme base-conhecimento/docs/curadoria-metadados-institucionais.md.",
    );
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(NodeFS.readFileSync(arquivo, "utf-8"));
  } catch (erro) {
    throw new ErroImportacao(`institucional/ifpr/${relativo}: JSON inválido: ${(erro as Error).message}`);
  }
  const resultado = decodificarCurso(bruto);
  if (Result.isFailure(resultado)) {
    const linhas = problemas(resultado.failure.issue).map(
      (p) => `${caminhoTexto(p.caminho) || "(raiz)"}: ${p.mensagem}`,
    );
    throw new ErroImportacao(`institucional/ifpr/${relativo} fora do schema: ${linhas.join("; ")}`);
  }
  return { registro: resultado.success, relativo };
}

function conferirFonteUrl(url: string): void {
  if (!/^https:\/\/\S+$/.test(url)) throw new ErroImportacao(`--fonte-url deve ser URL https: ${url}`);
  if (ehUrlAssinada(url)) {
    throw new ErroImportacao(`--fonte-url é URL pré-assinada; use o endereço público: ${semAssinatura(url)}`);
  }
  if (contar(url, RE_PLANILHA_GOOGLE) || contar(url, RE_SESSAO_SEI)) {
    throw new ErroImportacao(
      "--fonte-url é planilha do Google ou link de sessão do SEI; use o endereço público do PPC",
    );
  }
}

/** Corpo do Markdown da base: a conversão sem figura local, URLs internas e dados pessoais. */
export function markdownDaBase(
  bytes: Uint8Array,
  nomeDoArquivo: string,
  agora: Date,
): Pick<ResultadoImportacao, "omitidos" | "urlsLimpas" | "representacaoGrafica"> & { corpo: string } {
  let conversao;
  try {
    conversao = converterPpc(bytes, nomeDoArquivo, { agora });
  } catch (erro) {
    if (erro instanceof ErroDocx) throw new ErroImportacao(`Conversão recusada: ${erro.message}`);
    throw erro;
  }
  let texto = conversao.markdown;
  // A figura (ou o arquivo vetorial) ficaria num `imagens/` que a base não publica.
  const grafica = conversao.representacaoGrafica;
  if (grafica?.arquivo) texto = texto.replace(grafica.bloco, AVISO_FIGURA);

  const urlsLimpas = {
    planilhas: contar(texto, RE_PLANILHA_GOOGLE),
    sessoesSei: contar(texto, RE_SESSAO_SEI),
    assinadas: (texto.match(RE_URL) ?? []).filter(ehUrlAssinada).length,
  };
  texto = semSessaoSei(semPlanilhasGoogle(texto)).replace(RE_URL, semAssinatura);
  const { texto: corpo, contagem } = aplicarOmissao(texto);
  if (!corpo.trim()) throw new ErroImportacao("Conversão vazia: o DOCX não produziu texto para a base.");
  return {
    corpo: corpo.endsWith("\n") ? corpo : `${corpo}\n`,
    omitidos: contagem,
    urlsLimpas,
    representacaoGrafica: grafica?.metodo ?? null,
  };
}

/** Converte o DOCX e grava o PPC e o registro do curso. Nada é gravado se alguma conferência falha. */
export function importarPpcDocx(opcoes: OpcoesImportacao): ResultadoImportacao {
  const [campusId, cursoSlug, ...resto] = opcoes.curso.split("/");
  if (!campusId || !cursoSlug || resto.length || !RE_SLUG.test(campusId) || !RE_SLUG.test(cursoSlug)) {
    throw new ErroImportacao(`Curso deve ser <campus_id>/<curso_slug>: ${opcoes.curso}`);
  }
  conferirFonteUrl(opcoes.fonteUrl);
  const { registro, relativo } = lerCurso(opcoes.caminhos, campusId, cursoSlug);

  const markdownPath = `institucional/ifpr/ppcs/${campusId}/${cursoSlug}.md`;
  if (registro.ppc?.markdown_path && registro.ppc.markdown_path !== markdownPath) {
    throw new ErroImportacao(
      `ppc.markdown_path do curso é ${registro.ppc.markdown_path}, fora do caminho esperado ${markdownPath}; corrija o registro antes`,
    );
  }
  const destino = NodePath.join(opcoes.caminhos.raiz, markdownPath);
  const existe = NodeFS.existsSync(destino);
  if (existe && !opcoes.substituir) {
    throw new ErroImportacao(
      `Já há PPC em ${markdownPath}. Para trocá-lo pela versão nova (a anterior fica no histórico do git), repita com --substituir.`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = lerArquivoDocx(opcoes.arquivoDocx);
  } catch (erro) {
    throw new ErroImportacao((erro as Error).message);
  }
  const convertido = markdownDaBase(bytes, NodePath.basename(opcoes.arquivoDocx), opcoes.agora);
  const hoje = dataLocalIso(opcoes.agora);
  const frontMatter = serializarFrontMatterPpc({
    id: idPpc(campusId, cursoSlug),
    fonte_url: opcoes.fonteUrl,
    fonte_sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    convertido_em: hoje,
    conversor: opcoes.conversor,
    proveniencia: "registrada",
    nota_proveniencia: NOTA_DOCX,
  });

  // Ano e vagas registrados vieram do texto anterior: voltam para revisão contra o PPC novo.
  const ppc = { ...registro.ppc, url: opcoes.fonteUrl, markdown_path: markdownPath };
  const curadoriaReaberta: string[] = [];
  if (ppc.ano_documento !== undefined) {
    Object.assign(ppc, { curadoria_ano: STATUS_REABERTO, data_curadoria_ano: hoje });
    curadoriaReaberta.push("ano");
  }
  if (ppc.vagas !== undefined || ppc.trecho_vagas !== undefined || ppc.periodicidade_vagas !== undefined) {
    Object.assign(ppc, { curadoria_vagas: STATUS_REABERTO, data_curadoria_vagas: hoje });
    curadoriaReaberta.push("vagas");
  }

  NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
  NodeFS.writeFileSync(destino, frontMatter + convertido.corpo, "utf-8");
  gravarRegistro(relativo, { ...registro, ppc }, NodePath.join(opcoes.caminhos.institucional, "ifpr"));

  return {
    markdownPath,
    registroPath: `institucional/ifpr/${relativo}`,
    substituiu: existe,
    ppcUrlAnterior: registro.ppc?.url && registro.ppc.url !== opcoes.fonteUrl ? registro.ppc.url : null,
    omitidos: convertido.omitidos,
    urlsLimpas: convertido.urlsLimpas,
    curadoriaReaberta,
    representacaoGrafica: convertido.representacaoGrafica,
  };
}
