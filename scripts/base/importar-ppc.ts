// @effect-diagnostics nodeBuiltinImport:off -- a conversão e a gravação atômica do DOCX local seguem síncronas, com node:fs e node:crypto, como o resto do pipeline da base; `importarPpcDocx` as leva para o canal de erro numa só fronteira
/**
 * Entrada de um PPC na base a partir do DOCX que a coordenação do curso envia: converte com
 * `converterPpc` (`packages/ppc`), tira dados pessoais e URLs internas, grava o Markdown com o front
 * matter de proveniência `registrada` como versão nova do PPC do curso
 * (`ppcs/<campus>/<curso>/<versao>.md`, ID permanente) e aponta o registro do curso para ela
 * (`ppc.markdown_path`, `ppc.url` = `fonte_url`, `ppc.ano_documento`). O PPC que era o vigente fica
 * na base, substituído; só a reconversão do mesmo documento grava por cima dele.
 *
 * O `fonte_sha256` fica `desconhecido`: ele é o hash dos bytes de `fonte_url` (em geral o PDF
 * publicado), que a importação não baixa. O hash do DOCX convertido vai em `arquivo_convertido_sha256`.
 *
 * Não regenera os índices: quem chama roda o pipeline da base depois de conferir o texto.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ErroDocx } from "@simplifica-if/docx/erro";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { aplicarOmissao, type Contagem } from "@simplifica-if/kb/ppcs/dados-pessoais";
import {
  conferirEvidenciaAno,
  DESCONHECIDO,
  FONTE_TEXTO,
  serializarFrontMatterPendente,
  serializarFrontMatterPpc,
} from "@simplifica-if/kb/ppcs/front-matter";
import { caminhoPpc, compararVersoesPpc, idPpc, PASTA_PPCS, partesDoCaminhoPpc } from "@simplifica-if/kb/ppcs/ids";
import { comChave, ehFalhaAoGravar, type Gravacao, gravarJuntos } from "./gravacao.ts";
import { caminhoPendente, proximaVersao, rotuloLivre, STATUS_REABERTO } from "./versoes-ppc.ts";
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

export const MotivoImportacao = Schema.Literals([
  "curso-malformado",
  "curso-inexistente",
  "registro-invalido",
  "fonte-url-assinada",
  "fonte-url-interna",
  "fonte-url-nao-https",
  "markdown-path-fora",
  "ano-invalido",
  "evidencia-invalida",
  "versao-anterior",
  "arquivo-inexistente",
  "arquivo-recusado",
  "conversao-recusada",
  "conversao-vazia",
  "figura-local",
  "gravacao",
]);

/**
 * Recusa da importação. `detalhe` vai para o usuário como está e não traz dado do documento nem a
 * query de URL. O diagnóstico da falha de baixo nível vem em atributos próprios (`arquivo`, `codigo`,
 * `erroJson`), de onde `detalhe` é montado; `cause` guarda a falha original e não entra na mensagem.
 */
export class ErroImportacao extends Schema.TaggedError<ErroImportacao>()("ErroImportacao", {
  motivo: MotivoImportacao,
  detalhe: Schema.String,
  /** Relativo a `base-conhecimento/`. */
  arquivo: Schema.optional(Schema.String),
  /** `code` do erro do sistema (`ENOSPC`, `EACCES`), na gravação. */
  codigo: Schema.optional(Schema.String),
  /** Mensagem do `SyntaxError` do registro público do curso (não do DOCX). */
  erroJson: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detalhe;
  }
}

export const ehErroImportacao = Schema.is(ErroImportacao);

const recusa = (motivo: typeof MotivoImportacao.Type, detalhe: string, cause?: unknown) =>
  new ErroImportacao({ motivo, detalhe, ...(cause === undefined ? {} : { cause }) });

