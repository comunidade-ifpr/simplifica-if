/**
 * Normalização determinística do Markdown de PPCs: limpa ruídos recorrentes da
 * conversão (paginação, sumário, headings quebrados, parágrafos partidos,
 * tabelas pipe) antes da análise.
 *
 * As expressões regulares passam por `@simplifica-if/kb/primitivas/regex`
 * (classes Unicode).
 */
import { fullmatch, match, search, sub } from "@simplifica-if/kb/primitivas/regex";
import { casefold } from "@simplifica-if/kb/primitivas/texto";
import { aparar, apararCaracteres, apararFim, contarCaracteres, RE_TEM_ESPACO } from "@simplifica-if/kb/texto";

const r = String.raw;

const PADROES_PAGINACAO: Array<[string, boolean]> = [
  [r`^\s*\d{1,2}/\d{1,2}/\d{4},?\s+\d{1,2}:\d{2}(:\d{2})?\s*$`, false],
  [r`^\s*https?://sei\.ifpr\.edu\.br/sei/controlador\.php\S*\s*$`, true],
  [r`^\s*p[aá]gina\s+\d+(\s+de\s+\d+)?\s*$`, true],
  [r`^\s*pag\.\s*\d+(\s+de\s+\d+)?\s*$`, true],
  [r`^\s*sei/ifpr\s*[-–].*$`, true],
  [r`^\s*documento assinado eletronicamente.*$`, true],
  [r`^\s*consulta autenticidade.*$`, true],
  [r`^\s*c[oó]digo verificador.*$`, true],
];

const TOC_LINHA = r`^\s*\d+(\.\d+)*\s+.+\.{2,}\s*\d+\s*$`;
const TOC_LINHA_SOLTA = r`^\s*(#{1,6}\s*)?\d+(\.\d+)*[.)]?\s+.+\s+\d+\s*$`;
const TOC_PONTILHADO = r`(?:^|\s)\*{0,2}\d+(?:\.\d+)*[.)]?\s*[^.…]{2,}?[.…]{5,}\s*\d+`;
const NUMERO_SECAO = r`^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+?)\s*$`;
const HEADING = r`^\s*(#{1,6})\s*(.+?)\s*$`;
const LISTA = r`^\s*(?:[-*+]|\d+[.)])\s+`;

const TITULOS_SUMARIO = new Set(["sumário", "sumario", "sumário do documento", "sumario do documento"]);

export type ResultadoNormalizacao = {
  markdownBruto: string;
  markdownNormalizado: string;
  linhasBrutas: number;
  linhasNormalizadas: number;
};

function contar(texto: string, trecho: string): number {
  return texto.split(trecho).length - 1;
}

function semBr(texto: string): string {
  return texto.replaceAll("<br>", " ").replaceAll("<br/>", " ").replaceAll("<br />", " ");
}

/** Células de `texto.strip("|").split("|")`, aparadas, sem as vazias quando `semVazias`. */
function celulasSimples(texto: string, semVazias = true): string[] {
  const celulas = apararCaracteres(texto, "|")
    .split("|")
    .map((celula) => aparar(celula));
  return semVazias ? celulas.filter(Boolean) : celulas;
}

/**
 * Nível do título de uma seção de primeiro nível numerada ("1 JUSTIFICATIVA"); a subseção "1.1" fica
 * um abaixo. É 2 (`##`), a convenção dos PPCs da base e do `kb`: `#` fica para o título do documento, e
 * a segmentação de seções do `kb` só toma `##` em diante.
 */
const NIVEL_DA_SECAO = 2;

/** Normaliza o Markdown convertido: quebras de linha, espaços, títulos, listas e tabelas. */
export function normalizarMarkdown(markdown: string): ResultadoNormalizacao {
  const bruto = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll(" ", " ").replaceAll("\t", "    ");
  let linhas = bruto.split("\n");
  linhas = corrigirHeadingQuebrado(linhas);
  linhas = linhas.map(limparLinha);
  linhas = removerRuidos(linhas);
  linhas = removerSumario(linhas);
  linhas = normalizarHeadings(linhas);
  linhas = removerBlocosDuplicados(linhas);
  linhas = consolidarParagrafos(linhas);
  linhas = normalizarTabelasPipe(linhas);
  linhas = colapsarLinhasEmBranco(linhas);
  const normalizado = `${aparar(linhas.join("\n"))}\n`;
  return {
    markdownBruto: bruto,
    markdownNormalizado: normalizado,
    linhasBrutas: bruto ? contar(bruto, "\n") + 1 : 0,
    linhasNormalizadas: normalizado ? contar(normalizado, "\n") + 1 : 0,
  };
}

