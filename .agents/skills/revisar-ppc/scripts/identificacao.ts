// @effect-diagnostics nodeBuiltinImport:off -- extração heurística síncrona da identificação do curso a partir de arquivos locais
/**
 * Identificação do curso no PPC: denominação, campus, forma de oferta,
 * modalidade de ensino e eixo tecnológico.
 *
 * A extração é heurística e só lê o próprio documento (mais a lista de campi
 * do IFPR em `base-conhecimento/institucional/ifpr/campi/index.json`): o PPC
 * analisado pode não estar na base, então nada aqui consulta os cursos
 * cadastrados (`institucional/ifpr/cursos/`). As fontes, em ordem de preferência:
 *
 * 1. rótulo explícito, em linha ("Nome do curso: …"), em título numerado
 *    seguido do valor ("1.1.3 Denominação do Curso" / "Curso Técnico em …")
 *    ou em tabela de identificação (`| Denominação | Técnico em … |`);
 * 2. capa e folha de rosto ("CURSO TÉCNICO EM … FORMA DE OFERTA: …",
 *    "CAMPUS …");
 * 3. menções no início do documento (só para campus, forma e modalidade);
 * 4. o nome do arquivo (só para o curso).
 *
 * Um rótulo só vale no início de um segmento (linha, célula, trecho em
 * negrito) ou, no meio da linha, com inicial maiúscula e dois-pontos: assim
 * "Base legal específica do curso: Resolução CNE/CP nº 1/2021" não vira nome
 * de curso. Cada valor passa por um validador do campo antes de ser aceito.
 * O front matter YAML (`---` … `---`) no topo é ignorado.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { escape, search, sub } from "@simplifica-if/kb/python/re";
import { casefold, colapsarEspacos, semMarcas } from "@simplifica-if/kb/python/texto";
import { ehObjetoPy, itensPy, type ObjetoPy, strPy, verdadeiro } from "@simplifica-if/kb/python/valores";
import { chavesDoMapaYaml } from "@simplifica-if/kb/ppcs/front-matter";
import { aparar, apararFimEnquanto, dividirLinhas } from "@simplifica-if/kb/texto";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { lerJsonPy } from "./rodada.ts";

const IDENTIFICACAO_PLACEHOLDERS = new Set([
  "curso não identificado",
  "campus não identificado",
  "modalidade não identificada",
  "forma de oferta não identificada",
  "modalidade de ensino não identificada",
]);
const MAX_LINHAS_CAPA_PARA_CAMPUS = 120;
/** Linhas não vazias do início do documento onde a identificação é procurada. */
const MAX_UNIDADES_IDENTIFICACAO = 400;
/** Linhas não vazias consideradas capa e folha de rosto. */
const MAX_UNIDADES_CAPA = 60;

export type Identificacao = {
  curso: string;
  campus: string;
  modalidade: string;
  forma_oferta: string;
  modalidade_ensino: string;
  eixo_tecnologico?: string;
};

/** De onde saiu cada campo: `rotulo`, `capa`, `inicio`, `conversao` ou `nome_arquivo`. */
export type FontesIdentificacao = Partial<
  Record<"curso" | "campus" | "forma_oferta" | "modalidade_ensino" | "eixo_tecnologico", string>
>;

export type IdentificacaoComFontes = Identificacao & { fontes: FontesIdentificacao };

/** `valor_identificacao_preenchido`. */
export function valorIdentificacaoPreenchido(valor: unknown): boolean {
  const texto = aparar(verdadeiro(valor) ? strPy(valor) : "");
  return Boolean(texto) && !IDENTIFICACAO_PLACEHOLDERS.has(casefold(texto));
}

/** Texto sem acentos, em casefold, só com `[a-z0-9]` separados por um espaço. */
export function normalizarBusca(texto: string): string {
  return colapsarEspacos(sub("[^a-z0-9]+", " ", casefold(semMarcas(texto))));
}

// ---------------------------------------------------------------- campi

let campiCache: { indice: string; campi: Array<[string, string]> } | null = null;

