// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off -- importação síncrona de um DOCX local para a base, com node:fs e node:crypto, como o resto do pipeline da base; a recusa é erro síncrono que a casca do script imprime
/**
 * Entrada de um PPC na base a partir do DOCX que a coordenação do curso envia: converte com
 * `converterPpc` (`packages/ppc`), tira dados pessoais e URLs internas, grava o Markdown com o front
 * matter de proveniência `registrada` em `ppc.markdown_path` e atualiza o registro do curso
 * (`ppc.url` = `fonte_url`, que o `validar_base` exige iguais).
 *
 * O `fonte_sha256` fica `desconhecido`: ele é o hash dos bytes de `fonte_url` (em geral o PDF
 * publicado), que a importação não baixa. O hash do DOCX convertido vai em `arquivo_convertido_sha256`.
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
import { DESCONHECIDO, idPpc, serializarFrontMatterPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { conferirArquivoDocx, converterPpc } from "@simplifica-if/ppc/conversao-docx/conversao";
import type { RepresentacaoGrafica } from "@simplifica-if/ppc/conversao-docx/figura";
import { esquemaCursoLocal, esquemaPpcCurso, textoRegistro, type CursoLocal } from "../dados/institucional.ts";
import {
  type ContagemUrls,
  ehUrlAssinada,
  limparUrlsInternas,
  RE_PLANILHA_GOOGLE,
  RE_URL_ASSINADA,
  RE_URL_SESSAO_SEI,
} from "../dados/urls.ts";
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
  urlsLimpas: ContagemUrls;
  /** Campos de curadoria (`ano`, `vagas`) reabertos como "Precisa de revisão". */
  curadoriaReaberta: string[];
  /** `ppc.observacoes` foi mantido, mas foi escrito sobre o texto anterior: reconferir. */
  observacoesAReconferir: boolean;
  /** Método da representação gráfica, quando o PPC tem a seção. */
  representacaoGrafica: string | null;
};

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STATUS_REABERTO = "Precisa de revisão";

const decodificarCurso = Schema.decodeUnknownResult(esquemaCursoLocal, ESTRITO);
const ORDEM_CURSO = Object.keys(esquemaCursoLocal.fields);
const ORDEM_PPC = Object.keys(esquemaPpcCurso.fields);

const AVISO_FIGURA =
  "**Aviso da conversão:** a representação gráfica desta seção é uma figura do documento original, " +
  "que a base não publica. Consulte-a no PPC em `fonte_url`.";

const NOTA_DOCX =
  "Convertido do DOCX enviado pela coordenação do curso; o hash desse DOCX está em arquivo_convertido_sha256. " +
  "fonte_url é o endereço publicado do PPC (ppc.url), em geral um PDF gerado do mesmo documento, " +
  "que não foi baixado: por isso fonte_sha256 é desconhecido.";

/** A URL sem query nem fragmento, para as mensagens: a query pode trazer assinatura ou sessão. */
function semQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

function lerCurso(
  caminhos: CaminhosBase,
  campusId: string,
  cursoSlug: string,
): { registro: CursoLocal; relativo: string; arquivo: string } {
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
  return { registro: resultado.success, relativo, arquivo };
}

function conferirFonteUrl(url: string): void {
  // A assinatura vem antes do esquema: uma URL assinada em `http` também não aparece na mensagem.
  if (ehUrlAssinada(url) || RE_URL_ASSINADA.test(url)) {
    throw new ErroImportacao(`--fonte-url é URL pré-assinada; use o endereço público: ${semQuery(url)}`);
  }
  if (url.match(RE_PLANILHA_GOOGLE) || RE_URL_SESSAO_SEI.test(url)) {
    throw new ErroImportacao(
      "--fonte-url é planilha do Google ou link de sessão do SEI; use o endereço público do PPC",
    );
  }
  if (!/^https:\/\/\S+$/.test(url)) throw new ErroImportacao(`--fonte-url deve ser URL https: ${semQuery(url)}`);
}

/**
 * Troca o bloco da representação gráfica que aponta para `imagens/` (figura ou arquivo vetorial que a
 * base não publica) pelo aviso. Se o bloco não está no texto, ou se a referência ao arquivo sobra,
 * é falha do importador, não do documento: recusa em vez de publicar um link quebrado.
 */
