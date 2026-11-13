/**
 * Normalização determinística do Markdown de PPCs (porte de
 * `conversao_docx/markdown_normalizer.py`): limpa ruídos recorrentes da
 * conversão (paginação, sumário, headings quebrados, parágrafos partidos,
 * tabelas pipe) antes da análise.
 *
 * As expressões regulares são as do Python, traduzidas por
 * `@simplifica-if/kb/python/re` (classes Unicode como no Python).
 */
import { fullmatch, match, search, sub } from "@simplifica-if/kb/python/re";
import { casefold } from "@simplifica-if/kb/python/texto";
import { aparar, apararCaracteres, apararFim, contarCaracteres } from "@simplifica-if/kb/texto";

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

/** Normaliza o Markdown (`MarkdownNormalizer().normalize`). */
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

function consolidarParagrafos(linhas: string[]): string[] {
  const resultado: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    const atual = linhas[indice]!;
    if (!ehParagrafoContinuavel(atual)) {
      resultado.push(atual);
      indice += 1;
      continue;
    }
    let consolidado = aparar(atual);
    while (indice + 1 < linhas.length && deveUnirLinhas(consolidado, linhas[indice + 1]!)) {
      const proxima = aparar(linhas[indice + 1]!);
      consolidado = consolidado.endsWith("-")
        ? apararFim(consolidado.slice(0, -1)) + proxima
        : `${consolidado} ${proxima}`;
      indice += 1;
    }
    resultado.push(consolidado);
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
      normalizadas.push(...normalizarBlocoTabelaPipe(bloco));
      if (indice < linhas.length && aparar(linhas[indice]!)) normalizadas.push("");
      continue;
    }
    normalizadas.push(...bloco);
  }
  return normalizadas;
}

function ehParagrafoContinuavel(linha: string): boolean {
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

function deveUnirLinhas(atualOriginal: string, proximaOriginal: string): boolean {
  const atual = aparar(atualOriginal);
  const proxima = aparar(proximaOriginal);
  if (!atual || !proxima) return false;
  if (!ehParagrafoContinuavel(atual) || !ehParagrafoContinuavel(proxima)) return false;
  if (search("[.!?]$", atual)) return false;
  if (atual.endsWith("-")) return true;
  return Boolean(match("^[a-zà-ÿ0-9(]", proxima));
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

function nivelHeading(titulo: string, reserva = 2): number {
  const m = match(NUMERO_SECAO, titulo);
  if (!m) return Math.max(1, Math.min(reserva, 6));
  const profundidade = contar(m[1]!, ".") + 1;
  return Math.max(1, Math.min(profundidade, 6));
}
