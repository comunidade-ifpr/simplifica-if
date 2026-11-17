// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base) sobre os carregadores síncronos do kb
/** Validação das normas (Markdown com front matter), do manifest.json e do README.md. */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { contarDadosPessoais, MARCADORES } from "@simplifica-if/kb/ppcs/dados-pessoais";
import { RE_PLANILHA_GOOGLE, RE_URL_ASSINADA, RE_URL_SESSAO_SEI } from "../../dados/urls.ts";
import { ehArquivo, listarDiretorio, listarRecursivo, naBase } from "../caminhos.ts";
import {
  analisarFrontMatter,
  CAMPOS_MANIFEST,
  CAMPOS_OBRIGATORIOS,
  DIRETORIOS_POR_TIPO,
  ehErroFrontMatter,
  type FrontMatter,
} from "../front-matter.ts";
import { ehObjeto, type ObjetoJson, representar, textoDe, valoresIguais } from "@simplifica-if/kb/json";
import { analisarNorma, indiceDispositivos } from "@simplifica-if/kb/normas/estrutura";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { validarCorrespondencias } from "@simplifica-if/kb/normas/correspondencia";
import { carregarRelacoes, validarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import { caminhoConfigVigencia, carregarTransicoes, dataReferencia, statusEm } from "@simplifica-if/kb/normas/vigencia";
import { palavrasDoTexto } from "@simplifica-if/kb/normas/markdown";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { esquemaNorma } from "@simplifica-if/kb/normas/front-matter";
import { idDoAto, idEsperadoDaNorma } from "@simplifica-if/kb/normas/ids";
import { caminhoStubs, carregarRegistro, lerRegistroStubs } from "@simplifica-if/kb/normas/registro";
import { apararInicio, ErroDecodificacao, lerTexto, ordenarTextos } from "@simplifica-if/kb/texto";
import { type Contexto, listaOrdenada, mesmosElementos, PADROES_LOCAIS, type Resultado } from "./contexto.ts";

const decodificarNorma = Schema.decodeUnknownResult(esquemaNorma, { errors: "all" });

/** Linhas `<prefixo>: <caminho>: <mensagem>` de um erro de schema (texto pelo formatador pt-BR do kb). */
function linhasDoErro(prefixo: string, erro: Schema.SchemaError): string[] {
  return problemas(erro.issue).map((p) => `${prefixo}: ${caminhoTexto(p.caminho)}: ${p.mensagem}`);
}

const DIRETORIOS_IGNORADOS_PADROES_LOCAIS = new Set([".git", "skills"]);
const RE_DATA_NO_INICIO = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}_/u;
const RE_ALIAS_COM_ANO = /[_-]\p{Nd}{4}[^\n]*\.md(?=\n?$)/u;

function aliasPareceNomeAntigo(alias: unknown): boolean {
  if (typeof alias !== "string" || !alias.endsWith(".md")) return false;
  return RE_DATA_NO_INICIO.test(alias) || RE_ALIAS_COM_ANO.test(alias);
}

/** `ano` é comparado como texto: o front matter tem número e o manifest pode ter texto. */
function comparavel(campo: string, valor: unknown): unknown {
  if (campo === "ano" && valor !== null && valor !== undefined) return textoDe(valor);
  return valor;
}

/** Nenhum arquivo de texto da base pode conter caminhos locais. */
const ROTULOS_PESSOAIS = { cpf: "CPF", rg: "RG", telefone: "celular", matricula: "matrícula", siape: "SIAPE" } as const;

/**
 * Dados pessoais (política do AGENTS.md: CPF, RG, celular, matrícula de estudante, SIAPE), link de
 * planilha do Google fora do `horarios_url` de um campus e URL de sessão do SEI (`infra_hash`). As
 * mensagens trazem só contagens, nunca o valor.
 */