export function semFiguraLocal(texto: string, grafica: RepresentacaoGrafica | null): string {
  if (!grafica?.arquivo) return texto;
  if (!texto.includes(grafica.bloco)) {
    throw new ErroImportacao(
      "A conversão não trouxe o bloco da representação gráfica onde o importador o procura; " +
        "nada foi gravado (corrija scripts/base/importar-ppc.ts)",
    );
  }
  const trocado = texto.replace(grafica.bloco, () => AVISO_FIGURA);
  if (trocado.includes(grafica.arquivo.caminho)) {
    throw new ErroImportacao(
      `O Markdown ainda cita ${grafica.arquivo.caminho} depois do aviso; nada foi gravado (corrija scripts/base/importar-ppc.ts)`,
    );
  }
  return trocado;
}

/** Corpo do Markdown da base: a conversão sem figura local, URLs internas e dados pessoais. */
function markdownDaBase(
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
  const grafica = conversao.representacaoGrafica;
  const urls = limparUrlsInternas(semFiguraLocal(conversao.markdown, grafica));
  const { texto: corpo, contagem } = aplicarOmissao(urls.texto);
  if (!corpo.trim()) throw new ErroImportacao("Conversão vazia: o DOCX não produziu texto para a base.");
  return {
    corpo: corpo.endsWith("\n") ? corpo : `${corpo}\n`,
    omitidos: contagem,
    urlsLimpas: urls.contagem,
    representacaoGrafica: grafica?.metodo ?? null,
  };
}

/**
 * `objeto` com `chave` = `valor`: no mesmo lugar, se a chave já existe; senão, antes da primeira chave
 * existente que vem depois dela em `ordem` (a ordem dos campos do schema). As outras chaves não mudam
 * de posição, para o registro já completo sair igual byte a byte.
 */
function comChave<T extends object>(objeto: T, chave: string, valor: unknown, ordem: readonly string[]): T {
  if (chave in objeto) return { ...objeto, [chave]: valor };
  const depois = new Set(ordem.slice(ordem.indexOf(chave) + 1));
  const entradas: Array<[string, unknown]> = Object.entries(objeto);
  const posicao = entradas.findIndex(([nome]) => depois.has(nome));
  entradas.splice(posicao === -1 ? entradas.length : posicao, 0, [chave, valor]);
  return Object.fromEntries(entradas) as T;
}

export type Gravacao = { destino: string; texto: string };

/**
 * Grava os arquivos juntos: cada texto vai primeiro para um temporário na pasta do destino e só
 * depois, com todos escritos, é renomeado sobre o destino. Se uma troca falha, as já feitas são
 * desfeitas (o arquivo anterior volta, o novo sai) e o erro sobe. `renomear` é o `renameSync`; os
 * testes o trocam para simular a falha.
 */
export function gravarJuntos(
  gravacoes: Gravacao[],
  renomear: (de: string, para: string) => void = NodeFS.renameSync,
): void {
  const sufixo = `${NodeCrypto.randomBytes(4).toString("hex")}.tmp`;
  const itens = gravacoes.map((gravacao) => ({
    ...gravacao,
    temporario: NodePath.join(NodePath.dirname(gravacao.destino), `.${NodePath.basename(gravacao.destino)}.${sufixo}`),
    anterior: NodeFS.existsSync(gravacao.destino) ? NodeFS.readFileSync(gravacao.destino) : null,
    pastaCriada: undefined as string | undefined,
  }));
  const trocados: typeof itens = [];
  try {
    for (const item of itens) {
      item.pastaCriada = NodeFS.mkdirSync(NodePath.dirname(item.destino), { recursive: true });
      NodeFS.writeFileSync(item.temporario, item.texto, "utf-8");
    }
    for (const item of itens) {
      renomear(item.temporario, item.destino);
      trocados.push(item);
    }
  } catch (erro) {
    for (const item of trocados.reverse()) {
      if (item.anterior) NodeFS.writeFileSync(item.destino, item.anterior);
      else NodeFS.rmSync(item.destino, { force: true });
    }
    for (const item of itens) {
      NodeFS.rmSync(item.temporario, { force: true });
      if (item.pastaCriada) NodeFS.rmSync(item.pastaCriada, { recursive: true, force: true });
    }
    throw erro;
  }
}