function campiIfprConhecidos(baseConhecimentoDir: string): Array<[string, string]> {
  const indice = NodePath.join(baseConhecimentoDir, "institucional", "ifpr", "campi", "index.json");
  if (campiCache?.indice === indice) return campiCache.campi;
  let campi: Array<[string, string]> = [];
  if (NodeFS.existsSync(indice)) {
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

/** Campi que podem aparecer em texto corrido: "Reitoria" está em toda "Pró-Reitoria". */
function campiDeTexto(baseConhecimentoDir: string): Array<[string, string]> {
  return campiIfprConhecidos(baseConhecimentoDir).filter(([, normalizado]) => normalizado !== "reitoria");
}

function campusCanonicoNoTexto(texto: string, baseConhecimentoDir: string): string {
  const normalizado = normalizarBusca(texto);
  if (!normalizado) return "";
  const encontrados = campiDeTexto(baseConhecimentoDir)
    .filter(([, campus]) => search(`(^|\\s)${escape(campus)}($|\\s)`, normalizado))
    .map(([nome]) => nome);
  return new Set(encontrados).size === 1 ? encontrados[0]! : "";
}

/**
 * Campus citado logo depois da palavra "campus" ("Campus Avançado Arapongas",
 * "IFPR – Câmpus Foz do Iguaçu"); na primeira ocorrência que casar.
 */
function campusAposPalavraCampus(texto: string, baseConhecimentoDir: string): string {
  const normalizado = normalizarBusca(texto);
  const campi = [...campiDeTexto(baseConhecimentoDir)].sort((a, b) => b[1].length - a[1].length);
  for (const m of normalizado.matchAll(/\bcampus (?:avancado )?(?:d[eo] )?/g)) {
    const resto = normalizado.slice(m.index + m[0].length);
    const campus = campi.find(([, nome]) => resto === nome || resto.startsWith(`${nome} `));
    if (campus) return campus[0];
  }
  return "";
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

/**
 * Campus canônico do IFPR citado no valor; sem campus conhecido, o próprio
 * valor, se curto e sem cara de ruído (inventário, endereço).
 */
export function normalizarCampusIdentificacao(valor: unknown, caminhos: CaminhosAnalise = caminhosPadrao()): string {
  const texto = limparValorIdentificacao(valor);
  if (!texto || IDENTIFICACAO_PLACEHOLDERS.has(casefold(texto))) return "";
  const canonico =
    campusAposPalavraCampus(texto, caminhos.baseConhecimentoDir) ||
    campusCanonicoNoTexto(texto, caminhos.baseConhecimentoDir);
  if (canonico) return canonico;
  if (pareceRuidoDeCampus(texto) || /\d/.test(texto) || texto.split(/\s+/).length > 5) return "";
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
  return (
    campusAposPalavraCampus(trecho, caminhos.baseConhecimentoDir) ||
    campusCanonicoNoTexto(trecho, caminhos.baseConhecimentoDir)
  );
}

// ---------------------------------------------------------------- texto

/**
 * Remove o front matter YAML (`---` … `---`) do topo, se houver. Como no Pandoc, o `---` de abertura
 * não pode ser seguido de linha em branco, e o bloco precisa ser um mapa YAML: uma minuta que abre
 * com régua horizontal mantém o texto entre as réguas.
 */
export function removerFrontMatter(texto: string): string {
  const semBom = texto.replace(/^\ufeff/, "");
  const m = /^---[ \t]*\r?\n(?![ \t]*\r?\n)([\s\S]*?\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(semBom);
  return m && chavesDoMapaYaml(m[1]!) ? semBom.slice(m[0].length) : semBom;
}

/** Marca de início de rótulo em negrito (`**NOME DO CURSO:**`), que também fecha o valor anterior. */
const MARCA = "\u0001";

/** Texto legível de um trecho de Markdown, com `MARCA` antes de rótulos em negrito. */
function limparMarkdown(trecho: string): string {
  let texto = trecho
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\*\*([^*\n]{1,80}?:)\s*\*\*/g, `${MARCA}$1 `)
    .replace(/\*\*([^*\n]{1,80}?)\*\*(\s*:)/g, `${MARCA}$1$2`)
    .replace(/\*+/g, "")
    .replace(/(^|[\s(/|])_+/g, "$1")
    .replace(/_+(?=[\s).,:;/|]|$)/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, " ");
  texto = texto.replace(/^\s*(?:#{1,6}\s*|>\s*|[-•●▪◦]\s+)+/, "");
  return colapsarEspacos(texto).trim();
}

/** Minúsculas sem acento, com o mesmo comprimento do texto (posições alinhadas). */
function dobrar(texto: string): string {
  let saida = "";
  for (const unidade of texto.split("")) {
    const base = unidade.normalize("NFD")[0] ?? unidade;
    const minuscula = base.toLowerCase();
    saida += minuscula.length === 1 ? minuscula : base;
  }
  return saida;
}

type Unidade = {
  /** Texto limpo (pode conter `MARCA`). */
  texto: string;
  /** Versão dobrada de `texto`, para casar rótulos. */
  dobrado: string;
  /** Linha de título Markdown ou iniciada por numeração de seção. */
  titulo: boolean;
  numerado: boolean;
  /** Células, se a unidade veio de uma linha de tabela. */
  celulas: string[] | null;
};

const NUMERACAO = /^(?:\d+(?:\.\d+)*\.?|[ivx]+\.)\s*[-–—.)]?\s+/i;

function criarUnidade(texto: string, titulo: boolean, celulas: string[] | null = null): Unidade {
  return {
    texto,
    dobrado: dobrar(texto),
    titulo,
    numerado: NUMERACAO.test(texto.replace(MARCA, "")),
    celulas,
  };
}

/** Linhas não vazias do documento como unidades; `<br>` separa unidades, e tabelas viram uma unidade por célula. */
function unidadesDoDocumento(texto: string, limite: number): Unidade[] {
  const unidades: Unidade[] = [];
  for (const bruta of dividirLinhas(removerFrontMatter(texto).normalize("NFC"))) {
    if (unidades.length >= limite) break;
    const linha = bruta.trim();
    if (!linha) continue;
    const titulo = /^#{1,6}\s/.test(linha);
    if (linha.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(linha)) continue;
      const celulas = linha
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((celula) => limparMarkdown(celula.replace(/<br\s*\/?>/gi, " ")))
        .filter((celula) => celula.replaceAll(MARCA, "").trim());
      if (!celulas.length) continue;
      unidades.push(criarUnidade(celulas.join(" | "), false, celulas));
      continue;
    }
    for (const parte of linha.split(/<br\s*\/?>/i)) {
      const limpo = limparMarkdown(parte);
      if (limpo.replaceAll(MARCA, "").trim()) unidades.push(criarUnidade(limpo, titulo));
    }
  }
  return unidades;
}

// ---------------------------------------------------------------- rótulos

type Campo = "curso" | "campus" | "forma" | "modalidade" | "eixo";

/** Rótulos dos campos, já dobrados (minúsculas sem acento). */
const ROTULOS: Record<Campo, string> = {
  curso: "denominacao(?: do curso)?|nome do curso|titulo do curso|habilitacao(?: profissional)?(?: conferida)?|curso",
  campus: "local de realizacao ?/ ?campus|informacoes do campus|campus|unidade",
  forma: "forma de oferta|forma de articulacao|forma|oferta",
  modalidade: "modalidade(?: de (?:oferta|ensino))?",
  eixo: "eixo tecnologico|eixo",
};

/** Outros rótulos de formulário de identificação, que só servem para terminar um valor. */
const OUTROS_ROTULOS =
  "numero do processo|processo|coordenacao do curso|coordenacao|coordenador(?:a)?(?: do curso)?|nivel|" +
  "tempo (?:de|minimo de|maximo de) (?:duracao|integralizacao)(?: do curso)?|duracao(?: do curso)?|" +
  "turno(?: de oferta| do curso)?|horario(?: de oferta)?(?: do curso)?|(?:total de |numero de )?vagas(?: totais)?|" +
  "requisitos? de acesso(?: ao curso)?|carga[ -]horaria(?: total)?(?: do curso)?|regime(?: academico| de oferta)?|" +
  "periodicidade|endereco|telefone|e-?mail|home-?page|pagina|site|cnpj|instituicoes parceiras|" +
  "escolaridade(?: minima)?(?: exigida)?|formas? de ingresso|local de realizacao|tipo de matricula|ano de [a-z]+|" +
  "resolucao(?: de [a-z]+)?|autorizacao(?: de [a-z]+)?|ato (?:de )?autorizacao";

const TODOS_ROTULOS = new RegExp(`(?:${Object.values(ROTULOS).join("|")}|${OUTROS_ROTULOS})(?![a-z])`, "g");

const PREPOSICAO_ANTES = /\b(?:d[aeo]s?|n[ao]s?|a[os]?|pel[ao]s?|em|para|e)\s*$/;

/**
 * Um rótulo na posição `inicio` vale se estiver no começo do segmento, depois
 * de uma marca de negrito ou de "/"; ou, no meio do texto, se tiver inicial
 * maiúscula, não vier depois de preposição e for seguido de dois-pontos.
 */
function rotuloAceito(unidade: Unidade, inicio: number, fim: number): boolean {
  const antes = unidade.dobrado.slice(0, inicio);
  const antesSemMarca = apararFimEnquanto(antes, (caractere) => /[\s\u0001]/.test(caractere));
  if (!antesSemMarca || antes.endsWith(MARCA) || /\u0001\s*$/.test(antes)) return true;
  if (NUMERACAO.test(antes) && !antes.replace(NUMERACAO, "").trim()) return true;
  if (/[/|]\s*$/.test(antes)) return true;
  const original = unidade.texto[inicio] ?? "";
  if (original === original.toLowerCase()) return false;
  if (PREPOSICAO_ANTES.test(antesSemMarca)) return false;
  return /^\s*:/.test(unidade.dobrado.slice(fim));
}

/** Fim do valor que começa em `inicio`: próxima marca de negrito, `|` ou rótulo aceito seguido de dois-pontos. */
function fimDoValor(unidade: Unidade, inicio: number): number {
  let fim = unidade.dobrado.length;
  const marca = unidade.dobrado.indexOf(MARCA, inicio);
  if (marca >= 0) fim = marca;
  const barra = unidade.dobrado.indexOf(" | ", inicio);
  if (barra >= 0 && barra < fim) fim = barra;
  TODOS_ROTULOS.lastIndex = inicio;
  for (let m = TODOS_ROTULOS.exec(unidade.dobrado); m && m.index < fim; m = TODOS_ROTULOS.exec(unidade.dobrado)) {
    if (m.index === inicio || !/(^|[\s(])$/.test(unidade.dobrado.slice(0, m.index))) continue;
    const depois = unidade.dobrado.slice(m.index + m[0].length);
    const original = unidade.texto[m.index] ?? "";
    if (/^\s*:/.test(depois) && original !== original.toLowerCase()) {
      fim = m.index;
      break;
    }
  }
  return fim;
}

function limparValor(valor: string): string {
  const semInicio = colapsarEspacos(valor.replaceAll(MARCA, " ")).replace(/^[\s:–—-]+/, "");
  return apararFimEnquanto(semInicio, (caractere) => /[\s.;,:–—-]/.test(caractere)).trim();
}

type Candidato = { campo: Campo; valor: string; fonte: "rotulo" };

/** Rótulo de campo que ocupa a unidade inteira (com numeração e dois-pontos opcionais). */
function campoDoRotuloInteiro(dobrado: string): Campo | null {
  const semNumero = dobrado.replaceAll(MARCA, "").trim().replace(NUMERACAO, "").replace(/\s*:$/, "").trim();
  for (const [campo, rotulo] of Object.entries(ROTULOS) as Array<[Campo, string]>) {
    if (new RegExp(`^(?:${rotulo})$`).test(semNumero)) return campo;
  }
  return null;
}

/** Candidatos de rótulo de uma unidade; `proxima` é o valor da unidade seguinte, para rótulos em título. */
function candidatosDaUnidade(unidade: Unidade, proxima: Unidade | undefined): Candidato[] {
  const candidatos: Candidato[] = [];
  if (unidade.celulas) {
    unidade.celulas.forEach((celula, i) => {
      const campo = campoDoRotuloInteiro(dobrar(celula));
      const resto = unidade.celulas!.slice(i + 1).filter((c) => c.replaceAll(MARCA, "").trim());
      // Forma e modalidade em grade de opções ("| MODALIDADE: | PROEJA | INTEGRADO | CONCOMITANTE |"):
      // o valor é a linha inteira, e opções sem marca ficam ambíguas.
      const valor = campo === "forma" || campo === "modalidade" ? resto.join(" ") : resto[0];
      if (campo && valor) candidatos.push({ campo, valor: limparValor(valor), fonte: "rotulo" });
      candidatos.push(...candidatosDaUnidade(criarUnidade(celula, false), undefined));
    });
    return candidatos;
  }

  // Rótulo sozinho na unidade (título "1.1.3 Denominação do Curso" ou "NOME DO CURSO:"): valor na unidade seguinte.
  const campoInteiro = campoDoRotuloInteiro(unidade.dobrado);
  if (campoInteiro) {
    if (proxima && !proxima.celulas && !proxima.numerado && !campoComecaComRotulo(proxima)) {
      candidatos.push({ campo: campoInteiro, valor: limparValor(proxima.texto), fonte: "rotulo" });
    }
    return candidatos;
  }

  for (const [campo, rotulo] of Object.entries(ROTULOS) as Array<[Campo, string]>) {
    const padrao = new RegExp(`(?<![a-z])(?:${rotulo})(?![a-z])`, "g");
    for (const m of unidade.dobrado.matchAll(padrao)) {
      const fimRotulo = m.index + m[0].length;
      if (!rotuloAceito(unidade, m.index, fimRotulo)) continue;
      const resto = unidade.dobrado.slice(fimRotulo);
      const separador = /^\s*[:–—]\s*|^\s+-\s+/.exec(resto);
      // Sem dois-pontos, só vale em título numerado ("1.1.6 Forma de Oferta Integrado").
      const noInicio = !unidade.dobrado.slice(0, m.index).replace(NUMERACAO, "").replaceAll(MARCA, "").trim();
      if (!separador && !(noInicio && (unidade.titulo || unidade.numerado))) continue;
      const inicioValor = fimRotulo + (separador ? separador[0].length : 0);
      const valor = limparValor(unidade.texto.slice(inicioValor, fimDoValor(unidade, inicioValor)));
      if (valor) candidatos.push({ campo, valor, fonte: "rotulo" });
    }
  }
  return candidatos;
}

function campoComecaComRotulo(unidade: Unidade): boolean {
  const semNumero = unidade.dobrado.replaceAll(MARCA, "").trim().replace(NUMERACAO, "");
  return Object.values(ROTULOS).some((rotulo) => new RegExp(`^(?:${rotulo})\\s*:`).test(semNumero));
}

// ---------------------------------------------------------------- validação dos valores

const PALAVRAS_MINUSCULAS = new Set([
  "a",
  "o",
  "e",
  "em",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "com",
  "ao",
  "na",
  "no",
]);

/** "TÉCNICO EM AGROPECUÁRIA" → "Técnico em Agropecuária"; texto em caixa mista fica como está. */
function capitalizar(texto: string): string {
  const letras = texto.replace(/[^\p{L}]/gu, "");
  if (!letras || letras !== letras.toUpperCase()) return texto;
  return texto
    .toLowerCase()
    .split(" ")
    .map((palavra, i) =>
      i > 0 && PALAVRAS_MINUSCULAS.has(palavra) ? palavra : palavra.charAt(0).toUpperCase() + palavra.slice(1),
    )
    .join(" ")
    .replace(/\b(Proeja|Ead)\b/g, (s) => s.toUpperCase());
}

const RUIDO_CURSO =
  /(?<![\p{L}\d])(?:resolu[çc][ãa]o|lei|portaria|parecer|decreto|instru[çc][ãa]o normativa|cne|consup|consepe|n[º°.]|https?|www|\d+\s*h)(?![\p{L}\d])|@|\d{3,}/iu;

const QUALIFICADOR_OFERTA =
  /[\s,–—(-]*\b(?:na forma |na modalidade |modalidade |forma de oferta:? |forma )?(?:articulad[oa] )?(?:integrad[oa]|subsequente|concomitante)(?: (?:ao|com o|com|de) (?:ensino )?m[ée]dio)?\)?\s*$/i;
const QUALIFICADOR_PROEJA = /[\s,–—(-]*\b(?:na modalidade |modalidade )?proeja\)?\s*$/i;
const QUALIFICADOR_EXPERIMENTAL = /[\s,–—(-]*\b(?:em )?oferta experimental\)?\s*$/i;

/**
 * Denominação limpa do curso, ou vazio se o valor não parece nome de curso.
 * Qualificadores de oferta no fim ("Integrado ao Ensino Médio", "PROEJA")
 * saem do nome e voltam como `forma`.
 */
export function limparDenominacaoCurso(valor: string): { curso: string; forma: string } {
  let texto = colapsarEspacos(valor.replaceAll(MARCA, " "))
    .replace(/[\s.;,:–—-]+$/, "")
    .trim();
  // Ruído depois do nome ("Curso Técnico em Mecânica Resolução de Criação: …") é cortado; no início, descarta o valor.
  const ruido = RUIDO_CURSO.exec(texto);
  if (ruido) texto = texto.slice(0, ruido.index).trim();
  if (!texto || !/\p{L}{3}/u.test(texto)) return { curso: "", forma: "" };
  if (ruido && !/\bt[ée]cnico\b/i.test(texto)) return { curso: "", forma: "" };
  texto = capitalizar(texto);
  texto = texto.replace(/^curso\s+(?:de\s+)?(?=\S)/i, "");
  texto = texto.replace(
    /^ensino m[ée]dio integrado (?:(?:ao|com o) (?:curso )?t[ée]cnico )?(?:em|de) /i,
    "Técnico em ",
  );
  let forma = "";
  texto = texto.replace(
    /^(t[ée]cnico)\s+(?:de n[íi]vel m[ée]dio\s+)?(integrado|subsequente|concomitante)?\s*(?:ao ensino m[ée]dio\s+)?(?:em|de)\s+/i,
    (_m, tecnico: string, qualificador: string | undefined) => {
      if (qualificador) forma = qualificador;
      return `${tecnico} em `;
    },
  );
  for (let anterior = ""; anterior !== texto;) {
    anterior = texto;
    texto = texto.replace(QUALIFICADOR_EXPERIMENTAL, "");
    texto = texto.replace(QUALIFICADOR_PROEJA, () => {
      forma = forma ? `${forma} PROEJA` : "PROEJA";
      return "";
    });
    texto = texto.replace(QUALIFICADOR_OFERTA, (m) => {
      forma = forma ? `${m.trim()} ${forma}` : m.trim();
      return "";
    });
    texto = texto.replace(/[\s.;,:–—-]+$/, "").trim();
  }
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (!palavras.length || palavras.length > 12) return { curso: "", forma: "" };
  texto = texto.replace(/^t[ée]cnico\b/i, "Técnico");
  // "Técnico em informática" → "Técnico em Informática", como no CNCT.
  const m = /^(Técnico (?:em|de) )(.+)$/.exec(texto);
  if (m && m[2] === m[2]!.toLowerCase()) texto = m[1] + capitalizar(m[2]!.toUpperCase());
  return { curso: texto, forma };
}

/**
 * Escolha marcada em caixa de seleção: "( X ) Presencial ( ) A distância" →
 * "Presencial"; em grade sem parênteses, o X vem depois da opção
 * ("PROEJA INTEGRADO X CONCOMITANTE" → "INTEGRADO").
 */
function opcaoMarcada(valor: string): string | null {
  const m = /[([]\s*[xX]\s*[)\]]\s*([\p{L}][\p{L} ]*?)(?=\s*[([]|$)/u.exec(valor);
  if (m) return m[1]!;
  const m2 = /([\p{L}][\p{L} ]*?)\s*[([]\s*[xX]\s*[)\]]/u.exec(valor);
  if (m2) return m2[1]!;
  const m3 = /(?<![\p{L}])(\p{L}+)[\s|]+X(?![\p{L}])/u.exec(valor);
  return m3 ? m3[1]! : null;
}

/** Forma de oferta canônica no valor: "Integrado", "Subsequente", "Concomitante" (com "(PROEJA)"), ou vazio. */
export function formaOfertaCanonica(valor: string): string {
  const escolhido = opcaoMarcada(valor) ?? valor;
  const n = normalizarBusca(escolhido);
  const proeja = /\bproeja\b/.test(n);
  const categorias = new Set<string>();
  if (/\bintegrad[oa]s?\b/.test(n)) categorias.add("Integrado");
  if (/\bsubsequentes?\b/.test(n)) categorias.add("Subsequente");
  if (/\bconcomitantes?\b/.test(n)) categorias.add("Concomitante");
  if (proeja && !categorias.size) categorias.add("Integrado");
  if (categorias.size !== 1) return "";
  const forma = [...categorias][0]!;
  return proeja ? `${forma} (PROEJA)` : forma;
}

/** Modalidade de ensino canônica no valor: "Presencial", "A distância" ou vazio. */
export function modalidadeEnsinoCanonica(valor: string): string {
  const escolhido = opcaoMarcada(valor) ?? valor;
  const n = normalizarBusca(escolhido);
  const presencial = /\bpresencial\b/.test(n);
  const distancia = /\b(?:ead|distancia)\b/.test(n);
  if (presencial === distancia) return "";
  return presencial ? "Presencial" : "A distância";
}

let eixosCache: { indice: string; eixos: Array<[string, string]> } | null = null;

/** Eixos tecnológicos do CNCT (`base-conhecimento/catalogos/cnct/index.json`), do nome mais longo ao mais curto. */
function eixosCnct(baseConhecimentoDir: string): Array<[string, string]> {
  const indice = NodePath.join(baseConhecimentoDir, "catalogos", "cnct", "index.json");
  if (eixosCache?.indice === indice) return eixosCache.eixos;
  const nomes = new Set<string>();
  try {
    const payload = NodeFS.existsSync(indice) ? lerJsonPy(indice) : null;
    const itens = ehObjetoPy(payload) && Array.isArray(payload.items) ? payload.items : [];
    for (const item of itens) {
      if (ehObjetoPy(item) && typeof item.eixo_tecnologico === "string") nomes.add(item.eixo_tecnologico);
    }
  } catch {
    nomes.clear();
  }
  const eixos = [...nomes]
    .map((nome): [string, string] => [nome, normalizarBusca(nome)])
    .sort((a, b) => b[1].length - a[1].length);
  eixosCache = { indice, eixos };
  return eixos;
}

const RUIDO_EIXO = /\b(?:nivel|modalidade|previsao|forma|curso|coordenac\w*|campus)\b/;

/**
 * Eixo tecnológico: o nome do CNCT citado no valor ("Eixo de Gestão e
 * Negócios" → "Gestão e Negócios"); sem eixo do CNCT, o valor, se curto e
 * sem cara de outro campo do formulário.
 */
function limparEixo(valor: string, caminhos: CaminhosAnalise = caminhosPadrao()): string {
  const texto = limparValor(valor);
  if (!texto) return "";
  const normalizado = normalizarBusca(texto);
  // Eixo de uma palavra ("Segurança") só por igualdade: "Saúde, Ambiente e Segurança" é outro eixo.
  const eixo = eixosCnct(caminhos.baseConhecimentoDir).find(([, nome]) =>
    nome.includes(" ") ? search(`(^|\\s)${escape(nome)}($|\\s)`, normalizado) : nome === normalizado,
  );
  if (eixo) return eixo[0];
  const palavras = normalizado.split(" ").filter(Boolean);
  if (palavras.length < 2 || palavras.length > 8 || /\d/.test(texto) || RUIDO_CURSO.test(texto)) return "";
  if (RUIDO_EIXO.test(normalizado)) return "";
  return capitalizar(texto);
}

// ---------------------------------------------------------------- capa

/** "CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA: SUBSEQUENTE" na capa. */
const CURSO_NA_CAPA =
  /\b(?:curso )?tecnico (?:de nivel medio )?(?:(?:integrado|subsequente|concomitante) )?(?:em|de) (.+?)(?=\s+(?:forma de oferta|campus|modalidade|eixo|integrado|subsequente|concomitante|autorizad|ajuste|\d{4})\b|\s*[:|]|$)/;

function candidatosDaCapa(unidades: Unidade[]): { curso: string[]; forma: string[] } {
  const curso: string[] = [];
  const forma: string[] = [];
  for (const unidade of unidades) {
    const texto = unidade.texto.replaceAll(MARCA, " ");
    const dobrado = unidade.dobrado.replaceAll(MARCA, " ");
    if (/\b(?:coordenador|professor|docente|diretor|membro)/.test(dobrado)) continue;
    const m = CURSO_NA_CAPA.exec(dobrado);
    if (m) curso.push(texto.slice(m.index, m.index + m[0].length));
    const f = /\b(?:forma de oferta|modalidade)\s*:?\s*(.+)$/.exec(dobrado);
    if (f) forma.push(f[1]!);
    else if (
      /\b(?:integrado ao ensino medio|subsequente|concomitante|proeja)\b/.test(dobrado) &&
      /tecnico|curso/.test(dobrado)
    )
      forma.push(dobrado);
  }
  return { curso, forma };
}

// ---------------------------------------------------------------- extração

function primeiro<T>(itens: Iterable<T>, transformar: (item: T) => string): string {
  for (const item of itens) {
    const valor = transformar(item);
    if (valor) return valor;
  }
  return "";
}

/** Identificação do curso a partir do texto Markdown do PPC, com a fonte de cada campo. */
export function extrairIdentificacao(
  texto: string,
  nomeReserva = "",
  caminhos: CaminhosAnalise = caminhosPadrao(),
): IdentificacaoComFontes {
  const unidades = unidadesDoDocumento(texto, MAX_UNIDADES_IDENTIFICACAO);
  const candidatos = unidades.flatMap((unidade, i) => candidatosDaUnidade(unidade, unidades[i + 1]));
  const doCampo = (campo: Campo) => candidatos.filter((c) => c.campo === campo).map((c) => c.valor);
  const capa = candidatosDaCapa(unidades.slice(0, MAX_UNIDADES_CAPA));
  const fontes: FontesIdentificacao = {};

  // Curso: rótulo com "técnico", qualquer rótulo válido, capa, nome do arquivo.
  const denominacoes = doCampo("curso").map(limparDenominacaoCurso);
  let denominacao =
    denominacoes.find((d) => /^t[ée]cnico /i.test(d.curso)) ?? denominacoes.find((d) => d.curso) ?? null;
  if (denominacao) fontes.curso = "rotulo";
  else {
    denominacao = capa.curso.map(limparDenominacaoCurso).find((d) => /^t[ée]cnico /i.test(d.curso)) ?? null;
    if (denominacao) fontes.curso = "capa";
  }
  let curso = denominacao?.curso ?? "";
  if (!curso && nomeReserva) {
    curso = nomeReserva;
    fontes.curso = "nome_arquivo";
  }

  // Campus: rótulo, "Campus X" no início, campus único no início.
  const inicio = unidades.slice(0, MAX_LINHAS_CAPA_PARA_CAMPUS).map((u) => u.texto.replaceAll(MARCA, " "));
  let campus = primeiro(doCampo("campus"), (valor) => {
    const base = caminhos.baseConhecimentoDir;
    return campusAposPalavraCampus(`campus ${valor}`, base) || campusCanonicoNoTexto(valor, base);
  });
  if (campus) fontes.campus = "rotulo";
  else {
    campus = inferirCampusPorCapa(inicio.join("\n"), caminhos);
    if (campus) fontes.campus = "inicio";
  }

  // Forma de oferta e modalidade: os rótulos se confundem nos PPCs ("Modalidade: Integrado",
  // "Forma de oferta: Presencial"), então cada valor vale pelo que diz, não pelo rótulo.
  const valoresOferta = [...doCampo("forma"), ...doCampo("modalidade")];
  let formaOferta = primeiro(valoresOferta, formaOfertaCanonica);
  if (formaOferta) fontes.forma_oferta = "rotulo";
  else {
    formaOferta = primeiro([denominacao?.forma ?? "", ...capa.forma], formaOfertaCanonica);
    if (formaOferta) fontes.forma_oferta = "capa";
  }
  if (!formaOferta) {
    // Opção marcada fora de rótulo, em grade de formulário ("| SUBSEQUENTE | | X |").
    formaOferta = primeiro(inicio, (linha) => {
      const opcao = opcaoMarcada(linha);
      return opcao ? formaOfertaCanonica(opcao) : "";
    });
    if (formaOferta) fontes.forma_oferta = "inicio";
  }
  if (!formaOferta) {
    formaOferta = formaOfertaCanonica(
      inicio
        .join(" ")
        .match(/\b(?:integrad[oa] ao ensino m[ée]dio|subsequente|concomitante|proeja)\b/gi)
        ?.join(" ") ?? "",
    );
    if (formaOferta) fontes.forma_oferta = "inicio";
  }
  const mencoesProeja = [...valoresOferta, ...capa.forma, denominacao?.forma ?? ""];
  if (
    formaOferta === "Integrado" &&
    mencoesProeja.some((valor) => formaOfertaCanonica(valor) === "Integrado (PROEJA)")
  ) {
    formaOferta = "Integrado (PROEJA)";
  }

  let modalidadeEnsino = primeiro(valoresOferta, modalidadeEnsinoCanonica);
  if (modalidadeEnsino) fontes.modalidade_ensino = "rotulo";
  else {
    modalidadeEnsino = modalidadeEnsinoCanonica(
      inicio
        .join(" ")
        .match(/\b(?:presencial|a dist[âa]ncia|EaD)\b/gi)
        ?.join(" ") ?? "",
    );
    if (modalidadeEnsino) fontes.modalidade_ensino = "inicio";
  }

  const eixo = primeiro(doCampo("eixo"), (valor) => limparEixo(valor, caminhos));
  if (eixo) fontes.eixo_tecnologico = "rotulo";

  const identificacao: IdentificacaoComFontes = {
    curso: curso || "Curso não identificado",
    campus: campus || "Campus não identificado",
    modalidade: formaOferta || "Modalidade não identificada",
    forma_oferta: formaOferta || "Forma de oferta não identificada",
    modalidade_ensino: modalidadeEnsino || "Modalidade de ensino não identificada",
    fontes,
  };
  if (eixo) identificacao.eixo_tecnologico = eixo;
  return identificacao;
}

/** Identificação a partir do Markdown do PPC (sem as fontes). */
export function inferirIdentificacaoDoMarkdown(
  texto: string,
  nomeReserva = "",
  caminhos: CaminhosAnalise = caminhosPadrao(),
): Identificacao {
  const { fontes: _fontes, ...identificacao } = extrairIdentificacao(texto, nomeReserva, caminhos);
  return identificacao;
}

// ---------------------------------------------------------------- conversão DOCX

function valorPorChavesOuPrefixos(
  dados: ObjetoPy,
  chaves: readonly string[],
  prefixos: readonly string[],
  aceitar: (valor: string) => string,
): string {
  for (const chave of chaves) {
    const valor = aceitar(limparValorIdentificacao(dados[chave]));
    if (valor) return valor;
  }
  for (const [chave, bruto] of itensPy(dados)) {
    if (!prefixos.some((prefixo) => chave.startsWith(prefixo))) continue;
    const valor = aceitar(limparValorIdentificacao(bruto));
    if (valor) return valor;
  }
  return "";
}

/**
 * Identificação a partir dos dados da conversão DOCX (`dados_extraidos`), com
 * os mesmos validadores do Markdown: valor que não parece nome de curso,
 * campus, forma de oferta ou modalidade é descartado.
 */
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
      [
        "curso_cnct",
        "denominacao",
        "denominacao_curso",
        "denominacao_do_curso",
        "nome_do_curso",
        "Curso",
        "curso",
        "nome_curso",
      ],
      ["denominacao_", "nome_do_curso_", "curso_"],
      (valor) => limparDenominacaoCurso(valor).curso,
    ) ||
    nomeReserva ||
    "Curso não identificado";
  const campus =
    valorPorChavesOuPrefixos(d, ["campus", "Campus", "unidade"], [], (valor) =>
      normalizarCampusIdentificacao(valor, caminhos),
    ) || "Campus não identificado";
  const chavesOferta = [
    "forma_oferta",
    "Forma de oferta",
    "Forma de Oferta",
    "forma_de_oferta",
    "modalidade_ensino",
    "modalidade",
    "Modalidade",
  ];
  const prefixosOferta = ["forma_de_oferta_", "modalidade_"];
  const formaOferta = valorPorChavesOuPrefixos(d, chavesOferta, prefixosOferta, formaOfertaCanonica);
  const modalidadeEnsino = valorPorChavesOuPrefixos(d, chavesOferta, prefixosOferta, modalidadeEnsinoCanonica);
  const eixo = valorPorChavesOuPrefixos(
    d,
    ["eixo_tecnologico", "Eixo Tecnológico", "Eixo tecnologico"],
    ["eixo_tecnologico_"],
    (valor) => limparEixo(valor, caminhos),
  );
  return {
    curso,
    campus,
    modalidade: formaOferta || "Modalidade não identificada",
    forma_oferta: formaOferta || "Forma de oferta não identificada",
    modalidade_ensino: modalidadeEnsino || "Modalidade de ensino não identificada",
    eixo_tecnologico: eixo || "",
  };
}