export function dadosPessoaisEUrlsInternas(relativo: string, texto: string): string[] {
  const erros: string[] = [];
  const contagem = contarDadosPessoais(texto);
  const achados = (Object.keys(ROTULOS_PESSOAIS) as Array<keyof typeof ROTULOS_PESSOAIS>)
    .filter((categoria) => contagem[categoria])
    .map((categoria) => `${contagem[categoria]} ${ROTULOS_PESSOAIS[categoria]}`);
  if (achados.length) {
    erros.push(
      `${relativo} contém dados pessoais (${achados.join(", ")}); troque por ${Object.values(MARCADORES).join("/")} ` +
        "(omitirDadosPessoais de @simplifica-if/kb/ppcs/dados-pessoais)",
    );
  }
  const horarioDeCampus = /^institucional\/ifpr\/campi\/[^/]+\.json$/.test(relativo);
  const planilhas = texto
    .split("\n")
    .filter((linha) => !(horarioDeCampus && linha.includes('"horarios_url"')))
    .reduce((total, linha) => total + (linha.match(RE_PLANILHA_GOOGLE)?.length ?? 0), 0);
  if (planilhas) {
    erros.push(`${relativo} contém ${planilhas} link(s) de planilha do Google; tire o link (semPlanilhasGoogle)`);
  }
  if (RE_URL_SESSAO_SEI.test(texto)) {
    erros.push(`${relativo} contém URL de sessão do SEI (infra_hash); tire os parâmetros infra_* (semSessaoSei)`);
  }
  return erros;
}

export function validarPadroesLocais(ctx: Contexto): string[] {
  const erros: string[] = [];
  for (const caminho of listarRecursivo(ctx.c.raiz)) {
    const partes = ctx.rel(caminho).split(NodePath.sep);
    if (partes.some((parte) => DIRETORIOS_IGNORADOS_PADROES_LOCAIS.has(parte)) || !ehArquivo(caminho)) continue;
    let texto: string;
    try {
      texto = lerTexto(caminho);
    } catch (erro) {
      if (erro instanceof ErroDecodificacao) continue;
      throw erro;
    }
    for (const padrao of PADROES_LOCAIS) {
      if (texto.includes(padrao)) erros.push(`${ctx.rel(caminho)} contém padrão local proibido: ${padrao}`);
    }
    const assinada = RE_URL_ASSINADA.exec(texto);
    if (assinada) {
      // Só o começo da URL: a mensagem não repete a credencial.
      erros.push(
        `${ctx.rel(caminho)} contém URL pré-assinada (grave sem a query string): ${assinada[0].split("?")[0]}`,
      );
    }
    erros.push(...dadosPessoaisEUrlsInternas(ctx.rel(caminho), texto));
  }
  return erros;
}

export function carregarManifest(ctx: Contexto): Resultado<unknown[]> {
  let dados: unknown;
  try {
    dados = JSON.parse(lerTexto(ctx.c.manifest));
  } catch (erro) {
    return { ok: false, erros: [`manifest.json inválido: ${(erro as Error).message}`] };
  }
  if (!Array.isArray(dados)) return { ok: false, erros: ["manifest.json deve conter uma lista"] };
  return { ok: true, valor: dados };
}

/** Normas fora de normas/ e cobertura do manifest.json sobre os Markdown publicados. */
export function validarCoberturaManifest(ctx: Contexto, manifest: unknown[]): string[] {
  const erros: string[] = [];
  const markdownsNaRaiz = listarDiretorio(ctx.c.raiz, ".md")
    .map((caminho) => NodePath.basename(caminho))
    .filter((nome) => nome !== "AGENTS.md" && nome !== "README.md");
  if (markdownsNaRaiz.length) {
    erros.push(`normas não devem ficar na raiz do repositório: ${listaOrdenada(markdownsNaRaiz)}`);
  }

  const pathsManifest = new Set<unknown>(manifest.filter(ehObjeto).map((item) => item.path ?? null));
  const markdowns = listarRecursivo(ctx.c.normas, ".md").map((caminho) => ctx.rel(caminho));
  if (!mesmosElementos(pathsManifest, new Set<unknown>(markdowns))) {
    erros.push(
      `manifest.json não cobre exatamente as normas publicadas: manifest=${listaOrdenada([...pathsManifest].map(textoDe))} markdown=${listaOrdenada(markdowns)}`,
    );
  }
  return erros;
}