function limparLinha(linhaOriginal: string): string {
  let linha = apararFim(linhaOriginal);
  if (!linha) return "";
  if (!linha.includes("|")) linha = sub(" {2,}", " ", linha);
  linha = sub(r`\*{4,}`, "**", linha);
  linha = sub(r`\*\*\s+([^*]+?)\s+\*\*`, r`**\1**`, linha);
  linha = sub(r`\s+([,.;:])`, r`\1`, linha);
  return aparar(linha);
}

function corrigirHeadingQuebrado(linhas: string[]): string[] {
  const corrigidas: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    const atual = aparar(linhas[indice]!);
    if (fullmatch("#{1,6}", atual) && indice + 1 < linhas.length) {
      const proxima = aparar(linhas[indice + 1]!);
      if (proxima && !proxima.startsWith("#")) {
        corrigidas.push(`${atual} ${proxima}`);
        indice += 2;
        continue;
      }
    }
    corrigidas.push(linhas[indice]!);
    indice += 1;
  }
  return corrigidas;
}

function removerRuidos(linhas: string[]): string[] {
  const filtradas: string[] = [];
  for (const linha of linhas) {
    const conteudo = aparar(linha);
    if (!conteudo) {
      filtradas.push("");
      continue;
    }
    if (PADROES_PAGINACAO.some(([padrao, ignoreCase]) => match(padrao, conteudo, { ignoreCase }))) continue;
    if (fullmatch("[_\\-–—]{3,}", conteudo)) continue;
    filtradas.push(linha);
  }
  return filtradas;
}

/** Remove blocos de sumário/índice (`remover_sumario`). */
export function removerSumario(linhas: string[]): string[] {
  const resultado: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    const conteudo = aparar(linhas[indice]!);
    if (indice < 260 && ehResiduoSumarioIsolado(conteudo)) {
      indice += 1;
      continue;
    }
    if (ehInicioBlocoSumario(linhas, indice)) {
      indice = fimBlocoSumario(linhas, indice);
      continue;
    }
    if (!ehTituloSumario(conteudo)) {
      resultado.push(linhas[indice]!);
      indice += 1;
      continue;
    }
    indice = fimBlocoSumarioAposTitulo(linhas, indice);
  }
  return resultado;
}

function ehTituloSumario(conteudoOriginal: string): boolean {
  const conteudo = aparar(sub(r`^#{1,6}\s+`, "", conteudoOriginal).replaceAll("*", ""));
  return TITULOS_SUMARIO.has(casefold(conteudo));
}

function linhaContemTituloSumario(conteudo: string): boolean {
  const texto = semBr(sub(r`^#{1,6}\s+`, "", conteudo).replaceAll("*", ""));
  return Boolean(match(r`^\s*sum[aá]rio\b`, texto, { ignoreCase: true }));
}

function janelaNaoVazia(linhas: string[], inicio: number, fim: number): string[] {
  return linhas
    .slice(inicio, Math.min(linhas.length, fim))
    .map((linha) => aparar(linha))
    .filter(Boolean);
}

function ehInicioBlocoSumario(linhas: string[], indice: number): boolean {
  const conteudo = aparar(linhas[indice]!);
  if (!conteudo) return false;
  if (linhaContemTituloSumario(conteudo) && ehLinhaSumario(conteudo)) return true;
  if (linhaTabelaTemTituloSumario(conteudo)) return true;
  if (indice < 250 && linhaTabelaSeparador(conteudo)) {
    const janela = janelaNaoVazia(linhas, indice + 1, indice + 10);
    return janela.filter((linha) => ehLinhaSumario(linha)).length >= 3;
  }
  if (indice < 250 && ehLinhaSumario(conteudo)) {
    const janela = janelaNaoVazia(linhas, indice, indice + 12);
    return janela.filter((linha) => ehLinhaSumario(linha)).length >= 3;
  }
  return false;
}

