/**
 * Diagnóstico do Markdown convertido de um PDF (`diagnosticarMarkdown`): os trechos que a limpeza
 * determinística (`./limpeza.ts`) não corrige sozinha, com a linha, para a revisão com IA.
 *
 * Cada achado tem um `tipo` (`TIPOS_ACHADO`, com a explicação em `EXPLICACOES`), a linha de início e
 * de fim (1-based, no texto recebido) e o trecho. `regioesDosAchados` agrupa os achados próximos em
 * regiões de até `linhasPorRegiao` linhas, a unidade de trabalho da revisão.
 */
import { MINIMO_CARACTERES_CONTINUACAO, numeroDePagina, textoSemMarcacao } from "./limpeza.ts";

export const TIPOS_ACHADO = [
  "paragrafo-partido",
  "titulo-colado",
  "titulo-provavel",
  "titulo-suspeito",
  "tabela-cabecalho-partido",
  "tabela-palavra-partida",
  "hifen-partido",
  "palavras-coladas",
  "letras-espacadas",
  "caractere-estranho",
  "numero-solto",
] as const;

export type TipoAchado = (typeof TIPOS_ACHADO)[number];

export const EXPLICACOES: Record<TipoAchado, string> = {
  "paragrafo-partido":
    "parágrafo sem pontuação final seguido de outro que começa com maiúscula: pode ser o mesmo parágrafo partido pela página (nome próprio, sigla) ou um rótulo sem dois-pontos",
  "titulo-colado": "título numerado colado no texto que vem depois dele, num item de lista ou parágrafo",
  "titulo-provavel": "linha curta numerada (2.1, 3.4.2) que parece título de seção e não está marcada como título",
  "titulo-suspeito":
    "título longo, terminado em ponto ou começando em minúscula: pode ser um parágrafo marcado como título",
  "tabela-cabecalho-partido":
    "tabela com o cabeçalho espalhado em várias linhas quase vazias (cabeçalho de várias linhas ou células mescladas)",
  "tabela-palavra-partida": "palavra partida entre duas células da mesma linha da tabela",
  "hifen-partido": "palavra partida pela hifenização no fim da linha (estu- dante)",
  "palavras-coladas": "palavras sem o espaço entre elas (INSTITUTOFEDERAL, DivaneDias)",
  "letras-espacadas": "palavra com as letras separadas por espaço (C A M P U S)",
  "caractere-estranho": "caractere de substituição (�), de uso privado ou de controle",
  "numero-solto": "número sozinho num bloco, fora da sequência das páginas",
};

export interface Achado {
  readonly tipo: TipoAchado;
  /** Linha de início, 1-based. */
  readonly linha: number;
  /** Linha de fim, inclusiva. */
  readonly fim: number;
  readonly trecho: string;
}

interface Bloco {
  readonly texto: string;
  readonly linha: number;
  readonly fim: number;
}

/** Os blocos (separados por linha em branco) com a linha de início e de fim de cada um. */
function blocosComLinhas(texto: string, primeiraLinha: number): Bloco[] {
  const linhas = texto.split("\n");
  const blocos: Bloco[] = [];
  let inicio: number | undefined;
  const fechar = (fim: number) => {
    if (inicio === undefined) return;
    blocos.push({
      texto: linhas.slice(inicio, fim + 1).join("\n"),
      linha: inicio + primeiraLinha,
      fim: fim + primeiraLinha,
    });
    inicio = undefined;
  };
  linhas.forEach((linha, i) => {
    if (linha.trim() === "") fechar(i - 1);
    else inicio ??= i;
  });
  fechar(linhas.length - 1);
  return blocos;
}

const trecho = (texto: string, maximo = 160) =>
  texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto.replaceAll("\n", " ⏎ ");

const ehTabela = (b: string) => b.startsWith("|");
const ehTitulo = (b: string) => /^#{1,6}\s/u.test(b);
const ehItem = (b: string) => /^[-*]\s/u.test(b);
const ehTextoCorrido = (b: string) => !ehTabela(b) && !ehTitulo(b) && !b.startsWith("```") && !b.startsWith("<!--");

const RE_FIM_ABERTO = /[\p{L}\p{N},]$/u;
const RE_COMECA_MAIUSCULA = /^(?:[-*]\s+)?\p{Lu}/u;
/**
 * O bloco seguinte que começa outra coisa, e não continua o anterior: rótulo ("EMENTA:",
 * "Carga horária:"), referência bibliográfica ("SOBRENOME, Nome", "BRASIL."), legenda, anexo.
 */