export function validarReadme(ctx: Contexto): string[] {
  const erros: string[] = [];
  const texto = lerTexto(ctx.c.readme);
  for (const padrao of PADROES_LOCAIS) {
    if (texto.includes(padrao)) erros.push(`README.md contém padrão local proibido: ${padrao}`);
  }
  erros.push(...ctx.validarLinks(ctx.c.readme, texto));
  return erros;
}

export function validarMarkdown(ctx: Contexto, caminho: string): string[] {
  const r = ctx.rel(caminho);
  const erros: string[] = [];
  const texto = lerTexto(caminho);
  for (const padrao of PADROES_LOCAIS) {
    if (texto.includes(padrao)) erros.push(`${r}: contém padrão local proibido: ${padrao}`);
  }

  let meta: FrontMatter;
  let corpo: string;
  try {
    ({ meta, corpo } = analisarFrontMatter(texto, r));
  } catch (erro) {
    if (ehErroFrontMatter(erro)) return [erro.message];
    throw erro;
  }

  const ausentes = ordenarTextos(CAMPOS_OBRIGATORIOS.filter((campo) => !(campo in meta)));
  if (ausentes.length) erros.push(`${r}: campos obrigatórios ausentes: ${ausentes.join(", ")}`);
  if (!apararInicio(corpo).startsWith("## Resumo")) erros.push(`${r}: corpo não começa com ## Resumo`);
  const keywords = meta.keywords;
  if (!Array.isArray(keywords) || !keywords.length) erros.push(`${r}: keywords deve ser lista não vazia`);
  const aliases = "aliases" in meta ? meta.aliases : [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (aliasPareceNomeAntigo(alias)) erros.push(`${r}: alias parece nome antigo de arquivo: ${textoDe(alias)}`);
  }

  erros.push(...validarIdNorma(r, meta));
  erros.push(...ctx.validarLinks(caminho, texto));
  return erros;
}

/**
 * `id` canônico da norma: formato e coerência com `variante` (Effect Schema) e igualdade com o ID derivado de
 * tipo, órgão, jurisdição, ano e número (regras em `@simplifica-if/kb/normas/ids`).
 */
export function validarIdNorma(r: string, meta: FrontMatter): string[] {
  if (!("id" in meta)) return [];
  const erros: string[] = [];
  const resultado = decodificarNorma(meta);
  if (Result.isFailure(resultado)) {
    for (const problema of problemas(resultado.failure.issue)) {
      if (
        ["id", "variante", "assinada_em", "publicada_em", "vigente_de", "datas_fonte"].includes(
          String(problema.caminho[0]),
        )
      ) {
        erros.push(`${r}: ${caminhoTexto(problema.caminho)}: ${problema.mensagem}`);
      }
    }
  }
  const esperado = idEsperadoDaNorma({
    tipo_documento: textoDe(meta.tipo_documento ?? ""),
    orgao: textoDe(meta.orgao ?? ""),
    jurisdicao: textoDe(meta.jurisdicao ?? ""),
    numero: textoDe(meta.numero ?? ""),
    ano: textoDe(meta.ano ?? ""),
    tipo_ato: typeof meta.tipo_ato === "string" ? meta.tipo_ato : undefined,
  });
  if (esperado === null)
    erros.push(
      `${r}: sem regra de id para tipo/órgão (${textoDe(meta.tipo_documento ?? "")}, ${textoDe(meta.orgao ?? "")})`,
    );
  else if (meta.id !== esperado) erros.push(`${r}: id ${textoDe(meta.id)} difere do derivado do ato: ${esperado}`);
  return erros;
}

/** IDs únicos entre as normas; a variante (`~compilacao`) exige o ato publicado ou registrado como stub. */
export function validarUnicidadeIds(ctx: Contexto, caminhos: string[], idsRegistrados: ReadonlySet<string>): string[] {
  const erros: string[] = [];
  const porId = new Map<string, string>();
  const variantes: [string, string][] = [];
  for (const caminho of caminhos) {
    let meta: FrontMatter;
    try {
      ({ meta } = analisarFrontMatter(lerTexto(caminho), ctx.rel(caminho)));
    } catch (erro) {
      if (ehErroFrontMatter(erro)) continue;
      throw erro;
    }
    if (typeof meta.id !== "string") continue;
    const anterior = porId.get(meta.id);
    if (anterior !== undefined) erros.push(`${ctx.rel(caminho)}: id duplicado ${meta.id} (também em ${anterior})`);
    if (idsRegistrados.has(meta.id))
      erros.push(`${ctx.rel(caminho)}: id ${meta.id} também está em normas/stubs.yaml (remova o stub)`);
    else porId.set(meta.id, ctx.rel(caminho));
    if (idDoAto(meta.id) !== meta.id) variantes.push([ctx.rel(caminho), meta.id]);
  }
  for (const [r, id] of variantes) {
    const ato = idDoAto(id);
    if (!porId.has(ato) && !idsRegistrados.has(ato))
      erros.push(`${r}: variante ${id} sem o ato ${ato} na base ou nos stubs`);
  }
  return erros;
}