function fimBlocoSumario(linhas: string[], inicio: number): number {
  let fim = inicio;
  let linhasSumario = 0;
  const tabelaSumario = linhas[inicio]!.includes("|");
  while (fim < linhas.length) {
    const atual = aparar(linhas[fim]!);
    if (!atual) {
      fim += 1;
      continue;
    }
    if (ehLinhaSumario(atual)) {
      linhasSumario += 1;
      fim += 1;
      continue;
    }
    if (tabelaSumario && linhasSumario > 0 && atual.includes("|")) {
      fim += 1;
      continue;
    }
    if (linhasSumario > 0 && ehRuidoEmBlocoSumario(atual)) {
      fim += 1;
      continue;
    }
    if (linhasSumario > 0 && ehContinuacaoTituloSumario(atual)) {
      fim += 1;
      continue;
    }
    break;
  }
  return fim;
}

function fimBlocoSumarioAposTitulo(linhas: string[], inicio: number): number {
  let fim = inicio + 1;
  let viuLinhaSumario = false;
  while (fim < linhas.length) {
    const atual = aparar(linhas[fim]!);
    if (!atual) {
      fim += 1;
      continue;
    }
    if (ehLinhaSumario(atual) || ehLinhaSumarioTextualAposTitulo(atual)) {
      viuLinhaSumario = true;
      fim += 1;
      continue;
    }
    if (ehRuidoEmBlocoSumario(atual)) {
      fim += 1;
      continue;
    }
    if (viuLinhaSumario && ehContinuacaoTituloSumario(atual)) {
      fim += 1;
      continue;
    }
    break;
  }
  return fim;
}

function ehLinhaSumario(conteudo: string): boolean {
  const texto = aparar(semBr(conteudo).replaceAll("**", ""));
  if (linhaTabelaSumario(texto)) return true;
  if (search(TOC_PONTILHADO, texto)) return true;
  if (match(TOC_LINHA, texto) || match(TOC_LINHA_SOLTA, texto)) return true;
  if (texto.includes("|")) {
    const celulas = celulasSimples(aparar(texto));
    if (celulas.length >= 2 && fullmatch(r`\d+`, celulas.at(-1)!)) {
      if (comecaComNumeroSecao(celulas[0]!)) return true;
    }
  }
  return false;
}

function linhaTabelaSumario(conteudo: string): boolean {
  if (!conteudo.includes("|")) return false;
  const texto = aparar(conteudo.replaceAll("**", ""));
  const celulas = celulasSimples(texto, false);
  const naoVazias = celulas.filter(Boolean);
  if (!naoVazias.length) return false;
  if (linhaTabelaTemTituloSumario(texto)) return true;
  if (linhaTabelaSeparador(texto)) return true;
  if (naoVazias.length >= 2 && fullmatch(r`\d+`, naoVazias.at(-1)!)) {
    if (naoVazias.length >= 3 && fullmatch(r`\d{1,2}(\.\d+)*[.)]?`, naoVazias[0]!)) return true;
    return comecaComNumeroSecao(naoVazias[0]!);
  }
  if (naoVazias.length === 1) return Boolean(search(TOC_PONTILHADO, naoVazias[0]!));
  return false;
}

function linhaTabelaTemTituloSumario(conteudo: string): boolean {
  if (!conteudo.includes("|")) return false;
  const texto = aparar(conteudo.replaceAll("**", ""));
  return celulasSimples(texto).some((celula) => ehTituloSumario(celula) || linhaContemTituloSumario(celula));
}

function comecaComNumeroSecao(texto: string): boolean {
  return Boolean(match(r`^\d{1,2}(?:\.\d+)*[.)]?(?=\s|[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]|$)`, texto));
}

function ehLinhaSumarioTextualAposTitulo(conteudo: string): boolean {
  if (!conteudo.includes("|")) return false;
  const celulas = celulasSimples(aparar(conteudo.replaceAll("**", "")));
  if (celulas.length !== 2 || !fullmatch(r`\d+`, celulas.at(-1)!)) return false;
  return Boolean(fullmatch(r`[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9 .,:;()/–-]{6,}`, celulas[0]!));
}