/** Converte o DOCX e grava o PPC e o registro do curso. Nada é gravado se alguma conferência falha. */
export function importarPpcDocx(opcoes: OpcoesImportacao): ResultadoImportacao {
  const [campusId, cursoSlug, ...resto] = opcoes.curso.split("/");
  if (!campusId || !cursoSlug || resto.length || !RE_SLUG.test(campusId) || !RE_SLUG.test(cursoSlug)) {
    throw new ErroImportacao(`Curso deve ser <campus_id>/<curso_slug>: ${opcoes.curso}`);
  }
  conferirFonteUrl(opcoes.fonteUrl);
  const { registro, relativo, arquivo: arquivoRegistro } = lerCurso(opcoes.caminhos, campusId, cursoSlug);

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

  const arquivoDocx = NodePath.resolve(opcoes.arquivoDocx);
  if (!NodeFS.existsSync(arquivoDocx)) throw new ErroImportacao(`Arquivo não encontrado: ${arquivoDocx}`);
  try {
    conferirArquivoDocx(arquivoDocx, NodeFS.statSync(arquivoDocx).size);
  } catch (erro) {
    throw new ErroImportacao((erro as Error).message);
  }
  const bytes: Uint8Array = NodeFS.readFileSync(arquivoDocx);
  const convertido = markdownDaBase(bytes, NodePath.basename(opcoes.arquivoDocx), opcoes.agora);
  const hoje = dataLocalIso(opcoes.agora);
  const frontMatter = serializarFrontMatterPpc({
    id: idPpc(campusId, cursoSlug),
    fonte_url: opcoes.fonteUrl,
    fonte_sha256: DESCONHECIDO,
    convertido_em: hoje,
    conversor: opcoes.conversor,
    arquivo_convertido: "docx",
    arquivo_convertido_sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    proveniencia: "registrada",
    nota_proveniencia: NOTA_DOCX,
  });

  let ppc: NonNullable<CursoLocal["ppc"]> = registro.ppc ?? {};
  ppc = comChave(ppc, "url", opcoes.fonteUrl, ORDEM_PPC);
  ppc = comChave(ppc, "markdown_path", markdownPath, ORDEM_PPC);
  // Ano e vagas registrados vieram do texto anterior: voltam para revisão contra o PPC novo.
  const curadoriaReaberta: string[] = [];
  if (ppc.ano_documento !== undefined) {
    ppc = comChave(ppc, "curadoria_ano", STATUS_REABERTO, ORDEM_PPC);
    ppc = comChave(ppc, "data_curadoria_ano", hoje, ORDEM_PPC);
    curadoriaReaberta.push("ano");
  }
  if (ppc.vagas !== undefined || ppc.trecho_vagas !== undefined || ppc.periodicidade_vagas !== undefined) {
    ppc = comChave(ppc, "curadoria_vagas", STATUS_REABERTO, ORDEM_PPC);
    ppc = comChave(ppc, "data_curadoria_vagas", hoje, ORDEM_PPC);
    curadoriaReaberta.push("vagas");
  }

  // Os dois textos ficam prontos antes de qualquer escrita; a gravação é tudo ou nada.
  const textoMarkdown = frontMatter + convertido.corpo;
  const textoCurso = textoRegistro(comChave(registro, "ppc", ppc, ORDEM_CURSO));
  try {
    gravarJuntos([
      { destino, texto: textoMarkdown },
      { destino: arquivoRegistro, texto: textoCurso },
    ]);
  } catch (erro) {
    throw new ErroImportacao(`Falha ao gravar o PPC e o registro; nada foi alterado: ${(erro as Error).message}`, {
      cause: erro,
    });
  }

  return {
    markdownPath,
    registroPath: `institucional/ifpr/${relativo}`,
    substituiu: existe,
    ppcUrlAnterior: registro.ppc?.url && registro.ppc.url !== opcoes.fonteUrl ? registro.ppc.url : null,
    omitidos: convertido.omitidos,
    urlsLimpas: convertido.urlsLimpas,
    curadoriaReaberta,
    observacoesAReconferir: Boolean(registro.ppc?.observacoes),
    representacaoGrafica: convertido.representacaoGrafica,
  };
}