export type OpcoesImportacao = {
  caminhos: CaminhosBase;
  /** Chave do curso, `<campus_id>/<curso_slug>`. */
  curso: string;
  arquivoDocx: string;
  /** Endereço publicado do PPC (vira `fonte_url` e `ppc.url`). */
  fonteUrl: string;
  /** Ano do documento: a versão do PPC (`<ano>`, ou `<ano>-2`… se o curso já tem PPC desse ano). */
  ano?: number | undefined;
  /**
   * Trecho literal que traz o ano (`ano_evidencia`). Sem ele (ou sem `ano`), o PPC não entra na base:
   * vai para `curadoria/pendencias/ppcs/`, com a pendência `ano`, e o registro do curso não muda.
   */
  evidencia?: string | undefined;
  /** Onde está a evidência: `texto` (o padrão, no corpo convertido) ou a URL https da fonte. */
  fonteAno?: string | undefined;
  /**
   * Reconverte o PPC vigente (o mesmo documento) e grava por cima dele, mantendo o ID. Sem ele, o PPC
   * entra como versão nova e o vigente fica na base, substituído.
   */
  reconverter: boolean;
  agora: Date;
  /** Conversor e versão (`conversorAtual` na linha de comando). */
  conversor: string;
};

export type ResultadoImportacao = {
  /**
   * PPC gravado: relativo a `base-conhecimento/` quando entrou na base; relativo à raiz do repositório
   * (`curadoria/pendencias/ppcs/…`) quando ficou pendente.
   */
  markdownPath: string;
  /** Relativo a `base-conhecimento/`. */
  registroPath: string;
  /** ID permanente do PPC gravado; `null` no PPC pendente, que ainda não tem ID. */
  id: string | null;
  /** Pendências do PPC que ficou fora da base (vazia quando entrou). */
  pendencias: string[];
  /** Caminho do PPC que era o vigente e fica na base como substituído (`null` se não havia, ou na reconversão). */
  substituido: string | null;
  ppcUrlAnterior: string | null;
  omitidos: Contagem;
  urlsLimpas: ContagemUrls;
  /** Campos de curadoria (`vagas`) reabertos como "Precisa de revisão". */
  curadoriaReaberta: string[];
  /** `ppc.observacoes` foi mantido, mas foi escrito sobre o texto anterior: reconferir. */
  observacoesAReconferir: boolean;
  /** Método da representação gráfica, quando o PPC tem a seção. */
  representacaoGrafica: string | null;
};

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export { FalhaAoGravar, gravarJuntos } from "./gravacao.ts";
export { STATUS_REABERTO } from "./versoes-ppc.ts";

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
    throw recusa(
      "curso-inexistente",
      `Curso inexistente: ${campusId}/${cursoSlug} (institucional/ifpr/${relativo} não existe). ` +
        "Crie antes o registro do curso, conforme base-conhecimento/docs/curadoria-metadados-institucionais.md.",
    );
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(NodeFS.readFileSync(arquivo, "utf-8"));
  } catch (erro) {
    if (!(erro instanceof SyntaxError)) throw erro;
    const erroJson = erro.message;
    throw new ErroImportacao({
      motivo: "registro-invalido",
      detalhe: `institucional/ifpr/${relativo}: JSON inválido (${erroJson})`,
      arquivo: `institucional/ifpr/${relativo}`,
      erroJson,
      cause: erro,
    });
  }
  const resultado = decodificarCurso(bruto);
  if (Result.isFailure(resultado)) {
    const linhas = problemas(resultado.failure.issue).map(
      (p) => `${caminhoTexto(p.caminho) || "(raiz)"}: ${p.mensagem}`,
    );
    throw recusa("registro-invalido", `institucional/ifpr/${relativo} fora do schema: ${linhas.join("; ")}`);
  }
  return { registro: resultado.success, relativo, arquivo };
}

function conferirFonteUrl(url: string): void {
  // A assinatura vem antes do esquema: uma URL assinada em `http` também não aparece na mensagem.
  if (ehUrlAssinada(url) || RE_URL_ASSINADA.test(url)) {
    throw recusa("fonte-url-assinada", `--fonte-url é URL pré-assinada; use o endereço público: ${semQuery(url)}`);
  }
  if (url.match(RE_PLANILHA_GOOGLE) || RE_URL_SESSAO_SEI.test(url)) {
    throw recusa(
      "fonte-url-interna",
      "--fonte-url é planilha do Google ou link de sessão do SEI; use o endereço público do PPC",
    );
  }
  if (!/^https:\/\/\S+$/.test(url))
    throw recusa("fonte-url-nao-https", `--fonte-url deve ser URL https: ${semQuery(url)}`);
}