function ehResiduoSumarioIsolado(conteudo: string): boolean {
  let texto = aparar(conteudo.replaceAll("**", "").replaceAll("_", ""));
  if (!search(r`[.…]{5,}\s*\d+`, texto)) return false;
  if (comecaComNumeroSecao(texto)) return true;
  if (texto.includes("|")) {
    const celulas = celulasSimples(texto);
    if (celulas.some((celula) => comecaComNumeroSecao(celula))) return true;
    texto = celulas.join(" ");
  }
  return Boolean(
    match(r`^(REFER[EÊ]NCIAS|ANEXOS?|AP[EÊ]NDICES?|AP[EÊ]NDICE\b|CURRICULARES\b)`, texto, { ignoreCase: true }),
  );
}

function linhaTabelaSeparador(conteudo: string): boolean {
  if (!conteudo.includes("|")) return false;
  const celulas = celulasSimples(aparar(conteudo));
  return celulas.length > 0 && celulas.every((celula) => fullmatch(":?-{3,}:?", celula));
}

function ehRuidoEmBlocoSumario(conteudo: string): boolean {
  const texto = aparar(conteudo.replaceAll("**", ""));
  if (fullmatch(r`\d{1,3}`, texto)) return true;
  if (fullmatch(r`ass\.?:\s*(<br>)?`, texto, { ignoreCase: true })) return true;
  if (fullmatch(r`\d+\s+de\s+\d+`, texto, { ignoreCase: true })) return true;
  const dobrado = casefold(texto);
  return (
    dobrado.startsWith("instituto federal do paraná") ||
    dobrado.startsWith("institutofederal") ||
    dobrado.startsWith("av. ") ||
    dobrado.startsWith("rua ")
  );
}

function ehContinuacaoTituloSumario(conteudo: string): boolean {
  const texto = aparar(conteudo.replaceAll("**", ""));
  if (texto.includes("|")) {
    const celulas = celulasSimples(texto);
    return celulas.length === 1 && !fullmatch(r`\d+`, celulas[0]!);
  }
  return Boolean(fullmatch(r`[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9 ,;:/()–-]{8,}`, texto));
}

function normalizarHeadings(linhas: string[]): string[] {
  const normalizadas: string[] = [];
  let anterior = "";
  for (const linha of linhas) {
    const conteudo = aparar(linha);
    if (!conteudo) {
      normalizadas.push("");
      anterior = "";
      continue;
    }
    const heading = match(HEADING, conteudo);
    if (heading) {
      const titulo = aparar(heading[2]!);
      const nivel = nivelHeading(titulo, heading[1]!.length);
      normalizadas.push(`${"#".repeat(nivel)} ${titulo}`);
      anterior = conteudo;
      continue;
    }
    if (devePromoverAHeading(conteudo, anterior)) {
      normalizadas.push(`${"#".repeat(nivelHeading(conteudo))} ${conteudo}`);
      anterior = conteudo;
      continue;
    }
    normalizadas.push(conteudo);
    anterior = conteudo;
  }
  return normalizadas;
}

function removerBlocosDuplicados(linhas: string[]): string[] {
  const deduplicadas: string[] = [];
  let ultimo: string | null = null;
  for (const linha of linhas) {
    const conteudo = aparar(linha);
    if (conteudo && conteudo === ultimo) continue;
    deduplicadas.push(linha);
    if (conteudo) ultimo = conteudo;
  }
  return deduplicadas;
}

/**
 * Acima deste tamanho, o parágrafo em consolidação é avaliado pelo começo e pelo fim, sem remontar
 * o texto inteiro a cada linha.
 */
const LIMITE_DE_REMONTAGEM = 2048;
/** Primeiro caractere que não é de numeração (`12`, `1.2.`, `3)`). */
const RE_FORA_DA_NUMERACAO = /[^\p{Nd}.)]/u;
const RE_NUMERO_DE_SECAO = /^\p{Nd}+(?:\.\p{Nd}+)*[.)]?$/u;
const RE_NUMERO_DE_LISTA = /^\p{Nd}+[.)]$/u;
const ehEspaco = (caractere: string | undefined) => caractere !== undefined && RE_TEM_ESPACO.test(caractere);

