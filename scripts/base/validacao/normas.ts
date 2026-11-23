// @effect-diagnostics nodeBuiltinImport:off -- validação síncrona da base (validar_base) sobre os carregadores síncronos do kb
/** Validação das normas (Markdown com front matter) e do README.md. */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  type Categoria,
  contarDadosPessoais,
  MARCADORES,
  ROTULOS_PESSOAIS,
} from "@simplifica-if/kb/ppcs/dados-pessoais";
import { RE_PLANILHA_GOOGLE, RE_URL_ASSINADA, RE_URL_SESSAO_SEI } from "../../dados/urls.ts";
import { ehArquivo, listarDiretorio, listarRecursivo } from "../caminhos.ts";
import { analisarFrontMatter, DIRETORIOS_POR_TIPO, ehErroFrontMatter, type FrontMatter } from "../front-matter.ts";
import { representar, textoDe } from "@simplifica-if/kb/json";
import { analisarNorma, indiceDispositivos } from "@simplifica-if/kb/normas/estrutura";
import { artigosInexistentes } from "@simplifica-if/kb/normas/pontos-chave";
import { normasComCamposGerados } from "@simplifica-if/kb/normas/gerado";
import { validarCorrespondencias } from "@simplifica-if/kb/normas/correspondencia";
import { carregarRelacoes, validarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import {
  caminhoConfigVigencia,
  carregarConsolidado,
  carregarDatas,
  carregarTransicoes,
  dataReferencia,
  statusEm,
} from "@simplifica-if/kb/normas/vigencia";
import { palavrasDoTexto } from "@simplifica-if/kb/normas/markdown";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { esquemaNorma } from "@simplifica-if/kb/normas/front-matter";
import { idEsperadoDaNorma } from "@simplifica-if/kb/normas/ids";
import { caminhoStubs, carregarRegistro, lerRegistroStubs } from "@simplifica-if/kb/normas/registro";
import { ErroDecodificacao, lerTexto } from "@simplifica-if/kb/texto";
import { type Contexto, listaOrdenada, PADROES_LOCAIS } from "./contexto.ts";

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

/**
 * Dados pessoais (política do AGENTS.md: CPF, RG, celular, matrícula de estudante, SIAPE), link de
 * planilha do Google fora do `horarios_url` de um campus e URL de sessão do SEI (`infra_hash`). As
 * mensagens trazem só contagens, nunca o valor.
 */
export function dadosPessoaisEUrlsInternas(relativo: string, texto: string): string[] {
  const erros: string[] = [];
  const contagem = contarDadosPessoais(texto);
  const achados = (Object.keys(ROTULOS_PESSOAIS) as Categoria[])
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

/** Nenhum arquivo de texto da base pode conter caminhos locais, URL pré-assinada, dados pessoais nem URLs internas. */
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

/** Nenhuma norma solta na raiz de `base-conhecimento/`: elas ficam em `normas/`. */
export function validarNormasNaRaiz(ctx: Contexto): string[] {
  const markdownsNaRaiz = listarDiretorio(ctx.c.raiz, ".md")
    .map((caminho) => NodePath.basename(caminho))
    .filter((nome) => nome !== "AGENTS.md" && nome !== "README.md");
  return markdownsNaRaiz.length
    ? [`normas não devem ficar na raiz do repositório: ${listaOrdenada(markdownsNaRaiz)}`]
    : [];
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

  // o corpo é só o texto da norma: resumo, notas e orientações são campos do front matter
  for (const titulo of corpo.matchAll(/^#{1,3} +(Resumo|Notas?|Observaç(?:ão|ões)|Referências|Texto\b[^\n]*)\s*$/gim)) {
    erros.push(
      `${r}: o corpo traz a seção "${titulo[1]}"; ele é só o texto da norma (use pontos_chave ou notas_da_fonte no front matter; orientação para PPC vai na ficha da revisão)`,
    );
  }
  if (/<!--\s*fora-do-ato/.test(corpo)) {
    erros.push(
      `${r}: marcador fora-do-ato no corpo; o que não consta do ato sai do arquivo (registre em notas_da_fonte)`,
    );
  }
  const aliases = "aliases" in meta ? meta.aliases : [];
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (aliasPareceNomeAntigo(alias)) erros.push(`${r}: alias parece nome antigo de arquivo: ${textoDe(alias)}`);
  }

  erros.push(...validarContratoNorma(r, meta));
  erros.push(...validarLocalDaNorma(ctx, caminho, meta));
  erros.push(...ctx.validarLinks(caminho, texto));
  return erros;
}

/** Nome do arquivo sem data no começo e diretório pela jurisdição e pelo tipo do ato. */
function validarLocalDaNorma(ctx: Contexto, caminho: string, meta: FrontMatter): string[] {
  const r = ctx.rel(caminho);
  const erros: string[] = [];
  if (RE_DATA_NO_INICIO.test(NodePath.basename(caminho))) erros.push(`${r}: nome do arquivo não deve começar com data`);
  const jurisdicao = textoDe(meta.jurisdicao ?? "");
  const tipo = textoDe(meta.tipo_documento ?? "");
  const diretorioEsperado = DIRETORIOS_POR_TIPO[`${jurisdicao}|${tipo}`];
  if (diretorioEsperado === undefined) {
    erros.push(`${r}: jurisdição/tipo sem diretório configurado: (${representar(jurisdicao)}, ${representar(tipo)})`);
  } else if (ctx.rel(NodePath.dirname(caminho)) !== diretorioEsperado) {
    erros.push(`${r}: deveria estar em ${diretorioEsperado}`);
  }
  return erros;
}

/**
 * Contrato do front matter da norma: todos os erros de `esquemaNorma` (campos obrigatórios, tipos,
 * formatos, datas e fonte oficial) e o `id` igual ao derivado de tipo, órgão, jurisdição, ano e
 * número (regras em `@simplifica-if/kb/normas/ids`).
 */
export function validarContratoNorma(r: string, meta: FrontMatter): string[] {
  const erros: string[] = [];
  const resultado = decodificarNorma(meta);
  if (Result.isFailure(resultado)) {
    for (const problema of problemas(resultado.failure.issue)) {
      erros.push(`${r}: ${caminhoTexto(problema.caminho)}: ${problema.mensagem}`);
    }
  }
  if (!("id" in meta)) return erros;
  const esperado = idEsperadoDaNorma({
    tipo_documento: textoDe(meta.tipo_documento ?? ""),
    orgao: textoDe(meta.orgao ?? ""),
    jurisdicao: textoDe(meta.jurisdicao ?? ""),
    numero: textoDe(meta.numero ?? ""),
    ano: textoDe(meta.ano ?? ""),
  });
  if (esperado === null)
    erros.push(
      `${r}: sem regra de id para tipo/órgão (${textoDe(meta.tipo_documento ?? "")}, ${textoDe(meta.orgao ?? "")})`,
    );
  else if (meta.id !== esperado) erros.push(`${r}: id ${textoDe(meta.id)} difere do derivado do ato: ${esperado}`);
  return erros;
}

/** IDs únicos entre as normas, e nenhum repetido em `normas/stubs.yaml`. */
export function validarUnicidadeIds(ctx: Contexto, caminhos: string[], idsRegistrados: ReadonlySet<string>): string[] {
  const erros: string[] = [];
  const porId = new Map<string, string>();
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

/**
 * Estrutura do corpo da norma (parser de dispositivos de `@simplifica-if/kb/normas/estrutura`):
 * cabeçalho de artigo `#### Art. Nº` só com o rótulo, rótulos de parágrafo e inciso em negrito,
 * nenhum `**` solto, marcadores de trecho fechados e IDs de dispositivo únicos. Avisos (rótulo
 * repetido no texto publicado, com ID pela posição) não são erro. Confere também que os artigos
 * citados em `pontos_chave` existem na norma.
 */
export function validarEstruturaNorma(ctx: Contexto, caminho: string): string[] {
  const texto = lerTexto(caminho);
  let id: string;
  let meta: FrontMatter;
  try {
    ({ meta } = analisarFrontMatter(texto, ctx.rel(caminho)));
    if (typeof meta.id !== "string") return [];
    id = meta.id;
  } catch (erro) {
    if (ehErroFrontMatter(erro)) return [];
    throw erro;
  }
  const estrutura = analisarNorma(texto, { id, path: ctx.rel(caminho) });
  const erros = estrutura.problemas.filter((problema) => !problema.startsWith("aviso:"));
  // o artigo citado no parêntese final de um ponto-chave existe na norma
  for (const campo of ["pontos_chave"] as const) {
    const itens = meta[campo];
    for (const item of Array.isArray(itens) ? itens : []) {
      const faltam = artigosInexistentes(item, estrutura.dispositivos);
      if (faltam.length) {
        erros.push(
          `${ctx.rel(caminho)}: ${campo} cita artigo que a norma não tem (${faltam.join(", ")}): "${item.slice(0, 80)}"`,
        );
      }
    }
  }
  return erros;
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
    const calculado = statusEm(entrada.id, referencia, {
      registro: carregarRegistro(raiz),
      datas: carregarDatas(raiz),
      relacoes: carregarRelacoes(raiz),
      consolidado: carregarConsolidado(raiz),
    });
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
