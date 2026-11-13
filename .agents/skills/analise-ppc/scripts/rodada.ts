/**
 * Rodada de análise: caminhos, relógio, hashes, leitura e escrita de JSON e
 * identificação do curso (porte de `common.py`).
 *
 * Os arquivos da rodada precisam sair idênticos aos do Python: JSON pelo
 * `json` do Python (`@simplifica-if/kb/python/json`), datas no fuso local com
 * deslocamento (`2026-11-13T10:00:00-03:00`) e caminhos resolvidos como
 * `Path.resolve()`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { carregarJsonPy, dumpsPy, jsonIndentadoPy } from "@simplifica-if/kb/python/json";
import { escape, search, sub } from "@simplifica-if/kb/python/re";
import { casefold, colapsarEspacos, semMarcas } from "@simplifica-if/kb/python/texto";
import { ehObjetoPy, itensPy, type ObjetoPy, strPy, verdadeiro } from "@simplifica-if/kb/python/valores";
import { aparar, compararTexto, dividirLinhas } from "@simplifica-if/kb/texto";
import { listarArquivos } from "./arquivos.ts";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";

export const TAMANHO_GRUPO_PADRAO = 20;
const IDENTIFICACAO_PLACEHOLDERS = new Set([
  "curso não identificado",
  "campus não identificado",
  "modalidade não identificada",
  "forma de oferta não identificada",
  "modalidade de ensino não identificada",
]);
const MAX_LINHAS_CAPA_PARA_CAMPUS = 120;

// ---------------------------------------------------------------- relógio

/** Fonte da data e hora atuais; injetável para testes e diferenciais. */
export type Relogio = () => Date;

/**
 * Relógio da linha de comando: a variável `ANALISE_PPC_AGORA` (data ISO 8601)
 * fixa o instante, para testes e diferenciais; sem ela, a hora do sistema.
 */
export function relogioDoAmbiente(): Date {
  const fixo = process.env.ANALISE_PPC_AGORA;
  if (fixo) {
    const data = new Date(fixo);
    if (Number.isNaN(data.getTime())) throw new Error(`ANALISE_PPC_AGORA inválida: ${fixo}`);
    return data;
  }
  return new Date();
}

const dois = (n: number) => String(n).padStart(2, "0");

/** `datetime.now().astimezone().isoformat(timespec="seconds")`: hora local com deslocamento. */
export function agoraIso(relogio: Relogio = relogioDoAmbiente): string {
  const data = relogio();
  const deslocamento = -data.getTimezoneOffset();
  const sinal = deslocamento < 0 ? "-" : "+";
  const absoluto = Math.abs(deslocamento);
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}` +
    `${sinal}${dois(Math.floor(absoluto / 60))}:${dois(absoluto % 60)}`
  );
}

/** `datetime.now().astimezone().strftime("%Y-%m-%dt%H-%M-%S")`. */
export function timestampSlug(relogio: Relogio = relogioDoAmbiente): string {
  const data = relogio();
  return (
    `${String(data.getFullYear()).padStart(4, "0")}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `t${dois(data.getHours())}-${dois(data.getMinutes())}-${dois(data.getSeconds())}`
  );
}

// ---------------------------------------------------------------- arquivos

/** `Path(caminho).resolve()`: absoluto, com symlinks resolvidos na parte que existe. */
export function resolverCaminho(caminho: string): string {
  const absoluto = path.resolve(caminho);
  let existente = absoluto;
  const resto: string[] = [];
  while (!existsSync(existente)) {
    const pai = path.dirname(existente);
    if (pai === existente) return absoluto;
    resto.unshift(path.basename(existente));
    existente = pai;
  }
  return path.join(realpathSync(existente), ...resto);
}

export function existe(caminho: string): boolean {
  return existsSync(caminho);
}

export function ehDiretorio(caminho: string): boolean {
  return existsSync(caminho) && statSync(caminho).isDirectory();
}