/**
 * Parágrafo que vai recebendo as linhas seguintes. Guarda as partes, e não o texto montado:
 * `ehParagrafoContinuavel` sobre o texto acumulado, a cada linha, custava o quadrado do tamanho (2
 * milhões de parágrafos curtos sem pontuação não terminavam em 10 minutos).
 *
 * As respostas são as mesmas de antes. Num texto longo (mais de 120 caracteres, aparado e sem
 * quebra de linha), `ehParagrafoContinuavel` só depende do último caractere e do começo: os
 * prefixos de título, citação, imagem, tabela e bloco de código, e a numeração inicial com o
 * caractere que vem depois dela, que decidem se o texto é item de lista (`1. texto`) ou título
 * numerado (`1.2 texto`). Esse começo é estável: linhas unidas ao fim não o mudam, e a decisão é
 * tomada uma vez.
 */
class ParagrafoEmConsolidacao {
  readonly #partes: string[];
  #comprimento = 0;
  /** Posição do primeiro caractere fora da numeração inicial; -1 enquanto o texto todo é numeração. */
  #fimDaNumeracao = -1;
  /** O começo do texto não é de lista, título numerado nem de outro bloco; `null` enquanto não decidido. */
  #comecoContinuavel: boolean | null = null;

  /** `texto` já aparado e não vazio. */
  constructor(texto: string) {
    this.#partes = [];
    this.#acrescentar(texto);
  }

  texto(): string {
    return this.#partes.join("");
  }