/** `normas/stubs.yaml`: contrato (Effect Schema). Devolve os IDs registrados (stubs e `externo:`). */
export function validarStubs(ctx: Contexto): { erros: string[]; ids: Set<string> } {
  const arquivo = caminhoStubs(ctx.c.raizProjeto);
  if (!NodeFS.existsSync(arquivo)) return { erros: [], ids: new Set() };
  try {
    const registro = lerRegistroStubs(arquivo);
    return { erros: [], ids: new Set([...registro.normas, ...registro.externos].map((item) => item.id)) };
  } catch (erro) {
    if (Schema.isSchemaError(erro)) return { erros: linhasDoErro(ctx.rel(arquivo), erro), ids: new Set() };
    return { erros: [`${ctx.rel(arquivo)}: ${(erro as Error).message.split("\n")[0]}`], ids: new Set() };
  }
}

/** Item do manifest.json: campos obrigatórios, local do arquivo e coerência com o front matter. */
export function validarItemManifest(ctx: Contexto, item: ObjetoJson): string[] {
  const erros: string[] = [];
  for (const campo of [...CAMPOS_MANIFEST, "path"]) {
    if (!Object.hasOwn(item, campo)) erros.push(`manifest.json: item sem campo ${campo}: ${representar(item)}`);
  }

  const valorPath = item.path;
  if (typeof valorPath !== "string") return [...erros, "manifest.json: item sem path textual"];

  const caminho = naBase(ctx.c, valorPath);
  if (!NodeFS.existsSync(caminho)) return [...erros, `manifest.json aponta para arquivo inexistente: ${valorPath}`];

  if (RE_DATA_NO_INICIO.test(NodePath.basename(caminho))) {
    erros.push(`${valorPath}: nome do arquivo não deve começar com data`);
  }

  const jurisdicao = textoDe(item.jurisdicao);
  const tipo = textoDe(item.tipo_documento);
  const diretorioEsperado = DIRETORIOS_POR_TIPO[`${jurisdicao}|${tipo}`];
  if (diretorioEsperado === undefined) {
    erros.push(
      `manifest.json: item com jurisdição/tipo sem diretório configurado: (${representar(jurisdicao)}, ${representar(tipo)})`,
    );
  } else if (ctx.rel(NodePath.dirname(caminho)) !== diretorioEsperado) {
    erros.push(`${valorPath}: deveria estar em ${diretorioEsperado}`);
  }

  let meta: FrontMatter;
  try {
    ({ meta } = analisarFrontMatter(lerTexto(caminho), ctx.rel(caminho)));
  } catch (erro) {
    if (!ehErroFrontMatter(erro)) throw erro;
    erros.push(erro.message);
    return erros;
  }

  for (const campo of CAMPOS_MANIFEST) {
    const valorMeta = campo in meta ? meta[campo] : null;
    if (!valoresIguais(comparavel(campo, item[campo]), comparavel(campo, valorMeta))) {
      erros.push(`${valorPath}: manifest.json diverge do front matter no campo ${campo}`);
    }
  }
  return erros;
}

/**
 * Estrutura do corpo da norma (parser de dispositivos de `@simplifica-if/kb/normas/estrutura`):
 * cabeçalho de artigo `#### Art. Nº` só com o rótulo, rótulos de parágrafo e inciso em negrito,
 * nenhum `**` solto, marcadores de trecho fechados e IDs de dispositivo únicos. Avisos (rótulo
 * repetido no texto publicado, com ID pela posição) não são erro.
 */