/** `read_json`: JSON do Python (floats preservados). */
export function lerJsonPy(caminho: string): unknown {
  return carregarJsonPy(caminho);
}

/** `write_json`: JSON indentado do Python, com `\n` final. */
export function escreverJsonPy(caminho: string, valor: unknown): void {
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, jsonIndentadoPy(valor), "utf-8");
}

/** `write_text`. */
export function escreverTextoPy(caminho: string, texto: string): void {
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, texto, "utf-8");
}

/** `Path.read_text(encoding="utf-8")`: UTF-8 estrito com quebras de linha universais. */
export { lerTexto } from "@simplifica-if/kb/texto";

export function sha256Texto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** `sha256_json_payload`: hash do JSON compacto com chaves ordenadas por code point. */
export function sha256JsonPayload(valor: unknown): string {
  return sha256Texto(dumpsPy(valor, { ordenarChaves: true, separadores: [",", ":"] }));
}

export function sha256Arquivo(caminho: string): string {
  return createHash("sha256").update(readFileSync(caminho)).digest("hex");
}

/** `sha256_catalogo_json`: hash de nome e conteúdo dos `*.json` do diretório, em ordem de nome. */
export function sha256CatalogoJson(diretorio: string): string {
  const arquivos = listarArquivos(diretorio, ".json");
  if (!arquivos.length) return sha256Texto("[]");
  const hash = createHash("sha256");
  for (const arquivo of arquivos) {
    hash.update(Buffer.from(path.basename(arquivo), "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(arquivo));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

/** `load_fichas`: fichas na ordem dos nomes de arquivo. */
export function carregarFichas(fichasDir: string): ObjetoPy[] {
  return listarArquivos(fichasDir, ".json").map((arquivo) => lerJsonPy(arquivo) as ObjetoPy);
}

/** `sorted(itens, key=lambda item: str(item.get("id", "")))`. */
export function ordenarPorId<T extends ObjetoPy>(itens: T[]): T[] {
  return [...itens].sort((a, b) => compararTexto(strPy(a.id ?? ""), strPy(b.id ?? "")));
}

/** `safe_relpath`: caminho relativo a `base` quando dentro dela; senão, absoluto. */
export function caminhoRelativoSeguro(caminho: string, base: string): string {
  const alvo = resolverCaminho(caminho);
  const raiz = resolverCaminho(base);
  if (alvo === raiz) return ".";
  const prefixo = raiz.endsWith(path.sep) ? raiz : raiz + path.sep;
  return alvo.startsWith(prefixo) ? alvo.slice(prefixo.length) : alvo;
}

// ---------------------------------------------------------------- caminhos da rodada

export type CaminhosRodada = {
  rodadaDir: string;
  suporteDir: string;
  artefatosConversaoDir: string;
  ppc: string;
  ppcBruto: string;
  metadata: string;
  manifesto: string;
  preparacaoDocx: string;
  cnctContexto: string;
  contextoEstruturalSubagents: string;
  validacoesCruzadasContexto: string;
  gruposAvulsosDir: string;
  promptsSubagentsDir: string;
  promptsSubagentsManifest: string;
  resultadosSubagents: string;
  gruposSubagents: string;
  relatorioHtml: string;
};

/** `round_paths`: arquivos da rodada em `arquivos-suporte/` (ou na raiz, em rodadas antigas). */
export function caminhosRodada(rodada: string): CaminhosRodada {
  const rodadaDir = resolverCaminho(rodada);
  const legados = ["PPC.md", "metadata.json", "manifesto-rodada.json"].map((nome) => path.join(rodadaDir, nome));
  const suporte = path.join(rodadaDir, "arquivos-suporte");
  const base = !existsSync(suporte) && legados.some((caminho) => existsSync(caminho)) ? rodadaDir : suporte;
  return {
    rodadaDir,
    suporteDir: base,
    artefatosConversaoDir: path.join(base, "artefatos-conversao"),
    ppc: path.join(base, "PPC.md"),
    ppcBruto: path.join(base, "PPC-bruto.md"),
    metadata: path.join(base, "metadata.json"),
    manifesto: path.join(base, "manifesto-rodada.json"),
    preparacaoDocx: path.join(base, "preparacao-docx.json"),
    cnctContexto: path.join(base, "cnct-contexto.json"),
    contextoEstruturalSubagents: path.join(base, "contexto-estrutural-subagents.json"),
    validacoesCruzadasContexto: path.join(base, "validacoes-cruzadas-contexto.json"),
    gruposAvulsosDir: path.join(base, "grupos-avulsos"),
    promptsSubagentsDir: path.join(base, "prompts-subagents"),
    promptsSubagentsManifest: path.join(base, "prompts-subagents", "manifest.json"),
    resultadosSubagents: path.join(base, "resultados-subagents.json"),
    gruposSubagents: path.join(base, "grupos-subagents.json"),
    relatorioHtml: path.join(rodadaDir, "relatorio-analise.html"),
  };
}

/** `update_manifesto_base`: grava `manifesto-rodada.json` com os hashes de PPC, fichas, validações e prompts. */
export function atualizarManifestoBase(
  rodada: string,
  opcoes: { caminhos?: CaminhosAnalise; relogio?: Relogio } = {},
): ObjetoPy {
  const skill = opcoes.caminhos ?? caminhosPadrao();
  const caminhos = caminhosRodada(rodada);
  const promptSubagent = path.join(skill.promptsDir, "subagent-lote-fichas.md");
  const promptSintese = path.join(skill.promptsDir, "sintese-transversal.md");
  const manifesto = {
    rodada_id: path.basename(rodada),
    rodada_dir: resolverCaminho(rodada),
    ppc_sha256: sha256Arquivo(caminhos.ppc),
    fichas_sha256: sha256CatalogoJson(skill.fichasDir),
    validacoes_cruzadas_sha256: sha256CatalogoJson(skill.validacoesCruzadasDir),
    prompt_subagent_sha256: existsSync(promptSubagent) ? sha256Arquivo(promptSubagent) : "",
    prompt_sintese_transversal_sha256: existsSync(promptSintese) ? sha256Arquivo(promptSintese) : "",
    execucao: "subagents-na-conversa",
    criado_em: agoraIso(opcoes.relogio),
  };
  escreverJsonPy(caminhos.manifesto, manifesto);
  return manifesto;
}

// ---------------------------------------------------------------- identificação

/** `valor_identificacao_preenchido`. */
export function valorIdentificacaoPreenchido(valor: unknown): boolean {
  const texto = aparar(verdadeiro(valor) ? strPy(valor) : "");
  return Boolean(texto) && !IDENTIFICACAO_PLACEHOLDERS.has(casefold(texto));
}

/** Texto sem acentos, em casefold, só com `[a-z0-9]` separados por um espaço. */
export function normalizarBusca(texto: string): string {
  return colapsarEspacos(sub("[^a-z0-9]+", " ", casefold(semMarcas(texto))));
}

let campiCache: { indice: string; campi: Array<[string, string]> } | null = null;

function campiIfprConhecidos(baseConhecimentoDir: string): Array<[string, string]> {
  const indice = path.join(baseConhecimentoDir, "institucional", "ifpr", "campi", "index.json");
  if (campiCache?.indice === indice) return campiCache.campi;
  let campi: Array<[string, string]> = [];
  if (existsSync(indice)) {
    try {
      const payload = lerJsonPy(indice);
      const itens = ehObjetoPy(payload) ? payload.items : null;
      if (Array.isArray(itens)) {
        for (const item of itens) {
          if (!ehObjetoPy(item)) continue;
          const nome = aparar(verdadeiro(item.nome) ? strPy(item.nome) : "");
          if (nome) campi.push([nome, normalizarBusca(nome)]);
        }
      }
    } catch {
      campi = [];
    }
  }
  campiCache = { indice, campi };
  return campi;
}

function campusCanonicoNoTexto(texto: string, baseConhecimentoDir: string): string {
  const normalizado = normalizarBusca(texto);
  if (!normalizado) return "";
  const encontrados = campiIfprConhecidos(baseConhecimentoDir)
    .filter(([, campus]) => search(`(^|\\s)${escape(campus)}($|\\s)`, normalizado))
    .map(([nome]) => nome);
  return new Set(encontrados).size === 1 ? encontrados[0]! : "";
}

const TERMOS_RUIDO_CAMPUS = [
  "fluxo de ar",
  "unidade de fluxo",
  "quantidade",
  "equipamento",
  "material",
  "laboratorio",
  "capela",
  "bancada",
  "microscopio",
  "computador",
  "monitor",
];

function pareceRuidoDeCampus(texto: string): boolean {
  const normalizado = normalizarBusca(texto);
  if (!normalizado) return true;
  return TERMOS_RUIDO_CAMPUS.some((termo) => normalizado.includes(termo));
}

function limparValorIdentificacao(valor: unknown): string {
  let texto = aparar(verdadeiro(valor) ? strPy(valor) : "");
  texto = sub(
    "^(?:denomina[çc][ãa]o|nome\\s+do\\s+curso|curso|campus|unidade|forma\\s+de\\s+oferta|modalidade(?:\\s+de\\s+ensino)?|eixo\\s+tecnol[óo]gico)\\s*:\\s*",
    "",
    texto,
    { ignoreCase: true },
  );
  return colapsarEspacos(texto);
}

/** `normalizar_campus_identificacao`. */
export function normalizarCampusIdentificacao(valor: unknown, caminhos: CaminhosAnalise = caminhosPadrao()): string {
  const texto = limparValorIdentificacao(valor);
  if (!texto || IDENTIFICACAO_PLACEHOLDERS.has(casefold(texto))) return "";
  const canonico = campusCanonicoNoTexto(texto, caminhos.baseConhecimentoDir);
  if (canonico) return canonico;
  if (pareceRuidoDeCampus(texto)) return "";
  return texto;
}

function linhasNaoVazias(texto: string): string[] {
  return dividirLinhas(texto)
    .map((linha) => aparar(linha))
    .filter(Boolean);
}

/** `inferir_campus_por_capa`: campus conhecido citado nas primeiras 120 linhas não vazias. */
export function inferirCampusPorCapa(texto: string, caminhos: CaminhosAnalise = caminhosPadrao()): string {
  const trecho = linhasNaoVazias(texto).slice(0, MAX_LINHAS_CAPA_PARA_CAMPUS).join("\n");
  return campusCanonicoNoTexto(trecho, caminhos.baseConhecimentoDir);
}

export type Identificacao = {
  curso: string;
  campus: string;
  modalidade: string;
  forma_oferta: string;
  modalidade_ensino: string;
  eixo_tecnologico?: string;
};

/** `infer_identificacao_from_markdown`. */
export function inferirIdentificacaoDoMarkdown(
  texto: string,
  nomeReserva = "",
  caminhos: CaminhosAnalise = caminhosPadrao(),
): Identificacao {
  const textoUnico = linhasNaoVazias(texto).join("\n");
  const casar = (padroes: string[], padrao = ""): string => {
    for (const padraoRe of padroes) {
      const m = search(padraoRe, textoUnico, { ignoreCase: true });
      if (m) return colapsarEspacos(m[1]!);
    }
    return padrao;
  };
  const curso = casar(
    ["curso\\s*:\\s*(.+)", "nome do curso\\s*:\\s*(.+)", "^#\\s*(curso\\s+t[ée]cnico.+)$", "^#\\s*(.+curso.+)$"],
    nomeReserva,
  );
  let campus = normalizarCampusIdentificacao(casar(["campus\\s*:\\s*(.+)", "unidade\\s*:\\s*(.+)"]), caminhos);
  if (!campus) campus = inferirCampusPorCapa(textoUnico, caminhos);
  const formaOferta = casar(["forma\\s+de\\s+oferta\\s*:\\s*(.+)"]);
  const modalidadeEnsino = casar(["modalidade\\s*:\\s*(.+)"]);
  let modalidade = formaOferta;
  if (!modalidade) {
    const maiusculo = textoUnico.toUpperCase();
    if (maiusculo.includes("INTEGRADO")) modalidade = "Integrado";
    else if (maiusculo.includes("SUBSEQUENTE")) modalidade = "Subsequente";
    else if (maiusculo.includes("CONCOMITANTE")) modalidade = "Concomitante";
  }
  return {
    curso: curso || nomeReserva || "Curso não identificado",
    campus: campus || "Campus não identificado",
    modalidade: modalidade || "Modalidade não identificada",
    forma_oferta: formaOferta || modalidade || "Forma de oferta não identificada",
    modalidade_ensino: modalidadeEnsino || "Modalidade de ensino não identificada",
  };
}

function valorPorChavesOuPrefixos(
  dados: ObjetoPy,
  chaves: readonly string[] = [],
  prefixos: readonly string[] = [],
  exigePadrao: string | null = null,
): string {
  const aceita = (valor: string) =>
    Boolean(valor) && (exigePadrao === null || search(exigePadrao, valor, { ignoreCase: true }));
  for (const chave of chaves) {
    const valor = limparValorIdentificacao(dados[chave]);
    if (aceita(valor)) return valor;
  }
  for (const [chave, bruto] of itensPy(dados)) {
    if (!prefixos.some((prefixo) => chave.startsWith(prefixo))) continue;
    const valor = limparValorIdentificacao(bruto);
    if (aceita(valor)) return valor;
  }
  return "";
}

/** `extract_identificacao_from_conversion_json`: identificação a partir dos dados da conversão DOCX. */
export function extrairIdentificacaoDaConversao(
  payload: unknown,
  nomeReserva = "",
  caminhos: CaminhosAnalise = caminhosPadrao(),
): Identificacao {
  let dados: unknown = ehObjetoPy(payload) ? payload.dados_extraidos : {};
  if (!ehObjetoPy(dados)) dados = payload;
  if (!ehObjetoPy(dados)) throw new TypeError("dados da conversão precisam ser objeto JSON");
  const d = dados;
  const curso =
    valorPorChavesOuPrefixos(
      d,
      ["curso_cnct", "denominacao", "denominacao_curso", "nome_do_curso", "Curso", "curso"],
      ["denominacao_", "nome_do_curso_", "curso_"],
      "\\bcurso\\s+t[ée]cnico\\b",
    ) ||
    valorPorChavesOuPrefixos(d, ["nome_curso"]) ||
    nomeReserva ||
    "Curso não identificado";
  const campus =
    normalizarCampusIdentificacao(valorPorChavesOuPrefixos(d, ["campus", "Campus", "unidade"]), caminhos) ||
    "Campus não identificado";
  const formaOferta = valorPorChavesOuPrefixos(
    d,
    ["forma_oferta", "Forma de oferta", "Forma de Oferta"],
    ["forma_de_oferta_"],
  );
  const modalidadeEnsino = valorPorChavesOuPrefixos(
    d,
    ["modalidade_ensino", "Modalidade de ensino", "Modalidade de Ensino", "modalidade", "Modalidade"],
    ["modalidade_", "modalidade_de_ensino_"],
  );
  const modalidadeBruta = valorPorChavesOuPrefixos(d, ["modalidade", "Modalidade"], ["modalidade_"]);
  const eixo = valorPorChavesOuPrefixos(
    d,
    ["eixo_tecnologico", "Eixo Tecnológico", "Eixo tecnologico"],
    ["eixo_tecnologico_"],
  );
  const modalidade = formaOferta || modalidadeBruta || "Modalidade não identificada";
  return {
    curso,
    campus,
    modalidade,
    forma_oferta: formaOferta || modalidade,
    modalidade_ensino: modalidadeEnsino || "Modalidade de ensino não identificada",
    eixo_tecnologico: eixo || "",
  };
}