/**
 * Troca o bloco da representação gráfica que aponta para `imagens/` (figura ou arquivo vetorial que a
 * base não publica) pelo aviso. Se o bloco não está no texto, ou se a referência ao arquivo sobra,
 * é falha do importador, não do documento: recusa em vez de publicar um link quebrado.
 */
export function semFiguraLocal(texto: string, grafica: RepresentacaoGrafica | null): string {
  if (!grafica?.arquivo) return texto;
  if (!texto.includes(grafica.bloco)) {
    throw recusa(
      "figura-local",
      "A conversão não trouxe o bloco da representação gráfica onde o importador o procura; " +
        "nada foi gravado (corrija scripts/base/importar-ppc.ts)",
    );
  }
  const trocado = texto.replace(grafica.bloco, () => AVISO_FIGURA);
  if (trocado.includes(grafica.arquivo.caminho)) {
    throw recusa(
      "figura-local",
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
    // A mensagem do ErroDocx é a recusa do documento (não é ZIP, está protegido, passa dos limites).
    if (erro instanceof ErroDocx) throw recusa("conversao-recusada", `Conversão recusada: ${erro.message}`, erro);
    throw erro;
  }
  const grafica = conversao.representacaoGrafica;
  const urls = limparUrlsInternas(semFiguraLocal(conversao.markdown, grafica));
  const { texto: corpo, contagem } = aplicarOmissao(urls.texto);
  if (!corpo.trim()) throw recusa("conversao-vazia", "Conversão vazia: o DOCX não produziu texto para a base.");
  return {
    corpo: corpo.endsWith("\n") ? corpo : `${corpo}\n`,
    omitidos: contagem,
    urlsLimpas: urls.contagem,
    representacaoGrafica: grafica?.metodo ?? null,
  };
}

/** Converte o DOCX e grava o PPC e o registro do curso. Nada é gravado se alguma conferência falha. */
export const importarPpcDocx = Effect.fn("importarPpc.importar")(function* (opcoes: OpcoesImportacao) {
  return yield* Effect.suspend(() => {
    try {
      return Effect.succeed(importar(opcoes));
    } catch (erro) {
      return ehErroImportacao(erro) ? Effect.fail(erro) : Effect.die(erro);
    }
  });
});

/**
 * Versão do PPC importado. Na reconversão, a do vigente (que precisa ter o ano de `--ano`). Fora dela,
 * o ano, com sufixo se o curso já tem PPC desse ano; e a versão nova não pode ser anterior à vigente,
 * que deixaria de ser a mais recente.
 */
function escolherVersao(
  opcoes: OpcoesImportacao,
  ano: number,
  campusId: string,
  cursoSlug: string,
  versaoVigente: string | null,
): string {
  if (opcoes.reconverter) {
    if (!versaoVigente) {
      throw recusa("markdown-path-fora", `O curso ${campusId}/${cursoSlug} não tem PPC vigente para reconverter`);
    }
    if (!versaoVigente.startsWith(String(ano))) {
      throw recusa(
        "ano-invalido",
        `--reconverter grava por cima do PPC vigente (versão ${versaoVigente}); --ano ${ano} não é o ano dele. PPC de outro ano é versão nova: tire --reconverter.`,
      );
    }
    return versaoVigente;
  }
  const pasta = NodePath.join(opcoes.caminhos.raiz, PASTA_PPCS, campusId, cursoSlug);
  const existentes = NodeFS.existsSync(pasta)
    ? NodeFS.readdirSync(pasta)
        .filter((nome) => nome.endsWith(".md"))
        .map((nome) => nome.slice(0, -3))
    : [];
  const versao = proximaVersao(existentes, ano);
  if (versaoVigente && compararVersoesPpc(versao, versaoVigente) < 0) {
    throw recusa(
      "versao-anterior",
      `O PPC vigente do curso é a versão ${versaoVigente}; um PPC de ${ano} seria anterior a ele. A base não troca o vigente por um PPC mais antigo.`,
    );
  }
  return versao;
}

function importar(opcoes: OpcoesImportacao): ResultadoImportacao {
  const [campusId, cursoSlug, ...resto] = opcoes.curso.split("/");
  if (!campusId || !cursoSlug || resto.length || !RE_SLUG.test(campusId) || !RE_SLUG.test(cursoSlug)) {
    throw recusa("curso-malformado", `Curso deve ser <campus_id>/<curso_slug>: ${opcoes.curso}`);
  }
  conferirFonteUrl(opcoes.fonteUrl);
  const { registro, relativo, arquivo: arquivoRegistro } = lerCurso(opcoes.caminhos, campusId, cursoSlug);

  if (opcoes.ano !== undefined && (!Number.isInteger(opcoes.ano) || opcoes.ano < 1900 || opcoes.ano > 2999)) {
    throw recusa("ano-invalido", `--ano deve ser o ano do documento, com quatro dígitos: ${opcoes.ano}`);
  }
  const fonteAno = opcoes.fonteAno ?? FONTE_TEXTO;
  if (fonteAno !== FONTE_TEXTO && !/^https:\/\/\S+$/.test(fonteAno)) {
    throw recusa("evidencia-invalida", `--fonte-ano deve ser "texto" ou URL https: ${fonteAno}`);
  }
  if (opcoes.evidencia !== undefined && opcoes.ano === undefined) {
    throw recusa("evidencia-invalida", "--evidencia sem --ano: informe o ano que o trecho traz");
  }
  if (opcoes.evidencia !== undefined && opcoes.ano !== undefined && !opcoes.evidencia.includes(String(opcoes.ano))) {
    throw recusa("evidencia-invalida", `--evidencia deve conter o ano ${opcoes.ano}: "${opcoes.evidencia}"`);
  }
  // Com o ano e a evidência, o PPC entra na base; sem eles, fica pendente, fora dela.
  const anoComEvidencia = opcoes.ano !== undefined && opcoes.evidencia !== undefined ? opcoes.ano : undefined;
  if (opcoes.reconverter && anoComEvidencia === undefined) {
    throw recusa("evidencia-invalida", "--reconverter grava na base: informe --ano e --evidencia");
  }
  const vigenteAtual = registro.ppc?.markdown_path;
  const partesVigente = vigenteAtual ? partesDoCaminhoPpc(vigenteAtual) : null;
  if (
    vigenteAtual &&
    (!partesVigente || partesVigente.campusId !== campusId || partesVigente.cursoSlug !== cursoSlug)
  ) {
    throw recusa(
      "markdown-path-fora",
      `ppc.markdown_path do curso é ${vigenteAtual}, fora do caminho ${PASTA_PPCS}/${campusId}/${cursoSlug}/<versao>.md; corrija o registro antes`,
    );
  }
  const versao =
    anoComEvidencia === undefined
      ? null
      : escolherVersao(opcoes, anoComEvidencia, campusId, cursoSlug, partesVigente?.versao ?? null);

  const arquivoDocx = NodePath.resolve(opcoes.arquivoDocx);
  if (!NodeFS.existsSync(arquivoDocx)) throw recusa("arquivo-inexistente", `Arquivo não encontrado: ${arquivoDocx}`);
  let bytes: Uint8Array;
  try {
    conferirArquivoDocx(arquivoDocx, NodeFS.statSync(arquivoDocx).size);
    bytes = NodeFS.readFileSync(arquivoDocx);
  } catch (erro) {
    // A conferência recusa extensão e tamanho com mensagem própria, feita para quem importa.
    throw recusa("arquivo-recusado", (erro as Error).message, erro);
  }
  const convertido = markdownDaBase(bytes, NodePath.basename(opcoes.arquivoDocx), opcoes.agora);
  const hoje = dataLocalIso(opcoes.agora);
  const comum = {
    fonte_url: opcoes.fonteUrl,
    fonte_sha256: DESCONHECIDO,
    convertido_em: hoje,
    conversor: opcoes.conversor,
    arquivo_convertido: "docx",
    arquivo_convertido_sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    proveniencia: "registrada",
    nota_proveniencia: NOTA_DOCX,
  } as const;
  const resultadoComum = {
    registroPath: `institucional/ifpr/${relativo}`,
    omitidos: convertido.omitidos,
    urlsLimpas: convertido.urlsLimpas,
    representacaoGrafica: convertido.representacaoGrafica,
  };

  if (versao === null) {
    const pendencias = [
      opcoes.ano === undefined
        ? "ano: importado sem --ano; ache o ano do documento (capa, ato de aprovação) e a evidência literal"
        : `ano: importado com --ano ${opcoes.ano} sem --evidencia; confira o trecho que traz o ano`,
    ];
    const rotulo = rotuloLivre(
      opcoes.caminhos,
      campusId,
      cursoSlug,
      opcoes.ano === undefined ? "sem-ano" : String(opcoes.ano),
    );
    const markdownPath = caminhoPendente(campusId, cursoSlug, rotulo);
    const texto =
      serializarFrontMatterPendente({
        ...(opcoes.ano === undefined ? {} : { ano_documento: String(opcoes.ano) }),
        ...comum,
        pendencias,
      }) + convertido.corpo;
    gravarOuRecusar(opcoes, [{ destino: NodePath.join(opcoes.caminhos.raizProjeto, markdownPath), texto }]);
    return {
      ...resultadoComum,
      markdownPath,
      id: null,
      pendencias,
      substituido: null,
      ppcUrlAnterior: null,
      curadoriaReaberta: [],
      observacoesAReconferir: false,
    };
  }

  const markdownPath = caminhoPpc(campusId, cursoSlug, versao);
  const destino = NodePath.join(opcoes.caminhos.raiz, markdownPath);
  const evidencia = { ano_evidencia: opcoes.evidencia!, ano_fonte: fonteAno };
  const problemaEvidencia = conferirEvidenciaAno(evidencia, convertido.corpo);
  if (problemaEvidencia) throw recusa("evidencia-invalida", problemaEvidencia);
  const frontMatter = serializarFrontMatterPpc({
    id: idPpc(campusId, cursoSlug, versao),
    ano_documento: String(anoComEvidencia),
    ...evidencia,
    ...comum,
  });

  let ppc: NonNullable<CursoLocal["ppc"]> = registro.ppc ?? {};
  ppc = comChave(ppc, "url", opcoes.fonteUrl, ORDEM_PPC);
  ppc = comChave(ppc, "markdown_path", markdownPath, ORDEM_PPC);
  // As vagas registradas vieram do texto anterior: voltam para revisão contra o PPC novo.
  const curadoriaReaberta: string[] = [];
  if (ppc.vagas !== undefined || ppc.trecho_vagas !== undefined || ppc.periodicidade_vagas !== undefined) {
    ppc = comChave(ppc, "curadoria_vagas", STATUS_REABERTO, ORDEM_PPC);
    ppc = comChave(ppc, "data_curadoria_vagas", hoje, ORDEM_PPC);
    curadoriaReaberta.push("vagas");
  }

  // Os dois textos ficam prontos antes de qualquer escrita; a gravação é tudo ou nada.
  const textoCurso = textoRegistro(comChave(registro, "ppc", ppc, ORDEM_CURSO));
  gravarOuRecusar(opcoes, [
    { destino, texto: frontMatter + convertido.corpo },
    { destino: arquivoRegistro, texto: textoCurso },
  ]);

  return {
    ...resultadoComum,
    markdownPath,
    id: idPpc(campusId, cursoSlug, versao),
    pendencias: [],
    substituido: !opcoes.reconverter && vigenteAtual ? vigenteAtual : null,
    ppcUrlAnterior: registro.ppc?.url && registro.ppc.url !== opcoes.fonteUrl ? registro.ppc.url : null,
    curadoriaReaberta,
    observacoesAReconferir: Boolean(registro.ppc?.observacoes),
  };
}

function gravarOuRecusar(opcoes: OpcoesImportacao, gravacoes: Gravacao[]): void {
  try {
    gravarJuntos(gravacoes);
  } catch (erro) {
    if (!ehFalhaAoGravar(erro)) throw erro;
    const arquivo = NodePath.relative(opcoes.caminhos.raiz, erro.destino).split(NodePath.sep).join("/");
    const codigo = erro.codigo;
    throw new ErroImportacao({
      motivo: "gravacao",
      detalhe: `Falha ao gravar o PPC e o registro (${codigo ?? "falha"} em ${arquivo}); nada foi alterado`,
      arquivo,
      ...(codigo === undefined ? {} : { codigo }),
      cause: erro,
    });
  }
}