  #acrescentar(parte: string): void {
    if (this.#fimDaNumeracao < 0) {
      const fora = parte.search(RE_FORA_DA_NUMERACAO);
      if (fora >= 0) this.#fimDaNumeracao = this.#comprimento + fora;
    }
    this.#partes.push(parte);
    this.#comprimento += parte.length;
    // O caractere seguinte ao fim da numeração pode ter acabado de chegar.
    if (this.#comecoContinuavel !== null && this.#comprimento - parte.length <= this.#fimDaNumeracao + 1) {
      this.#comecoContinuavel = null;
    }
  }

  #ultimoCaractere(): string {
    return this.#partes.at(-1)?.at(-1) ?? "";
  }

  /** Tira do fim `quantos` caracteres e, depois, os espaços que sobrarem no fim. */
  #cortarFim(quantos: number): void {
    const ultima = this.#partes.pop()!;
    let resto = ultima.slice(0, ultima.length - quantos);
    this.#comprimento -= ultima.length;
    for (;;) {
      resto = apararFim(resto);
      if (resto || !this.#partes.length) break;
      resto = this.#partes.pop()!;
      this.#comprimento -= resto.length;
    }
    if (resto) {
      this.#partes.push(resto);
      this.#comprimento += resto.length;
    }
    // O corte chegou ao começo estável: o que sobrou antes dele é só numeração, já conferida.
    if (this.#comprimento <= this.#fimDaNumeracao) {
      this.#fimDaNumeracao = -1;
      this.#comecoContinuavel = null;
    } else if (this.#comprimento <= this.#fimDaNumeracao + 2) this.#comecoContinuavel = null;
  }

  /** Junta a linha seguinte (aparada): colada, se o parágrafo termina em hífen; senão, com um espaço. */
  unir(proxima: string): void {
    if (this.#ultimoCaractere() === "-") this.#cortarFim(1);
    else this.#acrescentar(" ");
    this.#acrescentar(proxima);
  }

  /** Os primeiros `quantos` caracteres do texto. */
  #comeco(quantos: number): string {
    let comeco = "";
    for (const parte of this.#partes) {
      if (comeco.length >= quantos) break;
      comeco += parte.length > quantos ? parte.slice(0, quantos) : parte;
    }
    return comeco.slice(0, quantos);
  }

  #decidirComeco(): boolean {
    const numeracao = this.#fimDaNumeracao;
    // Só numeração, sem espaço: não é lista nem título numerado (os dois pedem um espaço depois).
    if (numeracao < 0) return true;
    const comeco = this.#comeco(Math.max(numeracao + 2, 3));
    if (["#", ">", "![", "<", "|", "```"].some((prefixo) => comeco.startsWith(prefixo))) return false;
    const numero = comeco.slice(0, numeracao);
    const depois = comeco[numeracao];
    if (!numero) return !("-*+".includes(depois ?? " ") && ehEspaco(comeco[numeracao + 1]));
    if (!ehEspaco(depois)) return true;
    return !RE_NUMERO_DE_LISTA.test(numero) && !RE_NUMERO_DE_SECAO.test(numero);
  }

  /** `ehParagrafoContinuavel` do texto acumulado. */
  #continuavel(): boolean {
    if (this.#comprimento <= LIMITE_DE_REMONTAGEM) return ehParagrafoContinuavel(this.texto());
    if (this.#ultimoCaractere() === "|") return false;
    this.#comecoContinuavel ??= this.#decidirComeco();
    return this.#comecoContinuavel;
  }

  /** `deveUnirLinhas` entre o texto acumulado e a linha seguinte. */
  deveUnir(proximaOriginal: string): boolean {
    const proxima = aparar(proximaOriginal);
    if (!proxima || !this.#comprimento) return false;
    if (!this.#continuavel() || !ehParagrafoContinuavel(proxima)) return false;
    const ultimo = this.#ultimoCaractere();
    if (ultimo === "." || ultimo === "!" || ultimo === "?") return false;
    if (ultimo === "-") return true;
    return Boolean(match("^[a-zà-ÿ0-9(]", proxima));
  }
}

/** Une ao parágrafo as linhas seguintes que o continuam (texto partido pela conversão). */
export function consolidarParagrafos(linhas: string[]): string[] {
  const resultado: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    const atual = linhas[indice]!;
    if (!ehParagrafoContinuavel(atual)) {
      resultado.push(atual);
      indice += 1;
      continue;
    }
    const consolidado = new ParagrafoEmConsolidacao(aparar(atual));
    while (indice + 1 < linhas.length && consolidado.deveUnir(linhas[indice + 1]!)) {
      consolidado.unir(aparar(linhas[indice + 1]!));
      indice += 1;
    }
    resultado.push(consolidado.texto());
    indice += 1;
  }
  return resultado;
}

function colapsarLinhasEmBranco(linhas: string[]): string[] {
  const colapsadas: string[] = [];
  let ultimaVazia = false;
  for (const linha of linhas) {
    const vazia = !aparar(linha);
    if (vazia && ultimaVazia) continue;
    colapsadas.push(vazia ? "" : linha);
    ultimaVazia = vazia;
  }
  return colapsadas;
}

function normalizarTabelasPipe(linhas: string[]): string[] {
  const normalizadas: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    if (!ehLinhaTabelaPipe(linhas[indice]!)) {
      normalizadas.push(linhas[indice]!);
      indice += 1;
      continue;
    }
    const inicio = indice;
    while (indice < linhas.length && ehLinhaTabelaPipe(linhas[indice]!)) indice += 1;
    const bloco = linhas.slice(inicio, indice);
    if (blocoPareceTabelaPipe(bloco)) {
      if (normalizadas.length && aparar(normalizadas.at(-1)!)) normalizadas.push("");
      for (const item of normalizarBlocoTabelaPipe(bloco)) normalizadas.push(item);
      if (indice < linhas.length && aparar(linhas[indice]!)) normalizadas.push("");
      continue;
    }
    for (const item of bloco) normalizadas.push(item);
  }
  return normalizadas;
}

/** Linha de texto corrido, que pode continuar na seguinte: não é título, lista, tabela, citação, imagem nem bloco de código. */
export function ehParagrafoContinuavel(linha: string): boolean {
  const conteudo = aparar(linha);
  if (!conteudo) return false;
  if (["#", ">", "![", "<"].some((prefixo) => conteudo.startsWith(prefixo))) return false;
  if (conteudo.startsWith("|") || conteudo.endsWith("|")) return false;
  if (match(LISTA, conteudo)) return false;
  if (fullmatch("`{3,}.*", conteudo)) return false;
  if (pareceHeading(conteudo)) return false;
  return true;
}