const RE_NAO_CONTINUA =
  /^(?:[\p{L}\s()/º°-]{2,45}:|\p{Lu}[\p{Lu}\s'-]+[,.]|_{3,}|(?:ANEXO|APÊNDICE|Anexo|Apêndice|Quadro|QUADRO|Tabela|TABELA|Figura|FIGURA|Fonte|FONTE|Gráfico)\b)/u;
/** O bloco que é referência bibliográfica: acaba sem ponto sem estar partido. */
const RE_REFERENCIA = /^(?:\p{Lu}[\p{Lu}\s'-]+[,.]|_{3,})/u;
const RE_TITULO_COLADO = /^(?:[-*]\s+)?(?:\*\*)?\d{1,2}(?:\.\d{1,3})+\.?\s+\p{Lu}.{0,110}?[.:]\s+\S/u;
const RE_TITULO_PROVAVEL = /^(?:\*\*)?\d{1,2}(?:\.\d{1,3})+\.?\s+\p{Lu}[^.;:!?|]{2,100}(?:\*\*)?$/u;
const RE_HIFEN_PARTIDO = /\p{Ll}{2,}- \p{Ll}{2,}/u;
// Palavra comum passa de 20 letras ("interdisciplinaridade" tem 21); as coladas do cabeçalho
// institucional são as mais comuns, e as de nome próprio aparecem como "DivaneDias".
const RE_PALAVRAS_COLADAS =
  /\p{L}{24,}|\p{Ll}{3,}\p{Lu}\p{Ll}{3,}|[Ii][Nn][Ss][Tt][Ii][Tt][Uu][Tt][Oo][Ff][Ee][Dd]|[Mm][Ii][Nn][Ii][Ss][Tt][EeÉé][Rr][Ii][Oo][Dd][Aa]/u;
const RE_LETRAS_ESPACADAS = /(?:^|\s)(?:\p{L} ){4,}\p{L}(?:\s|$)/u;
// Com `new RegExp` e o escape dobrado: o formatador troca "\uFFFD" pelo caractere.
const RE_ESTRANHO = new RegExp("[\\uFFFD\\uE000-\\uF8FF\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "u");
// O pedaço da esquerda é curto ("ní|veis", "dos cur|sos"): a palavra inteira na célula ("Componente|sem.") é célula vizinha.
const RE_PALAVRA_ENTRE_CELULAS = /(?:^|[\s|])\p{Ll}{1,4}\|\p{Ll}{2,}/u;
const RE_URL = /https?:\S+|www\.\S+|\S+@\S+/gu;

function celulasVazias(linha: string): number {
  const celulas = linha.replace(/^\||\|$/gu, "").split("|");
  return celulas.filter((c) => c.trim() === "").length / Math.max(1, celulas.length);
}

function achadosDaTabela(bloco: Bloco, achar: (tipo: TipoAchado, linha: number, fim: number, texto: string) => void) {
  const linhas = bloco.texto.split("\n");
  const separador = linhas.findIndex((l) => /^\|(?:\s*:?-{3,}:?\s*\|)+$/u.test(l));
  // As linhas de cabeçalho: a de antes do separador e as quase vazias logo depois dele.
  let quaseVazias = celulasVazias(linhas[0]!) >= 0.5 ? 1 : 0;
  for (let i = separador + 1; i < Math.min(linhas.length, separador + 5); i += 1) {
    if (celulasVazias(linhas[i]!) >= 0.5) quaseVazias += 1;
    else break;
  }
  if (separador >= 0 && quaseVazias >= 3)
    achar("tabela-cabecalho-partido", bloco.linha, bloco.linha + separador + quaseVazias, linhas[0]!);
  linhas.forEach((linha, i) => {
    if (RE_PALAVRA_ENTRE_CELULAS.test(linha.replace(/<br>/gu, " ")))
      achar("tabela-palavra-partida", bloco.linha + i, bloco.linha + i, linha);
  });
}

/**
 * Os achados do texto. `primeiraLinha` é o número da primeira linha de `texto` no arquivo (o corpo
 * começa depois do front matter).
 */
export function diagnosticarMarkdown(texto: string, primeiraLinha = 1): Achado[] {
  const achados: Achado[] = [];
  const achar = (tipo: TipoAchado, linha: number, fim: number, texto: string) =>
    achados.push({ tipo, linha, fim, trecho: trecho(texto) });
  const blocos = blocosComLinhas(texto, primeiraLinha);
  let ultimaPagina: number | undefined;

  blocos.forEach((bloco, i) => {
    const b = bloco.texto;
    const seguinte = blocos[i + 1];
    if (ehTabela(b)) achadosDaTabela(bloco, achar);

    if (ehTextoCorrido(b) && seguinte && ehTextoCorrido(seguinte.texto) && !b.includes("\n")) {
      const texto = textoSemMarcacao(b);
      if (
        texto.length >= MINIMO_CARACTERES_CONTINUACAO &&
        RE_FIM_ABERTO.test(b) &&
        RE_COMECA_MAIUSCULA.test(seguinte.texto) &&
        !/^\*\*.*\*\*$/u.test(b) &&
        !RE_NAO_CONTINUA.test(textoSemMarcacao(seguinte.texto)) &&
        !RE_REFERENCIA.test(texto)
      )
        achar("paragrafo-partido", bloco.linha, seguinte.fim, `${trecho(b, 80)} ⏎ ${trecho(seguinte.texto, 60)}`);
    }

    if (!ehTabela(b) && !ehTitulo(b) && RE_TITULO_COLADO.test(b)) achar("titulo-colado", bloco.linha, bloco.fim, b);
    else if (!ehTabela(b) && !ehTitulo(b) && !ehItem(b) && !b.includes("\n") && RE_TITULO_PROVAVEL.test(b))
      achar("titulo-provavel", bloco.linha, bloco.fim, b);

    if (ehTitulo(b)) {
      const texto = textoSemMarcacao(b);
      if (texto.length > 150 || /\.$/u.test(texto) || /^\p{Ll}/u.test(texto))
        achar("titulo-suspeito", bloco.linha, bloco.fim, b);
    }

    const semUrl = b.replace(RE_URL, " ");
    const linhaDe = (re: RegExp) => {
      const linhas = semUrl.split("\n");
      const indice = linhas.findIndex((l) => re.test(l));
      return bloco.linha + Math.max(0, indice);
    };
    for (const [tipo, re] of [
      ["hifen-partido", RE_HIFEN_PARTIDO],
      ["palavras-coladas", RE_PALAVRAS_COLADAS],
      ["letras-espacadas", RE_LETRAS_ESPACADAS],
      ["caractere-estranho", RE_ESTRANHO],
    ] as const) {
      if (re.test(semUrl)) {
        const linha = linhaDe(re);
        const conteudo = semUrl.split("\n")[linha - bloco.linha] ?? b;
        const posicao = Math.max(0, conteudo.search(re) - 40);
        achar(tipo, linha, linha, conteudo.slice(posicao, posicao + 120));
      }
    }

    const numero = numeroDePagina(b);
    if (numero !== null) {
      const segue =
        ultimaPagina === undefined
          ? numero <= 30
          : (numero > ultimaPagina && numero - ultimaPagina <= 6) || numero <= 3;
      if (segue) ultimaPagina = numero;
      else achar("numero-solto", bloco.linha, bloco.fim, b);
    }
  });
  return achados.sort((a, b) => a.linha - b.linha);
}

export interface Regiao {
  readonly linha: number;
  readonly fim: number;
  readonly achados: ReadonlyArray<Achado>;
}

/** Os achados agrupados em regiões de até `linhasPorRegiao` linhas (os próximos entram juntos). */
export function regioesDosAchados(achados: ReadonlyArray<Achado>, linhasPorRegiao = 80): Regiao[] {
  const regioes: { linha: number; fim: number; achados: Achado[] }[] = [];
  for (const achado of achados) {
    const atual = regioes.at(-1);
    if (atual && achado.fim - atual.linha < linhasPorRegiao) {
      atual.fim = Math.max(atual.fim, achado.fim);
      atual.achados.push(achado);
    } else regioes.push({ linha: achado.linha, fim: achado.fim, achados: [achado] });
  }
  return regioes;
}

/** Quantos achados de cada tipo. */
export function contarAchados(achados: ReadonlyArray<Achado>): Record<TipoAchado, number> {
  const contagem = Object.fromEntries(TIPOS_ACHADO.map((t) => [t, 0])) as Record<TipoAchado, number>;
  for (const achado of achados) contagem[achado.tipo] += 1;
  return contagem;
}