export function validarEstruturaNorma(ctx: Contexto, caminho: string): string[] {
  const texto = lerTexto(caminho);
  let id: string;
  try {
    const { meta } = analisarFrontMatter(texto, ctx.rel(caminho));
    if (typeof meta.id !== "string") return [];
    id = meta.id;
  } catch (erro) {
    if (ehErroFrontMatter(erro)) return [];
    throw erro;
  }
  const estrutura = analisarNorma(texto, { id, path: ctx.rel(caminho) });
  return estrutura.problemas.filter((problema) => !problema.startsWith("aviso:"));
}

/**
 * Relações, transições, correspondências e vigência (fase 5): contrato e evidências de
 * `relacoes.yaml`, `transicoes.yaml` e `correspondencias/*.yaml`, campos gerados do front matter em dia (`gerar_base.ts`) e status dos stubs
 * atingidos por relações igual ao calculado na `data_referencia`.
 */
export function validarRelacoesEVigencia(ctx: Contexto): string[] {
  const raiz = ctx.c.raizProjeto;
  const erros = validarRelacoes(raiz);
  if (erros.length) return erros;

  erros.push(...validarCorrespondencias(raiz));
  const indice = indiceDispositivos(raiz);
  const registro = carregarRegistro(raiz);
  try {
    const transicoes = carregarTransicoes(raiz);
    const ids = new Set<string>();
    transicoes.forEach((transicao, i) => {
      const rotulo = `transicoes.yaml: transicoes.${i} (${transicao.id})`;
      if (ids.has(transicao.id)) erros.push(`${rotulo}: id repetido`);
      ids.add(transicao.id);
      const disp = indice.get(`${transicao.norma}${transicao.dispositivo}`);
      if (!disp)
        erros.push(`${rotulo}: dispositivo ${transicao.norma}${transicao.dispositivo} não existe no texto da base`);
      else if (!palavrasDoTexto(disp.texto).join(" ").includes(palavrasDoTexto(transicao.evidencia).join(" "))) {
        erros.push(`${rotulo}: evidência não está em ${transicao.norma}${transicao.dispositivo}`);
      }
      if (transicao.norma_anterior && !registro.obter(transicao.norma_anterior)) {
        erros.push(`${rotulo}: norma_anterior ${transicao.norma_anterior} fora da base e dos stubs`);
      }
    });
  } catch (erro) {
    if (Schema.isSchemaError(erro)) erros.push(...linhasDoErro("transicoes.yaml", erro));
    else erros.push(`transicoes.yaml: ${(erro as Error).message.split("\n")[0]}`);
  }

  if (!NodeFS.existsSync(caminhoConfigVigencia(raiz))) {
    return [...erros, "config/vigencia.yaml não encontrado (data_referencia da vigência publicada)"];
  }
  let referencia: string;
  try {
    referencia = dataReferencia(raiz);
  } catch (erro) {
    return [...erros, `config/vigencia.yaml: ${(erro as Error).message.split("\n")[0]}`];
  }
  const alvos = new Set(carregarRelacoes(raiz).map((relacao) => relacao.alvo));
  for (const entrada of registro.entradas) {
    if (entrada.situacao !== "stub") continue;
    const registrado = entrada.status_vigencia ?? "a confirmar";
    if (!alvos.has(entrada.id)) {
      if (registrado !== "a confirmar") {
        erros.push(`normas/stubs.yaml: ${entrada.id}: status ${registrado} sem relação em relacoes.yaml que o prove`);
      }
      continue;
    }
    const calculado = statusEm(entrada.id, referencia, raiz);
    if (calculado.eventos.some((evento) => evento.ocorreu !== false) && registrado !== calculado.status) {
      erros.push(
        `normas/stubs.yaml: ${entrada.id}: status_vigencia ${registrado} difere do calculado em ${referencia} (${calculado.status})`,
      );
    }
  }

  for (const norma of normasComCamposGerados(raiz)) {
    if (norma.atual !== norma.esperado) {
      erros.push(`${norma.path}: campos gerados do front matter desatualizados; rode node scripts/gerar_base.ts`);
    }
  }
  return erros;
}