function devePromoverAHeading(conteudo: string, anterior: string): boolean {
  if (match(LISTA, conteudo)) return false;
  if (match(NUMERO_SECAO, conteudo)) return true;
  if (aparar(anterior)) return false;
  return pareceHeading(conteudo);
}

function ehLinhaTabelaPipe(linha: string): boolean {
  const conteudo = aparar(linha);
  return Boolean(conteudo) && contar(conteudo, "|") >= 2;
}

function blocoPareceTabelaPipe(bloco: string[]): boolean {
  if (bloco.length < 2) return false;
  const processadas = bloco.map(extrairCelulasTabelaPipe);
  if (processadas.some((celulas) => !celulas.length)) return false;
  const totalColunas = processadas[0]!.length;
  if (totalColunas < 2) return false;
  if (processadas.some((celulas) => celulas.length !== totalColunas)) return false;
  return ehLinhaSeparadoraTabelaPipe(bloco[1]!);
}

function normalizarBlocoTabelaPipe(bloco: string[]): string[] {
  const processadas = bloco.map(extrairCelulasTabelaPipe);
  if (!processadas.length) return bloco;
  const normalizadas = [formatarLinhaTabelaPipe(processadas[0]!), formatarSeparadorTabelaPipe(processadas[1]!)];
  for (const celulas of processadas.slice(2)) normalizadas.push(formatarLinhaTabelaPipe(celulas));
  return normalizadas;
}

function extrairCelulasTabelaPipe(linha: string): string[] {
  const conteudo = aparar(linha);
  if (!conteudo) return [];
  let partes: string[] = [];
  let atual = "";
  let escape = false;
  for (const caractere of conteudo) {
    if (caractere === "\\" && !escape) {
      atual += caractere;
      escape = true;
      continue;
    }
    if (caractere === "|" && !escape) {
      partes.push(aparar(atual));
      atual = "";
      continue;
    }
    atual += caractere;
    escape = false;
  }
  partes.push(aparar(atual));
  if (partes.length && partes[0] === "") partes = partes.slice(1);
  if (partes.length && partes.at(-1) === "") partes = partes.slice(0, -1);
  return partes.map((parte) => aparar(parte));
}

function ehLinhaSeparadoraTabelaPipe(linha: string): boolean {
  const celulas = extrairCelulasTabelaPipe(linha);
  if (!celulas.length) return false;
  return celulas.every((celula) => fullmatch(":?-{2,}:?", celula.replaceAll(" ", "")));
}

function formatarLinhaTabelaPipe(celulas: string[]): string {
  return `| ${celulas.map((celula) => aparar(celula)).join(" | ")} |`;
}

function formatarSeparadorTabelaPipe(celulas: string[]): string {
  const separadores = celulas.map((celula) => {
    const bruto = celula.replaceAll(" ", "");
    const largura = Math.max(3, contar(bruto, "-"));
    const tracos = "-".repeat(largura);
    if (bruto.startsWith(":") && bruto.endsWith(":")) return `:${tracos}:`;
    if (bruto.endsWith(":")) return `${tracos}:`;
    if (bruto.startsWith(":")) return `:${tracos}`;
    return tracos;
  });
  return `|${separadores.join("|")}|`;
}

function pareceHeading(conteudo: string): boolean {
  if (match(NUMERO_SECAO, conteudo)) return true;
  if (contarCaracteres(conteudo) > 120) return false;
  const letras = sub("[^A-Za-zÀ-ÿ]", "", conteudo);
  if (!letras) return false;
  return conteudo === conteudo.toUpperCase() && contarCaracteres(letras) >= 6;
}

/** Nível pela numeração (`1.2` é a profundidade 2); sem numeração, o que o título já tinha (`reserva`). */
function nivelHeading(titulo: string, reserva = 2): number {
  const m = match(NUMERO_SECAO, titulo);
  if (!m) return Math.max(1, Math.min(reserva, 6));
  const profundidade = contar(m[1]!, ".") + 1;
  return Math.max(1, Math.min(profundidade + NIVEL_DA_SECAO - 1, 6));
}
